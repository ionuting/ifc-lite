/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Handle, Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import { BaseNode, NodeField, NodeInput } from './BaseNode';
import type { ProjectNodeData } from './types';

type ProjectFlowNode = Node<ProjectNodeData>;

export function ProjectNode({ id, data, selected }: NodeProps<ProjectFlowNode>) {
  const { updateNodeData } = useReactFlow();
  const upd = (patch: Partial<ProjectNodeData>) => updateNodeData(id, patch);

  return (
    <BaseNode title="IfcProject" subtitle="Root spatial container" headerClass="bg-indigo-600" selected={selected}>
      <NodeField label="Project">
        <NodeInput value={data.name} onChange={v => upd({ name: String(v) })} placeholder="My Building" />
      </NodeField>
      <NodeField label="Site">
        <NodeInput value={data.siteName} onChange={v => upd({ siteName: String(v) })} placeholder="Site" />
      </NodeField>
      <NodeField label="Building">
        <NodeInput value={data.buildingName} onChange={v => upd({ buildingName: String(v) })} placeholder="Building" />
      </NodeField>
      {/* Output: connects to StoreyNodes */}
      <Handle type="source" position={Position.Right} style={{ background: '#6366f1' }} />
    </BaseNode>
  );
}
