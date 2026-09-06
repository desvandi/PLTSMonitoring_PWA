'use client';

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { isValidInsight } from '@/lib/aiInsights';
import { fetchGasInsights } from '@/lib/gasEnvelope';
import { readSysConfig } from '@/lib/sysConfig';
import { getMqttStatus, hasMqttStatus } from '@/lib/mqtt';
import { recordEnergySample } from '@/lib/energyHistory';

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    // [PWA-01 REMEDIATION 2026-08] MQTT-first: when the MQTT bridge has a
    // live envelope, it IS the telemetry source — the REST poll is bypassed
    // (in MQTT-only production mode /api/status would 401 and kill the query).
    // The MQTT provider writes every envelope into this same cache key.
    queryFn: () => {
      if (hasMqttStatus()) return getMqttStatus()!;
      return api.status();
    },
    refetchInterval: () => (hasMqttStatus() ? 2000 : 5000),
    staleTime: 3000,
  });
}

/**
 * [PWA-04 REMEDIATION 2026-08] Subscribe-and-record: feeds every status
 * update (REST or MQTT) into the 24 h energy history that powers the
 * battery/energy charts. Previously recordEnergySample was exported but
 * NEVER called — the charts showed "Collecting data…" forever.
 * [WAVE-7 / PW7-6] Pencatatan kini di effect, bukan di badan render —
 * recordEnergySample bermutasi localStorage (side-effect); memanggilnya
 * saat render berisiko dieksekusi dua kali oleh StrictMode/concurrent
 * rendering pada render yang dibuang (throttle 60 detik hanya kebetulan
 * menyelamatkannya).
 */
export function useStatusAndRecord() {
  const query = useStatus();
  const data = query.data;
  useEffect(() => {
    if (data) recordEnergySample(data);
  }, [data]);
  return query;
}

export function useVersion() {
  return useQuery({
    queryKey: ['version'],
    queryFn: () => api.version(),
    staleTime: 60000,
  });
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api.config(),
  });
}

export function useAlarms() {
  return useQuery({
    queryKey: ['alarms'],
    queryFn: () => api.alarms(),
    refetchInterval: 5000,
  });
}

export function useDiagnostics() {
  return useQuery({
    queryKey: ['diagnostics'],
    queryFn: () => api.diagnostics(),
    refetchInterval: 10000,
  });
}

export function useCalibration() {
  return useQuery({
    queryKey: ['calibration'],
    queryFn: () => api.calibration(),
  });
}

export function useAiInsights() {
  return useQuery({
    queryKey: ['insights'],
    // [WAVE-7 / PW7-5] Setiap insight diverifikasi terhadap kontrak
    // (advisoryOnly === true, kategori/severity/source sah) sebelum sampai
    // ke UI — sebelumnya validator di lib/aiInsights.ts adalah dead code.
    // [PARITY-3 2026-09-06] GAS fallback: the device path (/api/insights via
    // the ESP32 HMAC proxy) only exists in LAN mode — a cloud-only profile
    // (no NEXT_PUBLIC_API_BASE_URL) previously got a permanent 503 from the
    // PWA's own route. GAS now serves action=INSIGHTS directly; call it with
    // the active device profile (same transport as LATEST/EMERGENCY_LOG).
    queryFn: async () => {
      let envelope;
      try {
        envelope = await api.insights();
      } catch (deviceErr) {
        const config = readSysConfig();
        const device = config
          ? (config.devices.find((d) => d.device_id === config.active_device_id) ?? config.devices[0])
          : undefined;
        if (!device) throw deviceErr;
        envelope = await fetchGasInsights(
          device.gas_webapp_url, device.auth_token, device.device_id);
      }
      const all = envelope.insights ?? [];
      const valid = all.filter(isValidInsight);
      return { ...envelope, insights: valid };
    },
    refetchInterval: 300000,
  });
}

export function useReboot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.reboot(),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useAckAlarm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (alarmId: string) => api.acknowledgeAlarm(alarmId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alarms'] }),
  });
}
