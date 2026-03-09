/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BubbleGraph state slice — persists the relational building graph
 * (storeys, axes, walls, beams, columns, slabs…) that drives both
 * the visual canvas editor and the automatic 2-D floor-plan views.
 */

import type { StateCreator } from 'zustand';

// ─── Minimal node shape (avoids direct @xyflow/react dep in store) ──────────

export interface FlowNode {
  id: string;
  type?: string;
  data: Record<string, unknown>;
}

// ─── Node / Edge types ────────────────────────────────────────────────────

export interface BubbleGraphNode {
  id: string;
  type: string;               // 'storey' | 'ax' | 'wall' | 'beam' | 'column' | 'slab' | …
  name: string;
  x: number;                  // canvas position in mm
  y: number;
  z: number;
  properties: Record<string, unknown>;
  locked?: boolean;
  parentId?: string;
}

export interface BubbleGraphEdge {
  id: string;
  from: string;
  to: string;
}

/** Global building axis grid — single source of truth for ALL storeys */
export interface BuildingAxes {
  xValues: number[];  // mm
  yValues: number[];  // mm
}

export type StoreyDiscipline = 'architectural' | 'structural' | 'mep';

// ─── Slice interface ──────────────────────────────────────────────────────

export interface BubbleGraphSlice {
  bubbleGraphNodes: BubbleGraphNode[];
  bubbleGraphEdges: BubbleGraphEdge[];
  bubbleGraphPanelVisible: boolean;

  /** Global axis grid shared by all storeys */
  buildingAxes: BuildingAxes;
  /** Currently active storey tab (null = show all) */
  activeStoreyId: string | null;

  /** ReactFlow node snapshots synced from NodeEditorPanel */
  flowNodes: FlowNode[];
  setFlowNodes: (nodes: FlowNode[]) => void;

  /** nodeId → IFC expressId(s) from the last successful compile */
  nodeExprIds: Map<string, number[]>;
  setNodeExprIds: (map: Map<string, number[]>) => void;

  /**
   * Callback registered by NodeEditorPanel so external code (e.g. 2D canvas
   * handles) can update a node's data and trigger auto-recompile.
   */
  updateFlowNodeData: ((nodeId: string, data: Record<string, unknown>) => void) | null;
  registerFlowNodeDataUpdater: (fn: ((nodeId: string, data: Record<string, unknown>) => void) | null) => void;

  setBubbleGraph: (nodes: BubbleGraphNode[], edges: BubbleGraphEdge[]) => void;
  setBubbleGraphPanelVisible: (visible: boolean) => void;
  toggleBubbleGraphPanel: () => void;
  setBuildingAxes: (axes: BuildingAxes) => void;
  setActiveStoreyId: (id: string | null) => void;
}

// ─── Creator ──────────────────────────────────────────────────────────────

export const createBubbleGraphSlice: StateCreator<BubbleGraphSlice, [], [], BubbleGraphSlice> = (set) => ({
  bubbleGraphNodes: [],
  bubbleGraphEdges: [],
  bubbleGraphPanelVisible: false,
  buildingAxes: { xValues: [], yValues: [] },
  activeStoreyId: null,
  flowNodes: [],
  nodeExprIds: new Map(),
  updateFlowNodeData: null,

  setFlowNodes: (nodes) => set({ flowNodes: nodes }),
  setNodeExprIds: (map) => set({ nodeExprIds: map }),
  registerFlowNodeDataUpdater: (fn) => set({ updateFlowNodeData: fn }),

  setBubbleGraph: (nodes, edges) => set({ bubbleGraphNodes: nodes, bubbleGraphEdges: edges }),
  setBubbleGraphPanelVisible: (visible) => set({ bubbleGraphPanelVisible: visible }),
  toggleBubbleGraphPanel: () =>
    set((s) => ({ bubbleGraphPanelVisible: !s.bubbleGraphPanelVisible })),
  setBuildingAxes: (axes) => set({ buildingAxes: axes }),
  setActiveStoreyId: (id) => set({ activeStoreyId: id }),
});
