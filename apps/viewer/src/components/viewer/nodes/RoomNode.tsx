/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Handle, Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import { BaseNode, NodeField, NodeInput } from './BaseNode';
import type { RoomNodeData } from './types';

type RoomFlowNode = Node<RoomNodeData>;

export function RoomNode({ id, data, selected }: NodeProps<RoomFlowNode>) {
  const { updateNodeData } = useReactFlow();
  const upd = (patch: Partial<RoomNodeData>) => updateNodeData(id, patch);

  return (
    <BaseNode title="IfcSpace" headerClass="bg-blue-600" selected={selected}>
      <NodeField label="Name">
        <NodeInput value={data.name ?? ''} onChange={v => upd({ name: String(v) || undefined })} placeholder="optional" />
      </NodeField>
      <NodeField label="X">
        <NodeInput type="number" value={data.x} onChange={v => upd({ x: Number(v) })} step={0.5} />
      </NodeField>
      <NodeField label="Y">
        <NodeInput type="number" value={data.y} onChange={v => upd({ y: Number(v) })} step={0.5} />
      </NodeField>
      <NodeField label="Width">
        <NodeInput type="number" value={data.width} onChange={v => upd({ width: Number(v) })} step={0.5} />
      </NodeField>
      <NodeField label="Depth">
        <NodeInput type="number" value={data.depth} onChange={v => upd({ depth: Number(v) })} step={0.5} />
      </NodeField>
      <NodeField label="Height">
        <NodeInput type="number" value={data.height} onChange={v => upd({ height: Number(v) })} step={0.1} />
      </NodeField>
      <Handle type="target" position={Position.Left} style={{ background: '#a855f7', top: '35%' }} title="Storey" />
      <Handle type="target" id="transform" position={Position.Left} style={{ background: '#7c3aed', top: '70%' }} title="Transform list" />
    </BaseNode>
  );
}
