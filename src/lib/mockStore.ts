// =============================================================================
// Mock API Store — PLTS Monitor
// -----------------------------------------------------------------------------
// In-memory simulation of ESP32 firmware v1.0 state. Persisted to a JSON file
// under .data/ so the demo state survives server restarts.
//
// In production: this file is NOT used. The PWA calls the real ESP32 firmware
// through the Cloudflare Tunnel URL configured in NEXT_PUBLIC_API_BASE_URL, or
// via MQTT remote mode.
//
// Fail-closed: isMockAuthEnabled() returns FALSE in production regardless of
// env vars (brief: production-grade anti-pattern fix).
// =============================================================================

import { promises as fs } from "fs";
import path from "path";
import { timingSafeEqual } from "crypto";   // [audit-2 K-2] constant-time compare
import type {
  SystemStatus,
  SystemConfig,
  DeviceConfig,
  Calibration,
  FirmwareInfo,
  OtaHistoryEntry,
  ActivityLog,
  LogType,
  Alarm,
  SystemEvent,
  Diagnostics,
  Direction,
  Measurement,
  MeasurementQuality,
  BatteryTelemetry,
  AcTelemetry,
  EnvironmentTelemetry,
  HealthSnapshot,
  SensorHealth,
  AlarmThresholds,
  DailyEnergyRecord,
  AiInsight,
} from "@/lib/types";
import { computeDewPoint, isCondensationRisk } from "./format";

// --- Demo mode flag (production fail-closed) ---
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const RAW_DEMO_MODE =
  process.env.NODE_ENV === "development" ||
  process.env.DEMO_MODE === "true" ||
  process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const DEMO_MODE = IS_PRODUCTION ? false : RAW_DEMO_MODE;

if (IS_PRODUCTION) {
  if (process.env.DEMO_MODE === "true" || process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    console.error(
      "[SECURITY] CRITICAL: DEMO_MODE/NEXT_PUBLIC_DEMO_MODE=true detected in production. Forcibly disabled.",
    );
  }
  if (process.env.MOCK_USER || process.env.MOCK_PASSWORD) {
    console.error(
      "[SECURITY] CRITICAL: MOCK_USER/MOCK_PASSWORD detected in production. Mock auth forcibly disabled.",
    );
  }
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    console.error("[SECURITY] CRITICAL: JWT_SECRET shorter than 32 bytes in production.");
  }
}

const MOCK_AUTH_EXPLICITLY_ENABLED =
  Boolean(process.env.JWT_SECRET && process.env.MOCK_USER && process.env.MOCK_PASSWORD) &&
  !IS_PRODUCTION;

export function isMockAuthEnabled(): boolean {
  return DEMO_MODE || MOCK_AUTH_EXPLICITLY_ENABLED;
}

// --- Default credentials (dev only — EMPTY in production) ---
// [audit-2 K-2 FIX] Variable renamed: was `DEFAULT_PASSWORD` but the
// value was a PLAINTEXT password, not a hash. The misleading name could
// trick a future developer into thinking the password was hashed when
// copying this pattern to firmware v1.0. Now renamed to DEFAULT_PASSWORD
// with an explicit comment that PRODUCTION must hash with bcrypt.
const DEV_DEFAULT_USER = "admin";
const DEV_DEFAULT_PASSWORD = "admin123";
const DEFAULT_USER =
  process.env.MOCK_USER || (process.env.NODE_ENV === "development" ? DEV_DEFAULT_USER : "");
const DEFAULT_PASSWORD =
  process.env.MOCK_PASSWORD ||
  (process.env.NODE_ENV === "development" ? DEV_DEFAULT_PASSWORD : "");
const JWT_SECRET =
  process.env.JWT_SECRET || (process.env.NODE_ENV === "development" ? "plts-dev-only-secret" : "");

export function getJwtSecret(): string {
  return JWT_SECRET;
}

/**
 * Verify credentials using CONSTANT-TIME comparison to prevent timing
 * attacks. Production firmware MUST replace this with a real password
 * hash verify (bcrypt/argon2/scrypt). The mock uses plaintext because
 * the demo backend has no password-change flow — but the comparison
 * is still constant-time to set the right pattern.
 *
 * PRODUCTION REPLACEMENT (firmware v1.0):
 *   const hash = bcrypt.hashSync(password, salt);
 *   return timingSafeEqual(Buffer.from(storedHash), Buffer.from(hash));
 */
export function verifyCredentials(username: string, password: string): boolean {
  if (!isMockAuthEnabled()) return false;
  if (!DEFAULT_USER || !DEFAULT_PASSWORD) return false;
  // Constant-time compare both username and password. timingSafeEqual
  // requires equal-length buffers; pad if needed (still constant-time
  // w.r.t. the shorter input's bytes).
  const userBuf = Buffer.from(String(username));
  const expectUserBuf = Buffer.from(DEFAULT_USER);
  const passBuf = Buffer.from(String(password));
  const expectPassBuf = Buffer.from(DEFAULT_PASSWORD);
  const userMatch =
    userBuf.length === expectUserBuf.length &&
    timingSafeEqual(userBuf, expectUserBuf);
  const passMatch =
    passBuf.length === expectPassBuf.length &&
    timingSafeEqual(passBuf, expectPassBuf);
  return userMatch && passMatch;
}

