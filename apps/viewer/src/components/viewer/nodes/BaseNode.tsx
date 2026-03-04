/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import React from 'react';
import { cn } from '@/lib/utils';

interface BaseNodeProps {
  title: string;
  subtitle?: string;
  headerClass: string;
  selected?: boolean;
  children: React.ReactNode;
}

/** Shared wrapper for all IFC node cards */
export function BaseNode({ title, subtitle, headerClass, selected, children }: BaseNodeProps) {
  return (
    <div
      className={cn(
        'min-w-[200px] rounded-lg shadow-lg border-2 bg-white dark:bg-zinc-900 text-sm',
        selected ? 'border-primary' : 'border-zinc-200 dark:border-zinc-700',
      )}
    >
      <div className={cn('px-3 py-2 rounded-t-md', headerClass)}>
        <div className="font-mono font-bold text-white text-xs uppercase tracking-wider">{title}</div>
        {subtitle && <div className="text-white/70 text-[10px] font-mono">{subtitle}</div>}
      </div>
      <div className="p-2.5 space-y-1.5">{children}</div>
    </div>
  );
}

/** Compact labelled field row */
export function NodeField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground font-mono w-16 shrink-0 text-right">{label}</span>
      {children}
    </div>
  );
}

/** Styled input for node fields */
export function NodeInput({
  value,
  onChange,
  type = 'text',
  placeholder,
  step,
}: {
  value: string | number;
  onChange: (val: string | number) => void;
  type?: 'text' | 'number';
  placeholder?: string;
  step?: number;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      step={step}
      className="nodrag flex-1 h-6 px-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary w-full"
      onChange={e => onChange(type === 'number' ? e.target.valueAsNumber : e.target.value)}
    />
  );
}
