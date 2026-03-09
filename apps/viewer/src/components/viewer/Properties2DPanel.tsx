/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Properties2DPanel
 *
 * Slide-in right-side panel for the 2D drawing view. Shows:
 *  - IFC properties of the selected drawing entity (express ID, IFC type, attributes)
 *  - Visual properties of the selected drawn shape (stroke/fill/width)
 *  - Drawing-level properties (scale, units) when nothing is selected
 */

import React, { useCallback } from 'react';
import { X, Layers, Square, Circle, Minus, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import type { DrawnShape2D } from '@/store/slices/drawing2DSlice';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function shapeSummary(shape: DrawnShape2D): Record<string, string> {
  switch (shape.type) {
    case 'line': {
      const len = shape.points.length >= 2 ? dist(shape.points[0], shape.points[1]) : 0;
      return { Length: `${(len * 1000).toFixed(1)} mm` };
    }
    case 'polyline': {
      let total = 0;
      for (let i = 1; i < shape.points.length; i++) total += dist(shape.points[i - 1], shape.points[i]);
      return { Segments: String(shape.points.length - 1), 'Total length': `${(total * 1000).toFixed(1)} mm` };
    }
    case 'rectangle': {
      if (shape.points.length < 2) return {};
      const w = Math.abs(shape.points[1].x - shape.points[0].x);
      const h = Math.abs(shape.points[1].y - shape.points[0].y);
      return {
        Width: `${(w * 1000).toFixed(1)} mm`,
        Height: `${(h * 1000).toFixed(1)} mm`,
        Area: `${(w * h * 1e6).toFixed(0)} mm²`,
      };
    }
    case 'circle': {
      if (shape.points.length < 2) return {};
      const r = dist(shape.points[0], shape.points[1]);
      return {
        Radius: `${(r * 1000).toFixed(1)} mm`,
        Diameter: `${(r * 2000).toFixed(1)} mm`,
        Area: `${(Math.PI * r * r * 1e6).toFixed(0)} mm²`,
      };
    }
    case 'arc': {
      if (shape.points.length < 3) return {};
      const r = dist(shape.points[0], shape.points[1]);
      const a1 = Math.atan2(shape.points[1].y - shape.points[0].y, shape.points[1].x - shape.points[0].x);
      const a2 = Math.atan2(shape.points[2].y - shape.points[0].y, shape.points[2].x - shape.points[0].x);
      let sweep = ((a2 - a1) * 180) / Math.PI;
      if (sweep < 0) sweep += 360;
      return {
        Radius: `${(r * 1000).toFixed(1)} mm`,
        Sweep: `${sweep.toFixed(1)}°`,
      };
    }
    default:
      return {};
  }
}

function shapeIcon(type: DrawnShape2D['type']) {
  switch (type) {
    case 'line': return <Minus className="h-4 w-4" />;
    case 'polyline': return <ChevronRight className="h-4 w-4" />;
    case 'rectangle': return <Square className="h-4 w-4" />;
    case 'circle': return <Circle className="h-4 w-4" />;
    case 'arc': return <Circle className="h-4 w-4 opacity-60" />;
    default: return null;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PropRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-[11px] text-muted-foreground shrink-0">{label}</span>
      <span className="text-[11px] font-mono text-right truncate">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 px-3">{title}</div>
      <div className="px-3">{children}</div>
    </div>
  );
}

// ─── Shape Properties Editor ──────────────────────────────────────────────────

function ShapePropertiesEditor({ shape }: { shape: DrawnShape2D }) {
  const updateDrawnShape2D = useViewerStore((s) => s.updateDrawnShape2D);

  const summary = React.useMemo(() => shapeSummary(shape), [shape]);

  return (
    <>
      <Section title={`${shape.type.charAt(0).toUpperCase()}${shape.type.slice(1)} · Geometry`}>
        {Object.entries(summary).map(([k, v]) => (
          <PropRow key={k} label={k} value={v} />
        ))}
        <PropRow label="Points" value={String(shape.points.length)} />
      </Section>

      <Section title="Style">
        <div className="flex items-center justify-between py-0.5 gap-2">
          <span className="text-[11px] text-muted-foreground">Stroke</span>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={shape.strokeColor}
              onChange={(e) => updateDrawnShape2D(shape.id, { strokeColor: e.target.value })}
              className="w-6 h-6 rounded cursor-pointer border border-border p-0"
            />
            <span className="text-[11px] font-mono">{shape.strokeColor}</span>
          </div>
        </div>

        <div className="flex items-center justify-between py-0.5 gap-2">
          <span className="text-[11px] text-muted-foreground">Line weight</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0.001}
              max={0.1}
              step={0.001}
              value={shape.strokeWidth}
              onChange={(e) => updateDrawnShape2D(shape.id, { strokeWidth: Number(e.target.value) })}
              className="w-20 text-[11px] font-mono border border-border rounded px-1.5 py-0.5 text-right bg-background"
            />
            <span className="text-[10px] text-muted-foreground">m</span>
          </div>
        </div>

        <div className="flex items-center justify-between py-0.5 gap-2">
          <span className="text-[11px] text-muted-foreground">Fill</span>
          <div className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={shape.fillColor !== null}
              onChange={(e) => updateDrawnShape2D(shape.id, { fillColor: e.target.checked ? '#1d4ed820' : null })}
              className="cursor-pointer"
            />
            {shape.fillColor !== null && (
              <input
                type="color"
                value={shape.fillColor.slice(0, 7)}
                onChange={(e) => updateDrawnShape2D(shape.id, { fillColor: e.target.value + '33' })}
                className="w-6 h-6 rounded cursor-pointer border border-border p-0"
              />
            )}
          </div>
        </div>
      </Section>
    </>
  );
}

