'use client';

// =============================================================================
// EnergyFlowDiagram — animated PLTS energy-flow diagram (SVG).
// -----------------------------------------------------------------------------
// Renders the model computed by lib/energyFlow.ts (pure logic — the tests pin
// the direction/power decisions there, not here). Visual contract:
//   - Active edges: animated dashes flowing along the direction; speed ∝ W.
//   - Battery edge can flow REVERSE (charging) — dashes run the other way.
//   - UNKNOWN edges: dashed gray with a "?" (never a fake zero-flow).
//   - PV node: "inferred" state is visibly marked (honest-data rule §91).
//   - Emergency ISOLATED: the whole diagram dims + a boundary note.
//   - prefers-reduced-motion: animation disabled (accessibility §37).
// =============================================================================

import { useMemo, useSyncExternalStore } from 'react';
import {
  computeEnergyFlow,
  edgeAnimationSeconds,
  type EnergyFlowInput,
  type FlowEdge,
} from '@/lib/energyFlow';
import { useLanguage } from '@/components/providers/language-provider';
import { cn } from '@/lib/utils';
import { Sun, Battery, Fuel, Zap, Home } from 'lucide-react';

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

const NODE_POS: Record<string, { x: number; y: number }> = {
  pv: { x: 60, y: 46 },
  battery: { x: 60, y: 134 },
  genset: { x: 300, y: 46 },
  inverter: { x: 180, y: 90 },
  load: { x: 300, y: 134 },
};

interface EdgeSpec {
  edge: FlowEdge;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

function edgePath(s: EdgeSpec): string {
  const mx = (s.from.x + s.to.x) / 2;
  const my = (s.from.y + s.to.y) / 2;
  return `M ${s.from.x + 24} ${s.from.y} Q ${mx} ${my}, ${s.to.x - 24} ${s.to.y}`;
}

const CERTAINTY_STROKE: Record<string, string> = {
  measured: 'stroke-emerald-400 text-emerald-400',
  estimated: 'stroke-amber-400 text-amber-400',
  inferred: 'stroke-sky-400 text-sky-400',
  unknown: 'stroke-muted-foreground text-muted-foreground',
};

export function EnergyFlowDiagram({ input, className }: { input: EnergyFlowInput; className?: string }) {
  const { t } = useLanguage();
  const reduced = usePrefersReducedMotion();
  const model = useMemo(() => computeEnergyFlow(input), [input]);

  const nodeMeta: Record<string, { icon: typeof Sun; label: string }> = {
    pv: { icon: Sun, label: t('emergency.node_pv') },
    battery: { icon: Battery, label: t('emergency.node_battery') },
    genset: { icon: Fuel, label: t('emergency.node_genset') },
    inverter: { icon: Zap, label: t('emergency.node_inverter') },
    load: { icon: Home, label: t('emergency.node_load') },
  };

  const activeNodes = new Map(model.nodes.map((n) => [n.id, n]));
  const pvInferred = model.edges.find((e) => e.id === 'pv-battery')?.certainty === 'inferred';

  return (
    <div className={cn('w-full', className)}>
      <svg viewBox="0 0 360 180" className="w-full h-auto" role="img"
           aria-label={t('emergency.flow_aria')}>
        {/* Edges */}
        {model.edges.map((edge) => {
          const from = NODE_POS[edge.from];
          const to = NODE_POS[edge.to];
          if (!from || !to) return null;
          const spec: EdgeSpec = { edge, from, to };
          const path = edgePath(spec);
          const styleCls = CERTAINTY_STROKE[edge.certainty] ?? CERTAINTY_STROKE.unknown;
          const active = edge.direction === 'forward' || edge.direction === 'reverse';
          const animSec = edgeAnimationSeconds(edge.powerW, active);
          const dashDir = edge.direction === 'reverse' ? 'reverse' : 'normal';
          return (
            <g key={edge.id}>
              <path
                d={path}
                fill="none"
                strokeWidth={active ? 2.5 : 1.5}
                strokeDasharray={active ? undefined : '4 4'}
                className={cn(
                  'transition-opacity',
                  styleCls,
                  edge.blocked && 'opacity-25',
                  !active && 'opacity-40',
                )}
                stroke="currentColor"
              />
              {active && !reduced && animSec != null && (
                <path
                  d={path}
                  fill="none"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeDasharray="5 15"
                  className={cn('flow-dash', styleCls, edge.blocked && 'opacity-15')}
                  stroke="currentColor"
                  style={{
                    animationDuration: `${animSec}s`,
                    animationDirection: dashDir,
                  }}
                />
              )}
              <text
                x={(from.x + to.x) / 2 + (edge.id === 'battery-inverter' ? -18 : 0)}
                y={(from.y + to.y) / 2 - 7}
                textAnchor="middle"
                className={cn('text-[9px]', styleCls, edge.blocked && 'opacity-30')}
                fill="currentColor"
              >
                {edge.certainty === 'unknown' ? '?' : `${edge.powerW} W`}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {Object.entries(NODE_POS).map(([id, pos]) => {
          const meta = nodeMeta[id];
          const active = activeNodes.get(id)?.active ?? false;
          const Icon = meta.icon;
          const nodeAccent =
            active
              ? id === 'pv' && pvInferred
                ? 'fill-sky-500/15 stroke-sky-400 text-sky-400'
                : 'fill-emerald-500/15 stroke-emerald-400 text-emerald-400'
              : 'fill-muted stroke-muted-foreground text-muted-foreground';
          return (
            <g key={id} transform={`translate(${pos.x - 24}, ${pos.y - 24})`}
               className={cn('transition-opacity', model.isolated && 'opacity-40')}>
              <rect
                width={48}
                height={48}
                rx={13}
                className={nodeAccent}
                stroke="currentColor"
                strokeWidth={1.5}
                fill="currentColor"
                fillOpacity={0.06}
              />
              <Icon x={14} y={14} width={20} height={20} />
              <text y={62} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {meta.label}
              </text>
              {id === 'pv' && pvInferred && (
                <text y={-2} x={44} textAnchor="middle" className="fill-sky-400 text-[9px]">
                  ~
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
        {model.dataCaveat}
      </p>
    </div>
  );
}
