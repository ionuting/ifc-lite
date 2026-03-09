/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * builtins.ts — registers all built-in IFC node types.
 *
 * Import this file once as a side-effect (e.g. in NodeEditorPanel.tsx) to
 * make all built-in node types available in the editor:
 *
 *   import './nodes/builtins';
 */

import {
  Layers2,
  LayoutList,
  Minus,
  Columns2,
  Box,
  Square,
  DoorOpen,
  Home,
} from 'lucide-react';
import { NodeRegistry } from './registry';
import { resolveTransforms, applyTransformToPoint, IDENTITY_TF } from './transformUtils';
import { ProjectNode } from './ProjectNode';
import { StoreyNode } from './StoreyNode';
import { WallNode } from './WallNode';
import { ColumnNode } from './ColumnNode';
import { BeamNode } from './BeamNode';
import { SlabNode } from './SlabNode';
import { OpeningNode } from './OpeningNode';
import { RoomNode } from './RoomNode';
import type {
  WallNodeData,
  ColumnNodeData,
  BeamNodeData,
  SlabNodeData,
  OpeningNodeData,
  RoomNodeData,
} from './types';

// ─── projectNode ───────────────────────────────────────────────────────────

NodeRegistry.register(
  {
    type: 'projectNode',
    label: 'IfcProject',
    icon: Layers2,
    headerClass: 'bg-indigo-600',
    iconColor: 'text-indigo-500',
    subtitle: 'Root spatial container',
    category: 'Structure',
    fields: [
      { id: 'name',         label: 'Project',  type: 'text', defaultValue: 'My Building', placeholder: 'My Building' },
      { id: 'siteName',     label: 'Site',     type: 'text', defaultValue: 'Site',        placeholder: 'Site'        },
      { id: 'buildingName', label: 'Building', type: 'text', defaultValue: 'Building',    placeholder: 'Building'    },
    ],
    handles: [
      { type: 'source', position: 'right', color: '#6366f1' },
    ],
  },
  { component: ProjectNode as any },
);

// ─── storeyNode ────────────────────────────────────────────────────────────

NodeRegistry.register(
  {
    type: 'storeyNode',
    label: 'IfcBuildingStorey',
    icon: LayoutList,
    headerClass: 'bg-purple-600',
    iconColor: 'text-purple-500',
    category: 'Structure',
    fields: [
      { id: 'name',      label: 'Name',      type: 'text',   defaultValue: 'Ground Floor'  },
      { id: 'elevation', label: 'Elevation', type: 'number', defaultValue: 0, step: 0.5    },
    ],
    handles: [
      { type: 'target', position: 'left',  color: '#6366f1' },
      { type: 'source', position: 'right', color: '#a855f7' },
    ],
  },
  { component: StoreyNode as any },
);

// ─── wallNode ──────────────────────────────────────────────────────────────

