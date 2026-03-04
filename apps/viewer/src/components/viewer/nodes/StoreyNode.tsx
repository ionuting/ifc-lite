/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Handle, Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import { BaseNode, NodeField, NodeInput } from './BaseNode';
import type { StoreyNodeData } from './types';

type StoreyFlowNode = Node<StoreyNodeData>;

export function StoreyNode({ id, data, selected }: NodeProps<StoreyFlowNode>) {
  const { updateNodeData } = useReactFlow();
  const upd = (patch: Partial<StoreyNodeData>) => updateNodeData(id, patch);

  return (
    <BaseNode title="IfcBuildingStorey" headerClass="bg-purple-600" selected={selected}>
      <NodeField label="Name">
        <NodeInput value={data.name} onChange={v => upd({ name: String(v) })} placeholder="Ground Floor" />
      </NodeField>
      <NodeField label="Elevation">
        <NodeInput type="number" value={data.elevation} onChange={v => upd({ elevation: Number(v) })} step={0.5} />
      </NodeField>
      {/* Input: from ProjectNode */}
      <Handle type="target" position={Position.Left} style={{ background: '#6366f1' }} />
      {/* Output: to element nodes */}
      <Handle type="source" position={Position.Right} style={{ background: '#a855f7' }} />
    </BaseNode>
  );
}
