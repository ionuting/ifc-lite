/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** #8446: the viewer's rotate turns a placement that leaves Axis and
 * RefDirection `$`, writing them out, and one Undo restores the record. */
import '@/test/setup-dom.js';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IfcParser } from '@ifc-lite/parser';
import { StepExporter } from '@ifc-lite/export';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { resolvePlacementChain, resolveRotationState } from '@/lib/placement-edit.js';
import { useViewerStore } from '@/store';
import { fixtureModel, fixtureModels } from '@/test/store-fixture';

const MODEL = 'rotate', WALL = 1222;

it('#8446 rotateEntity turns a wall whose placement leaves its directions implicit; one Undo restores it', async () => {
  const bytes = readFileSync(new URL('../../../public/samples/hello-wall.ifc', import.meta.url));
  const parse = (buffer: ArrayBuffer) => new IfcParser().parseColumnar(buffer, { disableWorkerScan: true });
  const sample = await parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  // Re-save the sample with the wall placement as files write it: IFCAXIS2PLACEMENT3D(#pt,$,$).
  const baseline = new MutablePropertyView(null, MODEL), baselineEditor = new StoreEditor(sample, baseline);
  const { axisPlacementId } = resolvePlacementChain(sample, baseline, baselineEditor, WALL)!;
  baselineEditor.setPositionalAttribute(axisPlacementId, 1, null);
  baselineEditor.setPositionalAttribute(axisPlacementId, 2, null);
  const saved = new StepExporter(sample, baseline).export({ schema: 'IFC4', applyMutations: true }).content;
  const store = await parse(saved.slice().buffer as ArrayBuffer);
  const view = new MutablePropertyView(null, MODEL), editor = new StoreEditor(store, view);
  assert.equal(resolveRotationState(store, view, editor, WALL)!.refDirectionId, null, 'sanity: the source leaves RefDirection `$`');
  useViewerStore.setState({ ...fixtureModels({ ...fixtureModel(MODEL), ifcDataStore: store }), mutationViews: new Map([[MODEL, view]]), storeEditors: new Map(), undoStacks: new Map(), redoStacks: new Map(), mutationBatchTags: new Map(), editEnabled: true, collabRoomId: null, canCollabEdit: () => true });
  const text = () => new TextDecoder().decode(new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true, timeStamp: '2026-10-31T00:00:00' }).content);
  const before = text();

  const turned = useViewerStore.getState().rotateEntity(MODEL, WALL, Math.PI / 2);
  assert.equal(turned.ok, true, turned.ok ? '' : turned.reason);
  const state = resolveRotationState(store, view, editor, WALL)!;
  assert.notEqual(state.refDirectionId, null, 'the RefDirection is written out');
  assert.ok(Math.abs(state.yawZ - Math.PI / 2) < 1e-9);

  useViewerStore.getState().undo(MODEL);
  assert.equal(text(), before, 'one Undo restores the original record');
  assert.equal(resolveRotationState(store, view, editor, WALL)!.refDirectionId, null);
});
