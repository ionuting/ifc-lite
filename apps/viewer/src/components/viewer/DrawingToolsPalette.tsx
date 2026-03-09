/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * DrawingToolsPalette
 *
 * Vertical floating toolbar docked to the left edge of the 2D canvas.
 * Provides:
 *  - Selection / pan
 *  - Element picker (select-element)
 *  - Drawing tools: line, polyline, rectangle, circle, arc
 *  - Boolean operations (union, difference, intersection) when 2+ elements selected
 *  - Properties panel toggle
 */

import React from 'react';
import {
  MousePointer2,
  Crosshair,
  Minus,
  Square,
  Circle,
  Spline,
  Merge,
  Scissors,
  CopyCheck,
  PanelRight,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import type { Annotation2DTool, DrawingTool2D } from '@/store/slices/drawing2DSlice';

// ─── Icon for polyline (SVG inline, lucide doesn't have one) ─────────────────
function PolylineIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="4" cy="20" r="2" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="20" cy="14" r="2" />
      <polyline points="5.5,18.5 10.5,5.5 18.5,13" />
    </svg>
  );
}

// ─── Icon for arc ─────────────────────────────────────────────────────────────
function ArcIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 18 Q12 4 20 18" />
      <circle cx="4" cy="18" r="2" />
      <circle cx="20" cy="18" r="2" />
      <circle cx="12" cy="9" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'destructive';
}

function ToolButton({ icon, label, active, onClick, disabled, variant = 'default' }: ToolButtonProps) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={active ? 'default' : variant === 'destructive' ? 'ghost' : 'ghost'}
            size="icon-sm"
            onClick={onClick}
            disabled={disabled}
            className={`w-8 h-8 ${active ? '' : variant === 'destructive' ? 'text-destructive hover:text-destructive' : ''}`}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Divider() {
  return <div className="w-5 h-px bg-border my-0.5 mx-auto" />;
}

export interface DrawingToolsPaletteProps {
  /** Called when clicking on the properties panel toggle */
  onToggleProperties?: () => void;
}

export function DrawingToolsPalette({ onToggleProperties }: DrawingToolsPaletteProps) {
  const annotation2DActiveTool = useViewerStore((s) => s.annotation2DActiveTool);
  const setAnnotation2DActiveTool = useViewerStore((s) => s.setAnnotation2DActiveTool);
  const activeDrawingTool = useViewerStore((s) => s.activeDrawingTool);
  const setActiveDrawingTool = useViewerStore((s) => s.setActiveDrawingTool);
  const selectedDrawingEntityIds = useViewerStore((s) => s.selectedDrawingEntityIds);
  const selectedShapeId = useViewerStore((s) => s.selectedShapeId);
  const drawnShapes2D = useViewerStore((s) => s.drawnShapes2D);
  const removeDrawnShape2D = useViewerStore((s) => s.removeDrawnShape2D);
  const properties2DPanelVisible = useViewerStore((s) => s.properties2DPanelVisible);
  const inProgressPoints = useViewerStore((s) => s.inProgressPoints);
  const cancelInProgressShape = useViewerStore((s) => s.cancelInProgressShape);

  // Boolean ops
  const { applyUnion, applyDifference, applyIntersection, canRun: canRunBoolean } = useBooleanOps();
  const canBoolean = canRunBoolean && selectedDrawingEntityIds.length >= 2;

  // Switch annotation tool (pan / select-element)
  const setAnnotationTool = (tool: Annotation2DTool) => {
    cancelInProgressShape();
    setActiveDrawingTool('none');
    setAnnotation2DActiveTool(tool);
  };

  // Switch drawing tool (line / polyline / rect / circle / arc)
  const setDrawTool = (tool: DrawingTool2D) => {
    cancelInProgressShape();
    setAnnotation2DActiveTool('none');
    setActiveDrawingTool(activeDrawingTool === tool ? 'none' : tool);
  };

  const isAnnotation = (tool: Annotation2DTool) =>
    annotation2DActiveTool === tool && activeDrawingTool === 'none';

  const isDrawing = (tool: DrawingTool2D) => activeDrawingTool === tool;

  return (
    <div className="absolute left-2 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-0.5 bg-background/95 border rounded-lg shadow-md px-1 py-1.5 select-none">

      {/* ── Selection tools ────────────────────────────────────── */}
      <ToolButton
        icon={<MousePointer2 className="h-4 w-4" />}
        label="Select / Pan  (V)"
        active={isAnnotation('none')}
        onClick={() => setAnnotationTool('none')}
      />
      <ToolButton
        icon={<Crosshair className="h-4 w-4" />}
        label="Select Element  (E)"
        active={isAnnotation('select-element')}
        onClick={() => setAnnotationTool(annotation2DActiveTool === 'select-element' ? 'none' : 'select-element')}
      />

      <Divider />

      {/* ── Drawing tools ──────────────────────────────────────── */}
      <ToolButton
        icon={<Minus className="h-4 w-4" />}
        label="Line  (L)"
        active={isDrawing('line')}
        onClick={() => setDrawTool('line')}
      />
      <ToolButton
        icon={<PolylineIcon className="h-4 w-4" />}
        label="Polyline  (P)"
        active={isDrawing('polyline')}
        onClick={() => setDrawTool('polyline')}
      />
      <ToolButton
        icon={<Square className="h-4 w-4" />}
        label="Rectangle  (R)"
        active={isDrawing('rectangle')}
        onClick={() => setDrawTool('rectangle')}
      />
      <ToolButton
        icon={<Circle className="h-4 w-4" />}
        label="Circle  (C)"
        active={isDrawing('circle')}
        onClick={() => setDrawTool('circle')}
      />
      <ToolButton
        icon={<ArcIcon className="h-4 w-4" />}
        label="Arc  (A)"
        active={isDrawing('arc')}
        onClick={() => setDrawTool('arc')}
      />

      {/* In-progress indicator & cancel */}
      {inProgressPoints.length > 0 && (
        <>
          <Divider />
          <div className="text-[9px] text-muted-foreground text-center leading-none py-0.5">
            {inProgressPoints.length}pt
          </div>
          <ToolButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Cancel current shape  (Esc)"
            active={false}
            onClick={cancelInProgressShape}
            variant="destructive"
          />
        </>
      )}

      {/* Delete selected drawn shape */}
      {selectedShapeId && drawnShapes2D.some((s) => s.id === selectedShapeId) && (
        <>
          <Divider />
          <ToolButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Delete selected shape  (Del)"
            active={false}
            onClick={() => removeDrawnShape2D(selectedShapeId)}
            variant="destructive"
          />
        </>
      )}

      {/* ── Boolean ops ────────────────────────────────────────── */}
      {canBoolean && (
        <>
          <Divider />
          <ToolButton
            icon={<Merge className="h-4 w-4" />}
            label={`Union  (${selectedDrawingEntityIds.length} shapes)`}
            active={false}
            onClick={applyUnion}
          />
          <ToolButton
            icon={<Scissors className="h-4 w-4" />}
            label="Difference  (subtract [1..n] from [0])"
            active={false}
            onClick={applyDifference}
          />
          <ToolButton
            icon={<CopyCheck className="h-4 w-4" />}
            label="Intersection"
            active={false}
            onClick={applyIntersection}
          />
        </>
      )}

      <Divider />

      {/* Properties panel toggle */}
      <ToolButton
        icon={<PanelRight className="h-4 w-4" />}
        label="Properties panel  (I)"
        active={properties2DPanelVisible}
        onClick={() => onToggleProperties?.()}
      />
    </div>
  );
}

