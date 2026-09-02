// =============================================================================
// Energy History — stores battery/AC/environment samples in localStorage (24h rolling)
// -----------------------------------------------------------------------------
// Sampled every 60s from MQTT status updates = max 1440 data points
// Extended for PLTS sensors (battery V/I/P/SOC, AC RMS, ambient T/H).
// =============================================================================

import type { SystemStatus } from "./types";

export type PltsSample = {
  ts: number;                 // ms epoch
  // Battery
  battV: number | null;
  battI: number | null;
  battP: number | null;
  soc: number | null;
  // AC
  acRmsI: number | null;
  acPeakI: number | null;
  acEstP: number | null;
  // Environment
  tempC: number | null;
  humPct: number | null;
  dewPoint: number | null;
};

const STORAGE_KEY = "plts-history";
const MAX_SAMPLES = 1440; // 24h × 60 samples/hour
const SAMPLE_INTERVAL_MS = 60_000; // 1 minute

let lastSampleMs = 0;
let cachedHistory: PltsSample[] | null = null;

export function getEnergyHistory(): PltsSample[] {
  if (cachedHistory) return cachedHistory;
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      cachedHistory = JSON.parse(raw) as PltsSample[];
      return cachedHistory;
    }
  } catch {
    // ignore
  }
  return [];
}

export function recordEnergySample(status: SystemStatus | undefined | null): void {
  if (!status) return;
  if (typeof localStorage === "undefined") return;

  const now = Date.now();
  if (now - lastSampleMs < SAMPLE_INTERVAL_MS) return;
  lastSampleMs = now;

  const sample: PltsSample = {
    ts: now,
    battV: status.battery.voltage.value,
    battI: status.battery.current.value,
    battP: status.battery.power.value,
    soc: status.battery.soc.value,
    acRmsI: status.ac.rmsCurrent.value,
    acPeakI: status.ac.peakCurrent.value,
    acEstP: status.ac.estimatedPower?.value ?? null,
    tempC: status.environment.temperature.value,
    humPct: status.environment.humidity.value,
    dewPoint: status.environment.dewPoint,
  };

  const history = getEnergyHistory();
  history.push(sample);

  if (history.length > MAX_SAMPLES) {
    history.splice(0, history.length - MAX_SAMPLES);
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    cachedHistory = history;
  } catch {
    // Quota exceeded — trim harder
    if (history.length > 720) {
      history.splice(0, history.length - 720);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
        cachedHistory = history;
      } catch {
        // give up — leave cached copy
      }
    }
  }
}

export function clearEnergyHistory(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  cachedHistory = [];
}

// Get samples from last N hours
export function getRecentSamples(hours: number): PltsSample[] {
  const history = getEnergyHistory();
  const cutoff = Date.now() - hours * 3600_000;
  return history.filter((s) => s.ts >= cutoff);
}

// Get samples from last N days
export function getRecentSamplesDays(days: number): PltsSample[] {
  const history = getEnergyHistory();
  const cutoff = Date.now() - days * 86_400_000;
  return history.filter((s) => s.ts >= cutoff);
}

export function getRecentSamplesRange(fromMs: number, toMs: number): PltsSample[] {
  const history = getEnergyHistory();
  return history.filter((s) => s.ts >= fromMs && s.ts <= toMs);
}
