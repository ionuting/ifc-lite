/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * useDrawingShapes2D
 *
 * Mouse interaction hook for placing drawn shapes (line, polyline, rectangle,
 * circle, arc) on the 2D canvas. Works in drawing coordinates and dispatches
 * to the Zustand slice.
 *
 * Tool behaviour:
 *  - line:      click start → click end → committed
 *  - polyline:  click to add points → double-click to commit (≥2 pts)
 *  - rectangle: click corner → drag/click opposite corner → committed
 *  - circle:    click center → drag/click edge → committed
 *  - arc:       click center → click start-angle pt → click end-angle pt → committed
 */

import React, { useCallback, useRef } from 'react';
import { useViewerStore } from '@/store';
import type { Point2D } from '@/store/slices/drawing2DSlice';
import type { SnapResult } from './useSnap2D';

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

interface UseDrawingShapes2DParams {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewTransform: ViewTransform;
  sectionAxis: 'down' | 'front' | 'side' | string;
  /** Optional snap function from useSnap2D — when provided, snaps raw cursor */
  snapFn?: (cursor: { x: number; y: number }) => SnapResult;
}

export interface DrawingShapes2DHandlers {
  handleMouseDown: (e: React.MouseEvent) => boolean; // returns true if consumed
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseUp: (e: React.MouseEvent) => void;
  handleDoubleClick: (e: React.MouseEvent) => void;
  handleKeyDown: (e: KeyboardEvent) => void;
  /** True when a drawing tool is active (not 'none') */
  isActive: boolean;
  /** Current snap result (null when no snap active) */
  currentSnap: SnapResult | null;
}

// ─── Snap helpers ──────────────────────────────────────────────────────────────

function snapToAngle(from: Point2D, to: Point2D, degreeSnap = 45): Point2D {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const snapped = Math.round(angle / (degreeSnap * (Math.PI / 180))) * (degreeSnap * (Math.PI / 180));
  const d = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
  return { x: from.x + d * Math.cos(snapped), y: from.y + d * Math.sin(snapped) };
}