// ─── local hook to avoid circular import with useBooleanOps2D ──────────────────
function useBooleanOps() {
  const selectedDrawingEntityIds = useViewerStore((s) => s.selectedDrawingEntityIds);
  const drawing = useViewerStore((s) => s.drawing2D);
  const setBooleanResult = useViewerStore((s) => s.setBooleanResult);

  const canRun = selectedDrawingEntityIds.length >= 2 && drawing !== null;

  // Lazy import to avoid circular dep — inline the minimal logic here
  const runOp = React.useCallback((op: 'union' | 'difference' | 'intersection') => {
    if (!drawing || selectedDrawingEntityIds.length < 2) return;
    import('polygon-clipping').then(({ default: polygonClipping }) => {
      type Ring = [number, number][];
      type PCPolygon = [Ring, ...Ring[]];
      type PCMultiPolygon = PCPolygon[][];

      const toRings = (entityId: number): PCPolygon | null => {
        const polys = drawing.cutPolygons.filter((p) => p.entityId === entityId);
        if (!polys.length) return null;
        const outer: Ring = polys[0].polygon.outer.map((pt) => [pt.x, pt.y] as [number, number]);
        const holes: Ring[] = (polys[0].polygon.holes ?? []).map((h) =>
          h.map((pt) => [pt.x, pt.y] as [number, number])
        );
        return [outer, ...holes];
      };

      const polygons = selectedDrawingEntityIds.map(toRings).filter(Boolean) as PCPolygon[];
      if (polygons.length < 2) return;
      const [subject, ...clippers] = polygons;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let result: PCMultiPolygon;
      try {
        if (op === 'union') result = polygonClipping.union(subject, ...clippers) as unknown as PCMultiPolygon;
        else if (op === 'difference') result = polygonClipping.difference(subject, ...clippers) as unknown as PCMultiPolygon;
        else result = polygonClipping.intersection(subject, ...clippers) as unknown as PCMultiPolygon;
      } catch {
        return;
      }

      const d = result.flatMap((poly) =>
        poly.map((ring) => {
          const pts = ring.map(([x, y]) => `${x},${y}`).join(' L ');
          return `M ${pts} Z`;
        })
      ).join(' ');

      const label = op === 'union' ? 'Union' : op === 'difference' ? 'Difference' : 'Intersection';
      setBooleanResult(d || null, label);
    });
  }, [drawing, selectedDrawingEntityIds, setBooleanResult]);

  return {
    canRun,
    applyUnion: () => runOp('union'),
    applyDifference: () => runOp('difference'),
    applyIntersection: () => runOp('intersection'),
  };
}
