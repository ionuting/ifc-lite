/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * fileInputNode.ts — registers the "Local File" node type.
 *
 * This node provides a file-picker that reads any local text file into the
 * node's data. Downstream nodes (GraphML Builder, etc.) can receive the
 * content via their compile context (CompileCtx), or by direct graph
 * inspection.
 *
 * Import as a side-effect to register:
 *   import './nodes/fileInputNode';
 */

import { FolderOpen } from 'lucide-react';
import { NodeRegistry } from './registry';
import { FileInputNodeComponent } from './FileInputNode';

NodeRegistry.register(
  {
    type: 'fileInputNode',
    label: 'Local File',
    icon: FolderOpen,
    headerClass: 'bg-gray-600',
    iconColor: 'text-gray-200',
    category: 'Input',
    // Fields and handles are handled entirely by the custom component.
    fields: [],
    handles: [],
  },
  {
    // Custom component: provides the file-picker UI.
    component: FileInputNodeComponent as Parameters<typeof NodeRegistry.register>[1]['component'],
    // No compile handler — this node is purely a data source for other nodes
    // (they read ctx.nodes to find connected FileInputNode content).
  },
);
