'use client';

import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Download, RotateCcw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useSysConfig } from '@/components/providers/sys-config-provider';
import { exportSysConfigBlob, persistSysConfig, validateSysConfig } from '@/lib/sysConfig';

/**
 * SystemConfigPanel — Export, Import & Factory Reset PWA config (§2.5).
 * Mount it in Settings view.
 */
export function SystemConfigPanel() {
  const { config, reset, refresh } = useSysConfig();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleExport = useCallback(() => {
    if (!config) {
      toast.error('Tidak ada konfigurasi untuk diekspor.');
      return;
    }
    const blob = exportSysConfigBlob(config);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'plts_config_backup.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Konfigurasi diunduh sebagai plts_config_backup.json');
  }, [config]);

  const handleImport = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const validated = validateSysConfig(parsed);
      if (!validated) {
        toast.error('File tidak sesuai schema PLTS_SYS_CONFIG.');
        return;
      }
      // Persist the FULL validated multi-device config (v2 schema).
      // Using writeSysConfig() here would collapse devices[] to a single
      // entry and drop labels — see testing-agent regression report.
      persistSysConfig({
        gas_webapp_url: validated.gas_webapp_url,
        auth_token: validated.auth_token,
        device_id: validated.device_id,
        dashboard_settings: validated.dashboard_settings,
        active_device_id: validated.active_device_id,
        devices: validated.devices,
      });
      refresh();
      toast.success(`Konfigurasi berhasil diimpor (${validated.devices.length} device).`);
    } catch {
      toast.error('Gagal membaca file JSON.');
    }
  }, [refresh]);

  const handleReset = useCallback(() => {
    reset();
    toast.success('Aplikasi direset. Anda akan diarahkan ke halaman setup.');
    setTimeout(() => {
      window.location.href = '/setup';
    }, 400);
  }, [reset]);

  return (
    <Card data-testid="system-config-panel">
      <CardHeader>
        <CardTitle>System Configuration Backup</CardTitle>
        <CardDescription>
          Ekspor, impor, atau reset konfigurasi lokal PWA (<code>PLTS_SYS_CONFIG</code>).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <Button onClick={handleExport} variant="secondary" data-testid="config-export-btn">
          <Download className="w-4 h-4 mr-2" /> Ekspor Konfigurasi
        </Button>

        <Button
          variant="secondary"
          onClick={() => fileRef.current?.click()}
          data-testid="config-import-btn"
        >
          <Upload className="w-4 h-4 mr-2" /> Impor Konfigurasi
        </Button>
        <input
          ref={fileRef}
          data-testid="config-import-file"
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImport(file);
            e.target.value = '';
          }}
        />

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" data-testid="config-reset-btn">
              <RotateCcw className="w-4 h-4 mr-2" /> Reset Aplikasi
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                Reset PWA ke Setup Awal
              </AlertDialogTitle>
              <AlertDialogDescription>
                Ini akan menghapus <code>PLTS_SYS_CONFIG</code> dari browser dan mengalihkan Anda ke layar setup awal.
                Konfigurasi ESP32 di lapangan tidak terpengaruh.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction onClick={handleReset} data-testid="config-reset-confirm">
                Reset Sekarang
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
