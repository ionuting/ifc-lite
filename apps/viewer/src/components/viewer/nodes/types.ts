/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Node, Edge } from '@xyflow/react';
import { IfcCreator } from '@ifc-lite/create';
import { NodeRegistry } from './registry';

// ─── Node data shapes ──────────────────────────────────────────────────────

export interface ProjectNodeData extends Record<string, unknown> {
  name: string;
  siteName: string;
  buildingName: string;
  description?: string;
}

export interface StoreyNodeData extends Record<string, unknown> {
  name: string;
  elevation: number;
}

export interface WallNodeData extends Record<string, unknown> {
  name?: string;
  startX: number;
  startY: number;
  length: number;
  thickness: number;
  height: number;
}

export interface ColumnNodeData extends Record<string, unknown> {
  name?: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
}

export interface BeamNodeData extends Record<string, unknown> {
  name?: string;
  startX: number;
  startY: number;
  length: number;
  width: number;
  beamHeight: number;
}

export interface SlabNodeData extends Record<string, unknown> {
  name?: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  thickness: number;
}

export interface OpeningNodeData extends Record<string, unknown> {
  name?: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
}

export interface RoomNodeData extends Record<string, unknown> {
  name?: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
}

export interface TransformNodeData extends Record<string, unknown> {
  /**
   * Semicolon- or newline-separated list of transform tuples.
   * Format per entry: tx, ty, tz, rx°, ry°, rz°  (metres / degrees)
   * Each entry produces ONE instance of the connected element at compile time.
   * Example (3 columns at x = 0, 5, 10 m):
   *   "0,0,0,0,0,0\n5,0,0,0,0,0\n10,0,0,0,0,0"
   */
  transforms: string;
}

// ─── Initial graph ──────────────────────────────────────────────────────────
// Default data is inlined here so INITIAL_NODES has no runtime dependency on
// the registry (which is populated lazily via side-effect imports).

export const INITIAL_NODES: Node[] = [
  {
    id: 'project-1',
    type: 'projectNode',
    position: { x: 60, y: 180 },
    data: { name: 'My Building', siteName: 'Site', buildingName: 'Building' } satisfies ProjectNodeData,
  },
  {
    id: 'storey-1',
    type: 'storeyNode',
    position: { x: 360, y: 140 },
    data: { name: 'Ground Floor', elevation: 0 } satisfies StoreyNodeData,
  },
  {
    id: 'wall-1',
    type: 'wallNode',
    position: { x: 640, y: 60 },
    data: { name: 'South Wall', startX: 0, startY: 0, length: 5, thickness: 0.2, height: 3 } satisfies WallNodeData,
  },
  {
    id: 'column-1',
    type: 'columnNode',
    position: { x: 640, y: 280 },
    data: { name: 'Corner Column', x: 0, y: 0, width: 0.3, depth: 0.3, height: 3 } satisfies ColumnNodeData,
  },
];

export const INITIAL_EDGES: Edge[] = [
  { id: 'e-proj-storey', source: 'project-1', target: 'storey-1', animated: true, style: { stroke: '#6366f1' } },
  { id: 'e-storey-wall',   source: 'storey-1', target: 'wall-1',   animated: true, style: { stroke: '#10b981' } },
  { id: 'e-storey-col',    source: 'storey-1', target: 'column-1', animated: true, style: { stroke: '#f97316' } },
];

// ─── Compile graph → IFC STEP text ─────────────────────────────────────────

/**
 * Walks the graph (project → storeys → elements) and compiles to IFC STEP.
 * Element node types dispatch to compile handlers registered via NodeRegistry.
 * This function is async because some handlers (e.g. GraphML Builder) may
 * need to fetch external resources.
 */
export async function compileGraphToIfc(nodes: Node[], edges: Edge[]): Promise<string | null> {
  const projectNode = nodes.find(n => n.type === 'projectNode');
  if (!projectNode) return null;

  const pd = projectNode.data as ProjectNodeData;
  const creator = new IfcCreator({
    Name: pd.name || 'Untitled',
    SiteName: pd.siteName || 'Site',
    BuildingName: pd.buildingName || 'Building',
    Schema: 'IFC4',
  });

  // Storey nodes wired from project
  const storeyNodes = edges
    .filter(e => e.source === projectNode.id)
    .map(e => nodes.find(n => n.id === e.target))
    .filter((n): n is Node => n?.type === 'storeyNode');

  if (storeyNodes.length === 0) {
    creator.addIfcBuildingStorey({ Name: 'Ground Floor', Elevation: 0 });
    return creator.toIfc().content;
  }

  for (const storeyNode of storeyNodes) {
    const sd = storeyNode.data as StoreyNodeData;
    const storeyId = creator.addIfcBuildingStorey({
      Name: sd.name || 'Storey',
      Elevation: typeof sd.elevation === 'number' ? sd.elevation : 0,
    });

    const elemNodes = edges
      .filter(e => e.source === storeyNode.id)
      .map(e => nodes.find(n => n.id === e.target))
      .filter((n): n is Node => !!n);

    for (const elemNode of elemNodes) {
      const handler = NodeRegistry.getCompileHandler(elemNode.type ?? '');
      if (handler) {
        await handler(
          elemNode.data as Record<string, unknown>,
          storeyId,
          creator,
          { nodes, edges, nodeId: elemNode.id },
        );
      }
    }
  }

  return creator.toIfc().content;
}