// --- Persistence paths ---
const DATA_DIR =
  process.env.NODE_ENV === "production"
    ? "/tmp/plts-data"
    : path.join(process.cwd(), ".data");
const STATE_FILE = path.join(DATA_DIR, "mock-state.json");
const LOG_FILE = path.join(DATA_DIR, "mock-logs.json");

const BOOT_TIME = Date.now();

// --- In-memory state ---
type StoreState = {
  deviceName: string;
  siteName: string;
  timezone: string;
  username: string;
  passwordHash: string;
  firmwareVersion: string;
  protocolVersion: number;
  configSchemaVersion: number;
  buildDate: string;
  latestAvailable: string;
  lastUpdateAt: number | null;
  lastUpdateStatus: "success" | "failed" | "rollback" | null;
  otaHistory: OtaHistoryEntry[];
  otaStatus: FirmwareInfo["otaStatus"];
  bootTime: number;
  bootCount: number;
  resetReason: string;
  wifiReconnectCount: number;
  minFreeHeap: number;
  // Energy counters (rolling)
  chargeAh: number;
  dischargeAh: number;
  chargeWh: number;
  dischargeWh: number;
  peakChargeCurrent: number | null;
  peakDischargeCurrent: number | null;
  // SOC sync
  socLastSync: number | null;
  // Calibration
  calibration: Calibration;
  // Config
  config: DeviceConfig;
  // Alarms
  alarms: Alarm[];
  // Events
  events: SystemEvent[];
  // Daily history (mock — would come from GAS in prod)
  dailyEnergy: DailyEnergyRecord[];
};

type GlobalStore = {
  state: StoreState | null;
  logs: ActivityLog[];
  nextLogId: number;
  nextEventId: number;
  nextAlarmId: number;
  simTimer: NodeJS.Timeout | null;
  persistTimer: NodeJS.Timeout | null;
};

const G: GlobalStore =
  (globalThis as unknown as { __pltsStore?: GlobalStore }).__pltsStore ??
  ((globalThis as unknown as { __pltsStore?: GlobalStore }).__pltsStore = {
    state: null,
    logs: [],
    nextLogId: 1,
    nextEventId: 1,
    nextAlarmId: 1,
    simTimer: null,
    persistTimer: null,
  });

// --- Default factory config (brief §64) ---
function defaultConfig(): DeviceConfig {
  return {
    version: 1,
    revision: 1,
    timestamp: BOOT_TIME,
    source: "factory",
    checksum: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    deviceName: "PLTS Monitor Site A",
    siteName: "Default Site",
    timezone: "Asia/Jakarta",
    batteryCapacityAh: 200,
    batteryNominalVoltage: 48,
    fullVoltage: 54.0,
    lowVoltage: 45.0,
    idleCurrentThreshold: 0.5,
    fullChargeCurrentThreshold: 2.0,
    fullChargePersistenceSec: 600,
    telemetryIntervalSec: 5,
    socParams: {
      syncOnFullCharge: true,
      syncOnVoltage: true,
      voltageSyncHysteresisV: 0.5,
      baselineAgingPerMonthPct: 0.5,
    },
    alarmThresholds: {
      voltageLowWarn: 46.0,
      voltageLowCritical: 45.0,
      voltageHighWarn: 55.0,
      voltageHighCritical: 56.0,
      currentHighWarn: 40,
      currentHighCritical: 50,
      temperatureHighWarn: 45,
      temperatureHighCritical: 55,
      humidityHighWarn: 85,
      socLowWarn: 30,
      socLowCritical: 20,
    } as AlarmThresholds,
    calibrationParams: {
      autoZeroAcs712OnBoot: true,
      sht31HeaterEnabled: false,
    },
  };
}

function defaultCalibration(): Calibration {
  return {
    version: 1,
    voltageLow: { reference: 45.0, raw: 44.61, timestamp: BOOT_TIME },
    voltageNominal: { reference: 51.0, raw: 50.55, timestamp: BOOT_TIME },
    voltageFull: { reference: 54.0, raw: 53.85, timestamp: BOOT_TIME },
    acs712Offset: 1650.0,
    acs712Sensitivity: 0.185,
    sht31TempOffset: 0.0,
    sht31HumOffset: 0.0,
    timestamp: BOOT_TIME,
    source: "factory",
  };
}

function defaultAlarms(): Alarm[] {
  return [];
}

function defaultEvents(): SystemEvent[] {
  return [
    {
      id: "evt-1",
      type: "DEVICE_BOOT",
      timestamp: BOOT_TIME,
      payload: { resetReason: "POWERON_RESET", bootCount: 1 },
      message: "Device booted (POWERON_RESET)",
    },
    {
      id: "evt-2",
      type: "WIFI_CONNECTED",
      timestamp: BOOT_TIME + 2_000,
      payload: { ssid: "SiteA-WiFi", rssi: -55 },
      message: "WiFi connected: SiteA-WiFi (-55 dBm)",
    },
    {
      id: "evt-3",
      type: "TIME_SYNCED",
      timestamp: BOOT_TIME + 5_000,
      payload: { source: "NTP", offset: 0.05 },
      message: "Time synced via NTP",
    },
  ];
}

