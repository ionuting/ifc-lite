/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Handle, Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import { BaseNode, NodeField, NodeInput } from './BaseNode';
import type { WallNodeData } from './types';

type WallFlowNode = Node<WallNodeData>;

export function WallNode({ id, data, selected }: NodeProps<WallFlowNode>) {
  const { updateNodeData } = useReactFlow();
  const upd = (patch: Partial<WallNodeData>) => updateNodeData(id, patch);

  return (
    <BaseNode title="IfcWall" headerClass="bg-emerald-600" selected={selected}>
      <NodeField label="Name">
        <NodeInput value={data.name ?? ''} onChange={v => upd({ name: String(v) || undefined })} placeholder="optional" />
      </NodeField>
      <NodeField label="Start X">
        <NodeInput type="number" value={data.startX} onChange={v => upd({ startX: Number(v) })} step={0.5} />
      </NodeField>
      <NodeField label="Start Y">
        <NodeInput type="number" value={data.startY} onChange={v => upd({ startY: Number(v) })} step={0.5} />
      </NodeField>
      <NodeField label="Length">
        <NodeInput type="number" value={data.length} onChange={v => upd({ length: Number(v) })} step={0.5} />
      </NodeField>
      <NodeField label="Thick.">
        <NodeInput type="number" value={data.thickness} onChange={v => upd({ thickness: Number(v) })} step={0.05} />
      </NodeField>
      <NodeField label="Height">
        <NodeInput type="number" value={data.height} onChange={v => upd({ height: Number(v) })} step={0.5} />
      </NodeField>
      <Handle type="target" position={Position.Left} style={{ background: '#a855f7', top: '30%' }} title="Storey" />
      <Handle type="target" id="transform" position={Position.Left} style={{ background: '#7c3aed', top: '60%' }} title="Transform list" />
      <Handle type="target" id="opening" position={Position.Left} style={{ background: '#64748b', top: '88%' }} title="Opening voids" />
    </BaseNode>
  );
}
