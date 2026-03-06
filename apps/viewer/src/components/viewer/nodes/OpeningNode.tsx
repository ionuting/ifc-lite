/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Handle, Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import { BaseNode, NodeField, NodeInput } from './BaseNode';
import type { OpeningNodeData } from './types';

type OpeningFlowNode = Node<OpeningNodeData>;

export function OpeningNode({ id, data, selected }: NodeProps<OpeningFlowNode>) {
  const { updateNodeData } = useReactFlow();
  const upd = (patch: Partial<OpeningNodeData>) => updateNodeData(id, patch);

  return (
    <BaseNode title="IfcOpeningElement" headerClass="bg-slate-500" selected={selected}>
      <NodeField label="Name">
        <NodeInput value={data.name ?? ''} onChange={v => upd({ name: String(v) || undefined })} placeholder="optional" />
      </NodeField>
      <NodeField label="Offset">
        <NodeInput type="number" value={data.x} onChange={v => upd({ x: Number(v) })} step={0.5} />
      </NodeField>
      <NodeField label="Sill H.">
        <NodeInput type="number" value={data.y} onChange={v => upd({ y: Number(v) })} step={0.1} />
      </NodeField>
      <NodeField label="Width">
        <NodeInput type="number" value={data.width} onChange={v => upd({ width: Number(v) })} step={0.1} />
      </NodeField>
      <NodeField label="Depth">
        <NodeInput type="number" value={data.depth} onChange={v => upd({ depth: Number(v) })} step={0.1} />
      </NodeField>
      <NodeField label="Height">
        <NodeInput type="number" value={data.height} onChange={v => upd({ height: Number(v) })} step={0.1} />
      </NodeField>
      {/* Left: storey + transform inputs */}
      <Handle type="target" position={Position.Left} style={{ background: '#a855f7', top: '35%' }} title="Storey (standalone)" />
      <Handle type="target" id="transform" position={Position.Left} style={{ background: '#7c3aed', top: '70%' }} title="Transform list" />
      {/* Right: connect to wall/slab to cut void */}
      <Handle type="source" position={Position.Right} style={{ background: '#64748b', borderColor: '#94a3b8' }} title="Connect to wall to cut void" />
    </BaseNode>
  );
}
