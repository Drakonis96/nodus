import React from 'react';
import type { IdeaType, EdgeType } from '@shared/types';

export const NODE_COLORS: Record<IdeaType, string> = {
  claim: '#6366f1',
  finding: '#10b981',
  construct: '#f59e0b',
  method: '#ec4899',
  framework: '#06b6d4',
};

export const NODE_LABELS: Record<IdeaType, string> = {
  claim: 'afirmación',
  finding: 'hallazgo',
  construct: 'constructo',
  method: 'método',
  framework: 'marco',
};

export const EDGE_LABELS: Record<EdgeType, string> = {
  extends: 'extiende',
  contradicts: 'contradice',
  applies_to: 'aplica a',
  shares_method: 'comparte método',
  precondition_of: 'precondición de',
  measures_same: 'mide lo mismo',
  supports: 'apoya',
  refutes: 'refuta',
};

export function Badge({
  children,
  color = 'neutral',
  title,
}: {
  children: React.ReactNode;
  color?: 'neutral' | 'indigo' | 'green' | 'amber' | 'red' | 'cyan';
  title?: string;
}) {
  const map: Record<string, string> = {
    neutral: 'bg-neutral-800 text-neutral-300',
    indigo: 'bg-indigo-900/50 text-indigo-300',
    green: 'bg-emerald-900/50 text-emerald-300',
    amber: 'bg-amber-900/50 text-amber-300',
    red: 'bg-red-900/50 text-red-300',
    cyan: 'bg-cyan-900/50 text-cyan-300',
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs ${map[color]}`}>
      {children}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-neutral-400 text-sm">
      <span className="inline-block w-4 h-4 border-2 border-neutral-600 border-t-indigo-400 rounded-full animate-spin" />
      {label}
    </div>
  );
}

export function TypeDot({ type }: { type: IdeaType | 'author' }) {
  const color = type === 'author' ? '#a3a3a3' : NODE_COLORS[type];
  return <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />;
}
