/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * DrawRectOverlay — settings panel + live SVG preview for the rectangle draw tool.
 *
 * The SVG preview reads screen-space coordinates from the store so it can show
 * the rectangle outline while the user drags without requiring renderer access.
 */

import React, { useCallback } from 'react';
import { X, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';

// IFC element classes supported via addIfcRawBrep
const IFC_TYPES = [
  'IfcBuildingElementProxy',
  'IfcWall',
  'IfcSlab',
  'IfcColumn',
  'IfcBeam',
  'IfcRoof',
  'IfcStair',
] as const;

export function DrawRectOverlay() {
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const drawRectIfcType = useViewerStore((s) => s.drawRectIfcType);
  const drawRectIsWire = useViewerStore((s) => s.drawRectIsWire);
  const drawRectExtrusionHeight = useViewerStore((s) => s.drawRectExtrusionHeight);
  const drawRectScreenStart = useViewerStore((s) => s.drawRectScreenStart);
  const drawRectScreenCurrent = useViewerStore((s) => s.drawRectScreenCurrent);
  const setDrawRectIfcType = useViewerStore((s) => s.setDrawRectIfcType);
  const setDrawRectIsWire = useViewerStore((s) => s.setDrawRectIsWire);
  const setDrawRectExtrusionHeight = useViewerStore((s) => s.setDrawRectExtrusionHeight);
  const clearDrawRectState = useViewerStore((s) => s.clearDrawRectState);

  const handleClose = useCallback(() => {
    clearDrawRectState();
    setActiveTool('select');
  }, [clearDrawRectState, setActiveTool]);

  // Compute rectangle bounds from screen coords for the SVG preview
  const rectPreview = drawRectScreenStart && drawRectScreenCurrent
    ? {
        x: Math.min(drawRectScreenStart.x, drawRectScreenCurrent.x),
        y: Math.min(drawRectScreenStart.y, drawRectScreenCurrent.y),
        width: Math.abs(drawRectScreenCurrent.x - drawRectScreenStart.x),
        height: Math.abs(drawRectScreenCurrent.y - drawRectScreenStart.y),
      }
    : null;

  return (
    <>
      {/* Settings panel */}
      <div className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur-sm rounded-lg border shadow-lg z-30">
        <div className="flex items-center justify-between gap-2 p-2">
          <div className="flex items-center gap-2 px-2 py-1">
            <Square className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Draw Rectangle</span>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={handleClose} title="Close">
            <X className="h-3 w-3" />
          </Button>
        </div>

        <div className="border-t px-3 pb-3 min-w-64 space-y-3">
          {/* IFC Type selector */}
          <div className="mt-3">
            <label className="text-xs text-muted-foreground mb-1 block">IFC Type</label>
            <select
              value={drawRectIfcType}
              onChange={(e) => setDrawRectIfcType(e.target.value)}
              className="w-full text-xs bg-muted px-2 py-1.5 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {IFC_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Wire / Solid toggle */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Geometry</label>
            <div className="flex gap-1">
              <Button
                variant={drawRectIsWire ? 'outline' : 'default'}
                size="sm"
                className="flex-1"
                onClick={() => setDrawRectIsWire(false)}
              >
                Solid
              </Button>
              <Button
                variant={drawRectIsWire ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => setDrawRectIsWire(true)}
              >
                Wire
              </Button>
            </div>
          </div>

          {/* Extrusion height — only visible for solid */}
          {!drawRectIsWire && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Height (m)
              </label>
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.1"
                value={drawRectExtrusionHeight}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!Number.isNaN(v) && v > 0) setDrawRectExtrusionHeight(v);
                }}
                className="w-full text-xs font-mono bg-muted px-2 py-1.5 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          )}
        </div>

        {/* Instruction hint */}
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          Click and drag on the floor plan to draw a rectangle.
        </div>
      </div>

      {/* SVG preview overlay — covers the full viewport, pointer-events disabled */}
      {rectPreview && rectPreview.width > 2 && rectPreview.height > 2 && (
        <svg
          className="pointer-events-none absolute inset-0 w-full h-full z-20"
          style={{ overflow: 'visible' }}
        >
          {/* Fill */}
          <rect
            x={rectPreview.x}
            y={rectPreview.y}
            width={rectPreview.width}
            height={rectPreview.height}
            fill="rgba(59,130,246,0.12)"
            stroke="rgba(59,130,246,0.9)"
            strokeWidth={1.5}
            strokeDasharray="6 3"
          />
          {/* Dimension labels */}
          {rectPreview.width > 40 && (
            <text
              x={rectPreview.x + rectPreview.width / 2}
              y={rectPreview.y - 5}
              textAnchor="middle"
              fontSize="11"
              fill="rgba(59,130,246,0.9)"
              fontFamily="monospace"
            >
              {rectPreview.width.toFixed(0)}px
            </text>
          )}
          {rectPreview.height > 40 && (
            <text
              x={rectPreview.x + rectPreview.width + 5}
              y={rectPreview.y + rectPreview.height / 2}
              dominantBaseline="middle"
              fontSize="11"
              fill="rgba(59,130,246,0.9)"
              fontFamily="monospace"
            >
              {rectPreview.height.toFixed(0)}px
            </text>
          )}
        </svg>
      )}
    </>
  );
}