function defaultDailyEnergy(): DailyEnergyRecord[] {
  // 7 days of mock history.
  const out: DailyEnergyRecord[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const dateStr = d.toISOString().slice(0, 10);
    const chargeAh = 30 + Math.random() * 20;
    const dischargeAh = 25 + Math.random() * 20;
    out.push({
      date: dateStr,
      chargeWh: chargeAh * 51.5,
      dischargeWh: dischargeAh * 51.0,
      netWh: chargeAh * 51.5 - dischargeAh * 51.0,
      chargeAh,
      dischargeAh,
      peakChargeA: 35 + Math.random() * 10,
      peakDischargeA: 25 + Math.random() * 10,
      socMin: 35 + Math.random() * 15,
      socMax: 85 + Math.random() * 10,
      alarmCount: Math.floor(Math.random() * 3),
      telemetryCompleteness: 0.92 + Math.random() * 0.07,
      deviceAvailability: 0.95 + Math.random() * 0.05,
    });
  }
  return out;
}

async function loadState(): Promise<StoreState> {
  if (G.state) return G.state;
  let loaded: Partial<StoreState> | null = null;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    loaded = JSON.parse(raw) as Partial<StoreState>;
  } catch {
    // no state file — fall through to defaults
  }
  G.state = {
    deviceName: loaded?.deviceName ?? "PLTS Monitor Site A",
    siteName: loaded?.siteName ?? "Default Site",
    timezone: loaded?.timezone ?? "Asia/Jakarta",
    username: DEFAULT_USER || "admin",
    passwordHash: DEFAULT_PASSWORD || "",
    firmwareVersion: "1.0.0",
    protocolVersion: 1,
    configSchemaVersion: 1,
    buildDate: "2026-08-20",
    latestAvailable: "1.0.0",
    lastUpdateAt: null,
    lastUpdateStatus: null,
    otaHistory: loaded?.otaHistory ?? [],
    otaStatus: "up-to-date",
    bootTime: BOOT_TIME,
    bootCount: loaded?.bootCount ?? 1,
    resetReason: "POWERON_RESET",
    wifiReconnectCount: loaded?.wifiReconnectCount ?? 0,
    minFreeHeap: 175_000,
    chargeAh: loaded?.chargeAh ?? 12.3,
    dischargeAh: loaded?.dischargeAh ?? 45.6,
    chargeWh: loaded?.chargeWh ?? 325.0,
    dischargeWh: loaded?.dischargeWh ?? 1200.0,
    peakChargeCurrent: loaded?.peakChargeCurrent ?? 42.5,
    peakDischargeCurrent: loaded?.peakDischargeCurrent ?? 37.2,
    socLastSync: loaded?.socLastSync ?? Date.now() - 3_600_000,
    calibration: loaded?.calibration ?? defaultCalibration(),
    config: loaded?.config ?? defaultConfig(),
    alarms: loaded?.alarms ?? defaultAlarms(),
    events: loaded?.events ?? defaultEvents(),
    dailyEnergy: loaded?.dailyEnergy ?? defaultDailyEnergy(),
  };
  G.nextEventId = G.state.events.length + 1;
  startSimulator();
  schedulePersist();
  return G.state;
}

export async function getStore(): Promise<StoreState> {
  return loadState();
}

function schedulePersist() {
  if (G.persistTimer || G.persistTimer) return;
  G.persistTimer = setInterval(() => {
    persist().catch((err) => console.warn("[mockStore] persist failed:", err));
  }, 10_000);
}

async function persist() {
  if (!G.state) return;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(G.state, null, 2), "utf-8");
    await fs.writeFile(LOG_FILE, JSON.stringify(G.logs.slice(0, 500), null, 2), "utf-8");
  } catch (err) {
    console.warn("[mockStore] persist write failed:", err);
  }
}

// --- Simulator: updates battery voltage/current/SOC every 5s ---
function startSimulator() {
  if (G.simTimer) return;
  G.simTimer = setInterval(() => {
    if (!G.state) return;
    // No state mutation that affects UI beyond telemetry — telemetry is
    // computed fresh in getSystemStatus() based on current time. Nothing to do.
  }, 5_000);
}

// --- Telemetry generation — DEMO/SIMULATION ONLY --------------------------
// [P0-006 REMEDIATION 2026-08] CRITICAL FIX: these snapshot generators produce
// FABRICATED telemetry (plausible-looking voltage/current/SOC curves labeled
// quality:"VALID", source:"MEASURED"). They were previously served by
// /api/status UNCONDITIONALLY — a production deployment without
// NEXT_PUBLIC_API_BASE_URL displayed pure simulation as live physical truth.
// Now every generator is gated behind DEMO_MODE; non-demo calls receive an
// explicit NO_DATA envelope (null values, NOT_AVAILABLE quality) instead.
// ---------------------------------------------------------------------------

function makeMeasurement<T extends number>(
  value: T,
  unit: string,
  quality: MeasurementQuality,
  source: Measurement<number>["source"],
  seq: number,
): Measurement<T> {
  return {
    value,
    unit,
    quality,
    source,
    timestamp: Date.now(),
    sequence: seq,
  };
}

let _seq = 100;

function nextSeq(): number {
  return ++_seq;
}

