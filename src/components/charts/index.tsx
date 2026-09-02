'use client';

// Generic Recharts-based chart components for PLTS telemetry.

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart, ReferenceLine,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';

export type ChartPoint = {
  ts: number;
  value: number | null;
  [key: string]: unknown;
};

const tooltipStyle = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--foreground)',
};

function useChartColors() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return {
    grid: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    axis: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)',
    chart1: 'hsl(var(--chart-1))',
    chart2: 'hsl(var(--chart-2))',
    chart3: 'hsl(var(--chart-3))',
    chart4: 'hsl(var(--chart-4))',
  };
}

function formatXAxis(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function BaseLineChart({
  data,
  dataKey,
  color,
  unit,
  title,
  icon,
  domain,
  height = 200,
}: {
  data: ChartPoint[];
  dataKey: string;
  color: string;
  unit?: string;
  title: ReactNode;
  icon?: ReactNode;
  domain?: [number | string, number | string];
  height?: number;
}) {
  const colors = useChartColors();
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} opacity={0.3} />
              <XAxis dataKey="ts" tickFormatter={formatXAxis} tick={{ fontSize: 10 }} stroke={colors.axis} />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke={colors.axis}
                domain={domain ?? ['auto', 'auto']}
                tickFormatter={(v: number) => (unit ? `${v.toFixed(1)}` : String(v))}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(ts: number) => new Date(ts).toLocaleString()}
                formatter={(v: number) => (unit ? `${v.toFixed(2)} ${unit}` : String(v))}
              />
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
            Collecting data... charts will appear after 1 minute.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function BaseAreaChart({
  data,
  dataKey,
  color,
  unit,
  title,
  icon,
  domain,
  height = 200,
  referenceLines,
}: {
  data: ChartPoint[];
  dataKey: string;
  color: string;
  unit?: string;
  title: ReactNode;
  icon?: ReactNode;
  domain?: [number | string, number | string];
  height?: number;
  referenceLines?: { value: number; label: string; color: string }[];
}) {
  const colors = useChartColors();
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} opacity={0.3} />
              <XAxis dataKey="ts" tickFormatter={formatXAxis} tick={{ fontSize: 10 }} stroke={colors.axis} />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke={colors.axis}
                domain={domain ?? ['auto', 'auto']}
                tickFormatter={(v: number) => (unit ? `${v.toFixed(1)}` : String(v))}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(ts: number) => new Date(ts).toLocaleString()}
                formatter={(v: number) => (unit ? `${v.toFixed(2)} ${unit}` : String(v))}
              />
              {referenceLines?.map((rl, i) => (
                <ReferenceLine
                  key={i}
                  y={rl.value}
                  stroke={rl.color}
                  strokeDasharray="4 4"
                  label={{ value: rl.label, fontSize: 9, fill: rl.color, position: 'insideTopRight' }}
                />
              ))}
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                fill={`url(#grad-${dataKey})`}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
            Collecting data...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return <Skeleton className={cn('w-full rounded-xl')} style={{ height }} />;
}

// Voltage chart with reference lines for low/full pack thresholds.
export function VoltageChart({ data }: { data: ChartPoint[] }) {
  const colors = useChartColors();
  return (
    <BaseAreaChart
      data={data}
      dataKey="value"
      color={colors.chart1}
      unit="V"
      title="Battery Voltage (V)"
      domain={[44, 56]}
      referenceLines={[
        { value: 45, label: 'Low (45V)', color: 'hsl(var(--status-error))' },
        { value: 54, label: 'Full (54V)', color: 'hsl(var(--status-on))' },
      ]}
    />
  );
}

export function CurrentChart({ data }: { data: ChartPoint[] }) {
  const colors = useChartColors();
  return (
    <BaseAreaChart
      data={data}
      dataKey="value"
      color={colors.chart2}
      unit="A"
      title="Battery Current (A) — signed (+charge / -discharge)"
      referenceLines={[{ value: 0, label: '0A', color: 'hsl(var(--status-off))' }]}
    />
  );
}

export function PowerChart({ data }: { data: ChartPoint[] }) {
  const colors = useChartColors();
  return (
    <BaseAreaChart
      data={data}
      dataKey="value"
      color={colors.chart3}
      unit="W"
      title="Battery Power (W) — signed"
      referenceLines={[{ value: 0, label: '0W', color: 'hsl(var(--status-off))' }]}
    />
  );
}

export function SocChart({ data }: { data: ChartPoint[] }) {
  const colors = useChartColors();
  return (
    <BaseAreaChart
      data={data}
      dataKey="value"
      color={colors.chart4}
      unit="%"
      title="SOC (%)"
      domain={[0, 100]}
      referenceLines={[
        { value: 30, label: 'Low Warn', color: 'hsl(var(--status-warn))' },
        { value: 20, label: 'Low Crit', color: 'hsl(var(--status-error))' },
      ]}
    />
  );
}

export function AcCurrentChart({ data }: { data: ChartPoint[] }) {
  const colors = useChartColors();
  return (
    <BaseAreaChart
      data={data}
      dataKey="value"
      color={colors.chart2}
      unit="A"
      title="AC RMS Current (A)"
    />
  );
}

export function TempChart({ data }: { data: ChartPoint[] }) {
  const colors = useChartColors();
  return (
    <BaseLineChart data={data} dataKey="value" color={colors.chart3} unit="°C" title="Ambient Temperature (°C)" />
  );
}

export function HumChart({ data }: { data: ChartPoint[] }) {
  const colors = useChartColors();
  return (
    <BaseLineChart data={data} dataKey="value" color={colors.chart1} unit="%" title="Humidity (%)" domain={[0, 100]} />
  );
}
