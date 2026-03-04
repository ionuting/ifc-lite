/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@xyflow/react/dist/style.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type NodeTypes,
} from '@xyflow/react';
import {
  X,
  Zap,
  Play,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Box,
  Columns2,
  Layers2,
  LayoutList,
  Minus,
  Square,
  GripHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { ProjectNode } from './nodes/ProjectNode';
import { StoreyNode } from './nodes/StoreyNode';
import { WallNode } from './nodes/WallNode';
import { ColumnNode } from './nodes/ColumnNode';
import { BeamNode } from './nodes/BeamNode';
import { SlabNode } from './nodes/SlabNode';
import { INITIAL_NODES, INITIAL_EDGES, DEFAULT_NODE_DATA, compileGraphToIfc } from './nodes/types';

// ─── Node type registry ────────────────────────────────────────────────────

const NODE_TYPES: NodeTypes = {
  projectNode: ProjectNode,
  storeyNode: StoreyNode,
  wallNode: WallNode,
  columnNode: ColumnNode,
  beamNode: BeamNode,
  slabNode: SlabNode,
};

// ─── Sidebar palette items ─────────────────────────────────────────────────

const PALETTE_ITEMS = [
  { type: 'projectNode',  label: 'Project',  icon: Layers2,    color: 'text-indigo-500' },
  { type: 'storeyNode',   label: 'Storey',   icon: LayoutList, color: 'text-purple-500' },
  { type: 'wallNode',     label: 'Wall',     icon: Minus,      color: 'text-emerald-500' },
  { type: 'columnNode',   label: 'Column',   icon: Columns2,   color: 'text-orange-500' },
  { type: 'beamNode',     label: 'Beam',     icon: Box,        color: 'text-amber-500' },
  { type: 'slabNode',     label: 'Slab',     icon: Square,     color: 'text-cyan-500' },
] as const;

// ─── Compile status ────────────────────────────────────────────────────────

type CompileStatus = 'idle' | 'compiling' | 'ok' | 'error';

// ─── Inner panel (needs ReactFlowProvider context) ─────────────────────────

interface NodeEditorPanelInnerProps {
  visible: boolean;
  onClose: () => void;
}

function NodeEditorPanelInner({ visible, onClose }: NodeEditorPanelInnerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const [autoCompile, setAutoCompile] = useState(true);
  const [status, setStatus] = useState<CompileStatus>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Floating window position & size ─────────────────────────────────────
  const [pos, setPos]   = useState({ x: 80, y: 80 });
  const [size, setSize] = useState({ w: 960, h: 580 });
  const dragRef   = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const resizeRef = useRef<{ mx: number; my: number; w: number; h: number } | null>(null);

  const onHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({ x: dragRef.current.px + me.clientX - dragRef.current.mx,
               y: dragRef.current.py + me.clientY - dragRef.current.my });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  };

  const onResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h };
    const onMove = (me: MouseEvent) => {
      if (!resizeRef.current) return;
      setSize({
        w: Math.max(420, resizeRef.current.w + me.clientX - resizeRef.current.mx),
        h: Math.max(300, resizeRef.current.h + me.clientY - resizeRef.current.my),
      });
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
  };

  const { loadFile } = useIfc();
  const setNodeEditorPanelVisible = useViewerStore((s) => s.setNodeEditorPanelVisible);

  // ── Connect edges ───────────────────────────────────────────────────────
  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) =>
        addEdge({ ...connection, animated: true, style: { stroke: '#a855f7' } }, eds)
      ),
    [setEdges]
  );

  // ── Compile to IFC ──────────────────────────────────────────────────────
  const compile = useCallback(async () => {
    setStatus('compiling');
    setStatusMsg('');
    try {
      const content = compileGraphToIfc(nodes, edges);
      if (!content) {
        setStatus('error');
        setStatusMsg('Add a Project node first');
        return;
      }
      const blob = new Blob([content], { type: 'application/x-step' });
      const file = new File([blob], 'node-graph.ifc', { type: 'application/x-step', lastModified: Date.now() });
      await loadFile(file);
      // loadFile resets store; restore node editor visibility
      setNodeEditorPanelVisible(true);
      setStatus('ok');
    } catch (err) {
      setStatus('error');
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }, [nodes, edges, loadFile, setNodeEditorPanelVisible]);

  // ── Auto-compile with debounce ──────────────────────────────────────────
  useEffect(() => {
    if (!autoCompile) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void compile(); }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [nodes, edges, autoCompile, compile]);

  // ── Add node from palette ───────────────────────────────────────────────
  const addNode = useCallback((type: string) => {
    const id = `${type}-${Date.now()}`;
    const x = 200 + Math.random() * 300;
    const y = 100 + Math.random() * 300;
    setNodes((nds) => [
      ...nds,
      { id, type, position: { x, y }, data: { ...DEFAULT_NODE_DATA[type] } },
    ]);
  }, [setNodes]);

  // ── Status icon ─────────────────────────────────────────────────────────
  const StatusIcon = status === 'compiling' ? Loader2
    : status === 'ok'      ? CheckCircle2
    : status === 'error'   ? AlertCircle
    : null;
  const statusColor = status === 'ok' ? 'text-emerald-500'
    : status === 'error'   ? 'text-red-500'
    : status === 'compiling' ? 'text-muted-foreground animate-spin'
    : 'text-muted-foreground';

  return (
    <div
      className={cn(
        'absolute z-50 flex flex-col bg-background border rounded-lg shadow-2xl overflow-hidden',
        !visible && 'hidden',
      )}
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      {/* Header / drag handle */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/40 shrink-0 cursor-grab active:cursor-grabbing select-none"
        onMouseDown={onHeaderMouseDown}
      >
        <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold tracking-tight">Node Graph Editor</span>

        <div className="flex-1" />

        {/* Status indicator */}
        {StatusIcon && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn('flex items-center gap-1 text-xs', statusColor,
                                  status === 'compiling' && 'animate-pulse')}>
                <StatusIcon className={cn('h-3.5 w-3.5', status === 'compiling' && 'animate-spin')} />
                {statusMsg && <span className="hidden sm:inline">{statusMsg}</span>}
              </span>
            </TooltipTrigger>
            <TooltipContent>{statusMsg || status}</TooltipContent>
          </Tooltip>
        )}

        {/* Auto-compile toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={autoCompile ? 'default' : 'ghost'}
              size="icon-sm"
              onClick={() => setAutoCompile((v) => !v)}
              className={cn(autoCompile && 'bg-primary text-primary-foreground')}
            >
              <Zap className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{autoCompile ? 'Auto-compile on (click to disable)' : 'Auto-compile off (click to enable)'}</TooltipContent>
        </Tooltip>

        {/* Manual compile */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={() => void compile()} disabled={status === 'compiling'}>
              {status === 'compiling' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Compile to IFC</TooltipContent>
        </Tooltip>

        {/* Close */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </div>

      {/* ── Body: sidebar + canvas ── */}
      <div className="flex flex-1 min-h-0">
        {/* Left palette */}
        <div className="w-36 shrink-0 border-r bg-background overflow-y-auto flex flex-col gap-0.5 p-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground px-1 pb-1 select-none">
            Add node
          </p>
          {PALETTE_ITEMS.map(({ type, label, icon: Icon, color }) => (
            <button
              key={type}
              onClick={() => addNode(type)}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left"
            >
              <Icon className={cn('h-4 w-4 shrink-0', color)} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* ReactFlow canvas */}
        <div className="flex-1 min-w-0 h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={NODE_TYPES}
            fitView
            deleteKeyCode="Backspace"
          >
            <Background />
            <Controls />
            <MiniMap zoomable pannable />
          </ReactFlow>
        </div>
      </div>

      {/* Resize grip — bottom-right corner */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-10"
        onMouseDown={onResizeMouseDown}
        title="Resize"
      >
        <svg viewBox="0 0 16 16" className="w-full h-full text-muted-foreground/40" fill="currentColor">
          <path d="M14 10l-4 4h4v-4zm0-4l-8 8h2l6-6V6zm0-4L6 10h2L14 4V2z" />
        </svg>
      </div>
    </div>
  );
}

// ─── Public export (wraps with provider) ──────────────────────────────────

interface NodeEditorPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function NodeEditorPanel({ visible, onClose }: NodeEditorPanelProps) {
  return (
    <ReactFlowProvider>
      <NodeEditorPanelInner visible={visible} onClose={onClose} />
    </ReactFlowProvider>
  );
}
