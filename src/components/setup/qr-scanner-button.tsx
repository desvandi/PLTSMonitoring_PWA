'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, Loader2, X, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface QrScannerButtonProps {
  onDetected: (text: string) => void;
  label?: string;
  'data-testid'?: string;
}

/**
 * Opens a modal with the device camera stream. Feeds each animation frame to
 * `jsQR` and calls `onDetected` when a QR is decoded. Automatically closes
 * the camera & modal on first detection. Uses back camera when available.
 */
export function QrScannerButton({ onDetected, label = 'Scan QR', ...rest }: QrScannerButtonProps) {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  // Deklarasi function (hoisted): self-reference requestAnimationFrame(tick)
  // legal tanpa TDZ — pola const-arrow menyalakan react-hooks/immutability.
  function tick(): void {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const image = ctx.getImageData(0, 0, w, h);
      const found = jsQR(image.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (found?.data) {
        stop();
        setOpen(false);
        onDetected(found.data);
        toast.success('QR terdeteksi & data disalin ke form.');
        return;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  const startCamera = useCallback(async () => {
    setError(null);
    setScanning(true);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Browser tidak mendukung akses kamera.');
      setScanning(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      tick();
    } catch (err) {
      setError(`Kamera tidak dapat diakses: ${(err as Error).message}`);
      setScanning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // [AUDIT 2026-08-28 G8] Seluruh kickoff/teardown ditunda satu macrotask —
    // setError/setScanning (di startCamera maupun stop) tidak pernah
    // sinkron-reachable dari badan effect (react-hooks/set-state-in-effect).
    const kickoff = open
      ? window.setTimeout(() => void startCamera(), 0)
      : window.setTimeout(stop, 0);
    return () => {
      window.clearTimeout(kickoff);
      stop();
    };
  }, [open, startCamera, stop]);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid={rest['data-testid'] ?? 'qr-scan-button'}
      >
        <ScanLine className="w-3.5 h-3.5 mr-1.5" /> {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="qr-scan-modal">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="w-4 h-4" /> Scan QR Onboarding
            </DialogTitle>
            <DialogDescription>
              Arahkan kamera ke QR yang di-generate PWA (Settings → QR
              Onboarding). Form setup akan otomatis terisi.
            </DialogDescription>
          </DialogHeader>
          <div className="relative rounded-md overflow-hidden border border-border bg-black aspect-square">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              muted
              playsInline
              aria-label="camera-preview"
            />
            <canvas ref={canvasRef} className="hidden" />
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-3/5 aspect-square border-2 border-primary/70 rounded-lg" />
            </div>
            {scanning && (
              <div className="absolute top-2 right-2 flex items-center gap-1.5 text-[10px] bg-black/60 text-white px-2 py-1 rounded">
                <Loader2 className="w-3 h-3 animate-spin" /> Memindai...
              </div>
            )}
          </div>
          {error && (
            <div className="text-xs text-destructive flex items-center gap-1.5">
              <CameraOff className="w-3.5 h-3.5" /> {error}
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              <X className="w-3.5 h-3.5 mr-1.5" /> Tutup
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
