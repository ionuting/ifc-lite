/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Editor state slice
 *
 * Controls visibility of the semantic IFC editor panel.
 */

import type { StateCreator } from 'zustand';

export interface EditorSlice {
  editorPanelVisible: boolean;
  setEditorPanelVisible: (visible: boolean) => void;
  toggleEditorPanel: () => void;
  /** Controls the "New Project" dialog inside EditorPanel. Can be triggered from outside (e.g. landing screen). */
  editorNewProjectDialogOpen: boolean;
  setEditorNewProjectDialogOpen: (open: boolean) => void;
  // ─── Live IFC Bridge (C# Nodify/xBIM → ifc-lite) ──────────────────────────
  /** HTTP base URL of the external IFC producer (e.g. http://localhost:5010) */
  bridgeUrl: string;
  setBridgeUrl: (url: string) => void;
  /** Whether the bridge poller is active */
  bridgeConnected: boolean;
  setBridgeConnected: (v: boolean) => void;
  /** Last error message from the bridge, null when OK */
  bridgeError: string | null;
  setBridgeError: (err: string | null) => void;
  /** ISO timestamp of the last successful IFC load from the bridge */
  bridgeLastLoaded: string | null;
  setBridgeLastLoaded: (ts: string | null) => void;
  /** ETag / content-hash used to avoid reloading the same content */
  bridgeLastEtag: string | null;
  setBridgeLastEtag: (etag: string | null) => void;
}

export const createEditorSlice: StateCreator<EditorSlice, [], [], EditorSlice> = (set) => ({
  editorPanelVisible: false,
  setEditorPanelVisible: (editorPanelVisible) => set({ editorPanelVisible }),
  toggleEditorPanel: () => set((state) => ({ editorPanelVisible: !state.editorPanelVisible })),
  editorNewProjectDialogOpen: false,
  setEditorNewProjectDialogOpen: (editorNewProjectDialogOpen) => set({ editorNewProjectDialogOpen }),
  bridgeUrl: 'http://localhost:5010',
  setBridgeUrl: (bridgeUrl) => set({ bridgeUrl }),
  bridgeConnected: false,
  setBridgeConnected: (bridgeConnected) => set({ bridgeConnected }),
  bridgeError: null,
  setBridgeError: (bridgeError) => set({ bridgeError }),
  bridgeLastLoaded: null,
  setBridgeLastLoaded: (bridgeLastLoaded) => set({ bridgeLastLoaded }),
  bridgeLastEtag: null,
  setBridgeLastEtag: (bridgeLastEtag) => set({ bridgeLastEtag }),
});
