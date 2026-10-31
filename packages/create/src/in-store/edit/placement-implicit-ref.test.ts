/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Turning an element whose IfcAxis2Placement3D leaves RefDirection `$`
 * (#8446): the directions are written out in the same compound edit, from the
 * renderer's fill (`firstProjAxis`, #5992) rather than an assumed +X, and one
 * undo restores the original record.
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { firstProjAxis } from '@ifc-lite/data';
import { StepExporter } from '@ifc-lite/export';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor, recordCompoundMutation, undoRecordedMutationOperations } from '@ifc-lite/mutations';
import { addOrdinaryElementInStore } from '../ordinary-element.js';
import { resolveSpatialAnchor } from '../resolve-anchor.js';
import { transformElementsInStore } from '../element-transform-edit.js';
import { asDirectionRatios, asExpressIdRef, readPlacementAttributes, resolvePlacementChain, resolveRotationState, rotateProductYaw } from './placement-core.js';

async function wallWithImplicitDirections(axis: [number, number, number] | null) {
  const bytes = await readFile(new URL('../../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
  const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm'), editor = new StoreEditor(store, view);
  const wall = addOrdinaryElementInStore(editor, resolveSpatialAnchor(store, 42, view), {
    kind: 'wall', params: { Start: [0, 10, 0], End: [4, 10, 0], Thickness: 0.2, Height: 3 },
  });
  // As files write it: IFCAXIS2PLACEMENT3D(#pt,$,$), or an explicit Axis with RefDirection `$`.
  const { axisPlacementId } = resolvePlacementChain(store, view, editor, wall)!;
  editor.setPositionalAttribute(axisPlacementId, 1, axis ? `#${editor.addEntity('IfcDirection', [axis]).expressId}` : null);
  editor.setPositionalAttribute(axisPlacementId, 2, null);
  const text = () => new TextDecoder().decode(new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true, timeStamp: '2026-10-31T00:00:00' }).content);
  const directions = () => {
    const attrs = readPlacementAttributes(store, view, editor, axisPlacementId)!;
    const ratios = (slot: number) => {
      const id = asExpressIdRef(attrs[slot]);
      return id === null ? null : asDirectionRatios(readPlacementAttributes(store, view, editor, id)![0]);
    };
    return { axis: ratios(1), refDirection: ratios(2) };
  };
  const undoOnce = () => undoRecordedMutationOperations(view, 1, () => { throw new Error('The turn must be one compound'); });
  return { store, view, editor, wall, text, directions, undoOnce };
}

const close = (actual: readonly number[] | null, expected: readonly number[]) => {
  expect(actual).not.toBeNull();
  actual!.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9));
};

describe('rotating a placement whose RefDirection is implicit (#8446)', () => {
  it('writes Axis and RefDirection, turns the element, and one undo restores the original record', async () => {
    const s = await wallWithImplicitDirections(null);
    expect(resolveRotationState(s.store, s.view, s.editor, s.wall)!.refDirectionId).toBeNull();
    const before = s.text();

    recordCompoundMutation(s.view, draft => transformElementsInStore({
      dataStore: s.store, view: draft, editor: new StoreEditor(s.store, draft),
      selected: [s.wall], op: { kind: 'rotate', pivot: [0, 10], angle: Math.PI / 2 },
    }));
    const turned = resolveRotationState(s.store, s.view, s.editor, s.wall)!;
    expect(turned.refDirectionId).not.toBeNull();
    expect(turned.yawZ).toBeCloseTo(Math.PI / 2, 9);
    // IFC sets Axis and RefDirection together.
    close(s.directions().axis, [0, 0, 1]);
    close(s.directions().refDirection, [0, 1, 0]);

    s.undoOnce();
    expect(s.text()).toBe(before);
    expect(s.directions()).toEqual({ axis: null, refDirection: null });
  });

  it('takes the fill from an explicit tilted Axis, not +X, and one undo restores the original record', async () => {
    const tilted: [number, number, number] = [0.6, 0, 0.8];
    const fill = firstProjAxis(tilted); // (0.8, 0, -0.6)
    const s = await wallWithImplicitDirections(tilted);
    close(resolveRotationState(s.store, s.view, s.editor, s.wall)!.refDirection, fill);
    const before = s.text();

    const result = recordCompoundMutation(s.view, draft => rotateProductYaw(s.store, draft, new StoreEditor(s.store, draft), s.wall, Math.PI / 2));
    expect(result.ok).toBe(true);
    // The Axis is kept; the turn starts from the fill's yaw and keeps its Z.
    close(s.directions().axis, tilted);
    close(s.directions().refDirection, [0, 1, fill[2]]);

    s.undoOnce();
    expect(s.text()).toBe(before);
    close(s.directions().axis, tilted);
    expect(s.directions().refDirection).toBeNull();
  });

  it('leaves an explicit RefDirection in place and only rewrites its ratios', async () => {
    const s = await wallWithImplicitDirections(null);
    recordCompoundMutation(s.view, draft => rotateProductYaw(s.store, draft, new StoreEditor(s.store, draft), s.wall, Math.PI / 2));
    const { refDirectionId } = resolveRotationState(s.store, s.view, s.editor, s.wall)!;
    expect(rotateProductYaw(s.store, s.view, s.editor, s.wall, Math.PI / 2).ok).toBe(true);
    const after = resolveRotationState(s.store, s.view, s.editor, s.wall)!;
    expect(after.refDirectionId).toBe(refDirectionId);
    expect(Math.abs(after.yawZ)).toBeCloseTo(Math.PI, 9);
  });
});
