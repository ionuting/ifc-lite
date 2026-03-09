/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ObjectStyles Slice — Revit-like per-IFC-category graphic configuration.
 *
 * Stores user overrides on top of DEFAULT_OBJECT_STYLES.
 * Consumed by:
 *   - SVGExporter (mesh-based 2D section drawings)
 *   - BubbleGraphPlanSVG (schema-driven 2D floor plan)
 */

import type { StateCreator } from 'zustand';
import type { ObjectStyle, ObjectStylesConfig } from '@ifc-lite/drawing-2d';

// ─── Slice interface ──────────────────────────────────────────────────────

export interface ObjectStylesSlice {
  /**
   * User overrides for IFC category graphic styles.
   * Empty by default — falls back to DEFAULT_OBJECT_STYLES.
   */
  objectStyleOverrides: Partial<ObjectStylesConfig>;

  /** Set a complete style override for one IFC type */
  setObjectStyleOverride: (ifcType: string, style: Partial<ObjectStyle>) => void;

  /** Remove the user override for one IFC type (reverts to built-in default) */
  resetObjectStyleOverride: (ifcType: string) => void;

  /** Clear all user overrides — fully revert to built-in defaults */
  resetAllObjectStyleOverrides: () => void;
}

// ─── Creator ──────────────────────────────────────────────────────────────

export const createObjectStylesSlice: StateCreator<
  ObjectStylesSlice,
  [],
  [],
  ObjectStylesSlice
> = (set) => ({
  objectStyleOverrides: {},

  setObjectStyleOverride: (ifcType, style) =>
    set((s) => ({
      objectStyleOverrides: {
        ...s.objectStyleOverrides,
        [ifcType]: {
          ...(s.objectStyleOverrides[ifcType] ?? {}),
          ...style,
        } as ObjectStyle,
      },
    })),

  resetObjectStyleOverride: (ifcType) =>
    set((s) => {
      const next = { ...s.objectStyleOverrides };
      delete next[ifcType];
      return { objectStyleOverrides: next };
    }),

  resetAllObjectStyleOverrides: () => set({ objectStyleOverrides: {} }),
});