export function useDrawingShapes2D({
  containerRef,
  viewTransform,
  sectionAxis,
  snapFn,
}: UseDrawingShapes2DParams): DrawingShapes2DHandlers {

  const activeDrawingTool = useViewerStore((s) => s.activeDrawingTool);
  const inProgressPoints = useViewerStore((s) => s.inProgressPoints);
  const addInProgressPoint = useViewerStore((s) => s.addInProgressPoint);
  const setInProgressCursor = useViewerStore((s) => s.setInProgressCursor);
  const commitInProgressShape = useViewerStore((s) => s.commitInProgressShape);
  const cancelInProgressShape = useViewerStore((s) => s.cancelInProgressShape);
  const setActiveDrawingTool  = useViewerStore((s) => s.setActiveDrawingTool);
  const drawingShapeStyle = useViewerStore((s) => s.drawingShapeStyle);
  const addDrawnShape2D = useViewerStore((s) => s.addDrawnShape2D);
  const setSelectedShapeId = useViewerStore((s) => s.setSelectedShapeId);

  // Whether we are mid-drag (mouse down, not yet up) for rectangle / circle
  const dragStartRef = useRef<Point2D | null>(null);
  const isDragCommitRef = useRef(false);
  // Current snap result (exposed to canvas for visual indicator)
  const currentSnapRef = useRef<SnapResult | null>(null);

  // Convert mouse event → drawing coordinates (raw, before snap)
  const toDrawCoords = useCallback((e: React.MouseEvent): Point2D => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const scaleX = sectionAxis === 'side' ? -viewTransform.scale : viewTransform.scale;
    const scaleY = sectionAxis === 'down' ? viewTransform.scale : -viewTransform.scale;
    return {
      x: (mouseX - viewTransform.x) / scaleX,
      y: (mouseY - viewTransform.y) / scaleY,
    };
  }, [containerRef, viewTransform, sectionAxis]);

  const isActive = activeDrawingTool !== 'none';

  /** Apply snap if available, fall back to raw cursor */
  const applySnap = useCallback((raw: Point2D): Point2D => {
    if (!snapFn) return raw;
    const result = snapFn(raw);
    currentSnapRef.current = result.type ? result : null;
    return result.type ? result.point : raw;
  }, [snapFn]);

  // ── Mouse Down ──────────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent): boolean => {
    if (!isActive) return false;
    if (e.button !== 0) return false;

    const raw = toDrawCoords(e);
    const pt = applySnap(raw);

    switch (activeDrawingTool) {
      case 'line':
      case 'polyline':
      case 'circle':
      case 'arc':
        addInProgressPoint(pt);
        break;

      case 'rectangle': {
        // Start drag
        dragStartRef.current = pt;
        addInProgressPoint(pt);
        isDragCommitRef.current = false;
        break;
      }
    }
    return true; // consumed, don't pan
  }, [isActive, activeDrawingTool, toDrawCoords, addInProgressPoint]);

  // ── Mouse Move ──────────────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isActive) return;
    let raw = toDrawCoords(e);

    // Constrain with shift (before snap, so snap wins if closer)
    if (e.shiftKey && inProgressPoints.length > 0) {
      const last = inProgressPoints[inProgressPoints.length - 1];
      raw = snapToAngle(last, raw, 45);
    }

    const pt = applySnap(raw);
    setInProgressCursor(pt);

    // Rectangle: update second point while dragging
    if (activeDrawingTool === 'rectangle' && dragStartRef.current && e.buttons === 1) {
      // We'll render the live second corner via inProgressCursor
    }
  }, [isActive, activeDrawingTool, toDrawCoords, inProgressPoints, setInProgressCursor]);

  // ── Mouse Up ────────────────────────────────────────────────────────────────
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!isActive) return;
    if (activeDrawingTool === 'rectangle' && dragStartRef.current) {
      const raw = toDrawCoords(e);
      const pt = applySnap(raw);
      // Commit only if dragged meaningfully
      const d = Math.sqrt((pt.x - dragStartRef.current.x) ** 2 + (pt.y - dragStartRef.current.y) ** 2);
      if (d > 0.001) {
        // Replace in-progress with final two-point shape
        addInProgressPoint(pt); // endpoint click also serves as commit trigger (2 pts = done for rect)
        // commitInProgressShape checks for min 2 pts
        const shape = {
          id: `shape-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'rectangle' as const,
          points: [dragStartRef.current, pt],
          ...drawingShapeStyle,
        };
        addDrawnShape2D(shape);
        setSelectedShapeId(shape.id);
        cancelInProgressShape();
        dragStartRef.current = null;
        isDragCommitRef.current = true;
      }
    }

    if (activeDrawingTool === 'line') {
      // line needs exactly 2 pts — after 2nd click commit
      const currentPts = inProgressPoints;
      if (currentPts.length >= 1) {
        // Second click was added in mouseDown → now we have 2 → auto-commit after mouseUp if we have end
        // Actually, the second click is in mouseDown, so after mouseDown inProgressPoints has 2 pts
        // We commit after the second mouseDown by checking length again
      }
    }
  }, [isActive, activeDrawingTool, toDrawCoords, addInProgressPoint, drawingShapeStyle, addDrawnShape2D, setSelectedShapeId, cancelInProgressShape, inProgressPoints]);

  // ── Double Click ─────────────────────────────────────────────────────────────
  const handleDoubleClick = useCallback((e: React.MouseEvent): void => {
    if (!isActive) return;

    if (activeDrawingTool === 'polyline') {
      // Remove the extra single-click point added just before dblclick fires
      const pts = useViewerStore.getState().inProgressPoints;
      if (pts.length >= 2) {
        // polyline: commit with current points (remove last since dblclick also fires click)
        const shape = {
          id: `shape-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'polyline' as const,
          points: pts.slice(0, -1), // drop last redundant click
          ...drawingShapeStyle,
        };
        if (shape.points.length >= 2) {
          addDrawnShape2D(shape);
          setSelectedShapeId(shape.id);
        }
        cancelInProgressShape();
      }
    }
  }, [isActive, activeDrawingTool, drawingShapeStyle, addDrawnShape2D, setSelectedShapeId, cancelInProgressShape]);

  // ── Key Down ─────────────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isActive) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      dragStartRef.current = null;
      currentSnapRef.current = null;
      cancelInProgressShape();
      setActiveDrawingTool('none');
    }
    if (e.key === 'Enter') {
      // Commit polyline / arc on Enter too
      if (activeDrawingTool === 'polyline' || activeDrawingTool === 'arc') {
        e.preventDefault();
        commitInProgressShape();
      }
    }
  }, [isActive, activeDrawingTool, cancelInProgressShape, commitInProgressShape, setActiveDrawingTool]);

  // ── Auto-commit for single-gesture tools ────────────────────────────────────
  // Check after each addInProgressPoint whether we've reached the required count
  React.useEffect(() => {
    const requiredPoints: Record<string, number> = { line: 2, circle: 2, arc: 3 };
    const required = requiredPoints[activeDrawingTool];
    if (required === undefined) return;
    if (inProgressPoints.length === required) {
      const shape = {
        id: `shape-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: activeDrawingTool as 'line' | 'circle' | 'arc',
        points: [...inProgressPoints],
        ...drawingShapeStyle,
      };
      addDrawnShape2D(shape);
      setSelectedShapeId(shape.id);
      cancelInProgressShape();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inProgressPoints.length]);

  return { handleMouseDown, handleMouseMove, handleMouseUp, handleDoubleClick, handleKeyDown, isActive, currentSnap: currentSnapRef.current };
}
