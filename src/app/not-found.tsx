// 404 page (brief: critical gap fix vs reference — was missing).

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Home, Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background bg-grid p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="rounded-lg bg-primary/10 p-2">
              <Compass className="w-5 h-5 text-primary" />
            </div>
            <CardTitle className="text-lg">Page not found</CardTitle>
          </div>
          <CardDescription>
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/">
              <Home className="w-4 h-4 mr-2" />
              Return to PLTS Monitor
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
