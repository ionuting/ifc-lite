/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * FileInputNode.tsx — custom node component that lets the user pick a file
 * from their local disk and stores its text content in node data.
 *
 * Downstream nodes (e.g. GraphML Builder) can read the file content via the
 * CompileCtx passed to their compile handler.
 *
 * Accepted file types: .graphml, .xml, .ifc, .json, .csv, .txt
 */

import React, { useRef, useCallback } from 'react';
import { NodeProps, Node, useReactFlow, Handle, Position } from '@xyflow/react';
import { FolderOpen, FileText } from 'lucide-react';

export interface FileInputNodeData extends Record<string, unknown> {
  /** Original filename as reported by the File API. */
  filename?: string;
  /** Full text content of the file, read via FileReader. */
  content?: string;
  /** File extension or MIME type string. */
  filetype?: string;
}

export function FileInputNodeComponent({ id, data }: NodeProps<Node<FileInputNodeData>>) {
  const { updateNodeData } = useReactFlow();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        updateNodeData(id, {
          filename: file.name,
          content,
          filetype: ext,
        } satisfies FileInputNodeData);
      };
      reader.readAsText(file);
    },
    [id, updateNodeData],
  );

  const hasFile = Boolean(data.filename);

  return (
    <div className="relative rounded-xl overflow-hidden shadow-lg border border-white/10 bg-gray-900 min-w-[210px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-600">
        <FolderOpen className="h-4 w-4 text-gray-200" />
        <span className="text-xs font-semibold tracking-wide text-white">Local File</span>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 flex flex-col gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-xs text-gray-200 border border-gray-500 transition-colors cursor-pointer w-full justify-center"
        >
          <FolderOpen className="h-3 w-3 shrink-0" />
          {hasFile ? 'Change file…' : 'Choose file…'}
        </button>

        {hasFile && (
          <div className="flex items-center gap-1.5 text-xs text-gray-300">
            <FileText className="h-3 w-3 shrink-0 text-gray-400" />
            <span className="truncate max-w-[168px]" title={data.filename}>
              {data.filename}
            </span>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept=".graphml,.xml,.ifc,.json,.csv,.txt"
          onChange={handleFileChange}
        />
      </div>

      {/* Source handle — passes file content to downstream nodes */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#9ca3af', borderColor: '#6b7280' }}
        title="File content"
      />
    </div>
  );
}
