/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BubbleGraphPlanSVG — architectural 2D floor-plan SVG renderer.
 *
 * Consumes BubbleGraph node/edge state and emits a standards-compliant SVG
 * floor-plan view that respects the same ObjectStylesConfig used by the
 * mesh-based SVGExporter.  This means every pen weight, color, and hatch
 * pattern can be controlled from a single place — the Object Styles table.
 *
 * Supported element types:
 *   ax  + has_column=True  → <rect> (actual section dimensions from geometryLibrary)
 *   wall  (ax–ax edge)     → <rect> (thickness from geometryLibrary, centered on axis)
 *   beam  (ax–ax edge)     → <line> (centerline, projected plan width)
 *   room / shell (ax loop) → <polygon>
 *   slab  (ax loop)        → <polygon>
 *   Building axes grid     → <line> annotation layer
 *
 * All coordinates are in mm (same as BubbleGraphNode.x / .y).
 * The viewBox is auto-fitted to the drawn content plus padding.
 */

import React, { useMemo } from 'react';
import type { BubbleGraphNode, BubbleGraphEdge, BuildingAxes } from '@/store/slices/bubbleGraphSlice';
import {
  resolveObjectStyle,
  LINE_PATTERN_DASH_ARRAYS,
  DEFAULT_OBJECT_STYLES,
  type ObjectStylesConfig,
  type ObjectStyleHatch,
} from '@ifc-lite/drawing-2d';
import { getGeometryDefinition } from './geometryResolver';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Resolve the 2D plan position of an ax node (mm). */
function resolveAxPos(ax: BubbleGraphNode, buildingAxes: BuildingAxes): { x: number; y: number } {
  const gx = ax.properties.gridX as number | undefined;
  const gy = ax.properties.gridY as number | undefined;
  if (
    gx != null &&
    gy != null &&
    gx < buildingAxes.xValues.length &&
    gy < buildingAxes.yValues.length
  ) {
    return { x: buildingAxes.xValues[gx], y: buildingAxes.yValues[gy] };
  }
  return { x: ax.x, y: ax.y };
}

/** Read a section dimension (mm) from the geometry library. */
function geomMm(id: string, key: 'width' | 'depth' | 'height' | 'thickness', fallback: number): number {
  const geom = getGeometryDefinition(id);
  if (!geom?.section) return fallback;
  const raw = (geom.section as Record<string, unknown>)[key];
  return typeof raw === 'number' ? raw : fallback;
}

/** Build SVG stroke-dasharray attribute from a pattern preset. */
function dashArrayAttr(pattern: ObjectStyleHatch | null | undefined, prefix = ' '): string {
  // Hatch line pattern is always solid in current presets — keep it simple.
  return '';
}

/** Convert an ObjectStyleHatch to an SVG <pattern> def string. */
function buildSvgHatchDef(id: string, hatch: ObjectStyleHatch): string {
  const { pattern, spacing, angle, secondaryAngle, lineColor, lineWeight } = hatch;

  if (pattern === 'none' || pattern === 'solid' || pattern === 'glass') return '';

  // All hatch patterns are rendered as tiled line segments.
  if (pattern === 'cross-hatch') {
    const sec = secondaryAngle ?? -45;
    return `<pattern id="${id}" patternUnits="userSpaceOnUse"
        width="${spacing}" height="${spacing}">
      <line x1="0" y1="0" x2="${spacing}" y2="${spacing}"
            stroke="${lineColor}" stroke-width="${lineWeight}"/>
      <line x1="${spacing}" y1="0" x2="0" y2="${spacing}"
            stroke="${lineColor}" stroke-width="${lineWeight}"/>
    </pattern>`;
  }

  if (pattern === 'horizontal') {
    return `<pattern id="${id}" patternUnits="userSpaceOnUse"
        width="${spacing}" height="${spacing}">
      <line x1="0" y1="${spacing / 2}" x2="${spacing}" y2="${spacing / 2}"
            stroke="${lineColor}" stroke-width="${lineWeight}"/>
    </pattern>`;
  }

  if (pattern === 'vertical') {
    return `<pattern id="${id}" patternUnits="userSpaceOnUse"
        width="${spacing}" height="${spacing}">
      <line x1="${spacing / 2}" y1="0" x2="${spacing / 2}" y2="${spacing}"
            stroke="${lineColor}" stroke-width="${lineWeight}"/>
    </pattern>`;
  }

  if (pattern === 'concrete') {
    // Small random-like dot cluster approximated by fixed dots
    return `<pattern id="${id}" patternUnits="userSpaceOnUse"
        width="${spacing * 2}" height="${spacing * 2}">
      <circle cx="${spacing * 0.3}" cy="${spacing * 0.3}" r="${lineWeight * 1.5}" fill="${lineColor}"/>
      <circle cx="${spacing * 1.3}" cy="${spacing * 1.3}" r="${lineWeight * 1.5}" fill="${lineColor}"/>
      <circle cx="${spacing * 0.8}" cy="${spacing * 1.6}" r="${lineWeight}" fill="${lineColor}"/>
    </pattern>`;
  }

  // Default: diagonal / steel / brick / insulation / earth / wood → diagonal lines
  return `<pattern id="${id}" patternUnits="userSpaceOnUse"
      width="${spacing}" height="${spacing}" patternTransform="rotate(${angle})">
    <line x1="0" y1="0" x2="0" y2="${spacing}"
          stroke="${lineColor}" stroke-width="${lineWeight}"/>
  </pattern>`;
}