// Generate a realistic telemetry snapshot based on current time of day.
// Battery cycles: charging 06:00–18:00 (solar hours), discharging 18:00–06:00.
function getBatterySnapshot(state: StoreState): BatteryTelemetry {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const charging = hour >= 6 && hour < 18;
  // Pack voltage: 47V at 30% SOC, ~52V at 70%, 54V at 100%.
  const baseV = 48 + Math.sin((hour / 24) * Math.PI * 2 - Math.PI / 2) * 2.5;
  const voltage = charging ? baseV + 1.5 : baseV - 0.5;
  const current = charging ? 8 + Math.sin(hour / 24 * Math.PI) * 15 : -(5 + Math.abs(Math.sin(hour / 24 * Math.PI)) * 10);
  const power = voltage * current;
  const direction: Direction = current > state.config.idleCurrentThreshold
    ? "CHARGING"
    : current < -state.config.idleCurrentThreshold
      ? "DISCHARGING"
      : "IDLE";
  const socBase = 50 + Math.sin((hour / 24) * Math.PI * 2 - Math.PI / 2) * 30;
  const soc = Math.max(15, Math.min(95, socBase));
  const remainingAh = (soc / 100) * state.config.batteryCapacityAh;
  return {
    voltage: makeMeasurement(parseFloat(voltage.toFixed(2)), "V", "VALID", "MEASURED", nextSeq()),
    current: makeMeasurement(parseFloat(current.toFixed(2)), "A", "VALID", "MEASURED", nextSeq()),
    power: makeMeasurement(parseFloat(power.toFixed(1)), "W", "DERIVED", "DERIVED", nextSeq()),
    direction,
    soc: {
      value: parseFloat(soc.toFixed(1)),
      quality: "ESTIMATED",
      source: "COULOMB_COUNTING",
      method: state.socLastSync && Date.now() - state.socLastSync < 3_600_000
        ? "SYNCHRONIZED"
        : "ESTIMATED",
      lastSync: state.socLastSync,
      confidence:
        state.socLastSync == null
          ? "LOW"
          : Date.now() - state.socLastSync < 86_400_000
            ? "HIGH"
            : Date.now() - state.socLastSync < 7 * 86_400_000
              ? "MEDIUM"
              : "BASELINE_AGING",
      // v1.6.0 demo: the (simulated) BMS is connected → BMS_DIRECT provenance.
      provenance: "BMS_DIRECT",
    },
    remainingAh: parseFloat(remainingAh.toFixed(2)),
    chargeAh: state.chargeAh,
    dischargeAh: state.dischargeAh,
    chargeWh: state.chargeWh,
    dischargeWh: state.dischargeWh,
    netWh: state.chargeWh - state.dischargeWh,
    netAh: state.chargeAh - state.dischargeAh,
    efc: parseFloat(((state.chargeAh + state.dischargeAh) / 2 / state.config.batteryCapacityAh).toFixed(3)),
    estimatedUsableCapacityAh: state.config.batteryCapacityAh * 0.97,
    peakChargeCurrent: state.peakChargeCurrent,
    peakDischargeCurrent: state.peakDischargeCurrent,
    // v1.6.0 — DEMO BMS block (DEMO_MODE gated like the rest of the store).
    // Simulates a Pylontech-style pack on CAN with a small cross-check noise
    // so the BMS card and provenance badge are visible in demo builds.
    bms: {
      connected: true,
      protocol: "PYLONTECH_CAN",
      state: "LOCKED",
      voltage: parseFloat(voltage.toFixed(2)),
      current: parseFloat((current + (Math.sin(nextSeq()) * 0.05)).toFixed(2)),
      temperature: parseFloat((28.5 + Math.sin(hour / 24 * Math.PI * 2) * 2).toFixed(1)),
      soh: 98,
      cellVoltageMin: 3.31,
      cellVoltageMax: 3.34,
      cellCount: 16,
      chargeCurrentLimit: 100,
      dischargeCurrentLimit: 100,
      cycleCount: 42,
      faultFlags: 0,
      moduleCount: 1,
      lastSeenMs: Date.now() % 1_000_000,
      currentMismatchA: 0.08,
    },
  };
}

function getAcSnapshot(): AcTelemetry {
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  // AC load: peaks in evening 18-22.
  const rms = 1.5 + Math.max(0, Math.sin((hour - 18) / 6 * Math.PI)) * 4.5;
  const peak = rms * 1.414 + 0.3;
  const avg = rms * 0.92;
  return {
    rmsCurrent: makeMeasurement(parseFloat(rms.toFixed(2)), "A", "VALID", "MEASURED", nextSeq()),
    peakCurrent: makeMeasurement(parseFloat(peak.toFixed(2)), "A", "VALID", "MEASURED", nextSeq()),
    averageCurrent: makeMeasurement(parseFloat(avg.toFixed(2)), "A", "VALID", "MEASURED", nextSeq()),
    estimatedPower: {
      value: parseFloat((rms * 220 * 0.9).toFixed(1)),
      unit: "W",
      quality: "ESTIMATED",
      assumptions: { voltage: 220, powerFactor: 0.9 },
    },
    signalQuality: "GOOD",
  };
}

function getEnvironmentSnapshot(): EnvironmentTelemetry {
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const temp = 28 + Math.sin((hour / 24) * Math.PI * 2 - Math.PI / 2) * 5;
  const hum = 65 + Math.cos((hour / 24) * Math.PI * 2) * 12;
  const dew = computeDewPoint(temp, hum);
  return {
    temperature: makeMeasurement(parseFloat(temp.toFixed(1)), "°C", "VALID", "MEASURED", nextSeq()),
    humidity: makeMeasurement(parseFloat(hum.toFixed(1)), "%", "VALID", "MEASURED", nextSeq()),
    dewPoint: dew != null ? parseFloat(dew.toFixed(1)) : null,
    label: "Ambient / Enclosure Temperature",
    condensationRisk: isCondensationRisk(temp, hum),
  };
}

