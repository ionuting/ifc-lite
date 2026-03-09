/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * SVG Exporter - Export 2D drawings to SVG format
 *
 * Generates architectural-quality SVG output with:
 * - Proper line weights and styles
 * - Hatch patterns
 * - Layer organization
 * - Scale and paper size handling
 */

import type {
  Drawing2D,
  DrawingLine,
  DrawingPolygon,
  Point2D,
  Bounds2D,
  LineCategory,
} from './types';
import type { HatchLine } from './hatch-generator';
import { HatchGenerator } from './hatch-generator';
import {
  getLineStyle,
  getHatchPattern,
  PAPER_SIZES,
  COMMON_SCALES,
  type PaperSize,
  type DrawingScale,
  type HatchPattern,
} from './styles';
import { boundsSize, boundsCenter } from './math';
import {
  resolveObjectStyle,
  LINE_PATTERN_DASH_ARRAYS,
  type ObjectStylesConfig,
} from './object-styles';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SVGExportOptions {
  /** Paper size */
  paperSize?: PaperSize;
  /** Drawing scale (e.g., { name: '1:100', factor: 100 }) */
  scale?: DrawingScale;
  /** Padding around drawing in mm */
  padding?: number;
  /** Include hidden lines */
  showHiddenLines?: boolean;
  /** Include hatching */
  showHatching?: boolean;
  /**
   * Object Styles configuration (Revit-like per-category line/fill/hatch
   * overrides).  When provided, takes precedence over the built-in
   * hard-coded defaults from styles.ts.
   */
  objectStyles?: Partial<ObjectStylesConfig>;
  /** Include title block */
  showTitleBlock?: boolean;
  /** Drawing title */
  title?: string;
  /** Project name */
  projectName?: string;
  /** Background color (default: white) */
  backgroundColor?: string;
  /** Units for dimension display */
  units?: 'mm' | 'm';
}

interface Transform2D {
  scale: number;
  offsetX: number;
  offsetY: number;
  flipY: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// SVG EXPORTER CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class SVGExporter {
  private hatchGenerator = new HatchGenerator();

  /**
   * Export a 2D drawing to SVG string
   */
  export(drawing: Drawing2D, options: SVGExportOptions = {}): string {
    const {
      paperSize = PAPER_SIZES.A3_LANDSCAPE,
      scale = COMMON_SCALES.find((s) => s.factor === drawing.config.scale) || COMMON_SCALES[5],
      padding = 20,
      showHiddenLines = true,
      showHatching = true,
      showTitleBlock = false,
      title = 'Section',
      projectName = '',
      backgroundColor = '#FFFFFF',
    } = options;

    // Calculate transform from drawing coordinates to SVG coordinates
    const transform = this.computeTransform(drawing.bounds, paperSize, scale, padding);

    // Build SVG
    let svg = this.createHeader(paperSize, backgroundColor);
    svg += this.createDefs(drawing, scale.factor);

    const { objectStyles } = options;

    // Layer: Hatching (bottom)
    if (showHatching && drawing.cutPolygons.length > 0) {
      svg += this.createHatchingLayer(drawing.cutPolygons, transform, scale.factor, objectStyles);
    }

    // Layer: Hidden lines
    if (showHiddenLines) {
      const hiddenLines = drawing.lines.filter((l) => l.visibility === 'hidden');
      if (hiddenLines.length > 0) {
        svg += this.createLineLayer('hidden-lines', hiddenLines, transform, 'Hidden Lines', objectStyles);
      }
    }

    // Layer: Projection lines
    const projectionLines = drawing.lines.filter(
      (l) => l.category === 'projection' && l.visibility !== 'hidden'
    );
    if (projectionLines.length > 0) {
      svg += this.createLineLayer('projection-lines', projectionLines, transform, 'Projection', objectStyles);
    }

    // Layer: Silhouettes and creases
    const featureLines = drawing.lines.filter(
      (l) =>
        (l.category === 'silhouette' || l.category === 'crease' || l.category === 'boundary') &&
        l.visibility !== 'hidden'
    );
    if (featureLines.length > 0) {
      svg += this.createLineLayer('feature-lines', featureLines, transform, 'Feature Edges', objectStyles);
    }

    // Layer: Cut lines (top)
    const cutLines = drawing.lines.filter((l) => l.category === 'cut');
    if (cutLines.length > 0) {
      svg += this.createLineLayer('cut-lines', cutLines, transform, 'Cut Lines', objectStyles);
    }

    // Title block
    if (showTitleBlock) {
      svg += this.createTitleBlock(paperSize, title, projectName, scale);
    }

    svg += '</svg>';

    return svg;
  }

