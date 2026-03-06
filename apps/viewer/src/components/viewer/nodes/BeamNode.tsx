/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Handle, Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import { BaseNode, NodeField, NodeInput } from './BaseNode';
import type { BeamNodeData } from './types';

type BeamFlowNode = Node<BeamNodeData>;

export function BeamNode({ id, data, selected }: NodeProps<BeamFlowNode>) {
  const { updateNodeData } = useReactFlow();
  const upd = (patch: Partial<BeamNodeData>) => updateNodeData(id, patch);

  return (
    <BaseNode title="IfcBeam" headerClass="bg-amber-500" selected={selected}>
      <NodeField label="Name">
        <NodeInput value={data.name ?? ''} onChange={v => upd({ name: String(v) || undefined })} placeholder="optional" />
      </NodeField>
      <NodeField label="StartX">
        <NodeInput type="number" value={data.startX} onChange={v => upd({ startX: Number(v) })} step={0.5} />
      </NodeField>
      <NodeField label="StartY">
        <NodeInput type="number" value={data.startY} onChange={v => upd({ startY: Number(v) })} step={0.5} />
      </NodeField>
      <NodeField label="Length">
        <NodeInput type="number" value={data.length} onChange={v => upd({ length: Number(v) })} step={0.5} />
      </NodeField>
      <NodeField label="Width">
        <NodeInput type="number" value={data.width} onChange={v => upd({ width: Number(v) })} step={0.05} />
      </NodeField>
      <NodeField label="BHeight">
        <NodeInput type="number" value={data.beamHeight} onChange={v => upd({ beamHeight: Number(v) })} step={0.05} />
      </NodeField>
      <Handle type="target" position={Position.Left} style={{ background: '#a855f7', top: '35%' }} title="Storey" />
      <Handle type="target" id="transform" position={Position.Left} style={{ background: '#7c3aed', top: '70%' }} title="Transform list" />
    </BaseNode>
  );
}