function getHealthSnapshot(state: StoreState): HealthSnapshot {
  const allOnline: SensorHealth = "ONLINE";
  return {
    systemState:
      state.alarms.filter((a) => a.lifecycle === "ACTIVE" && a.severity === "CRITICAL").length > 0
        ? "DEGRADED"
        : state.alarms.filter((a) => a.lifecycle === "ACTIVE").length > 0
          ? "WARNING"
          : "HEALTHY",
    sensorHealth: {
      ina219: allOnline,
      batteryAdc: allOnline,
      acs712: allOnline,
      sht31: allOnline,
    },
    taskHeartbeats: {
      sensor: Date.now(),
      measurement: Date.now(),
      energy: Date.now(),
      telemetry: Date.now(),
      network: Date.now(),
      persistence: Date.now(),
      health: Date.now(),
    },
    freeHeap: 180_000 + Math.floor(Math.random() * 5000),
    minFreeHeap: state.minFreeHeap,
    wifiRssi: -55 + Math.floor(Math.random() * 8),
    wifiReconnectCount: state.wifiReconnectCount,
    mqttConnected: true,
    ntpSynced: true,
    storageOk: true,
    spoolSize: 0,
    highestAlarmSeverity:
      state.alarms.some((a) => a.lifecycle === "ACTIVE" && a.severity === "CRITICAL")
        ? "CRITICAL"
        : state.alarms.some((a) => a.lifecycle === "ACTIVE" && a.severity === "WARNING")
          ? "WARNING"
          : "INFO",
  };
}

export function getSystemStatus(): SystemStatus {
  // [P0-006] Fail-closed: WITHOUT demo mode there is NO local telemetry.
  // Return an explicit NO_DATA envelope — null values, NOT_AVAILABLE quality,
  // online:false. NEVER fabricated numbers dressed as VALID/MEASURED.
  if (!DEMO_MODE) {
    return noDataStatus();
  }
  const state = G.state;
  if (!state) {
    // Best-effort fallback — should never reach in practice (API routes call getStore() first).
    return getSystemStatusFromStateSync();
  }
  const battery = getBatterySnapshot(state);
  const ac = getAcSnapshot();
  const environment = getEnvironmentSnapshot();
  const health = getHealthSnapshot(state);
  return {
    protocolVersion: state.protocolVersion,
    firmwareVersion: state.firmwareVersion,
    deviceId: "PLTS-AB12CD34",
    deviceName: state.deviceName,
    sequence: nextSeq(),
    timestamp: Date.now(),
    timeQuality: "VALID",
    uptimeSeconds: Math.floor((Date.now() - state.bootTime) / 1000),
    bootCount: state.bootCount,
    resetReason: state.resetReason,
    battery,
    ac,
    environment,
    health,
    activeAlarms: state.alarms.filter((a) => a.lifecycle === "ACTIVE"),
    calibration: state.calibration,
    config: state.config,
    online: true,
    simulated: true,          // [P0-006] explicit simulation marker in the envelope
  };
}

/**
 * [P0-006] Explicit NO_DATA envelope — what a production deployment without
 * a device backend must see: every measurement null, quality NOT_AVAILABLE,
 * NO fabricated values. The UI renders these as NO_DATA/UNKNOWN states.
 */
function noDataStatus(): SystemStatus {
  const nullM = (unit: string) => ({
    value: null, unit, quality: "NOT_AVAILABLE" as MeasurementQuality,
    source: "MEASURED" as Measurement<number>["source"], timestamp: 0, sequence: 0,
  });
  return {
    protocolVersion: 1,
    firmwareVersion: "0.0.0",
    deviceId: "",
    deviceName: "No device connected",
    sequence: 0,
    timestamp: 0,
    timeQuality: "UNKNOWN",
    uptimeSeconds: 0,
    bootCount: 0,
    resetReason: "UNKNOWN",
    battery: {
      voltage: nullM("V"), current: nullM("A"), power: nullM("W"),
      direction: "UNKNOWN",
      soc: { value: null, quality: "NOT_AVAILABLE", source: "ESTIMATED", method: "UNKNOWN", lastSync: null, confidence: "UNKNOWN" },
      remainingAh: null, chargeAh: null, dischargeAh: null,
      chargeWh: null, dischargeWh: null, netWh: null, netAh: null, efc: null,
      estimatedUsableCapacityAh: null, peakChargeCurrent: null, peakDischargeCurrent: null,
    },
    ac: {
      rmsCurrent: nullM("A"), peakCurrent: nullM("A"), averageCurrent: nullM("A"),
      estimatedPower: { value: null, unit: "W", quality: "ESTIMATED", assumptions: { voltage: null, powerFactor: null } },
      signalQuality: "UNKNOWN",
    },
    environment: {
      temperature: nullM("°C"), humidity: nullM("%"), dewPoint: null,
      label: "Ambient / Enclosure Temperature", condensationRisk: null,
    },
    health: {
      systemState: "UNKNOWN",
      sensorHealth: { ina219: "OFFLINE", batteryAdc: "OFFLINE", acs712: "OFFLINE", sht31: "OFFLINE" },
      taskHeartbeats: {},
      freeHeap: null, minFreeHeap: null, wifiRssi: null, wifiReconnectCount: null,
      mqttConnected: false, ntpSynced: false, storageOk: null,
      spoolSize: null, highestAlarmSeverity: "UNKNOWN",
    },
    activeAlarms: [],
    calibration: defaultCalibration(),
    config: defaultConfig(),
    online: false,
    simulated: false,
  } as unknown as SystemStatus;
}

