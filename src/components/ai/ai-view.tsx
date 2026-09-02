'use client';

// =============================================================================
// AI Insights View — advisory-only AI insights (brief §94-95, §99)
// -----------------------------------------------------------------------------
// CRITICAL CONTRACT (brief §94-95):
//   - PWA NEVER calls GAS directly. ESP32 proxies via HMAC.
//   - All insights are ADVISORY ONLY — never used for control.
//   - The UI MUST display a prominent "ADVISORY ONLY" badge on every insight.
//   - Source label: 'gemini' (real) vs 'mock' (fallback) — always visible.
//   - Insights are cached by GAS for ~5min; PWA polls every 5min.
// =============================================================================

import { useAiInsights } from '@/hooks/useApi';
import { useLanguage } from '@/components/providers/language-provider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Brain, Info, AlertTriangle, AlertCircle, RefreshCw,
  BatteryCharging, Activity, AlertOctagon, Wind,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';
import type { AiInsight, InsightSeverity, InsightCategory } from '@/lib/types';

const SEVERITY_STYLE: Record<InsightSeverity, { color: string; icon: typeof Info }> = {
  info: { color: 'text-status-info border-status-info/30', icon: Info },
  warning: { color: 'text-status-warn border-status-warn/30', icon: AlertTriangle },
  critical: { color: 'text-status-error border-status-error/30', icon: AlertCircle },
};

const CATEGORY_ICON: Record<InsightCategory, typeof Brain> = {
  battery_analysis: BatteryCharging,
  energy_analysis: Activity,
  energy_anomaly: AlertOctagon,
  maintenance_suggestion: Brain,
  environment_alert: Wind,
};

export function AiView() {
  const { t, lang } = useLanguage();
  const { data, isLoading, isFetching, refetch } = useAiInsights();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-16 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const envelope = data; // request<InsightsEnvelope> already unwraps
  const insights: AiInsight[] = envelope?.insights ?? [];
  // InsightsEnvelope (kontrak): penanda mock ada di .mock; timestamp cache
  // diambil dari generatedAt insight terbaru saat envelope.cached — field
  // cachedAt/source di level envelope tidak pernah ada di kontrak (akses
  // warisan as-any yang selalu undefined).
  const isMock = envelope?.mock === true;
  const cachedAt = envelope?.cached && insights.length > 0
    ? Math.max(...insights.map((i) => i.generatedAt))
    : null;
  const hasError = !envelope?.success || !!envelope?.error;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Brain className="w-6 h-6 text-primary" />
          {t('ai.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('ai.subtitle')}</p>
      </div>

      {/* Advisory-only banner — prominent, always visible */}
      <Alert className="border-status-warn/40 bg-status-warn/5">
        <AlertTriangle className="w-4 h-4 text-status-warn" />
        <AlertDescription className="text-xs text-status-warn">
          <strong>{t('ai.advisory_only')}</strong> — {t('ai.disclaimer')}
        </AlertDescription>
      </Alert>

      {/* Pipeline / source status */}
      <Card className="border-border/60">
        <CardContent className="p-3 flex items-center justify-between text-xs flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground uppercase tracking-wider">
              {t('ai.pipeline')}:
            </span>
            <Badge
              variant="outline"
              className={cn(
                'text-[9px] px-1.5 h-4',
                isMock
                  ? 'border-status-warn/30 text-status-warn'
                  : 'border-status-on/30 text-status-on',
              )}
            >
              {isMock ? 'MOCK (offline)' : 'GEMINI (live)'}
            </Badge>
            {cachedAt && (
              <span className="text-muted-foreground">
                · cached {formatRelativeTime(cachedAt, lang)}
              </span>
            )}
          </div>
          <Button
            variant="outline" size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        </CardContent>
      </Card>

      {/* Error state */}
      {hasError && (
        <Alert className="border-status-error/40 bg-status-error/5">
          <AlertCircle className="w-4 h-4 text-status-error" />
          <AlertDescription className="text-xs text-status-error">
            AI insights unavailable: {envelope?.error ?? 'unknown error'}
            {envelope?.message && (
              <span className="block mt-1 text-muted-foreground">{envelope.message}</span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Insights grid */}
      {insights.length === 0 && !hasError ? (
        <Card className="border-dashed border-border/50">
          <CardContent className="py-12 text-center text-muted-foreground">
            <Brain className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No insights available yet.</p>
            <p className="text-xs mt-1">
              The GasAdvisor posts telemetry hourly. Insights will appear after the first cycle.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {insights.map((ins) => {
            const sev = SEVERITY_STYLE[ins.severity];
            const SevIcon = sev.icon;
            const CatIcon = CATEGORY_ICON[ins.category] ?? Brain;
            return (
              <Card key={ins.id} className={cn('border', sev.color)}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-start justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <CatIcon className="w-4 h-4 flex-shrink-0" />
                      {ins.title}
                    </span>
                    <div className="flex flex-col gap-1 items-end">
                      <Badge variant="outline" className={cn('text-[9px] px-1.5 h-4', sev.color)}>
                        <SevIcon className="w-2.5 h-2.5 mr-1" />
                        {ins.severity.toUpperCase()}
                      </Badge>
                      <Badge variant="outline" className="text-[9px] px-1.5 h-4 opacity-70">
                        ADVISORY ONLY
                      </Badge>
                    </div>
                  </CardTitle>
                  <CardDescription className="text-[10px] text-muted-foreground">
                    {ins.category.replace(/_/g, ' ')} ·{' '}
                    {ins.source === 'gemini' ? 'Gemini' : 'mock'} ·{' '}
                    {formatRelativeTime(ins.generatedAt, lang)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-xs whitespace-pre-wrap">{ins.body}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
