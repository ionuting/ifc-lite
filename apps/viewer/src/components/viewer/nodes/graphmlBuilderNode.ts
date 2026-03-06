/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * graphmlBuilderNode.ts — adapts the BubbleGraph GraphML Builder pattern to
 * the ifc-lite node registry.
 *
 * The node reads a GraphML file (served from `public/`) that describes an
 * axis grid with walls and columns, then generates IFC elements for the
 * storey it is wired to.
 *
 * GraphML expected format (same as BubbleGraph_node_ex.ts):
 *   <node id="n1"><data key="type">ax</data><data key="name">1</data></node>
 *   <node id="n2"><data key="type">wall</data><data key="name">W25</data></node>
 *   Edges: ax → wall → ax  (for walls)
 *          ax with has_column="true" and column_type="C25x25" (for columns)
 *
 * Import as a side-effect to register:
 *   import './nodes/graphmlBuilderNode';
 */

import { FileJson2 } from 'lucide-react';
import { NodeRegistry } from './registry';
import { resolveTransforms, applyTransformToPoint, IDENTITY_TF } from './transformUtils';

// ─── GraphML parsing ───────────────────────────────────────────────────────

interface GMLNode {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  props: Record<string, string>;
}

interface GMLEdge {
  source: string;
  target: string;
}

function parseGraphML(xml: string): {
  nodes: Map<string, GMLNode>;
  edges: GMLEdge[];
} {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid XML: ' + (doc.querySelector('parsererror')?.textContent ?? ''));
  }

  const nodes = new Map<string, GMLNode>();
  for (const el of doc.querySelectorAll('node')) {
    const id = el.getAttribute('id') ?? '';
    const props: Record<string, string> = {};
    for (const d of el.querySelectorAll('data')) {
      const k = d.getAttribute('key');
      if (k) props[k] = d.textContent?.trim() ?? '';
    }
    nodes.set(id, {
      id,
      type: props['type'] ?? '',
      name: props['name'] ?? id,
      x:    parseFloat(props['x'] ?? '0') || 0,
      y:    parseFloat(props['y'] ?? '0') || 0,
      props,
    });
  }

  const edges: GMLEdge[] = [];
  for (const el of doc.querySelectorAll('edge')) {
    edges.push({
      source: el.getAttribute('source') ?? '',
      target: el.getAttribute('target') ?? '',
    });
  }

  return { nodes, edges };
}

// ─── Axis grid computation ─────────────────────────────────────────────────

/**
 * Converts a comma-separated string of inter-axis distances to absolute
 * cumulative positions starting at 0.
 * e.g. "5,5,5" → [0, 5, 10, 15]
 */
function axisPositions(str: string): number[] {
  const result = [0];
  let cum = 0;
  for (const s of str.split(',')) {
    const v = parseFloat(s.trim());
    if (!isNaN(v) && v > 0) { cum += v; result.push(cum); }
  }
  return result;
}

/**
 * Maps a 1-based axis name index to {x, z} world coordinates.
 * Layout: indices fill rows left-to-right, then next row.
 * e.g. nX=4 columns: idx 1→(col0,row0), 2→(col1,row0), 5→(col0,row1)
 */
function makeGetCoord(xPos: number[], zPos: number[]) {
  const nX = xPos.length;
  return (nameIdx: number): { x: number; z: number } | null => {
    const li = nameIdx - 1;
    if (li < 0) return null;
    const xi = li % nX;
    const zi = Math.floor(li / nX);
    if (xi >= nX || zi >= zPos.length) return null;
    return { x: xPos[xi], z: zPos[zi] };
  };
}

// ─── Registration ──────────────────────────────────────────────────────────

