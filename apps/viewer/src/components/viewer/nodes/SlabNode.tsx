/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Handle, Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import { BaseNode, NodeField, NodeInput } from './BaseNode';
import type { SlabNodeData } from './types';

type SlabFlowNode = Node<SlabNodeData>;

export function SlabNode({ id, data, selected }: NodeProps<SlabFlowNode>) {
  const { updateNodeData } = useReactFlow();
  const upd = (patch: Partial<SlabNodeData>) => updateNodeData(id, patch);

  return (
    <BaseNode title="IfcSlab" headerClass="bg-cyan-600" selected={selected}>
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
      <NodeField label="Thick">
        <NodeInput type="number" value={data.thickness} onChange={v => upd({ thickness: Number(v) })} step={0.05} />
      </NodeField>
      <NodeField label="Off.Outer">
        <NodeInput type="number" value={data.offsetOuter ?? 0} onChange={v => upd({ offsetOuter: Number(v) })} step={0.05} />
      </NodeField>
      <Handle type="target" position={Position.Left} style={{ background: '#a855f7', top: '35%' }} title="Storey" />
      <Handle type="target" id="transform" position={Position.Left} style={{ background: '#7c3aed', top: '70%' }} title="Transform list" />
    </BaseNode>
  );
}
