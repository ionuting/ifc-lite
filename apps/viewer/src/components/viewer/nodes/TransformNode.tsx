/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * TransformNode.tsx — a node that holds a list of 6-DOF transforms.
 *
 * Each row in the textarea = one instance of the connected element(s):
 *   tx, ty, tz, rx°, ry°, rz°
 * Rows are separated by newlines or semicolons.
 *
 * Examples:
 *   0, 0, 0, 0, 0, 0          → 1 copy at origin
 *   0,0,0,0,0,0               (spaces and commas both work)
 *   0,0,0,0,0,0; 5,0,0,0,0,0  → 2 copies
 *
 * Source handle (right) fans out to any number of element nodes.
 * Element nodes can accept any number of TransformNodes (instance lists merge).
 */

import React from 'react';
import { Handle, Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { TransformNodeData } from './types';

export function TransformNodeComponent({
  id,
  data,
  selected,
}: NodeProps<Node<TransformNodeData>>) {
  const { updateNodeData } = useReactFlow();
  const value = String(data.transforms ?? '');

  const lineCount = value.trim() === '' ? 0
    : value.split(/[;\n]+/).filter(l => l.trim()).length;

  return (
    <div
      className={cn(
        'min-w-[260px] rounded-lg shadow-lg border-2 bg-zinc-900',
        selected ? 'border-violet-400' : 'border-zinc-700',
      )}
    >
      {/* Header */}
      <div className="px-3 py-2 rounded-t-md bg-violet-700">
        <div className="font-mono font-bold text-white text-xs uppercase tracking-wider">
          Transform
        </div>
        <div className="text-white/70 text-[10px] font-mono">
          {lineCount > 0 ? `${lineCount} instance${lineCount !== 1 ? 's' : ''}` : 'no transforms — identity'}
        </div>
      </div>

      {/* Axis hint row */}
      <div className="px-2.5 pt-2 flex gap-1">
        {['tx','ty','tz','rx°','ry°','rz°'].map(l => (
          <span
            key={l}
            className="flex-1 text-center text-[9px] font-mono text-zinc-400 bg-zinc-800 rounded px-0.5 py-0.5"
          >
            {l}
          </span>
        ))}
      </div>

      {/* Textarea */}
      <div className="px-2.5 pb-2 pt-1.5">
        <textarea
          className="nodrag w-full rounded border border-zinc-700 bg-zinc-800 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-y leading-relaxed px-2 py-1.5"
          rows={4}
          spellCheck={false}
          placeholder={"0, 0, 0, 0, 0, 0\n5, 0, 0, 0, 0, 0\n10, 0, 0, 0, 0, 0"}
          value={value}
          onChange={e =>
            updateNodeData(id, { transforms: e.target.value } satisfies Partial<TransformNodeData>)
          }
        />
        <p className="text-[9px] text-zinc-500 font-mono mt-1">
          Each row → 1 instance. Use comma‑separated values.<br />
          Separate rows with ; or newline.
        </p>
      </div>

      {/* Source handle — fans out to any number of element nodes */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#7c3aed', borderColor: '#a78bfa' }}
        title="Connect to element nodes"
      />
    </div>
  );
}

