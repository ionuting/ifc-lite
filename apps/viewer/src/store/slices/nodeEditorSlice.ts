/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { StateCreator } from 'zustand';

export interface NodeEditorSlice {
  nodeEditorPanelVisible: boolean;
  setNodeEditorPanelVisible: (visible: boolean) => void;
  toggleNodeEditorPanel: () => void;
}

export const createNodeEditorSlice: StateCreator<NodeEditorSlice, [], [], NodeEditorSlice> = (set) => ({
  nodeEditorPanelVisible: false,
  setNodeEditorPanelVisible: (nodeEditorPanelVisible) => set({ nodeEditorPanelVisible }),
  toggleNodeEditorPanel: () => set((s) => ({ nodeEditorPanelVisible: !s.nodeEditorPanelVisible })),
});