NodeRegistry.register(
  {
    type: 'wallNode',
    label: 'IfcWall',
    icon: Minus,
    headerClass: 'bg-emerald-600',
    iconColor: 'text-emerald-500',
    category: 'Elements',
    fields: [
      { id: 'name',        label: 'Name',      type: 'text',   defaultValue: '',  placeholder: 'optional' },
      { id: 'startX',      label: 'Start X',   type: 'number', defaultValue: 0,  step: 0.5 },
      { id: 'startY',      label: 'Start Y',   type: 'number', defaultValue: 0,  step: 0.5 },
      { id: 'length',      label: 'Length',    type: 'number', defaultValue: 5,  step: 0.5 },
      { id: 'thickness',   label: 'Thick.',    type: 'number', defaultValue: 0.2, step: 0.05 },
      { id: 'height',      label: 'Height',    type: 'number', defaultValue: 3,  step: 0.5 },
      { id: 'offsetStart', label: 'Off.Start', type: 'number', defaultValue: 0,  step: 0.05 },
      { id: 'offsetEnd',   label: 'Off.End',   type: 'number', defaultValue: 0,  step: 0.05 },
    ],
    handles: [
      { type: 'target', position: 'left', color: '#a855f7' },
    ],
  },
  {
    component: WallNode as any,
    compileHandler: (data, storeyId, creator, ctx) => {
      const d   = data as WallNodeData;
      const tfs = resolveTransforms(ctx.nodeId, ctx);
      const instances = tfs.length ? tfs : [IDENTITY_TF];
      // Collect opening nodes connected via the 'opening' handle
      const openings = ctx.edges
        .filter(e => e.target === ctx.nodeId && e.targetHandle === 'opening')
        .map(e => ctx.nodes.find(n => n.id === e.source && n.type === 'openingNode'))
        .filter((n): n is (typeof ctx.nodes)[0] => !!n)
        .map(n => {
          const od = n.data as OpeningNodeData;
          return {
            Name:     od.name || undefined,
            Width:    od.width ?? 0.9,
            Height:   od.height ?? 2.1,
            // Position[0] = offset along wall axis, Position[2] = sill height
            Position: [(od.x ?? 1), 0, (od.y ?? 0)] as [number, number, number],
          };
        });
      for (const tf of instances) {
        const rawStart = applyTransformToPoint([d.startX ?? 0, d.startY ?? 0, 0], tf);
        const rawEnd   = applyTransformToPoint([(d.startX ?? 0) + (d.length ?? 5), d.startY ?? 0, 0], tf);
        // Apply axis offsets along wall direction
        const dx = rawEnd[0] - rawStart[0];
        const dy = rawEnd[1] - rawStart[1];
        const wl = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / wl;
        const uy = dy / wl;
        const os = d.offsetStart ?? 0;
        const oe = d.offsetEnd ?? 0;
        const Start: [number, number, number] = [rawStart[0] - os * ux, rawStart[1] - os * uy, rawStart[2]];
        const End:   [number, number, number] = [rawEnd[0]   + oe * ux, rawEnd[1]   + oe * uy, rawEnd[2]];
        const wallId = creator.addIfcWall(storeyId, {
          Name:      d.name || undefined,
          Start,
          End,
          Thickness: d.thickness ?? 0.2,
          Height:    d.height ?? 3,
          Openings:  openings.length ? openings : undefined,
        });
        ctx.recordExprId?.(ctx.nodeId, wallId);
      }
    },
  },
);

// ─── columnNode ────────────────────────────────────────────────────────────

NodeRegistry.register(
  {
    type: 'columnNode',
    label: 'IfcColumn',
    icon: Columns2,
    headerClass: 'bg-orange-500',
    iconColor: 'text-orange-500',
    category: 'Elements',
    fields: [
      { id: 'name',  label: 'Name',    type: 'text',   defaultValue: '',   placeholder: 'optional' },
      { id: 'x',     label: 'X',       type: 'number', defaultValue: 0,    step: 0.5  },
      { id: 'y',     label: 'Y',       type: 'number', defaultValue: 0,    step: 0.5  },
      { id: 'width', label: 'Width',   type: 'number', defaultValue: 0.3,  step: 0.05 },
      { id: 'depth', label: 'Depth',   type: 'number', defaultValue: 0.3,  step: 0.05 },
      { id: 'height',label: 'Height',  type: 'number', defaultValue: 3,    step: 0.5  },
      { id: 'offsetX',    label: 'Off.X',    type: 'number', defaultValue: 0, step: 0.05 },
      { id: 'offsetY',    label: 'Off.Y',    type: 'number', defaultValue: 0, step: 0.05 },
      { id: 'offsetBase', label: 'Off.Base', type: 'number', defaultValue: 0, step: 0.05 },
      { id: 'offsetTop',  label: 'Off.Top',  type: 'number', defaultValue: 0, step: 0.05 },
    ],
    handles: [
      { type: 'target', position: 'left', color: '#a855f7' },
    ],
  },
  {
    component: ColumnNode as any,
    compileHandler: (data, storeyId, creator, ctx) => {
      const d   = data as ColumnNodeData;
      const tfs = resolveTransforms(ctx.nodeId, ctx);
      const instances = tfs.length ? tfs : [IDENTITY_TF];
      for (const tf of instances) {
        const pos = applyTransformToPoint([
          (d.x ?? 0) + (d.offsetX ?? 0),
          (d.y ?? 0) + (d.offsetY ?? 0),
          -(d.offsetBase ?? 0),
        ], tf);
        const colId = creator.addIfcColumn(storeyId, {
          Name:     d.name || undefined,
          Position: pos,
          Width:    d.width ?? 0.3,
          Depth:    d.depth ?? 0.3,
          Height:   (d.height ?? 3) + (d.offsetBase ?? 0) + (d.offsetTop ?? 0),
        });
        ctx.recordExprId?.(ctx.nodeId, colId);
      }
    },
  },
);

// ─── beamNode ──────────────────────────────────────────────────────────────