  /**
   * Export just the cut polygons with hatching (for section fills)
   */
  exportPolygons(polygons: DrawingPolygon[], bounds: Bounds2D, options: SVGExportOptions = {}): string {
    const {
      paperSize = PAPER_SIZES.A3_LANDSCAPE,
      scale = COMMON_SCALES[5],
      padding = 20,
      backgroundColor = '#FFFFFF',
    } = options;

    const transform = this.computeTransform(bounds, paperSize, scale, padding);

    let svg = this.createHeader(paperSize, backgroundColor);
    svg += this.createPolygonDefs(scale.factor);
    svg += this.createHatchingLayer(polygons, transform, scale.factor);
    svg += '</svg>';

    return svg;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  private computeTransform(
    bounds: Bounds2D,
    paperSize: PaperSize,
    scale: DrawingScale,
    padding: number
  ): Transform2D {
    const size = boundsSize(bounds);
    const center = boundsCenter(bounds);

    // Available drawing area
    const availableWidth = paperSize.width - padding * 2;
    const availableHeight = paperSize.height - padding * 2;

    // Scale: world units to mm on paper
    const worldToMm = 1000 / scale.factor; // mm per world unit (assuming world is in meters)

    // Center the drawing
    const offsetX = paperSize.width / 2 - center.x * worldToMm;
    const offsetY = paperSize.height / 2 + center.y * worldToMm; // Flip Y

    return {
      scale: worldToMm,
      offsetX,
      offsetY,
      flipY: true,
    };
  }

  private transformPoint(point: Point2D, transform: Transform2D): Point2D {
    return {
      x: point.x * transform.scale + transform.offsetX,
      y: transform.flipY
        ? -point.y * transform.scale + transform.offsetY
        : point.y * transform.scale + transform.offsetY,
    };
  }

  private createHeader(paperSize: PaperSize, backgroundColor: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="${paperSize.width}mm"
     height="${paperSize.height}mm"
     viewBox="0 0 ${paperSize.width} ${paperSize.height}">
  <rect width="100%" height="100%" fill="${backgroundColor}"/>
`;
  }

  private createDefs(drawing: Drawing2D, scaleFactor: number): string {
    let defs = '  <defs>\n';
    defs += this.createHatchPatternDefs(scaleFactor);
    defs += '  </defs>\n';
    return defs;
  }

  private createPolygonDefs(scaleFactor: number): string {
    let defs = '  <defs>\n';
    defs += this.createHatchPatternDefs(scaleFactor);
    defs += '  </defs>\n';
    return defs;
  }

  private createHatchPatternDefs(scaleFactor: number): string {
    const spacing = 3 * (scaleFactor / 100); // Adjust for scale
    let defs = '';

    // Diagonal hatch
    defs += `    <pattern id="hatch-diagonal" patternUnits="userSpaceOnUse"
                width="${spacing}" height="${spacing}" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="${spacing}" stroke="#000" stroke-width="0.15"/>
    </pattern>\n`;

    // Cross-hatch
    defs += `    <pattern id="hatch-cross" patternUnits="userSpaceOnUse"
                width="${spacing}" height="${spacing}">
      <line x1="0" y1="0" x2="${spacing}" y2="${spacing}" stroke="#000" stroke-width="0.1"/>
      <line x1="${spacing}" y1="0" x2="0" y2="${spacing}" stroke="#000" stroke-width="0.1"/>
    </pattern>\n`;

    // Horizontal lines
    defs += `    <pattern id="hatch-horizontal" patternUnits="userSpaceOnUse"
                width="${spacing}" height="${spacing}">
      <line x1="0" y1="${spacing / 2}" x2="${spacing}" y2="${spacing / 2}" stroke="#000" stroke-width="0.1"/>
    </pattern>\n`;

    // Concrete dots
    defs += `    <pattern id="hatch-concrete" patternUnits="userSpaceOnUse"
                width="${spacing * 2}" height="${spacing * 2}">
      <circle cx="${spacing * 0.3}" cy="${spacing * 0.3}" r="0.3" fill="#666"/>
      <circle cx="${spacing * 1.3}" cy="${spacing * 1.3}" r="0.3" fill="#666"/>
      <circle cx="${spacing * 0.8}" cy="${spacing * 1.6}" r="0.2" fill="#888"/>
    </pattern>\n`;

    // Steel (dense diagonal)
    defs += `    <pattern id="hatch-steel" patternUnits="userSpaceOnUse"
                width="${spacing * 0.7}" height="${spacing * 0.7}" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="${spacing * 0.7}" stroke="#333" stroke-width="0.2"/>
    </pattern>\n`;

    return defs;
  }

  private createLineLayer(
    id: string,
    lines: DrawingLine[],
    transform: Transform2D,
    label: string,
    objectStyles?: Partial<ObjectStylesConfig>,
  ): string {
    let layer = `  <g id="${id}" inkscape:label="${label}" inkscape:groupmode="layer">\n`;

    for (const line of lines) {
      // Skip invisible types (IfcOpeningElement etc.) when objectStyles provided
      if (objectStyles && line.ifcType) {
        const obj = resolveObjectStyle(line.ifcType, objectStyles);
        if (!obj.visible) continue;
      }
      layer += this.renderLine(line, transform, objectStyles);
    }

    layer += '  </g>\n';
    return layer;
  }

  private renderLine(
    line: DrawingLine,
    transform: Transform2D,
    objectStyles?: Partial<ObjectStylesConfig>,
  ): string {
    const p0 = this.transformPoint(line.line.start, transform);
    const p1 = this.transformPoint(line.line.end, transform);

    let weight: number;
    let color: string;
    let dashArray: string;
    let lineCap: string;

    if (objectStyles && line.ifcType) {
      // Use ObjectStyles when provided — category drives cut vs projection pen
      const objStyle = resolveObjectStyle(line.ifcType, objectStyles);
      const lineProps =
        line.category === 'cut' ? objStyle.cutLines : objStyle.projectionLines;
      weight = lineProps.lineWeight;
      color = lineProps.lineColor;
      const dashes = LINE_PATTERN_DASH_ARRAYS[lineProps.linePattern] ?? [];
      dashArray = dashes.length > 0 ? ` stroke-dasharray="${dashes.join(' ')}"` : '';
      lineCap = 'round';
    } else {
      // Legacy fallback: use hard-coded styles.ts
      const style = getLineStyle(line.category, line.ifcType);
      weight = style.weight;
      color = style.color;
      dashArray = style.dashPattern.length > 0
        ? ` stroke-dasharray="${style.dashPattern.join(' ')}"`
        : '';
      lineCap = style.lineCap;
    }

    return `    <line x1="${p0.x.toFixed(3)}" y1="${p0.y.toFixed(3)}" x2="${p1.x.toFixed(3)}" y2="${p1.y.toFixed(3)}"
          stroke="${color}" stroke-width="${weight}"
          stroke-linecap="${lineCap}"${dashArray}
          data-entity-id="${line.entityId}" data-ifc-type="${line.ifcType}"/>\n`;
  }

  private createHatchingLayer(
    polygons: DrawingPolygon[],
    transform: Transform2D,
    scaleFactor: number,
    objectStyles?: Partial<ObjectStylesConfig>,
  ): string {
    let layer = '  <g id="hatching" inkscape:label="Hatching" inkscape:groupmode="layer">\n';

    for (const polygon of polygons) {
      // Resolve style: ObjectStyles take priority, fall back to hard-coded
      let fillColor: string | null = null;
      let strokeColor: string;
      let strokeWeight: number;
      let hatchPattern: HatchPattern | null = null;

      if (objectStyles) {
        const objStyle = resolveObjectStyle(polygon.ifcType, objectStyles);
        if (!objStyle.visible) continue;

        fillColor = objStyle.fillColor;
        strokeColor = objStyle.cutLines.lineColor;
        strokeWeight = objStyle.cutLines.lineWeight;

        if (objStyle.hatch) {
          hatchPattern = {
            type: objStyle.hatch.pattern,
            spacing: objStyle.hatch.spacing,
            angle: objStyle.hatch.angle,
            secondaryAngle: objStyle.hatch.secondaryAngle,
            lineWeight: objStyle.hatch.lineWeight,
            strokeColor: objStyle.hatch.lineColor,
          };
        }
      } else {
        // Legacy path
        const pattern = getHatchPattern(polygon.ifcType);
        if (pattern.type === 'none') continue;
        hatchPattern = pattern;
        fillColor = pattern.fillColor ?? '#FFFFFF';
        strokeColor = pattern.strokeColor;
        strokeWeight = pattern.lineWeight;
      }

      // Render polygon outline + fill
      layer += this.renderPolygonStyled(
        polygon, transform, fillColor, strokeColor, strokeWeight,
        hatchPattern?.type ?? 'none',
      );

      // Generate and render explicit hatch lines
      if (hatchPattern && hatchPattern.type !== 'none' && hatchPattern.type !== 'solid' && hatchPattern.type !== 'glass') {
        const hatchResult = this.hatchGenerator.generateHatch(polygon, scaleFactor, {
          type: hatchPattern.type,
          spacing: hatchPattern.spacing,
          angle: hatchPattern.angle,
          secondaryAngle: hatchPattern.secondaryAngle,
        });
        for (const hatchLine of hatchResult.lines) {
          layer += this.renderHatchLine(hatchLine, transform, hatchPattern);
        }
      }
    }

    layer += '  </g>\n';
    return layer;
  }

  private renderPolygonStyled(
    polygon: DrawingPolygon,
    transform: Transform2D,
    fillColor: string | null,
    strokeColor: string,
    strokeWeight: number,
    hatchPatternType: string,
  ): string {
    const pathData = this.polygonToPath(polygon.polygon, transform);
    let fill: string;
    if (hatchPatternType === 'solid') {
      fill = fillColor ?? '#CCCCCC';
    } else if (hatchPatternType === 'glass') {
      fill = fillColor ?? 'rgba(200,230,255,0.3)';
    } else if (hatchPatternType === 'none' || !hatchPatternType) {
      fill = fillColor ?? 'none';
    } else {
      // Use SVG pattern ref for hatch overlay; solid fill underneath
      fill = fillColor ? fillColor : 'none';
    }
    return `    <path d="${pathData}" fill="${fill}"
          stroke="${strokeColor}" stroke-width="${strokeWeight}"
          data-entity-id="${polygon.entityId}" data-ifc-type="${polygon.ifcType}"/>\n`;
  }

  private renderPolygon(
    polygon: DrawingPolygon,
    transform: Transform2D,
    pattern: HatchPattern
  ): string {
    const pathData = this.polygonToPath(polygon.polygon, transform);

    let fill: string;
    if (pattern.type === 'solid') {
      fill = pattern.fillColor || '#CCCCCC';
    } else if (pattern.type === 'glass') {
      fill = pattern.fillColor || 'rgba(200, 230, 255, 0.3)';
    } else if (pattern.type === 'none') {
      fill = 'none';
    } else {
      fill = `url(#hatch-${pattern.type})`;
    }

    return `    <path d="${pathData}" fill="${fill}"
          stroke="${pattern.strokeColor}" stroke-width="${pattern.lineWeight}"
          data-entity-id="${polygon.entityId}" data-ifc-type="${polygon.ifcType}"/>\n`;
  }

  private polygonToPath(polygon: { outer: Point2D[]; holes: Point2D[][] }, transform: Transform2D): string {
    let path = '';

    // Outer boundary
    if (polygon.outer.length > 0) {
      const first = this.transformPoint(polygon.outer[0], transform);
      path += `M ${first.x.toFixed(3)} ${first.y.toFixed(3)}`;
      for (let i = 1; i < polygon.outer.length; i++) {
        const p = this.transformPoint(polygon.outer[i], transform);
        path += ` L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
      }
      path += ' Z';
    }

    // Holes
    for (const hole of polygon.holes) {
      if (hole.length > 0) {
        const first = this.transformPoint(hole[0], transform);
        path += ` M ${first.x.toFixed(3)} ${first.y.toFixed(3)}`;
        for (let i = 1; i < hole.length; i++) {
          const p = this.transformPoint(hole[i], transform);
          path += ` L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
        }
        path += ' Z';
      }
    }

    return path;
  }

