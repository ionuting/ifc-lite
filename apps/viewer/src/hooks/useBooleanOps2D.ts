/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * useBooleanOps2D — polygon boolean operations on selected 2D drawing elements.
 *
 * Uses `polygon-clipping` (Martinez-Rueda-Feito algorithm) to compute:
 *  - union    : merge selected polygons into one shape
 *  - difference: subtract polygon[1..n] from polygon[0]
 *  - intersection: keep only the overlapping area
 *
 * Results are stored as an SVG path string in `booleanResultSvgPath` so they
 * can be rendered as an SVG overlay on top of the 2D section canvas.
 */

import { useCallback } from 'react';
import polygonClipping from 'polygon-clipping';
import type { Polygon as PCPolygon, MultiPolygon as PCMultiPolygon } from 'polygon-clipping';
import { useViewerStore } from '@/store';

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a DrawingPolygon's outer ring + holes into polygon-clipping's
 * ring format: `[outerRing, ...holes]` where each ring is `[x,y][]`.
 */
function toRings(outer: { x: number; y: number }[], holes: { x: number; y: number }[][]): PCPolygon {
  const outerRing = outer.map((p) => [p.x, p.y] as [number, number]);
  const holeRings = holes.map((h) => h.map((p) => [p.x, p.y] as [number, number]));
  return [outerRing, ...holeRings];
}

/**
 * Convert a polygon-clipping MultiPolygon result into an SVG `d` path string.
 * Uses evenodd fill rule — each ring is a subpath.
 */
function multiPolyToSvgPath(multiPoly: PCMultiPolygon): string {
  const parts: string[] = [];
  for (const polygon of multiPoly) {
    for (const ring of polygon) {
      if (ring.length < 2) continue;
      const [first, ...rest] = ring;
      let d = `M ${first[0].toFixed(5)} ${first[1].toFixed(5)}`;
      for (const pt of rest) {
        d += ` L ${pt[0].toFixed(5)} ${pt[1].toFixed(5)}`;
      }
      d += ' Z';
      parts.push(d);
    }
  }
  return parts.join(' ');
}

// ─── hook ─────────────────────────────────────────────────────────────────────

export interface BooleanOps2DResult {
  /** Perform union of all selected polygons */
  applyUnion: () => void;
  /** Subtract polygons [1..n] from polygon [0] (first selected = base) */
  applyDifference: () => void;
  /** Keep only the area shared by all selected polygons */
  applyIntersection: () => void;
  /** Clear / discard the current boolean result overlay */
  clearResult: () => void;
  /** Whether there are enough selected elements to run an operation */
  canRun: boolean;
}

export function useBooleanOps2D(): BooleanOps2DResult {
  const drawing = useViewerStore((s) => s.drawing2D);
  const selectedIds = useViewerStore((s) => s.selectedDrawingEntityIds);
  const setBooleanResult = useViewerStore((s) => s.setBooleanResult);

  const canRun = selectedIds.length >= 2 && drawing !== null;

  /** Collect all cut polygons that belong to the selected entity IDs */
  const collectSubjects = useCallback((): PCPolygon[] => {
    if (!drawing) return [];
    const idSet = new Set(selectedIds);
    const polys: PCPolygon[] = [];
    for (const dp of drawing.cutPolygons) {
      if (idSet.has(dp.entityId)) {
        polys.push(toRings(dp.polygon.outer, dp.polygon.holes));
      }
    }
    return polys;
  }, [drawing, selectedIds]);

  const applyUnion = useCallback(() => {
    if (!canRun) return;
    const subjects = collectSubjects();
    if (subjects.length < 2) return;
    try {
      const result = polygonClipping.union(subjects[0], ...subjects.slice(1));
      const path = multiPolyToSvgPath(result);
      setBooleanResult(path, 'Union');
    } catch {
      // polygon-clipping can throw on degenerate inputs — silently ignore
    }
  }, [canRun, collectSubjects, setBooleanResult]);

  const applyDifference = useCallback(() => {
    if (!canRun) return;
    const subjects = collectSubjects();
    if (subjects.length < 2) return;
    try {
      const result = polygonClipping.difference(subjects[0], ...subjects.slice(1));
      const path = multiPolyToSvgPath(result);
      setBooleanResult(path, 'Difference');
    } catch {
      // ignore degenerate geometry
    }
  }, [canRun, collectSubjects, setBooleanResult]);

  const applyIntersection = useCallback(() => {
    if (!canRun) return;
    const subjects = collectSubjects();
    if (subjects.length < 2) return;
    try {
      const result = polygonClipping.intersection(subjects[0], ...subjects.slice(1));
      const path = multiPolyToSvgPath(result);
      setBooleanResult(path, 'Intersection');
    } catch {
      // ignore degenerate geometry
    }
  }, [canRun, collectSubjects, setBooleanResult]);

  const clearResult = useCallback(() => {
    setBooleanResult(null, null);
  }, [setBooleanResult]);

  return { applyUnion, applyDifference, applyIntersection, clearResult, canRun };
}
