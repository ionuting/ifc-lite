/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * useOffsetHandles2D — parametric offset drag handles for the 2D canvas.
 *
 * Reads FlowNodes from the Zustand store (synced by NodeEditorPanel), computes
 * handle positions in IFC world / drawing coordinates, and provides:
 *  - `handles`  — array of OffsetHandle to be rendered by Drawing2DCanvas
 *  - `onHandleMouseDown` — call when a handle is mouse-pressed
 *  - `handleMouseMove` / `handleMouseUp` — forwarded to the canvas container
 *
 * Supported element types (plan view, sectionAxis === 'down'):
 *  wall   → two endpoint handles (offsetStart / offsetEnd along wall axis)
 *  beam   → two endpoint handles (offsetStart / offsetEnd along beam axis)
 *  column → one center handle (offsetX / offsetY free drag)
 *  slab   → four edge-midpoint handles (all update offsetOuter uniformly)
 *  room   → four edge-midpoint handles (all update offsetOuter uniformly)
 */

import React, { useCallback, useRef } from 'react';
import { useViewerStore } from '@/store';

// ─── Public types ──────────────────────────────────────────────────────────

export type OffsetHandleType =
  | 'wall-start' | 'wall-end'
  | 'beam-start' | 'beam-end'
  | 'col-center'
  | 'slab-left' | 'slab-right' | 'slab-bottom' | 'slab-top'
  | 'room-left' | 'room-right' | 'room-bottom' | 'room-top';

export interface OffsetHandle {
  /** Unique handle id, e.g. "wall-1-start" */
  id: string;
  /** ReactFlow node id this handle belongs to */
  nodeId: string;
  /** Offset parameter to modify on drag */
  param: string;
  /** Position in drawing / world coordinates */
  x: number;
  y: number;
  /** Constrained drag axis in drawing coords (unit vector); [0,0] = free */
  dragAxis: [number, number];
  /** Sign: +1 means dragging along axis INCREASES param, -1 means dragging DECREASES it */
  dragSign: number;
  type: OffsetHandleType;
}

// ─── Hook params ───────────────────────────────────────────────────────────

interface Pt { x: number; y: number }

interface UseOffsetHandles2DParams {
  containerRef: React.RefObject<HTMLDivElement>;
  viewTransform: { x: number; y: number; scale: number };
  /** Current section axis — only 'down' (plan) is handled; others return empty handles */
  sectionAxis: string;
}

// ─── Helper ───────────────────────────────────────────────────────────────