NodeRegistry.register(
  {
    type: 'graphmlBuilderNode',
    label: 'GraphML Builder',
    icon: FileJson2,
    headerClass: 'bg-blue-800',
    iconColor: 'text-blue-400',
    subtitle: 'Axis grid → IFC elements',
    category: 'Advanced',
    fields: [
      {
        id:           'filePath',
        label:        'File',
        type:         'text',
        defaultValue: '/model.graphml',
        placeholder:  '/model.graphml — place in public/',
      },
      {
        id:           'axisX',
        label:        'Axis X',
        type:         'text',
        defaultValue: '5,5,5',
        placeholder:  'inter-axis distances, m',
      },
      {
        id:           'axisZ',
        label:        'Axis Z',
        type:         'text',
        defaultValue: '4,4',
        placeholder:  'inter-axis distances, m',
      },
      {
        id:           'floorHeight',
        label:        'Height',
        type:         'number',
        defaultValue: 3,
        step:         0.5,
      },
    ],
    handles: [
      { type: 'target', position: 'left', color: '#a855f7' },
      { type: 'target', id: 'transform', position: 'left', color: '#7c3aed' },
    ],
  },
  {
    async compileHandler(data, storeyId, creator, ctx) {
      const filePath    = String(data['filePath'] ?? '').trim();
      const height      = Math.max(0.5, Number(data['floorHeight'] ?? 3) || 3);
      const xPos        = axisPositions(String(data['axisX'] ?? '5,5,5'));
      const zPos        = axisPositions(String(data['axisZ'] ?? '4,4'));
      const getCoord    = makeGetCoord(xPos, zPos);
      const tfs      = resolveTransforms(ctx.nodeId, ctx);
      const instances = tfs.length ? tfs : [IDENTITY_TF];

      // ── Resolve XML source ───────────────────────────────────────────────
      let xml: string | undefined;

      // Use type-safe find so transform + file edges don't interfere.
      const fileNode = ctx.nodes.find(
        n => n.type === 'fileInputNode' &&
             ctx.edges.some(e => e.source === n.id && e.target === ctx.nodeId),
      );

      if (fileNode?.data?.['content']) {
        xml = fileNode.data['content'] as string;
        console.info('[GraphMLBuilder] Using file content from connected Local File node:', fileNode.data['filename']);
      } else {
        if (!filePath) {
          console.warn('[GraphMLBuilder] No filePath set and no Local File node connected');
          return;
        }
        try {
          const res = await fetch(filePath);
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
          xml = await res.text();
        } catch (err) {
          console.warn('[GraphMLBuilder] Could not load GraphML:', err);
          return;
        }
      }

      // ── Parse ────────────────────────────────────────────────────────────
      if (!xml) return;
      const { nodes: gmlNodes, edges: gmlEdges } = parseGraphML(xml);
      const axNodes   = [...gmlNodes.values()].filter(n => n.type === 'ax');
      const wallNodes = [...gmlNodes.values()].filter(n => n.type === 'wall');

      // ── Resolve axis 3D positions ────────────────────────────────────────
      const axPos = new Map<string, { x: number; z: number }>();
      for (const ax of axNodes) {
        const nameIdx = parseInt(ax.name, 10);
        const coord   = isNaN(nameIdx) ? null : getCoord(nameIdx);
        // Fall back to canvas pixel coords (divided by 100) if name is non-numeric
        axPos.set(ax.id, coord ?? { x: ax.x * 0.01, z: -ax.y * 0.01 });
      }

      // ── Columns ──────────────────────────────────────────────────────────
      for (const ax of axNodes) {
        if (ax.props['has_column']?.toLowerCase() !== 'true') continue;
        const colType = ax.props['column_type'] ?? 'C25x25';
        const m       = colType.match(/C?(\d+)[xX](\d+)/i);
        const pos     = axPos.get(ax.id) ?? { x: 0, z: 0 };

        for (const tf of instances) {
          creator.addIfcColumn(storeyId, {
            Name:     colType || undefined,
            Position: applyTransformToPoint([pos.x, pos.z, 0], tf),
            Width:    m ? parseInt(m[1]) / 100 : 0.25,
            Depth:    m ? parseInt(m[2]) / 100 : 0.25,
            Height:   height,
          });
        }
      }

      // ── Walls (ax → wall → ax edge topology) ─────────────────────────────
      for (const wall of wallNodes) {
        let startAxId: string | null = null;
        let endAxId:   string | null = null;

        for (const edge of gmlEdges) {
          if (edge.target === wall.id && gmlNodes.get(edge.source)?.type === 'ax') {
            startAxId = edge.source;
          }
          if (edge.source === wall.id && gmlNodes.get(edge.target)?.type === 'ax') {
            endAxId = edge.target;
          }
        }

        if (!startAxId || !endAxId) continue;
        const s  = axPos.get(startAxId);
        const e  = axPos.get(endAxId);
        if (!s || !e) continue;

        // Derive wall thickness from name suffix (e.g. "W25" → 0.25 m)
        const m   = wall.name.toUpperCase().match(/\d+/);
        const thk = m ? Math.max(0.10, Math.min(0.99, parseInt(m[0]) / 100)) : 0.25;

        for (const tf of instances) {
          creator.addIfcWall(storeyId, {
            Name:      wall.name || undefined,
            Start:     applyTransformToPoint([s.x, s.z, 0], tf),
            End:       applyTransformToPoint([e.x, e.z, 0], tf),
            Thickness: thk,
            Height:    height,
          });
        }
      }

      console.info(
        `[GraphMLBuilder] ${axNodes.length} axes, ` +
        `${wallNodes.filter(w => {
          let s = false, en = false;
          for (const edge of gmlEdges) {
            if (edge.target === w.id && gmlNodes.get(edge.source)?.type === 'ax') s = true;
            if (edge.source === w.id && gmlNodes.get(edge.target)?.type === 'ax') en = true;
          }
          return s && en;
        }).length} walls → storey #${storeyId}`,
      );
    },
  },
);
