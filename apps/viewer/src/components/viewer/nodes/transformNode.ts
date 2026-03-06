/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * transformNode.ts — registers the "Transform" node type.
 *
 * The TransformNode carries no compile handler — it is a pure data-provider
 * node. Element-node compile handlers call `resolveTransforms(ctx.nodeId, ctx)`
 * from transformUtils.ts to collect all TransformNodes wired to them and apply
 * the stacked transform to every IFC geometry point.
 *
 * Multi-target / multi-source ("lists"):
 *   - One TransformNode → many element nodes  (source handle fans out)
 *   - One element node  → many TransformNodes (target handle accepts many)
 *   Both directions are natural @xyflow/react behaviour; compile logic uses
 *   resolveTransforms() which iterates ALL matching edges.
 *
 * Import as a side-effect to register:
 *   import './nodes/transformNode';
 */

import { Move3d } from 'lucide-react';
import { NodeRegistry } from './registry';
import { TransformNodeComponent } from './TransformNode';

NodeRegistry.register(
  {
    type: 'transformNode',
    label: 'Transform',
    icon: Move3d,
    headerClass: 'bg-violet-700',
    iconColor: 'text-violet-400',
    subtitle: 'tx,ty,tz,rx°,ry°,rz° list',
    category: 'Modifiers',
    // Fields and handles are fully managed by the custom component.
    fields: [],
    handles: [],
  },
  {
    component: TransformNodeComponent as Parameters<typeof NodeRegistry.register>[1]['component'],
    // No compile handler — element nodes pull from this node via resolveTransforms().
  },
);