// ─── IFC Entity Properties ────────────────────────────────────────────────────

function IfcEntityProperties({ entityId, ifcType }: { entityId: number; ifcType: string | null }) {
  return (
    <Section title="IFC Element">
      <PropRow label="Express ID" value={`#${entityId}`} />
      {ifcType && <PropRow label="Type" value={ifcType} />}
      <p className="text-[10px] text-muted-foreground mt-1">
        Open 3D viewer Properties panel for full attribute list.
      </p>
    </Section>
  );
}

// ─── Drawing-level properties ─────────────────────────────────────────────────

function DrawingLevelProperties() {
  const displayOptions = useViewerStore((s) => s.drawing2DDisplayOptions);
  const drawing = useViewerStore((s) => s.drawing2D);
  const drawnShapes2D = useViewerStore((s) => s.drawnShapes2D);
  const clearDrawnShapes2D = useViewerStore((s) => s.clearDrawnShapes2D);

  return (
    <>
      <Section title="Drawing">
        <PropRow label="Scale" value={`1:${displayOptions.scale}`} />
        <PropRow label="Cut polygons" value={String(drawing?.cutPolygons.length ?? 0)} />
        <PropRow label="Lines" value={String(drawing?.lines?.length ?? 0)} />
        <PropRow label="Drawn shapes" value={String(drawnShapes2D.length)} />
      </Section>

      {drawnShapes2D.length > 0 && (
        <Section title="Shapes on drawing">
          {drawnShapes2D.map((s) => (
            <div key={s.id} className="flex items-center gap-1.5 py-0.5 text-[11px] group">
              <span className="text-muted-foreground">{shapeIcon(s.type)}</span>
              <span className="capitalize flex-1">{s.type}</span>
              <DeleteShapeButton id={s.id} />
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="text-[11px] text-destructive w-full mt-1 h-6"
            onClick={clearDrawnShapes2D}
          >
            Clear all shapes
          </Button>
        </Section>
      )}
    </>
  );
}

function DeleteShapeButton({ id }: { id: string }) {
  const removeDrawnShape2D = useViewerStore((s) => s.removeDrawnShape2D);
  return (
    <button
      onClick={() => removeDrawnShape2D(id)}
      className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80 p-0.5 rounded"
      title="Remove shape"
    >
      <X className="h-3 w-3" />
    </button>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function Properties2DPanel() {
  const visible = useViewerStore((s) => s.properties2DPanelVisible);
  const setVisible = useViewerStore((s) => s.setProperties2DPanelVisible);
  const selectedShapeId = useViewerStore((s) => s.selectedShapeId);
  const drawnShapes2D = useViewerStore((s) => s.drawnShapes2D);
  const selectedDrawingEntityId = useViewerStore((s) => s.selectedDrawingEntityId);
  const selectedDrawingEntityIfcType = useViewerStore((s) => s.selectedDrawingEntityIfcType);

  const selectedShape = React.useMemo(
    () => drawnShapes2D.find((s) => s.id === selectedShapeId) ?? null,
    [drawnShapes2D, selectedShapeId]
  );

  const handleClose = useCallback(() => setVisible(false), [setVisible]);

  if (!visible) return null;

  return (
    <div className="absolute top-0 right-0 bottom-0 w-56 bg-background border-l shadow-lg z-20 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/50 shrink-0">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">Properties</span>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={handleClose} className="h-6 w-6">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-2 text-xs">
        {selectedShape ? (
          <>
            {/* Shape icon + type header */}
            <div className="flex items-center gap-2 px-3 pb-2 border-b mb-2">
              <span className="text-muted-foreground">{shapeIcon(selectedShape.type)}</span>
              <span className="font-medium capitalize">{selectedShape.type}</span>
              <span className="ml-auto text-[10px] font-mono text-muted-foreground">{selectedShape.id.slice(-6)}</span>
            </div>
            <ShapePropertiesEditor shape={selectedShape} />
          </>
        ) : selectedDrawingEntityId !== null ? (
          <>
            <div className="flex items-center gap-2 px-3 pb-2 border-b mb-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{selectedDrawingEntityIfcType ?? 'IFC Element'}</span>
            </div>
            <IfcEntityProperties
              entityId={selectedDrawingEntityId}
              ifcType={selectedDrawingEntityIfcType}
            />
          </>
        ) : (
          <DrawingLevelProperties />
        )}
      </div>
    </div>
  );
}
