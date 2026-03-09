/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * useSnap2D
 *
 * Snap engine for the 2D drawing tools. Given a raw cursor position in
 * drawing coordinates, finds the nearest snap candidate from:
 *  - VERTEX   — exact corner of a cut polygon or line endpoint
 *  - MIDPOINT — midpoint of a polygon edge or line segment
 *  - EDGE     — nearest point on a polygon edge or line segment
 *
 * Returns a SnapResult with the snapped point, type, and screen-pixel distance.
 *
 * Snap priority: VERTEX > MIDPOINT > EDGE
 * Snap threshold: configurable in screen pixels (default 12px)
 */

import { useMemo, useCallback } from 'react';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import type { DrawnShape2D } from '@/store/slices/drawing2DSlice';

export type SnapType = 'vertex' | 'midpoint' | 'edge' | null;

export interface SnapResult {
  point: { x: number; y: number };
  type: SnapType;
  /** Screen-pixel distance from raw cursor to this snap candidate */
  distPx: number;
}

interface Pt { x: number; y: number }

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Nearest point on segment [a,b] to point p, returned with parametric t ∈ [0,1] */
function nearestOnSegment(p: Pt, a: Pt, b: Pt): { pt: Pt; t: number } {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return { pt: a, t: 0 };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return { pt: { x: a.x + t * abx, y: a.y + t * aby }, t };
}

function dist2(a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return dx * dx + dy * dy;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

interface UseSnap2DParams {
  drawing: Drawing2D | null;
  drawnShapes?: DrawnShape2D[];
  /** Current viewport scale (drawing→screen pixels, used to convert threshold) */
  scale: number;
  /** Snap threshold in screen pixels */
  thresholdPx?: number;
  /** Enable/disable specific snap types */
  snapVertex?: boolean;
  snapMidpoint?: boolean;
  snapEdge?: boolean;
}

export function useSnap2D({
  drawing,
  drawnShapes = [],
  scale,
  thresholdPx = 12,
  snapVertex = true,
  snapMidpoint = true,
  snapEdge = true,
}: UseSnap2DParams) {

  /**
   * Build a flat list of segments from IFC geometry + drawn shapes.
   * Re-computed only when drawing / drawnShapes change (not on every mouse move).
   */
  const segments = useMemo<{ a: Pt; b: Pt }[]>(() => {
    const segs: { a: Pt; b: Pt }[] = [];

    if (drawing) {
      // Cut polygons — outer ring + holes
      for (const cp of drawing.cutPolygons) {
        const addRing = (ring: Pt[]) => {
          for (let i = 0; i < ring.length; i++) {
            segs.push({ a: ring[i], b: ring[(i + 1) % ring.length] });
          }
        };
        addRing(cp.polygon.outer);
        for (const hole of cp.polygon.holes ?? []) addRing(hole);
      }
      // Drawing lines
      for (const drawLine of drawing.lines ?? []) {
        segs.push({ a: drawLine.line.start, b: drawLine.line.end });
      }
    }

    // User-drawn shapes
    for (const shape of drawnShapes) {
      switch (shape.type) {
        case 'line':
        case 'polyline':
          for (let i = 0; i + 1 < shape.points.length; i++) {
            segs.push({ a: shape.points[i], b: shape.points[i + 1] });
          }
          break;
        case 'rectangle':
          if (shape.points.length >= 2) {
            const [tl, br] = shape.points;
            const tr = { x: br.x, y: tl.y };
            const bl = { x: tl.x, y: br.y };
            segs.push({ a: tl, b: tr }, { a: tr, b: br }, { a: br, b: bl }, { a: bl, b: tl });
          }
          break;
        // circle/arc: approximate with 32-segment polyline for edge snap
        case 'circle':
        case 'arc': {
          if (shape.points.length < 2) break;
          const [center, edgePt] = shape.points;
          const r = Math.sqrt(dist2(center, edgePt));
          const startA = shape.type === 'arc' ? Math.atan2(edgePt.y - center.y, edgePt.x - center.x) : 0;
          const endA = shape.type === 'arc' && shape.points[2]
            ? Math.atan2(shape.points[2].y - center.y, shape.points[2].x - center.x)
            : startA + Math.PI * 2;
          const n = 32;
          const span = endA - startA;
          for (let i = 0; i < n; i++) {
            const t0 = startA + (span * i) / n;
            const t1 = startA + (span * (i + 1)) / n;
            segs.push({
              a: { x: center.x + r * Math.cos(t0), y: center.y + r * Math.sin(t0) },
              b: { x: center.x + r * Math.cos(t1), y: center.y + r * Math.sin(t1) },
            });
          }
          break;
        }
      }
    }

    return segs;
  }, [drawing, drawnShapes]);

  /**
   * Given a raw cursor position in drawing coords, returns the best snap candidate.
   * Called on every mouse move — must be fast.
   */
  const snap = useCallback((cursor: Pt): SnapResult => {
    const thresholdDrawing = thresholdPx / scale; // threshold in drawing units
    const threshold2 = thresholdDrawing * thresholdDrawing;

    let best: SnapResult = { point: cursor, type: null, distPx: Infinity };

    for (const seg of segments) {
      // ── Vertex candidates ───────────────────────────────────────────────
      if (snapVertex) {
        for (const v of [seg.a, seg.b]) {
          const d2 = dist2(cursor, v);
          if (d2 < threshold2) {
            const distPx = Math.sqrt(d2) * scale;
            if (distPx < best.distPx || (distPx === best.distPx && 'vertex' > (best.type ?? ''))) {
              // prefer vertex over midpoint/edge at equal distance
              if (best.type !== 'vertex' || distPx < best.distPx) {
                best = { point: v, type: 'vertex', distPx };
              }
            }
          }
        }
      }

      // ── Midpoint candidates ─────────────────────────────────────────────
      if (snapMidpoint) {
        const mid: Pt = { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 };
        const d2 = dist2(cursor, mid);
        if (d2 < threshold2) {
          const distPx = Math.sqrt(d2) * scale;
          if (best.type === null || (best.type === 'edge' && distPx < best.distPx) || (best.type === 'midpoint' && distPx < best.distPx)) {
            best = { point: mid, type: 'midpoint', distPx };
          }
        }
      }

      // ── Edge candidates (only if no vertex/midpoint hit) ────────────────
      if (snapEdge) {
        const { pt } = nearestOnSegment(cursor, seg.a, seg.b);
        const d2 = dist2(cursor, pt);
        if (d2 < threshold2) {
          const distPx = Math.sqrt(d2) * scale;
          if (best.type === null || (best.type === 'edge' && distPx < best.distPx)) {
            best = { point: pt, type: 'edge', distPx };
          }
        }
      }
    }

    // Re-apply priority: vertex > midpoint > edge (if both within threshold, prefer higher)
    return best;
  }, [segments, scale, thresholdPx, snapVertex, snapMidpoint, snapEdge]);

  return { snap, segmentCount: segments.length };
}