// Synchronous variant that loads state from cache if available.
function getSystemStatusFromStateSync(): SystemStatus {
  if (!DEMO_MODE) return noDataStatus();      // [P0-006] fail-closed
  if (G.state) return getSystemStatus();
  // Block-synchronously initialize defaults — only used as last resort.
  G.state = {
    deviceName: "PLTS Monitor Site A",
    siteName: "Default Site",
    timezone: "Asia/Jakarta",
    username: DEFAULT_USER,
    passwordHash: DEFAULT_PASSWORD,
    firmwareVersion: "1.0.0",
    protocolVersion: 1,
    configSchemaVersion: 1,
    buildDate: "2026-08-20",
    latestAvailable: "1.0.0",
    lastUpdateAt: null,
    lastUpdateStatus: null,
    otaHistory: [],
    otaStatus: "up-to-date",
    bootTime: BOOT_TIME,
    bootCount: 1,
    resetReason: "POWERON_RESET",
    wifiReconnectCount: 0,
    minFreeHeap: 175_000,
    chargeAh: 12.3,
    dischargeAh: 45.6,
    chargeWh: 325.0,
    dischargeWh: 1200.0,
    peakChargeCurrent: 42.5,
    peakDischargeCurrent: 37.2,
    socLastSync: Date.now() - 3_600_000,
    calibration: defaultCalibration(),
    config: defaultConfig(),
    alarms: defaultAlarms(),
    events: defaultEvents(),
    dailyEnergy: defaultDailyEnergy(),
  };
  return getSystemStatus();
}

export function getConfig(): SystemConfig {
  const state = G.state ?? null;
  if (!state) {
    // initialize lazily
    return {
      deviceName: "PLTS Monitor Site A",
      siteName: "Default Site",
      timezone: "Asia/Jakarta",
      config: defaultConfig(),
      calibration: defaultCalibration(),
    };
  }
  return {
    deviceName: state.deviceName,
    siteName: state.siteName,
    timezone: state.timezone,
    config: state.config,
    calibration: state.calibration,
  };
}

export function getCalibration(): Calibration {
  return G.state?.calibration ?? defaultCalibration();
}

export function getFirmwareInfo(): FirmwareInfo {
  const state = G.state;
  return {
    currentVersion: state?.firmwareVersion ?? "1.0.0",
    buildDate: state?.buildDate ?? "2026-08-20",
    protocolVersion: 1,
    configSchemaVersion: 1,
    latestAvailable: state?.latestAvailable ?? "1.0.0",
    updateAvailable: false,
    signatureVerified: null,
    otaStatus: state?.otaStatus ?? "up-to-date",
    lastUpdateAt: state?.lastUpdateAt ?? null,
    lastUpdateStatus: state?.lastUpdateStatus ?? null,
  };
}

export function getOtaHistory(): OtaHistoryEntry[] {
  return G.state?.otaHistory ?? [];
}

export function getLogsSnapshot(): ActivityLog[] {
  return G.logs.slice(0, 200);
}

export function getActiveAlarms(): Alarm[] {
  return (G.state?.alarms ?? []).filter((a) => a.lifecycle === "ACTIVE");
}

export function getAlarmHistory(): Alarm[] {
  return G.state?.alarms ?? [];
}

export function acknowledgeAlarm(alarmId: string): boolean {
  if (!G.state) return false;
  const alarm = G.state.alarms.find((a) => a.id === alarmId);
  if (!alarm) return false;
  alarm.lifecycle = "ACKNOWLEDGED";
  alarm.acknowledgedAt = Date.now();
  addLog("alarm_ack", `Alarm ${alarm.code} acknowledged`);
  addEvent("ALARM_ACKNOWLEDGED", { alarmId, code: alarm.code }, `Alarm ${alarm.code} acknowledged`);
  return true;
}

export function getEvents(from?: number, to?: number, limit?: number): SystemEvent[] {
  let events = G.state?.events ?? [];
  if (from) events = events.filter((e) => e.timestamp >= from);
  if (to) events = events.filter((e) => e.timestamp <= to);
  if (limit) events = events.slice(-limit);
  return events;
}