  private renderHatchLine(
    hatchLine: HatchLine,
    transform: Transform2D,
    pattern: HatchPattern
  ): string {
    const p0 = this.transformPoint(hatchLine.line.start, transform);
    const p1 = this.transformPoint(hatchLine.line.end, transform);

    return `    <line x1="${p0.x.toFixed(3)}" y1="${p0.y.toFixed(3)}" x2="${p1.x.toFixed(3)}" y2="${p1.y.toFixed(3)}"
          stroke="${pattern.strokeColor}" stroke-width="${pattern.lineWeight}" stroke-linecap="butt"/>\n`;
  }

  private createTitleBlock(
    paperSize: PaperSize,
    title: string,
    projectName: string,
    scale: DrawingScale
  ): string {
    const blockWidth = 180;
    const blockHeight = 50;
    const x = paperSize.width - blockWidth - 10;
    const y = paperSize.height - blockHeight - 10;

    return `  <g id="title-block">
    <rect x="${x}" y="${y}" width="${blockWidth}" height="${blockHeight}"
          fill="white" stroke="black" stroke-width="0.5"/>
    <line x1="${x}" y1="${y + 20}" x2="${x + blockWidth}" y2="${y + 20}" stroke="black" stroke-width="0.3"/>
    <line x1="${x}" y1="${y + 35}" x2="${x + blockWidth}" y2="${y + 35}" stroke="black" stroke-width="0.3"/>
    <line x1="${x + 100}" y1="${y + 20}" x2="${x + 100}" y2="${y + blockHeight}" stroke="black" stroke-width="0.3"/>
    <text x="${x + 5}" y="${y + 14}" font-family="Arial" font-size="10" font-weight="bold">${this.escapeXml(title)}</text>
    <text x="${x + 5}" y="${y + 30}" font-family="Arial" font-size="8">${this.escapeXml(projectName)}</text>
    <text x="${x + 5}" y="${y + 45}" font-family="Arial" font-size="8">Scale: ${scale.name}</text>
    <text x="${x + 105}" y="${y + 30}" font-family="Arial" font-size="7">Date:</text>
    <text x="${x + 105}" y="${y + 45}" font-family="Arial" font-size="7">${new Date().toLocaleDateString()}</text>
  </g>\n`;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Export a Drawing2D to SVG string
 */
export function exportToSVG(drawing: Drawing2D, options?: SVGExportOptions): string {
  const exporter = new SVGExporter();
  return exporter.export(drawing, options);
}