NodeRegistry.register(
  {
    type: 'beamNode',
    label: 'IfcBeam',
    icon: Box,
    headerClass: 'bg-amber-500',
    iconColor: 'text-amber-500',
    category: 'Elements',
    fields: [
      { id: 'name',                label: 'Name',        type: 'text',   defaultValue: '',   placeholder: 'optional' },
      { id: 'startX',              label: 'Start X',     type: 'number', defaultValue: 0,    step: 0.5  },
      { id: 'startY',              label: 'Start Y',     type: 'number', defaultValue: 0,    step: 0.5  },
      { id: 'length',              label: 'Length',      type: 'number', defaultValue: 5,    step: 0.5  },
      { id: 'width',               label: 'Width',       type: 'number', defaultValue: 0.2,  step: 0.05 },
      { id: 'beamHeight',          label: 'BHeight',     type: 'number', defaultValue: 0.4,  step: 0.05 },
      { id: 'offsetStart',         label: 'Off.Start',   type: 'number', defaultValue: 0,    step: 0.05 },
      { id: 'offsetEnd',           label: 'Off.End',     type: 'number', defaultValue: 0,    step: 0.05 },
      { id: 'offsetVerticalStart', label: 'Z.Start',     type: 'number', defaultValue: 0,    step: 0.05 },
      { id: 'offsetVerticalEnd',   label: 'Z.End',       type: 'number', defaultValue: 0,    step: 0.05 },
    ],
    handles: [
      { type: 'target', position: 'left', color: '#a855f7' },
    ],
  },
  {
    component: BeamNode as any,
    compileHandler: (data, storeyId, creator, ctx) => {
      const d   = data as BeamNodeData;
      const tfs = resolveTransforms(ctx.nodeId, ctx);
      const instances = tfs.length ? tfs : [IDENTITY_TF];
      for (const tf of instances) {
        const rawStart = applyTransformToPoint([d.startX ?? 0, d.startY ?? 0, d.offsetVerticalStart ?? 0], tf);
        const rawEnd   = applyTransformToPoint([(d.startX ?? 0) + (d.length ?? 5), d.startY ?? 0, d.offsetVerticalEnd ?? 0], tf);
        const dx = rawEnd[0] - rawStart[0];
        const dy = rawEnd[1] - rawStart[1];
        const bl = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / bl;
        const uy = dy / bl;
        const os = d.offsetStart ?? 0;
        const oe = d.offsetEnd ?? 0;
        const Start: [number, number, number] = [rawStart[0] - os * ux, rawStart[1] - os * uy, rawStart[2]];
        const End:   [number, number, number] = [rawEnd[0]   + oe * ux, rawEnd[1]   + oe * uy, rawEnd[2]];
        const beamId = creator.addIfcBeam(storeyId, {
          Name:   d.name || undefined,
          Start,
          End,
          Width:  d.width ?? 0.2,
          Height: d.beamHeight ?? 0.4,
        });
        ctx.recordExprId?.(ctx.nodeId, beamId);
      }
    },
  },
);

// ─── slabNode ──────────────────────────────────────────────────────────────

NodeRegistry.register(
  {
    type: 'slabNode',
    label: 'IfcSlab',
    icon: Square,
    headerClass: 'bg-cyan-600',
    iconColor: 'text-cyan-500',
    category: 'Elements',
    fields: [
      { id: 'name',        label: 'Name',      type: 'text',   defaultValue: '',   placeholder: 'optional' },
      { id: 'x',           label: 'X',         type: 'number', defaultValue: 0,    step: 0.5  },
      { id: 'y',           label: 'Y',         type: 'number', defaultValue: 0,    step: 0.5  },
      { id: 'width',       label: 'Width',     type: 'number', defaultValue: 10,   step: 0.5  },
      { id: 'depth',       label: 'Depth',     type: 'number', defaultValue: 8,    step: 0.5  },
      { id: 'thickness',   label: 'Thick',     type: 'number', defaultValue: 0.2,  step: 0.05 },
      { id: 'offsetOuter', label: 'Off.Outer', type: 'number', defaultValue: 0,    step: 0.05 },
    ],
    handles: [
      { type: 'target', position: 'left', color: '#a855f7' },
    ],
  },
  {
    component: SlabNode as any,
    compileHandler: (data, storeyId, creator, ctx) => {
      const d   = data as SlabNodeData;
      const tfs = resolveTransforms(ctx.nodeId, ctx);
      const instances = tfs.length ? tfs : [IDENTITY_TF];
      const off = d.offsetOuter ?? 0;
      for (const tf of instances) {
        const pos = applyTransformToPoint([(d.x ?? 0) - off, (d.y ?? 0) - off, 0], tf);
        const slabId = creator.addIfcSlab(storeyId, {
          Name:      d.name || undefined,
          Position:  pos,
          Width:     Math.max(0, (d.width ?? 10) + 2 * off),
          Depth:     Math.max(0, (d.depth ?? 8)  + 2 * off),
          Thickness: d.thickness ?? 0.2,
        });
        ctx.recordExprId?.(ctx.nodeId, slabId);
      }
    },
  },
);