/** Compute bounding box of a list of [x,y] pairs. */
function computeBounds(points: Array<{ x: number; y: number }>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface BubbleGraphPlanSVGProps {
  nodes: BubbleGraphNode[];
  edges: BubbleGraphEdge[];
  buildingAxes: BuildingAxes;
  /** Which storey to render — null renders the first storey found */
  storeyId?: string | null;
  /** User Object Style overrides (merged on top of DEFAULT_OBJECT_STYLES) */
  objectStyles?: Partial<ObjectStylesConfig>;
  /** Padding around all content in mm */
  padding?: number;
  /** CSS class applied to the root <svg> element */
  className?: string;
  /** Called when user clicks an element — receives the BubbleGraph node id */
  onElementClick?: (nodeId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────

export function BubbleGraphPlanSVG({
  nodes,
  edges,
  buildingAxes,
  storeyId,
  objectStyles = {},
  padding = 500,
  className,
  onElementClick,
}: BubbleGraphPlanSVGProps) {
  const { svgContent, viewBox, defs } = useMemo(
    () => buildPlanSVGContent(nodes, edges, buildingAxes, storeyId ?? null, objectStyles, padding),
    [nodes, edges, buildingAxes, storeyId, objectStyles, padding],
  );

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      className={className}
      style={{ width: '100%', height: '100%', background: '#FFFFFF' }}
      onClick={(e) => {
        const target = e.target as SVGElement;
        const nodeId = target.dataset.nodeId;
        if (nodeId && onElementClick) onElementClick(nodeId);
      }}
    >
      <defs dangerouslySetInnerHTML={{ __html: defs }} />
      <g dangerouslySetInnerHTML={{ __html: svgContent }} />
    </svg>
  );
}

// ─── Pure SVG builder (also usable outside React) ─────────────────────────

/**
 * Serialize a BubbleGraph floor plan to an SVG string.
 *
 * @param nodes         All BubbleGraph nodes
 * @param edges         All BubbleGraph edges
 * @param buildingAxes  Global axis grid
 * @param storeyId      Storey to render (null = first storey found)
 * @param objectStyles  User style overrides
 * @param padding       Margin around content in mm
 * @returns             Complete SVG string
 */
export function serializeBubbleGraphPlanToSVG(
  nodes: BubbleGraphNode[],
  edges: BubbleGraphEdge[],
  buildingAxes: BuildingAxes,
  storeyId: string | null = null,
  objectStyles: Partial<ObjectStylesConfig> = {},
  padding = 500,
): string {
  const { svgContent, viewBox, defs } = buildPlanSVGContent(
    nodes, edges, buildingAxes, storeyId, objectStyles, padding,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <rect width="100%" height="100%" fill="#FFFFFF"/>
  <defs>
${defs}
  </defs>
${svgContent}
</svg>`;
}

// ─── Internal builder ─────────────────────────────────────────────────────

interface BuildResult {
  svgContent: string;
  defs: string;
  viewBox: string;
}

function buildPlanSVGContent(
  nodes: BubbleGraphNode[],
  edges: BubbleGraphEdge[],
  buildingAxes: BuildingAxes,
  storeyId: string | null,
  objectStyles: Partial<ObjectStylesConfig>,
  padding: number,
): BuildResult {
  // ── Pick the active storey ─────────────────────────────────────────────
  const storeyNodes = nodes.filter((n) => n.type === 'storey');
  const activeStorey =
    storeyId != null
      ? storeyNodes.find((n) => n.id === storeyId)
      : storeyNodes[0];

  if (!activeStorey) {
    return { svgContent: '', defs: '', viewBox: '0 0 1000 1000' };
  }

  const children = nodes.filter((n) => n.parentId === activeStorey.id);
  const childSet = new Set(children.map((n) => n.id));

  // Adjacency map (children only)
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!childSet.has(e.from) || !childSet.has(e.to)) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  const nbrs = (id: string) => adj.get(id) ?? [];

  const axNodes = children.filter((n) => n.type === 'ax');

  // Pre-compute all axis positions for bounds calculation
  const allPoints: Array<{ x: number; y: number }> = axNodes.map((ax) =>
    resolveAxPos(ax, buildingAxes),
  );

  // Collect SVG layers
  const gridLines: string[] = [];
  const hatchFills: string[] = [];
  const elementOutlines: string[] = [];
  const annotations: string[] = [];
  const defsMap = new Map<string, string>(); // id → def content

  const colStyle = resolveObjectStyle('IfcColumn', objectStyles);
  const wallStyle = resolveObjectStyle('IfcWall', objectStyles);
  const beamStyle = resolveObjectStyle('IfcBeam', objectStyles);
  const roomStyle = resolveObjectStyle('IfcSpace', objectStyles);
  const slabStyle = resolveObjectStyle('IfcSlab', objectStyles);

  // Register hatch pattern defs
  function ensureHatchDef(ifcType: string): string | null {
    const style = resolveObjectStyle(ifcType, objectStyles);
    if (!style.hatch || style.hatch.pattern === 'none') return null;
    const defId = `hatch-${ifcType.replace(/\s/g, '-')}`;
    if (!defsMap.has(defId)) {
      defsMap.set(defId, buildSvgHatchDef(defId, style.hatch));
    }
    return defId;
  }

  // ── Building Axes grid ────────────────────────────────────────────────
  if (buildingAxes.xValues.length > 0 && buildingAxes.yValues.length > 0) {
    const axisStyle = 'stroke="#CCCCCC" stroke-width="50" stroke-dasharray="200,150"';
    const xMin = Math.min(...buildingAxes.xValues) - padding / 2;
    const xMax = Math.max(...buildingAxes.xValues) + padding / 2;
    const yMin = Math.min(...buildingAxes.yValues) - padding / 2;
    const yMax = Math.max(...buildingAxes.yValues) + padding / 2;

    for (let i = 0; i < buildingAxes.xValues.length; i++) {
      const x = buildingAxes.xValues[i];
      gridLines.push(
        `  <line x1="${x}" y1="${yMin}" x2="${x}" y2="${yMax}" ${axisStyle}/>`,
      );
      // Axis label
      annotations.push(
        `  <text x="${x}" y="${yMin - 150}" text-anchor="middle" font-size="200" fill="#AAAAAA" font-family="sans-serif">${i + 1}</text>`,
      );
    }
    for (let i = 0; i < buildingAxes.yValues.length; i++) {
      const y = buildingAxes.yValues[i];
      gridLines.push(
        `  <line x1="${xMin}" y1="${y}" x2="${xMax}" y2="${y}" ${axisStyle}/>`,
      );
      annotations.push(
        `  <text x="${xMin - 150}" y="${y}" dominant-baseline="middle" text-anchor="end" font-size="200" fill="#AAAAAA" font-family="sans-serif">${String.fromCharCode(65 + i)}</text>`,
      );
    }
  }

  // ── Room / Shell polygons ─────────────────────────────────────────────
  for (const room of children.filter((n) => n.type === 'room' || n.type === 'shell')) {
    if (!roomStyle.visible) continue;
    const connectedAx = nodes.filter(
      (n) => nbrs(room.id).includes(n.id) && n.type === 'ax',
    );
    if (connectedAx.length < 3) continue;

    const pts = connectedAx.map((ax) => resolveAxPos(ax, buildingAxes));
    const pointsAttr = pts.map((p) => `${p.x},${p.y}`).join(' ');
    const fill = roomStyle.fillColor ?? 'none';
    const strokeColor = roomStyle.cutLines.lineColor;
    const strokeWeight = roomStyle.cutLines.lineWeight;
    const dashes = LINE_PATTERN_DASH_ARRAYS[roomStyle.cutLines.linePattern] ?? [];
    const dashAttr = dashes.length > 0 ? ` stroke-dasharray="${dashes.join(' ')}"` : '';

    const hatchDefId = ensureHatchDef('IfcSpace');
    hatchFills.push(
      hatchDefId
        ? `  <polygon points="${pointsAttr}" fill="url(#${hatchDefId})"${dashAttr}/>` 
        : '',
    );
    elementOutlines.push(
      `  <polygon points="${pointsAttr}" fill="${fill}" stroke="${strokeColor}" stroke-width="${strokeWeight}"${dashAttr} data-node-id="${room.id}"/>`,
    );
    pts.forEach((p) => allPoints.push(p));
  }

  // ── Slab polygons ─────────────────────────────────────────────────────
  for (const slab of children.filter((n) => n.type === 'slab')) {
    if (!slabStyle.visible) continue;
    const connectedAx = nodes.filter(
      (n) => nbrs(slab.id).includes(n.id) && n.type === 'ax',
    );
    if (connectedAx.length < 3) continue;

    const pts = connectedAx.map((ax) => resolveAxPos(ax, buildingAxes));
    const pointsAttr = pts.map((p) => `${p.x},${p.y}`).join(' ');
    const fill = slabStyle.fillColor ?? '#E0E0E0';
    const strokeColor = slabStyle.cutLines.lineColor;
    const strokeWeight = slabStyle.cutLines.lineWeight;

    const hatchDefId = ensureHatchDef('IfcSlab');
    if (hatchDefId) {
      hatchFills.push(
        `  <polygon points="${pointsAttr}" fill="url(#${hatchDefId})"/>`,
      );
    }
    elementOutlines.push(
      `  <polygon points="${pointsAttr}" fill="${fill}" stroke="${strokeColor}" stroke-width="${strokeWeight}" data-node-id="${slab.id}"/>`,
    );
    pts.forEach((p) => allPoints.push(p));
  }

  // ── Walls ─────────────────────────────────────────────────────────────
  for (const wall of children.filter((n) => n.type === 'wall')) {
    if (!wallStyle.visible) continue;
    const neighborIds = nbrs(wall.id);
    const axNeighbors = nodes
      .filter((n) => neighborIds.includes(n.id) && n.type === 'ax')
      .slice(0, 2);
    if (axNeighbors.length < 2) continue;

    const [axA, axB] = axNeighbors;
    const pA = resolveAxPos(axA, buildingAxes);
    const pB = resolveAxPos(axB, buildingAxes);

    const wallType = (wall.properties.wall_type as string) ?? 'W20';
    const thickness = geomMm(wallType, 'thickness', 200);

    // Direction & normal
    const dx = pB.x - pA.x, dy = pB.y - pA.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const ux = dx / len, uy = dy / len;
    const nx = -uy * (thickness / 2), ny = ux * (thickness / 2);

    // 4 corners of wall rectangle
    const pts = [
      { x: pA.x + nx, y: pA.y + ny },
      { x: pB.x + nx, y: pB.y + ny },
      { x: pB.x - nx, y: pB.y - ny },
      { x: pA.x - nx, y: pA.y - ny },
    ];
    const pointsAttr = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const fill = wallStyle.fillColor ?? '#FFFFFF';
    const strokeColor = wallStyle.cutLines.lineColor;
    const strokeWeight = wallStyle.cutLines.lineWeight;

    const hatchDefId = ensureHatchDef('IfcWall');
    if (hatchDefId) {
      hatchFills.push(
        `  <polygon points="${pointsAttr}" fill="url(#${hatchDefId})"/>`,
      );
    }
    elementOutlines.push(
      `  <polygon points="${pointsAttr}" fill="${fill}" stroke="${strokeColor}" stroke-width="${strokeWeight}" data-node-id="${wall.id}"/>`,
    );
    pts.forEach((p) => allPoints.push(p));
  }

  // ── Beams ─────────────────────────────────────────────────────────────
  for (const beam of children.filter((n) => n.type === 'beam')) {
    if (!beamStyle.visible) continue;
    const neighborIds = nbrs(beam.id);
    const axNeighbors = nodes
      .filter((n) => neighborIds.includes(n.id) && n.type === 'ax')
      .slice(0, 2);
    if (axNeighbors.length < 2) continue;

    const [axA, axB] = axNeighbors;
    const pA = resolveAxPos(axA, buildingAxes);
    const pB = resolveAxPos(axB, buildingAxes);

    const beamType = (beam.properties.beam_type as string) ?? 'B30x60';
    const bw = geomMm(beamType, 'width', 300);

    const dx = pB.x - pA.x, dy = pB.y - pA.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const ux = dx / len, uy = dy / len;
    const nx = -uy * (bw / 2), ny = ux * (bw / 2);

    const pts = [
      { x: pA.x + nx, y: pA.y + ny },
      { x: pB.x + nx, y: pB.y + ny },
      { x: pB.x - nx, y: pB.y - ny },
      { x: pA.x - nx, y: pA.y - ny },
    ];
    const pointsAttr = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const fill = beamStyle.fillColor ?? '#FFFFFF';
    const strokeColor = beamStyle.cutLines.lineColor;
    const strokeWeight = beamStyle.cutLines.lineWeight;
    const dashes = LINE_PATTERN_DASH_ARRAYS[beamStyle.cutLines.linePattern] ?? [];
    const dashAttr = dashes.length > 0 ? ` stroke-dasharray="${dashes.join(' ')}"` : '';

    const hatchDefId = ensureHatchDef('IfcBeam');
    if (hatchDefId) {
      hatchFills.push(`  <polygon points="${pointsAttr}" fill="url(#${hatchDefId})"/>`)
    }
    elementOutlines.push(
      `  <polygon points="${pointsAttr}" fill="${fill}" stroke="${strokeColor}" stroke-width="${strokeWeight}"${dashAttr} data-node-id="${beam.id}"/>`,
    );
    pts.forEach((p) => allPoints.push(p));
  }

  // ── Columns (ax nodes with has_column=True) ───────────────────────────
  for (const ax of axNodes) {
    const hasCol = ax.properties.has_column;
    if (hasCol !== 'True' && hasCol !== true) continue;
    if (!colStyle.visible) continue;

    const colType = (ax.properties.column_type as string) ?? 'C25x25';
    const w = geomMm(colType, 'width', 250);
    const d = geomMm(colType, 'depth', 250);
    const pos = resolveAxPos(ax, buildingAxes);

    const x = pos.x - w / 2;
    const y = pos.y - d / 2;

    const strokeColor = colStyle.cutLines.lineColor;
    const strokeWeight = colStyle.cutLines.lineWeight;
    const fill = colStyle.fillColor ?? '#FFFFFF';
    const dashes = LINE_PATTERN_DASH_ARRAYS[colStyle.cutLines.linePattern] ?? [];
    const dashAttr = dashes.length > 0 ? ` stroke-dasharray="${dashes.join(' ')}"` : '';

    // Hatch overlay
    const hatchDefId = ensureHatchDef('IfcColumn');
    if (hatchDefId) {
      hatchFills.push(
        `  <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${d}" fill="url(#${hatchDefId})"/>`,
      );
    }

    // Column outline (drawn last — on top of hatch)
    elementOutlines.push(
      `  <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${d}"` +
      ` fill="${fill}" stroke="${strokeColor}" stroke-width="${strokeWeight}"${dashAttr} data-node-id="${ax.id}"/>`,
    );

    allPoints.push({ x: pos.x - w / 2, y: pos.y - d / 2 });
    allPoints.push({ x: pos.x + w / 2, y: pos.y + d / 2 });
  }

  // ── Compute viewBox ───────────────────────────────────────────────────
  let viewBox: string;
  if (allPoints.length === 0) {
    viewBox = '0 0 10000 10000';
  } else {
    const { minX, minY, maxX, maxY } = computeBounds(allPoints);
    const vx = minX - padding;
    const vy = minY - padding;
    const vw = maxX - minX + padding * 2;
    const vh = maxY - minY + padding * 2;
    viewBox = `${vx.toFixed(0)} ${vy.toFixed(0)} ${vw.toFixed(0)} ${vh.toFixed(0)}`;
  }

  // ── Assemble defs ─────────────────────────────────────────────────────
  const defs = [...defsMap.values()].join('\n');

  // ── Assemble SVG body ─────────────────────────────────────────────────
  const svgContent = [
    '  <!-- Grid -->',
    ...gridLines,
    '  <!-- Hatch fills -->',
    ...hatchFills,
    '  <!-- Element outlines -->',
    ...elementOutlines,
    '  <!-- Annotations -->',
    ...annotations,
  ].join('\n');

  return { svgContent, defs, viewBox };
}