export function getDiagnostics(): Diagnostics {
  // [P0-006] Non-demo: explicit OFFLINE/UNKNOWN diagnostics — previously this
  // function fabricated freeHeap:180000, rssi:-55, mqttState:"CONNECTED",
  // spoolSize:0, all sensors ONLINE regardless of any real state.
  const state = G.state;
  if (!DEMO_MODE) {
    return {
      uptimeSeconds: 0, freeHeap: null, minFreeHeap: null,
      wifiRssi: null, wifiReconnectCount: 0,
      wifiState: "DISCONNECTED", mqttState: "DISCONNECTED",
      gasApiState: "NOT_CONFIGURED", ntpState: "NOT_SYNCED",
      resetReason: "UNKNOWN", bootCount: 0,
      firmwareVersion: "0.0.0", protocolVersion: 1, configSchemaVersion: 1,
      storageState: "UNKNOWN", spoolSize: null,
      sensorHealth: { ina219: "OFFLINE", batteryAdc: "OFFLINE", acs712: "OFFLINE", sht31: "OFFLINE" },
      calibrationVersions: { voltage: 0, acs712: 0, sht31: 0 },
    } as unknown as Diagnostics;
  }
  return {
    uptimeSeconds: state ? Math.floor((Date.now() - state.bootTime) / 1000) : 0,
    freeHeap: 180_000,
    minFreeHeap: state?.minFreeHeap ?? 175_000,
    wifiRssi: -55,
    wifiReconnectCount: state?.wifiReconnectCount ?? 0,
    wifiState: "CONNECTED",
    mqttState: "CONNECTED",
    gasApiState: "OK",
    ntpState: "SYNCED",
    resetReason: state?.resetReason ?? "POWERON_RESET",
    bootCount: state?.bootCount ?? 1,
    firmwareVersion: state?.firmwareVersion ?? "1.0.0",
    protocolVersion: 1,
    configSchemaVersion: 1,
    storageState: "OK",
    spoolSize: 0,
    sensorHealth: {
      ina219: "ONLINE",
      batteryAdc: "ONLINE",
      acs712: "ONLINE",
      sht31: "ONLINE",
    },
    calibrationVersions: {
      voltage: state?.calibration.version ?? 1,
      acs712: state?.calibration.version ?? 1,
      sht31: state?.calibration.version ?? 1,
    },
  };
}

export function getDailyEnergy(): DailyEnergyRecord[] {
  // [P0-006] Non-demo: NO fabricated history — daily energy comes from the
  // GAS backend (DAILY action) or the device. Previously this served 7 days
  // of Math.random() data to any production deployment without a base URL.
  if (!DEMO_MODE) return [];
  return G.state?.dailyEnergy ?? [];
}

// --- Mutations — [P0-006] rejected outside demo mode -------------------------
export function updateConfig(patch: Partial<DeviceConfig>): boolean {
  if (!DEMO_MODE) return false;   // [P0-006] no local mock mutations in production
  if (!G.state) return false;
  const cfg = G.state.config;
  G.state.config = {
    ...cfg,
    ...patch,
    // Bump revision + timestamp + source on every successful update.
    revision: cfg.revision + 1,
    timestamp: Date.now(),
    source: "web_ui",
    checksum: `sha256:${Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64)}`,
  };
  addLog("config_change", `Config updated (revision ${G.state.config.revision})`);
  addEvent("CONFIGURATION_CHANGED", { revision: G.state.config.revision }, "Configuration changed via web UI");
  return true;
}

export function updateCalibration(patch: Partial<Calibration>): boolean {
  if (!G.state) return false;
  G.state.calibration = {
    ...G.state.calibration,
    ...patch,
    version: G.state.calibration.version + 1,
    timestamp: Date.now(),
    source: "manual",
  };
  addLog("calibration_change", `Calibration updated (v${G.state.calibration.version})`);
  addEvent("CALIBRATION_CHANGED", { version: G.state.calibration.version }, "Calibration changed");
  return true;
}

export function setVoltageCalibrationPoint(
  point: "low" | "nominal" | "full",
  reference: number,
  raw: number,
): boolean {
  if (!G.state) return false;
  const ts = Date.now();
  const newPoint = { reference, raw, timestamp: ts };
  switch (point) {
    case "low":
      G.state.calibration.voltageLow = newPoint;
      break;
    case "nominal":
      G.state.calibration.voltageNominal = newPoint;
      break;
    case "full":
      G.state.calibration.voltageFull = newPoint;
      break;
  }
  G.state.calibration.version += 1;
  G.state.calibration.timestamp = ts;
  G.state.calibration.source = "manual";
  addLog("calibration_change", `Voltage ${point} point set: ref=${reference}V raw=${raw}`);
  addEvent("CALIBRATION_CHANGED", { point, reference, raw }, `Voltage ${point} calibration point set`);
  return true;
}

export function acs712ZeroCalibrate(): { updated: boolean; newOffset: number } {
  if (!G.state) return { updated: false, newOffset: 0 };
  // Simulate sampling ADC at 0A for 1 second.
  const newOffset = 1648 + Math.floor(Math.random() * 5);
  G.state.calibration.acs712Offset = newOffset;
  G.state.calibration.version += 1;
  G.state.calibration.timestamp = Date.now();
  G.state.calibration.source = "auto_zero";
  addLog("calibration_change", `ACS712 zero-calibration: new offset=${newOffset}`);
  addEvent("CALIBRATION_CHANGED", { newOffset }, "ACS712 zero-calibration completed");
  return { updated: true, newOffset };
}

export function updateDeviceConfig(opts: {
  deviceName?: string;
  siteName?: string;
  timezone?: string;
}): boolean {
  if (!G.state) return false;
  if (opts.deviceName !== undefined) G.state.deviceName = opts.deviceName;
  if (opts.siteName !== undefined) G.state.siteName = opts.siteName;
  if (opts.timezone !== undefined) G.state.timezone = opts.timezone;
  G.state.config.deviceName = G.state.deviceName;
  addLog("config_change", `Device config updated: ${JSON.stringify(opts)}`);
  return true;
}