function canvasToDrawing(
  cx: number, cy: number,
  vt: { x: number; y: number; scale: number },
  axis: string,
): Pt {
  const scaleX = axis === 'side' ? -vt.scale : vt.scale;
  const scaleY = axis === 'down' ? vt.scale : -vt.scale;
  return { x: (cx - vt.x) / scaleX, y: (cy - vt.y) / scaleY };
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useOffsetHandles2D({
  containerRef,
  viewTransform,
  sectionAxis,
}: UseOffsetHandles2DParams) {
  const flowNodes          = useViewerStore((s) => s.flowNodes);
  const updateFlowNodeData = useViewerStore((s) => s.updateFlowNodeData);

  // ── Drag state ──────────────────────────────────────────────────────────
  const dragRef = useRef<{
    handleId: string;
    nodeId: string;
    param: string;
    startParamValue: number;
    startDraw: Pt;
    axis: [number, number];
    sign: number;
  } | null>(null);

  // ── Compute handles ─────────────────────────────────────────────────────
  const handles: OffsetHandle[] = [];

  // Only compute plan-view handles
  if (sectionAxis === 'down') {
    for (const node of flowNodes) {
      const d = node.data;
      const nid = node.id;

      if (node.type === 'wallNode' || node.type === 'beamNode') {
        const sx   = Number(d.startX ?? 0);
        const sy   = Number(d.startY ?? 0);
        const len  = Number(d.length ?? (node.type === 'wallNode' ? 5 : 5));
        const os   = Number(d.offsetStart ?? 0);
        const oe   = Number(d.offsetEnd   ?? 0);
        // Wall/beam direction is always along +X in local coords (no angle param)
        const ux = 1, uy = 0;

        const prefix = node.type === 'wallNode' ? 'wall' : 'beam';

        // Start handle: at actual start (after offsetStart applied)
        handles.push({
          id: `${nid}-start`,
          nodeId: nid,
          param: 'offsetStart',
          x: sx - os * ux,
          y: sy - os * uy,
          dragAxis: [ux, uy] as [number, number],
          dragSign: -1, // drag in +X direction = offsetStart decreases
          type: `${prefix}-start` as OffsetHandleType,
        });
        // End handle: at actual end (after offsetEnd applied)
        handles.push({
          id: `${nid}-end`,
          nodeId: nid,
          param: 'offsetEnd',
          x: sx + len + oe * ux,
          y: sy        + oe * uy,
          dragAxis: [ux, uy] as [number, number],
          dragSign: 1, // drag in +X direction = offsetEnd increases
          type: `${prefix}-end` as OffsetHandleType,
        });
      }

      if (node.type === 'columnNode') {
        const cx = Number(d.x ?? 0) + Number(d.offsetX ?? 0);
        const cy = Number(d.y ?? 0) + Number(d.offsetY ?? 0);
        handles.push({
          id: `${nid}-center`,
          nodeId: nid,
          param: 'offsetXY', // special: updates both offsetX and offsetY
          x: cx, y: cy,
          dragAxis: [0, 0] as [number, number], // free drag
          dragSign: 1,
          type: 'col-center',
        });
      }

      if (node.type === 'slabNode' || node.type === 'roomNode') {
        const bx  = Number(d.x ?? 0);
        const by  = Number(d.y ?? 0);
        const bw  = Number(d.width ?? (node.type === 'slabNode' ? 10 : 5));
        const bd  = Number(d.depth ?? (node.type === 'slabNode' ? 8 : 4));
        const off = Number(d.offsetOuter ?? 0);
        const prefix = node.type === 'slabNode' ? 'slab' : 'room';

        // Left edge midpoint (drag left = increase offsetOuter)
        handles.push({ id: `${nid}-left`,   nodeId: nid, param: 'offsetOuter', x: bx - off,        y: by + bd / 2,        dragAxis: [1, 0], dragSign: -1, type: `${prefix}-left`   as OffsetHandleType });
        // Right edge midpoint (drag right = increase offsetOuter)
        handles.push({ id: `${nid}-right`,  nodeId: nid, param: 'offsetOuter', x: bx + bw + off,   y: by + bd / 2,        dragAxis: [1, 0], dragSign:  1, type: `${prefix}-right`  as OffsetHandleType });
        // Bottom edge midpoint (drag down = increase offsetOuter)
        handles.push({ id: `${nid}-bottom`, nodeId: nid, param: 'offsetOuter', x: bx + bw / 2,     y: by - off,           dragAxis: [0, 1], dragSign: -1, type: `${prefix}-bottom` as OffsetHandleType });
        // Top edge midpoint (drag up = increase offsetOuter)
        handles.push({ id: `${nid}-top`,    nodeId: nid, param: 'offsetOuter', x: bx + bw / 2,     y: by + bd + off,      dragAxis: [0, 1], dragSign:  1, type: `${prefix}-top`    as OffsetHandleType });
      }
    }
  }

  // ── Hit test: returns handle id or null ─────────────────────────────────
  /** hitRadius in drawing units */
  function hitTest(drawPt: Pt, hitRadius: number): OffsetHandle | null {
    let best: OffsetHandle | null = null;
    let bestDist = hitRadius;
    for (const h of handles) {
      const d = Math.sqrt((drawPt.x - h.x) ** 2 + (drawPt.y - h.y) ** 2);
      if (d < bestDist) { bestDist = d; best = h; }
    }
    return best;
  }

  // ── Mouse down — start drag if over a handle ────────────────────────────
  const onHandleMouseDown = useCallback((e: React.MouseEvent): boolean => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const drawPt = canvasToDrawing(e.clientX - rect.left, e.clientY - rect.top, viewTransform, sectionAxis);
    const hitRadiusPx = 10;
    const hitRadiusDraw = hitRadiusPx / viewTransform.scale;
    const handle = hitTest(drawPt, hitRadiusDraw);
    if (!handle) return false;

    e.preventDefault();
    e.stopPropagation();

    const node = flowNodes.find(n => n.id === handle.nodeId);
    const currentValue = Number(node?.data[handle.param] ?? 0);

    dragRef.current = {
      handleId: handle.id,
      nodeId: handle.nodeId,
      param: handle.param,
      startParamValue: currentValue,
      startDraw: drawPt,
      axis: handle.dragAxis,
      sign: handle.dragSign,
    };
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, viewTransform, sectionAxis, flowNodes]);

  const isDragging = useCallback(() => !!dragRef.current, []);

  // ── Mouse move — update offset value ────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag || !updateFlowNodeData) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const drawPt = canvasToDrawing(e.clientX - rect.left, e.clientY - rect.top, viewTransform, sectionAxis);

    const ddx = drawPt.x - drag.startDraw.x;
    const ddy = drawPt.y - drag.startDraw.y;

    if (drag.param === 'offsetXY') {
      // Column center: free drag → update offsetX and offsetY
      const node = flowNodes.find(n => n.id === drag.nodeId);
      const baseX = Number(node?.data.x ?? 0);
      const baseY = Number(node?.data.y ?? 0);
      const startOX = Number(node?.data.offsetX ?? 0);
      const startOY = Number(node?.data.offsetY ?? 0);
      // We need to track the initial offsetX/Y, not just the sum
      // Use drag.startParamValue as composite; instead recompute from startDraw
      // We stored startParamValue as 0 for this case; recalculate from base position
      const ox = Number(node?.data.startX ?? baseX);  // fall back, doesn't really matter
      void ox; // unused but keeps lint happy
      updateFlowNodeData(drag.nodeId, {
        offsetX: startOX + (ddx * drag.sign),
        offsetY: startOY + (ddy * drag.sign),
      });
    } else {
      // Constrained drag along axis
      const [ax, ay] = drag.axis;
      const delta = ax !== 0 ? ddx : ddy; // project onto axis
      const newValue = drag.startParamValue + delta * drag.sign;
      updateFlowNodeData(drag.nodeId, { [drag.param]: newValue });
    }
  }, [containerRef, viewTransform, sectionAxis, updateFlowNodeData, flowNodes]);

  // ── Mouse up — end drag ─────────────────────────────────────────────────
  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  return { handles, onHandleMouseDown, handleMouseMove, handleMouseUp, isDragging };
}