// ─── openingNode ───────────────────────────────────────────────────────────

NodeRegistry.register(
  {
    type: 'openingNode',
    label: 'IfcOpeningElement',
    icon: DoorOpen,
    headerClass: 'bg-slate-500',
    iconColor: 'text-slate-400',
    category: 'Elements',
    fields: [
      { id: 'name',   label: 'Name',   type: 'text',   defaultValue: '',   placeholder: 'optional' },
      { id: 'x',      label: 'X',      type: 'number', defaultValue: 0,    step: 0.5  },
      { id: 'y',      label: 'Y',      type: 'number', defaultValue: 0,    step: 0.5  },
      { id: 'width',  label: 'Width',  type: 'number', defaultValue: 0.9,  step: 0.1  },
      { id: 'depth',  label: 'Depth',  type: 'number', defaultValue: 0.3,  step: 0.05 },
      { id: 'height', label: 'Height', type: 'number', defaultValue: 2.1,  step: 0.1  },
    ],
    handles: [
      { type: 'target', position: 'left', color: '#a855f7' },
    ],
  },
  {
    component: OpeningNode as any,
    compileHandler: (data, storeyId, creator, ctx) => {
      // Skip standalone creation when this opening is wired as a void into a wall/slab
      const isVoid = ctx.edges.some(e => e.source === ctx.nodeId && e.targetHandle === 'opening');
      if (isVoid) return;
      const d   = data as OpeningNodeData;
      const tfs = resolveTransforms(ctx.nodeId, ctx);
      const instances = tfs.length ? tfs : [IDENTITY_TF];
      for (const tf of instances) {
        creator.addIfcOpeningElement(storeyId, {
          Name:     d.name || undefined,
          Position: applyTransformToPoint([d.x ?? 0, d.y ?? 0, 0], tf),
          Width:    d.width ?? 0.9,
          Depth:    d.depth ?? 0.3,
          Height:   d.height ?? 2.1,
        });
      }
    },
  },
);

// ─── roomNode ──────────────────────────────────────────────────────────────

NodeRegistry.register(
  {
    type: 'roomNode',
    label: 'IfcSpace',
    icon: Home,
    headerClass: 'bg-blue-600',
    iconColor: 'text-blue-400',
    category: 'Elements',
    fields: [
      { id: 'name',        label: 'Name',      type: 'text',   defaultValue: '',   placeholder: 'optional' },
      { id: 'x',           label: 'X',         type: 'number', defaultValue: 0,    step: 0.5  },
      { id: 'y',           label: 'Y',         type: 'number', defaultValue: 0,    step: 0.5  },
      { id: 'width',       label: 'Width',     type: 'number', defaultValue: 5,    step: 0.5  },
      { id: 'depth',       label: 'Depth',     type: 'number', defaultValue: 4,    step: 0.5  },
      { id: 'height',      label: 'Height',    type: 'number', defaultValue: 2.65, step: 0.05 },
      { id: 'offsetOuter', label: 'Off.Outer', type: 'number', defaultValue: 0,    step: 0.05 },
    ],
    handles: [
      { type: 'target', position: 'left', color: '#a855f7' },
    ],
  },
  {
    component: RoomNode as any,
    compileHandler: (data, storeyId, creator, ctx) => {
      const d   = data as RoomNodeData;
      const tfs = resolveTransforms(ctx.nodeId, ctx);
      const instances = tfs.length ? tfs : [IDENTITY_TF];
      const off = d.offsetOuter ?? 0;
      for (const tf of instances) {
        const pos = applyTransformToPoint([(d.x ?? 0) - off, (d.y ?? 0) - off, 0], tf);
        const roomId = creator.addIfcSpace(storeyId, {
          Name:     d.name || undefined,
          Position: pos,
          Width:    Math.max(0, (d.width ?? 5) + 2 * off),
          Depth:    Math.max(0, (d.depth ?? 4) + 2 * off),
          Height:   d.height ?? 2.65,
        });
        ctx.recordExprId?.(ctx.nodeId, roomId);
      }
    },
  },
);