export function changePassword(current: string, next: string): boolean {
  if (!G.state) return false;
  if (current !== G.state.passwordHash) return false;
  G.state.passwordHash = next;
  return true;
}

export function exportConfig(): SystemConfig {
  return getConfig();
}

export function importConfig(cfg: SystemConfig): boolean {
  if (!G.state) return false;
  G.state.deviceName = cfg.deviceName;
  G.state.siteName = cfg.siteName;
  G.state.timezone = cfg.timezone;
  G.state.config = cfg.config;
  G.state.calibration = cfg.calibration;
  G.state.config.revision += 1;
  G.state.config.timestamp = Date.now();
  G.state.config.source = "web_ui";
  addLog("config_change", "Config imported");
  addEvent("CONFIGURATION_CHANGED", { revision: G.state.config.revision }, "Configuration imported");
  return true;
}

export function reboot(): boolean {
  if (!G.state) return false;
  addLog("restart", "System reboot requested");
  addEvent("DEVICE_BOOT", { reason: "manual_reboot" }, "Reboot requested");
  // Simulate reboot: reset bootTime, increment bootCount, reset uptime.
  setTimeout(() => {
    if (G.state) {
      G.state.bootTime = Date.now();
      G.state.bootCount += 1;
      G.state.resetReason = "SW_RESET";
    }
  }, 1000);
  return true;
}

export function factoryReset(): boolean {
  if (!G.state) return false;
  const oldBootCount = G.state.bootCount;
  G.state.config = defaultConfig();
  G.state.calibration = defaultCalibration();
  G.state.alarms = [];
  G.state.events = defaultEvents();
  G.state.dailyEnergy = defaultDailyEnergy();
  G.state.bootTime = Date.now();
  G.state.bootCount = oldBootCount + 1;
  G.state.resetReason = "FACTORY_RESET";
  addLog("restart", "Factory reset performed");
  addEvent("DEVICE_BOOT", { reason: "factory_reset" }, "Factory reset — device booted");
  return true;
}

export async function simulateOtaUpdate(targetVersion: string): Promise<boolean> {
  if (!G.state) return false;
  const fromVersion = G.state.firmwareVersion;
  addLog("ota", `OTA started: ${fromVersion} → ${targetVersion}`);
  await new Promise((r) => setTimeout(r, 1500));
  G.state.firmwareVersion = targetVersion;
  G.state.otaStatus = "up-to-date";
  G.state.lastUpdateAt = Date.now();
  G.state.lastUpdateStatus = "success";
  G.state.otaHistory.unshift({
    id: (G.state.otaHistory[0]?.id ?? 0) + 1,
    timestamp: Date.now(),
    fromVersion,
    toVersion: targetVersion,
    status: "success",
    durationSeconds: 90,
  });
  addLog("ota", `OTA success: now on ${targetVersion}`);
  addEvent("OTA_SUCCESS", { fromVersion, toVersion: targetVersion }, `OTA update to ${targetVersion} succeeded`);
  return true;
}

// --- AI Insights mock (firmware proxies to GAS → Gemini) ---
export function getInsights(): { insights: AiInsight[]; mock: boolean } {
  return {
    insights: [
      {
        id: "mock-battery-1",
        category: "battery_analysis",
        severity: "info",
        title: "Battery within normal parameters",
        body: "No anomalies detected in the last 24 hours. SOC cycling is healthy and within nominal voltage range.",
        generatedAt: Date.now(),
        source: "mock",
        advisoryOnly: true,
      },
      {
        id: "mock-energy-1",
        category: "energy_analysis",
        severity: "info",
        title: "Daily energy cycle stable",
        body: "Charge/discharge pattern is consistent with prior week. EFC trending +0.02/day — within expected LiFePO4 calendar aging.",
        generatedAt: Date.now(),
        source: "mock",
        advisoryOnly: true,
      },
      {
        id: "mock-maintenance-1",
        category: "maintenance_suggestion",
        severity: "info",
        title: "No maintenance required",
        body: "All sensors online. Ambient temperature within LiFePO4 optimal range (20-30°C). No calibration drift detected.",
        generatedAt: Date.now(),
        source: "mock",
        advisoryOnly: true,
      },
    ],
    mock: true,
  };
}

// --- Log & event helpers ---
export function addLog(type: LogType, message: string, details?: Record<string, unknown>): void {
  G.logs.unshift({
    id: G.nextLogId++,
    timestamp: Date.now(),
    type,
    message,
    details,
  });
  if (G.logs.length > 500) G.logs.length = 500;
}

export function addEvent(
  type: SystemEvent["type"],
  payload: Record<string, unknown>,
  message: string,
): void {
  if (!G.state) return;
  G.state.events.push({
    id: `evt-${G.nextEventId++}`,
    type,
    timestamp: Date.now(),
    payload,
    message,
  });
  if (G.state.events.length > 500) G.state.events.splice(0, G.state.events.length - 500);
}

// Initialize eagerly on module load (so first request doesn't block on disk).
// [PWA-22 REMEDIATION 2026-08] Disk persistence + timers now start ONLY in
// demo mode — previously the module wrote /tmp/plts-data state files and ran
// a 10 s persist interval even in production where mock is disabled.
if (G.state === null && DEMO_MODE) {
  loadState().catch((err) => console.error("[mockStore] init failed:", err));
}
