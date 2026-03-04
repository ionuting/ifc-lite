/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Node, Edge } from '@xyflow/react';
import { IfcCreator } from '@ifc-lite/create';

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

// ─── Default data per node type ────────────────────────────────────────────

export const DEFAULT_NODE_DATA: Record<string, Record<string, unknown>> = {
  projectNode:  { name: 'My Building', siteName: 'Site', buildingName: 'Building' } satisfies ProjectNodeData,
  storeyNode:   { name: 'Ground Floor', elevation: 0 } satisfies StoreyNodeData,
  wallNode:     { startX: 0, startY: 0, length: 5, thickness: 0.2, height: 3 } satisfies WallNodeData,
  columnNode:   { x: 0, y: 0, width: 0.3, depth: 0.3, height: 3 } satisfies ColumnNodeData,
  beamNode:     { startX: 0, startY: 0, length: 5, width: 0.2, beamHeight: 0.4 } satisfies BeamNodeData,
  slabNode:     { x: 0, y: 0, width: 10, depth: 8, thickness: 0.2 } satisfies SlabNodeData,
};

// ─── Initial graph ──────────────────────────────────────────────────────────

export const INITIAL_NODES: Node[] = [
  {
    id: 'project-1',
    type: 'projectNode',
    position: { x: 60, y: 180 },
    data: DEFAULT_NODE_DATA.projectNode,
  },
  {
    id: 'storey-1',
    type: 'storeyNode',
    position: { x: 360, y: 140 },
    data: DEFAULT_NODE_DATA.storeyNode,
  },
  {
    id: 'wall-1',
    type: 'wallNode',
    position: { x: 640, y: 60 },
    data: { ...DEFAULT_NODE_DATA.wallNode, name: 'South Wall' },
  },
  {
    id: 'column-1',
    type: 'columnNode',
    position: { x: 640, y: 280 },
    data: { ...DEFAULT_NODE_DATA.columnNode, name: 'Corner Column' },
  },
];

export const INITIAL_EDGES: Edge[] = [
  { id: 'e-proj-storey', source: 'project-1', target: 'storey-1', animated: true, style: { stroke: '#6366f1' } },
  { id: 'e-storey-wall',   source: 'storey-1', target: 'wall-1',   animated: true, style: { stroke: '#10b981' } },
  { id: 'e-storey-col',    source: 'storey-1', target: 'column-1', animated: true, style: { stroke: '#f97316' } },
];

// ─── Compile graph → IFC STEP text ─────────────────────────────────────────

export function compileGraphToIfc(nodes: Node[], edges: Edge[]): string | null {
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
      switch (elemNode.type) {
        case 'wallNode': {
          const d = elemNode.data as WallNodeData;
          creator.addIfcWall(storeyId, {
            Name: d.name || undefined,
            Start: [d.startX ?? 0, d.startY ?? 0, 0],
            End: [(d.startX ?? 0) + (d.length ?? 5), d.startY ?? 0, 0],
            Thickness: d.thickness ?? 0.2,
            Height: d.height ?? 3,
          });
          break;
        }
        case 'columnNode': {
          const d = elemNode.data as ColumnNodeData;
          creator.addIfcColumn(storeyId, {
            Name: d.name || undefined,
            Position: [d.x ?? 0, d.y ?? 0, 0],
            Width: d.width ?? 0.3,
            Depth: d.depth ?? 0.3,
            Height: d.height ?? 3,
          });
          break;
        }
        case 'beamNode': {
          const d = elemNode.data as BeamNodeData;
          creator.addIfcBeam(storeyId, {
            Name: d.name || undefined,
            Start: [d.startX ?? 0, d.startY ?? 0, 0],
            End: [(d.startX ?? 0) + (d.length ?? 5), d.startY ?? 0, 0],
            Width: d.width ?? 0.2,
            Height: d.beamHeight ?? 0.4,
          });
          break;
        }
        case 'slabNode': {
          const d = elemNode.data as SlabNodeData;
          creator.addIfcSlab(storeyId, {
            Name: d.name || undefined,
            Position: [d.x ?? 0, d.y ?? 0, 0],
            Width: d.width ?? 10,
            Depth: d.depth ?? 8,
            Thickness: d.thickness ?? 0.2,
          });
          break;
        }
      }
    }
  }

  return creator.toIfc().content;
}
