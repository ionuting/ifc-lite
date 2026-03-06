/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * transformUtils.ts — shared 3-D transform math and graph helpers used by
 * all element-node compile handlers.
 *
 * Rotation convention: extrinsic XYZ (= intrinsic ZYX Tait-Bryan).
 * Applied order: first Rz, then Ry, then Rx, then translation.
 * All angles are in degrees.
 *
 * Transform list format (stored in TransformNode.transforms):
 *   "tx,ty,tz,rx,ry,rz; tx,ty,tz,rx,ry,rz; ..."
 *   or newline-separated, or both.
 *   Each entry produces ONE instance of the connected element.
 *   Example — 3 columns spaced 5 m apart on X:
 *     "0,0,0,0,0,0\n5,0,0,0,0,0\n10,0,0,0,0,0"
 */

import type { Node, Edge } from '@xyflow/react';

// ─── Data shape ───────────────────────────────────────────────────────────

export interface TransformData {
  tx: number; ty: number; tz: number;   // translation, metres
  rx: number; ry: number; rz: number;   // rotation, degrees
}

const D2R = Math.PI / 180;

// ─── Parsing ──────────────────────────────────────────────────────────────

/**
 * Parses a semicolon- and/or newline-separated list of transform tuples.
 *
 * Each entry is 6 comma-separated numbers: tx, ty, tz, rx°, ry°, rz°.
 * Whitespace around values is trimmed. Empty/invalid entries are skipped.
 *
 * Examples:
 *   "0,0,0,0,0,0"            → 1 entry  (identity)
 *   "0,0,0,0,0,0; 5,0,0,0,0,0" → 2 entries
 *   "0,0,0,0,0,0\n5,0,0,0,0,0" → 2 entries (newline-separated)
 */
export function parseTransformList(str: string): TransformData[] {
  if (!str?.trim()) return [];
  const result: TransformData[] = [];
  for (const entry of str.split(/[;\n]+/)) {
    const parts = entry.trim().split(/[\s,]+/).map(s => parseFloat(s));
    if (parts.length >= 6 && parts.slice(0, 6).every(v => !isNaN(v))) {
      result.push({
        tx: parts[0], ty: parts[1], tz: parts[2],
        rx: parts[3], ry: parts[4], rz: parts[5],
      });
    }
  }
  return result;
}

// ─── Point math ───────────────────────────────────────────────────────────

/**
 * Applies a single transform to a 3-D point.
 * Rotation order: Rz → Ry → Rx (extrinsic XYZ), then translation.
 */
export function applyTransformToPoint(
  [x, y, z]: [number, number, number],
  t: TransformData,
): [number, number, number] {
  // Rz
  const cz = Math.cos(t.rz * D2R), sz = Math.sin(t.rz * D2R);
  const x1 = x * cz - y * sz,  y1 = x * sz + y * cz;

  // Ry
  const cy = Math.cos(t.ry * D2R), sy = Math.sin(t.ry * D2R);
  const x2 =  x1 * cy + z * sy,    z2 = -x1 * sy + z * cy;

  // Rx
  const cx = Math.cos(t.rx * D2R), sx = Math.sin(t.rx * D2R);
  const y3 = y1 * cx - z2 * sx,    z3 =  y1 * sx + z2 * cx;

  return [x2 + t.tx, y3 + t.ty, z3 + t.tz];
}

/**
 * Applies an ordered list of transforms to a point (chain / stack).
 * Returns the original point when `transforms` is empty.
 */
export function applyTransforms(
  point: [number, number, number],
  transforms: TransformData[],
): [number, number, number] {
  return transforms.reduce<[number, number, number]>(
    (p, t) => applyTransformToPoint(p, t),
    point,
  );
}

// ─── Graph helpers ────────────────────────────────────────────────────────

/**
 * Returns a flat list of TransformData instances from ALL TransformNodes
 * wired as sources into `nodeId`. Each TransformNode's `transforms` field
 * is a semicolon/newline list; all entries from all connected nodes are
 * flattened into a single array.
 *
 * This array IS the "instance list" — compile handlers create ONE IFC
 * element per entry, enabling arrays of objects.
 *
 * Returns [] if no TransformNodes are connected → caller creates exactly
 * one instance at the element's local coordinates.
 */
export function resolveTransforms(
  nodeId: string,
  ctx: { nodes: Node[]; edges: Edge[] },
): TransformData[] {
  const result: TransformData[] = [];
  for (const edge of ctx.edges) {
    if (edge.target !== nodeId) continue;
    const src = ctx.nodes.find(n => n.id === edge.source);
    if (!src || src.type !== 'transformNode') continue;
    result.push(...parseTransformList(String(src.data?.['transforms'] ?? '')));
  }
  return result;
}

/** Identity transform — equivalent to no transform applied. */
export const IDENTITY_TF: TransformData = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };
