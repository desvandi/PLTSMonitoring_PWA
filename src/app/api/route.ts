import { NextResponse } from "next/server";

// Health check endpoint for uptime monitoring.
export async function GET() {
  return NextResponse.json({
    success: true,
    message: "PLTS Monitor PWA is running",
    data: {
      name: "plts-monitor-pwa",
      version: "1.0.0",
      timestamp: Date.now(),
    },
  });
}
