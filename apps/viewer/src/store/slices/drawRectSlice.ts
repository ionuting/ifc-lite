/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Draw-rectangle tool state slice.
 *
 * Manages the parametric settings (IFC type, wire/solid, extrusion height)
 * and the ephemeral screen-space draw state used for the SVG preview while
 * the user is dragging out a rectangle.
 */

import type { StateCreator } from 'zustand';

// ─── Types ────────────────────────────────────────────────────────────────

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface DrawRectSlice {
  // Tool parameters (persistent settings)
  drawRectIfcType: string;
  drawRectIsWire: boolean;
  drawRectExtrusionHeight: number;

  // Ephemeral draw state (cleared when draw ends)
  drawRectScreenStart: ScreenPoint | null;
  drawRectScreenCurrent: ScreenPoint | null;

  // Actions
  setDrawRectIfcType: (t: string) => void;
  setDrawRectIsWire: (wire: boolean) => void;
  setDrawRectExtrusionHeight: (h: number) => void;
  setDrawRectScreenStart: (p: ScreenPoint | null) => void;
  setDrawRectScreenCurrent: (p: ScreenPoint | null) => void;
  clearDrawRectState: () => void;
}

// ─── Creator ──────────────────────────────────────────────────────────────

export const createDrawRectSlice: StateCreator<DrawRectSlice, [], [], DrawRectSlice> = (set) => ({
  drawRectIfcType: 'IfcBuildingElementProxy',
  drawRectIsWire: false,
  drawRectExtrusionHeight: 3.0,

  drawRectScreenStart: null,
  drawRectScreenCurrent: null,

  setDrawRectIfcType: (drawRectIfcType) => set({ drawRectIfcType }),
  setDrawRectIsWire: (drawRectIsWire) => set({ drawRectIsWire }),
  setDrawRectExtrusionHeight: (drawRectExtrusionHeight) => set({ drawRectExtrusionHeight }),
  setDrawRectScreenStart: (drawRectScreenStart) => set({ drawRectScreenStart }),
  setDrawRectScreenCurrent: (drawRectScreenCurrent) => set({ drawRectScreenCurrent }),
  clearDrawRectState: () => set({ drawRectScreenStart: null, drawRectScreenCurrent: null }),
});
