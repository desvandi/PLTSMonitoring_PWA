'use client';

// =============================================================================
// Error boundary (brief: critical gap fix vs reference — was missing).
// -----------------------------------------------------------------------------
// Catches runtime React errors and shows a friendly fallback with a "reload"
// button. Logs to console.error for diagnostics. Does NOT catch errors in
// event handlers or async code (use try/catch there).
// =============================================================================

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[PLTS PWA] Uncaught error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background bg-grid p-4">
      <Card className="max-w-md w-full border-status-error/30">
        <CardHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="rounded-lg bg-status-error/10 p-2">
              <AlertTriangle className="w-5 h-5 text-status-error" />
            </div>
            <CardTitle className="text-lg">Something went wrong</CardTitle>
          </div>
          <CardDescription>
            An unexpected error occurred while rendering the page. Reloading usually fixes it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs font-mono break-all">
            <p className="text-muted-foreground mb-1">Error:</p>
            <p className="text-foreground">{error.message || 'Unknown error'}</p>
            {error.digest && (
              <p className="text-muted-foreground mt-1">Digest: {error.digest}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={reset} className="flex-1">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try again
            </Button>
            <Button
              variant="outline"
              onClick={() => (window.location.href = '/')}
              className="flex-1"
            >
              <Home className="w-4 h-4 mr-2" />
              Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
