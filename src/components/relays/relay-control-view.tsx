"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { deviceApi } from "@/lib/deviceApi";
import { getCompatibilitySnapshot } from "@/lib/compatibility";
import type { RelayChannelStatus, RelayCommandState } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Power, AlertTriangle, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";

// Command state tracking — per-channel, with expiry
// TIMEOUT → UNKNOWN (not FAILED) — reconcile after reconnect, not blind retry
const channelCommandState = new Map<number, { state: RelayCommandState; expiresAt: number }>();

function getCommandState(channel: number): RelayCommandState | null {
  const entry = channelCommandState.get(channel);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    channelCommandState.delete(channel);
    return "TIMEOUT"; // UNKNOWN — not FAILED
  }
  return entry.state;
}

function setCommandState(channel: number, state: RelayCommandState, ttlMs = 10000) {
  channelCommandState.set(channel, { state, expiresAt: Date.now() + ttlMs });
}

function clearCommandState(channel: number) {
  channelCommandState.delete(channel);
}

function RelayChannelCard({ channel, status }: { channel: number; status: RelayChannelStatus }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);

  const onMutation = useMutation({
    mutationFn: () => deviceApi.relayOn(channel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7),
    onMutate: () => {
      setPending(true);
      setCommandState(channel, "COMMAND_PENDING");
    },
    onSuccess: (result) => {
      if (result.ok) {
        // [PRODUCTION-GRADE 2026-09 / audit p.70] Derive the confirmation from
        // the ACTION that just succeeded, NOT from the pre-command status
        // snapshot (the old code read status.desiredState — a stale value, so
        // ON from an OFF state showed CONFIRMED_OFF).
        // QUEUED result → the executor will finalize asynchronously; the
        // relayStatus invalidation below reconciles the 3-tier display.
        setCommandState(channel, result.result === "QUEUED" ? "COMMAND_PENDING" : "CONFIRMED_ON");
        toast.success(`Channel ${channel}: ${result.message}`);
      } else {
        setCommandState(channel, result.result === "UNKNOWN" ? "UNKNOWN" : "FAILED");
        toast.error(`Channel ${channel}: ${result.message}`);
      }
      qc.invalidateQueries({ queryKey: ["relayStatus"] });
    },
    onError: () => {
      // TIMEOUT → UNKNOWN (not FAILED) — we don't know if command reached device
      setCommandState(channel, "TIMEOUT");
      toast.warning(`Channel ${channel}: command timeout — state UNKNOWN. Reconcile after reconnect.`);
      qc.invalidateQueries({ queryKey: ["relayStatus"] });
    },
    onSettled: () => setPending(false),
  });

  const offMutation = useMutation({
    mutationFn: () => deviceApi.relayOff(channel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7),
    onMutate: () => {
      setPending(true);
      setCommandState(channel, "COMMAND_PENDING");
    },
    onSuccess: (result) => {
      if (result.ok) {
        clearCommandState(channel);
        toast.success(`Channel ${channel}: ${result.message}`);
      } else {
        setCommandState(channel, "FAILED");
        toast.error(`Channel ${channel}: ${result.message}`);
      }
      qc.invalidateQueries({ queryKey: ["relayStatus"] });
    },
    onError: () => {
      setCommandState(channel, "TIMEOUT");
      toast.warning(`Channel ${channel}: command timeout — state UNKNOWN`);
      qc.invalidateQueries({ queryKey: ["relayStatus"] });
    },
    onSettled: () => setPending(false),
  });

  const ackMutation = useMutation({
    mutationFn: () => deviceApi.relayAcknowledge(channel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7),
    onSuccess: () => {
      toast.success(`Channel ${channel}: safety alarm acknowledged`);
      qc.invalidateQueries({ queryKey: ["relayStatus"] });
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => deviceApi.relayClear(channel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7),
    onSuccess: () => {
      toast.success(`Channel ${channel}: safety lockout cleared`);
      qc.invalidateQueries({ queryKey: ["relayStatus"] });
    },
  });

  const cmdState = getCommandState(channel);
  const isOn = status.reportedState;
  const isLocked = status.lockoutState !== "NORMAL" && status.lockoutState !== "ARMED";
  const isForced = status.maxOnTimeForced;

  // State confidence display — honest about software-only
  const confidenceLabel = status.stateConfidence === "SOFTWARE_ONLY"
    ? "Software only"
    : status.stateConfidence === "VERIFIED"
    ? "Verified"
    : status.stateConfidence === "FAULT"
    ? "Fault"
    : "Unknown";

  return (
    <Card className={`relative ${isOn ? "border-emerald-500/50" : ""} ${isLocked ? "border-red-500/50" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Power className={`h-4 w-4 ${isOn ? "text-emerald-500" : "text-muted-foreground"}`} />
            {status.name || `Channel ${channel}`}
          </CardTitle>
          <div className="flex gap-1">
            {isOn && <Badge variant="default" className="bg-emerald-600">ON</Badge>}
            {!isOn && <Badge variant="secondary">OFF</Badge>}
            {cmdState === "COMMAND_PENDING" && (
              <Badge variant="outline" className="animate-pulse">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                PENDING
              </Badge>
            )}
            {cmdState === "TIMEOUT" && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/50">
                UNKNOWN
              </Badge>
            )}
            {isForced && (
              <Badge variant="destructive">
                <ShieldAlert className="h-3 w-3 mr-1" />
                FORCE OFF
              </Badge>
            )}
            {isLocked && (
              <Badge variant="destructive" className="text-xs">
                {status.lockoutState}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 3-tier state display: desired / reported / physical */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="text-center">
            <div className="text-muted-foreground">Desired</div>
            <div className={status.desiredState ? "text-emerald-600 font-bold" : "text-muted-foreground font-bold"}>
              {status.desiredState ? "ON" : "OFF"}
            </div>
          </div>
          <div className="text-center">
            <div className="text-muted-foreground">Reported</div>
            <div className={status.reportedState ? "text-emerald-600 font-bold" : "text-muted-foreground font-bold"}>
              {status.reportedState ? "ON" : "OFF"}
            </div>
          </div>
          <div className="text-center">
            <div className="text-muted-foreground">Physical</div>
            <div className="text-muted-foreground font-bold">
              {status.physicalState === null ? "—" : status.physicalState ? "ON" : "OFF"}
            </div>
          </div>
        </div>

        {/* Confidence + source */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Confidence: {confidenceLabel}</span>
          <span>Source: {status.source}</span>
        </div>

        {/* State drift detection */}
        {status.desiredState !== status.reportedState && (
          <div className="flex items-center gap-1 text-xs text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            STATE DRIFT: desired={status.desiredState ? "ON" : "OFF"}, reported={status.reportedState ? "ON" : "OFF"}
          </div>
        )}

        {/* Controls — idempotent ON/OFF (NOT toggle) */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={isOn ? "secondary" : "default"}
            className="flex-1"
            disabled={pending || isLocked || isForced || !status.enabled}
            onClick={() => onMutation.mutate()}
          >
            ON
          </Button>
          <Button
            size="sm"
            variant={!isOn ? "secondary" : "default"}
            className="flex-1"
            disabled={pending || !status.enabled}
            onClick={() => offMutation.mutate()}
          >
            OFF
          </Button>
        </div>

        {/* Safety lockout controls */}
        {isLocked && (
          <div className="space-y-2 pt-2 border-t">
            <div className="text-xs text-red-600 flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" />
              Safety lockout: {status.lockoutState}
            </div>
            {status.lockoutState === "TRIPPED" && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={ackMutation.isPending}
                onClick={() => ackMutation.mutate()}
              >
                <ShieldCheck className="h-3 w-3 mr-1" />
                Acknowledge
              </Button>
            )}
            {status.lockoutState === "ACKNOWLEDGED" && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={clearMutation.isPending}
                onClick={() => clearMutation.mutate()}
              >
                Clear Lockout
              </Button>
            )}
          </div>
        )}

        {!status.enabled && (
          <div className="text-xs text-muted-foreground text-center pt-1">
            Channel disabled in config
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RelayControlView() {
  // [self-review fix] Check compatibility before fetching — if firmware
  // doesn't support 8-channel relay (v1.7.x or older), show honest message
  // instead of getting a 404 error.
  const compat = getCompatibilitySnapshot();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["relayStatus"],
    queryFn: () => deviceApi.relayStatus(),
    refetchInterval: 3000,
    // Skip the query if firmware doesn't support relays
    enabled: compat ? compat.canControlRelays : false,
  });

  const qc = useQueryClient();
  const allOffMutation = useMutation({
    mutationFn: () => deviceApi.relayAllOff(),
    onSuccess: () => {
      toast.success("All channels OFF");
      qc.invalidateQueries({ queryKey: ["relayStatus"] });
    },
  });

  // Compatibility gate — honest "not supported" message
  if (compat && !compat.canControlRelays) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            <div>
              <p className="font-medium">8-Channel Relay not available</p>
              <p className="text-sm text-muted-foreground mt-1">
                Firmware version {compat.firmwareVersion ?? "unknown"} does not
                support 8-channel relay control. Requires firmware v1.8.0 or later
                with PCF8574 I²C expander.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">
            Unable to load relay status. The firmware may not support 8-channel relay
            (requires v1.8.0+). Check compatibility banner.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data.available) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            <span>Relay driver unavailable (PCF8574 not responding). Check I²C wiring.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">8-Channel Relay Control</h2>
        <Button
          variant="destructive"
          size="sm"
          disabled={allOffMutation.isPending}
          onClick={() => allOffMutation.mutate()}
        >
          All OFF
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {data.channels.map((ch) => (
          <RelayChannelCard
            key={ch.channel}
            channel={ch.channel}
            status={ch}
          />
        ))}
      </div>

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <p>
            <strong>State Confidence:</strong> SOFTWARE_ONLY means GPIO was commanded
            but no physical feedback is available. Physical state is unknown (null).
          </p>
          <p>
            <strong>Timeout:</strong> If a command times out, state is UNKNOWN (not FAILED).
            Reconcile after reconnect — do NOT blind retry.
          </p>
          <p>
            <strong>Safety:</strong> maxOnTime FORCE OFF cannot be overridden.
            Acknowledge + Clear required to re-enable.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
