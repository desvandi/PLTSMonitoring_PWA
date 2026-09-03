// =============================================================================
// PLTS Monitor — Telemetry Contract Types
// -----------------------------------------------------------------------------
// Mirrors ESP32 firmware v1.0 telemetry schema (Protocol v1).
// Monitoring-only system — NO relays, NO actuators, NO commands.
//
// Disciplines (brief §1, §36-37, §52, §90-92):
//   1. `null` is invalid/unknown, NEVER 0.
//   2. Text label + color, never color alone (accessibility — brief §37).
//   3. Explicit UNAVAILABLE card when subsystem omitted (no silent null).
//   4. Distinguish MEASURED / DERIVED / ESTIMATED visually (brief §37, §91).
//   5. Stale data visibly marked (brief §90).
//   6. NO fake PV metrics (brief §92). Hardware doesn't measure PV.
//   7. AI advisory-only (brief §94-95).
// =============================================================================

export type ApiResponse<T> = {
  success: boolean;
  message: string;
  data: T;
};

// ---------- AUTH ----------
export type LoginRequest = {
  username: string;
  password: string;
};

export type LoginData = {
  token: string;          // JWT access token
  csrfToken: string;      // CSRF token for mutation requests
  expiresAt: number;      // Token expiry (ms epoch)
  username: string;
};

export type SessionInfo = {
  isAuthenticated: boolean;
  username: string | null;
  expiresAt: number | null;
  // [PWA-02 REMEDIATION 2026-08] Session role — the minimal authorization
  // dimension (directive §16: authentication ≠ authorization). MQTT-mode
  // sessions are VIEWER-scoped: broker subscription proves identity for
  // READING telemetry, never for config/calibration/OTA mutations. REST
  // sessions are OPERATOR (single-user device admin model).
  role?: 'viewer' | 'operator';
};

// ---------- MEASUREMENT QUALITY (brief §1, §36) ----------
// A reading is one of these qualities. NEVER collapse to a boolean — the UI
// must visibly distinguish STALE (was valid, now old) from INVALID (sensor
// reported a reading that failed sanity check) from NOT_AVAILABLE (sensor
// omitted entirely, e.g., SHT31 not populated).
export type MeasurementQuality =
  | 'VALID'            // fresh, within range, sensor reported OK
  | 'STALE'            // last good reading, but timestamp too old (>2× interval)
  | 'INVALID'          // sensor reported but value failed sanity check
  | 'OUT_OF_RANGE'     // value outside plausible physical range
  | 'SENSOR_ERROR'     // sensor I2C/ADC error reported
  | 'NOT_AVAILABLE'    // sensor not populated or never sampled
  | 'ESTIMATED'        // derived from other measurements + model (e.g., SOC)
  | 'DERIVED'          // computed from measured values (e.g., power = V × I)
  | 'CALIBRATING'      // sensor is currently being calibrated — readings unstable
  | 'SUSPECT';         // anomaly detector flagged — investigate

export type MeasurementSource =
  | 'MEASURED'           // direct sensor reading (INA219, ADC, ACS712, SHT31)
  | 'DERIVED'           // computed from measured values (P = V × I, dew point)
  | 'ESTIMATED';        // inferred from a model (SOC via coulomb counting)

// Generic measurement envelope. `value` is null when quality is INVALID/
// NOT_AVAILABLE/SENSOR_ERROR. NEVER coerce null to 0 — the UI must show "N/A"
// so operators are not misled into believing a 0A reading is a real 0A.
export interface Measurement<T> {
  value: T | null;
  unit: string;
  quality: MeasurementQuality;
  source: MeasurementSource;
  timestamp: number;        // ms since epoch
  sequence: number;         // monotonic counter for gap detection
}

export type Direction = 'CHARGING' | 'DISCHARGING' | 'IDLE' | 'UNKNOWN';

// ---------- SOC PROVENANCE (v1.6.0 multi-protocol BMS integration) ----------
// Answers "WHERE does the SOC number come from?" — the operator-facing honesty
// field. Firmware <1.6.0 does not send it; absent → 'UNKNOWN' (never guessed).
export type SocProvenance = 'BMS_DIRECT' | 'SHUNT_COULOMB' | 'OCV_ESTIMATED' | 'UNKNOWN';

export function normalizeSocProvenance(raw: unknown): SocProvenance {
  const s = typeof raw === 'string' ? raw.toUpperCase() : '';
  if (s === 'BMS_DIRECT' || s === 'SHUNT_COULOMB' || s === 'OCV_ESTIMATED') return s;
  return 'UNKNOWN';
}

// ---------- BATTERY (brief §3-23) ----------
// 15S LiFePO4 pack: nominal 48V, full 54.0V, low 45.0V.
// Current sign convention (brief §5): + = charging (into battery),
//                                       - = discharging (out of battery).
// Power is signed the same way.
export interface SocState {
  value: number | null;        // 0..100 %, null = unavailable
  quality: MeasurementQuality;  // always ESTIMATED unless synchronized
  source: 'COULOMB_COUNTING' | 'VOLTAGE_SYNC' | 'FULL_CHARGE_DETECTED';
  method: 'ESTIMATED' | 'SYNCHRONIZED' | 'BMS_DIRECT';
  lastSync: number | null;     // ms epoch of last full-charge sync
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'BASELINE_AGING';
  provenance?: SocProvenance;  // v1.6.0 — absent on older firmware/GAS rows
}

export interface BatteryTelemetry {
  voltage: Measurement<number>;            // V, MEASURED (INA219 or ESP32 ADC)
  current: Measurement<number>;            // A, MEASURED (INA219, signed)
  power: Measurement<number>;              // W, DERIVED (signed: + charging, - discharging)
  direction: Direction;
  soc: SocState;
  remainingAh: number | null;              // estimated usable Ah remaining
  chargeAh: number;                       // accumulated since last reset (Ah)
  dischargeAh: number;                    // accumulated since last reset (Ah)
  chargeWh: number;                       // accumulated since last reset (Wh)
  dischargeWh: number;                    // accumulated since last reset (Wh)
  netWh: number;                          // chargeWh - dischargeWh (signed)
  netAh: number;                          // chargeAh - dischargeAh (signed)
  efc: number;                            // equivalent full cycles
  estimatedUsableCapacityAh: number | null; // NOT "SOH" — brief §22
  peakChargeCurrent: number | null;        // A, max charging current observed
  peakDischargeCurrent: number | null;     // A, max discharging current observed (positive)
  // v1.6.0 — external BMS/inverter comm block. Absent on firmware <1.6.0
  // (treated as "no BMS" — provenance falls back to the shunt path honestly).
  bms?: BmsStatus | null;
}

// ---------- EXTERNAL BMS (v1.6.0 — CAN / Modbus RTU / Modbus TCP) ----------
// NaN-safe like every measurement: null = not provided by the protocol.
// `connected` mirrors the firmware manager's LOCKED + fresh state.
export type BmsProtocol = 'PYLONTECH_CAN' | 'MODBUS_RTU' | 'MODBUS_TCP' | 'PYLONTECH_RS485' | 'NONE' | 'UNKNOWN';

export interface BmsStatus {
  connected: boolean;
  protocol: BmsProtocol;
  state: 'DISABLED' | 'PROBING' | 'LOCKED' | 'LOST' | 'IDLE_NO_BMS' | 'UNKNOWN';
  voltage: number | null;                 // V (pack, from BMS)
  current: number | null;                 // A, +charging (sign-normalized by firmware)
  temperature: number | null;             // °C
  soh: number | null;                     // % state of health
  cellVoltageMin: number | null;          // V
  cellVoltageMax: number | null;          // V
  cellCount: number;                      // 0 = not reported
  chargeCurrentLimit: number | null;      // A (CCL — BMS-requested ceiling)
  dischargeCurrentLimit: number | null;   // A (DCL)
  cycleCount: number;                     // 0 = not reported
  faultFlags: number;                     // protocol-specific bitfield
  moduleCount: number;                    // parallel modules (0 = not reported)
  lastSeenMs: number;                     // device uptime ms of last valid frame
  currentMismatchA: number | null;        // |I_bms − I_shunt| (null = n/a)
}

// ---------- AC (brief §26-28) ----------
// ACS712 measures AC current only. Power is ESTIMATED because we don't measure
// AC voltage or power factor — the operator must input assumed voltage and PF.
export interface AcEstimatedPower {
  value: number | null;
  unit: string;
  quality: MeasurementQuality;            // always ESTIMATED
  assumptions: {
    voltage: number;                       // assumed AC voltage (e.g., 220V)
    powerFactor: number;                   // assumed PF (e.g., 0.9)
  };
}

// v1.7.0 [W12-2] — PZEM-004T v3 real AC power meter (optional firmware flag
// PLTS_ENABLE_PZEM_AC). Absent on firmware without the meter → undefined
// (honest: no meter). A present-but-disconnected meter reports
// connected=false with null values — never fabricated zeros.
export interface AcMeterMeasurement {
  connected: boolean;                      // PZEM answering within timeout
  voltage: number | null;                  // V, MEASURED
  current: number | null;                  // A, MEASURED
  power: number | null;                    // W, MEASURED (active power)
  energy: number | null;                   // Wh, MEASURED (cumulative import)
  frequency: number | null;                // Hz, MEASURED
  powerFactor: number | null;              // 0..1, MEASURED
}

export interface AcTelemetry {
  rmsCurrent: Measurement<number>;        // A, MEASURED (ACS712 RMS)
  peakCurrent: Measurement<number>;       // A, MEASURED (ACS712 peak)
  averageCurrent: Measurement<number>;     // A, MEASURED (rolling average)
  estimatedPower: AcEstimatedPower | null;
  signalQuality: 'GOOD' | 'DEGRADED' | 'POOR' | 'INVALID' | 'UNKNOWN';
  // v1.7.0 [E-WAVE] — 2nd ACS712 (genset→inverter feed). Absent on older
  // firmware → undefined (honest: the channel does not exist yet).
  gensetRmsCurrent?: Measurement<number>;
  // v1.7.0 [W12-2] — PZEM-004T real AC meter. Absent → undefined (no meter).
  meter?: AcMeterMeasurement;
}

// ---------- EMERGENCY RELAY (v1.7.0 / firmware-generic ≥ 1.6.0) ----------
// Mirrors the GAS LATEST emergency block + firmware E-layer semantics.
export type EmergencyRelayState = 'RUN' | 'EMERGENCY' | 'UNKNOWN';

export interface EmergencyStatus {
  state: EmergencyRelayState;
  reason: string | null;                // VBAT_LOW | ESTOP | OPERATOR | BOOT | CRASHLOOP | ...
  estopLineOpen: boolean;              // physical E-stop line sense
  tripCount: number | null;            // lifetime trips (NVS-persisted on device)
}

// ---------- ENVIRONMENT (brief §29-30) ----------
// SHT31 measures ambient T/H. Label is "Ambient / Enclosure Temperature"
// NEVER "Battery Temperature" — the SHT31 is in the enclosure, not on cells.
export interface EnvironmentTelemetry {
  temperature: Measurement<number>;       // °C, MEASURED
  humidity: Measurement<number>;           // % RH, MEASURED
  dewPoint: number | null;                // °C, DERIVED (Magnus formula)
  label: 'Ambient / Enclosure Temperature';
  condensationRisk: boolean;              // true if dewPoint > surface temp estimate
}

// ---------- HEALTH (brief §31-33) ----------
export type SensorHealth = 'ONLINE' | 'OFFLINE' | 'ERROR' | 'RECOVERING';
export type SystemState = 'HEALTHY' | 'WARNING' | 'DEGRADED' | 'FAILED' | 'RECOVERING' | 'UNKNOWN';

export interface HealthSnapshot {
  systemState: SystemState;
  sensorHealth: {
    ina219: SensorHealth;          // battery current sensor
    batteryAdc: SensorHealth;      // ESP32 ADC battery voltage
    acs712: SensorHealth;          // AC current sensor
    sht31: SensorHealth;           // ambient T/H sensor
    bmsComm?: SensorHealth;        // v1.6.0 — external BMS/inverter comm manager
  };
  taskHeartbeats: Record<string, number>;  // taskName → last heartbeat ms epoch
  freeHeap: number;                       // bytes
  minFreeHeap: number;                    // bytes (lowest since boot)
  wifiRssi: number;                        // dBm
  wifiReconnectCount: number;
  mqttConnected: boolean;
  ntpSynced: boolean;
  storageOk: boolean;
  spoolSize: number;                       // # of queued telemetry packets
  highestAlarmSeverity: 'INFO' | 'WARNING' | 'CRITICAL';
}

// ---------- CALIBRATION (brief §11-14) ----------
export interface VoltageCalibrationPoint {
  reference: number;                       // known-good reference voltage (multimeter)
  raw: number;                             // ESP32 ADC raw reading at that voltage
  timestamp: number;                       // ms epoch
}

export interface Calibration {
  version: number;
  voltageLow: VoltageCalibrationPoint;       // ~45V reference point
  voltageNominal: VoltageCalibrationPoint;    // ~51V reference point
  voltageFull: VoltageCalibrationPoint;       // ~54V reference point
  acs712Offset: number;                       // ADC counts at 0A (zero-cal)
  acs712Sensitivity: number;                  // V/A (typ. 0.185 for ACS712-5A)
  sht31TempOffset: number;                    // °C offset
  sht31HumOffset: number;                     // % RH offset
  timestamp: number;
  source: string;                             // 'manual' | 'auto_zero' | 'factory'
}

// ---------- CONFIG (brief §64) ----------
export interface AlarmThresholds {
  voltageLowWarn: number;                     // V
  voltageLowCritical: number;                 // V
  voltageHighWarn: number;                    // V
  voltageHighCritical: number;                // V
  currentHighWarn: number;                    // A (absolute value)
  currentHighCritical: number;                // A
  temperatureHighWarn: number;                 // °C
  temperatureHighCritical: number;            // °C
  humidityHighWarn: number;                   // %
  socLowWarn: number;                         // %
  socLowCritical: number;                     // %
}

export interface DeviceConfig {
  version: number;
  revision: number;
  timestamp: number;
  source: string;                              // 'web_ui' | 'mqtt' | 'factory'
  checksum: string;                            // SHA-256 of serialized config
  deviceName: string;
  siteName: string;
  timezone: string;
  batteryCapacityAh: number;                  // nameplate capacity (e.g., 200Ah)
  batteryNominalVoltage: number;              // 48
  fullVoltage: number;                         // 54.0 (15S LiFePO4 full)
  lowVoltage: number;                          // 45.0 (15S LiFePO4 low)
  idleCurrentThreshold: number;                // A — below this, direction = IDLE
  fullChargeCurrentThreshold: number;          // A — below this at high V, consider "full"
  fullChargePersistenceSec: number;            // seconds the above must persist
  telemetryIntervalSec: number;                // 5 (typ.)
  // v1.6.0 — external BMS/inverter communication (multi-protocol).
  bmsProtocol?: 'auto' | 'none' | 'pylontech_can' | 'modbus_rtu' | 'modbus_tcp';
  bmsPollIntervalMs?: number;                  // 1000..600000 (default 5000)
  bmsModbusSlaveId?: number;                   // 1..247
  bmsModbusTcpHost?: string;                   // empty = Modbus TCP slot off
  bmsModbusTcpPort?: number;                   // 1..65535 (default 502)
  socParams: {
    syncOnFullCharge: boolean;
    syncOnVoltage: boolean;
    voltageSyncHysteresisV: number;
    baselineAgingPerMonthPct: number;
  };
  alarmThresholds: AlarmThresholds;
  calibrationParams: {
    autoZeroAcs712OnBoot: boolean;
    sht31HeaterEnabled: boolean;
  };
}

// ---------- ALARM (brief §34-35) ----------
export type AlarmSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlarmLifecycle = 'ACTIVE' | 'ACKNOWLEDGED' | 'CLEARED';

export interface Alarm {
  id: string;                                  // UUID
  code: string;                                // e.g., 'BATTERY_VOLTAGE_LOW'
  severity: AlarmSeverity;
  lifecycle: AlarmLifecycle;
  raisedAt: number;                             // ms epoch
  acknowledgedAt: number | null;
  clearedAt: number | null;
  message: string;
  domain: 'BATTERY' | 'AC' | 'ENVIRONMENT' | 'SYSTEM' | 'SENSOR' | 'CONFIGURATION';
  device?: string;                              // deviceId if multi-device
}

// ---------- EVENTS (brief §61) ----------
export type EventType =
  | 'DEVICE_BOOT'
  | 'WIFI_CONNECTED'
  | 'WIFI_DISCONNECTED'
  | 'TIME_SYNCED'
  | 'SENSOR_FAILURE'
  | 'SENSOR_RECOVERED'
  | 'ALARM_ACTIVE'
  | 'ALARM_ACKNOWLEDGED'
  | 'ALARM_CLEARED'
  | 'SOC_BASELINE_CORRECTED'
  | 'CALIBRATION_CHANGED'
  | 'CONFIGURATION_CHANGED'
  | 'OTA_STARTED'
  | 'OTA_SUCCESS'
  | 'OTA_FAILED'
  | 'STORAGE_ERROR';

export interface SystemEvent {
  id: string;
  type: EventType;
  timestamp: number;                          // ms epoch
  payload: Record<string, unknown>;
  message: string;
}

// ---------- LOGS ----------
export type LogType =
  | 'login'
  | 'logout'
  | 'error'
  | 'restart'
  | 'ota'
  | 'config_change'
  | 'calibration_change'
  | 'alarm_active'
  | 'alarm_ack'
  | 'alarm_clear'
  | 'time_sync'
  | 'sensor_failure'
  | 'sensor_recovered';

export interface ActivityLog {
  id: number;
  timestamp: number;                          // ms epoch
  type: LogType;
  message: string;
  details?: Record<string, unknown>;
}

export type LogFilter = {
  type?: LogType | 'all';
  limit?: number;
  since?: number;                              // ms epoch
};

// ---------- DIAGNOSTICS (brief §60) ----------
export interface Diagnostics {
  uptimeSeconds: number;
  freeHeap: number;
  minFreeHeap: number;
  wifiRssi: number;
  wifiReconnectCount: number;
  // Field LANGSUNG dari firmware /api/diagnostics (produsen kanonik; hadir
  // saat PWA bicara langsung ke perangkat). Demo route belum mengirimnya.
  mqttConnected?: boolean;
  ntpSynced?: boolean;
  filesystemOk?: boolean;
  nvsOk?: boolean;
  watchdogResets?: number;
  brownoutResets?: number;
  spoolDrops?: number;
  spoolReplays?: number;
  wifiState: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'ERROR';
  mqttState: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'ERROR';
  gasApiState: 'OK' | 'FAILED' | 'DISABLED' | 'UNKNOWN';
  ntpState: 'SYNCED' | 'UNSYNCED' | 'ERROR';
  resetReason: string;
  bootCount: number;
  firmwareVersion: string;
  protocolVersion: number;
  configSchemaVersion: number;
  storageState: 'OK' | 'READ_ONLY' | 'CORRUPTED' | 'FAILED';
  spoolSize: number;
  sensorHealth: HealthSnapshot['sensorHealth'];
  calibrationVersions: {
    voltage: number;
    acs712: number;
    sht31: number;
  };
}

// ---------- ROOT TELEMETRY (brief §41) ----------
export interface SystemStatus {
  protocolVersion: number;                     // 1
  firmwareVersion: string;
  deviceId: string;                            // 'PLTS-XXXXXX' (modular, 6 hex) | 'PLTS-XXXXXXXX' (8 hex)
  deviceName: string;
  sequence: number;                            // monotonic — for gap detection
  timestamp: number;                           // ms epoch
  timeQuality: 'VALID' | 'UNSYNCED' | 'UNKNOWN';
  uptimeSeconds: number;
  bootCount: number;
  resetReason: string;
  battery: BatteryTelemetry;
  ac: AcTelemetry;
  environment: EnvironmentTelemetry;
  health: HealthSnapshot;
  activeAlarms: Alarm[];
  calibration: Calibration;
  config: DeviceConfig;
  // v1.7.0 [E-WAVE] — emergency relay block (undefined on older firmware —
  // the UI renders an honest "tidak diketahui", never a fabricated RUN).
  emergency?: EmergencyStatus;
  // Convenience: serializes the device online state for the UI shell.
  online: boolean;
  // [P0-006 REMEDIATION 2026-08] Explicit simulation marker: true ONLY when
  // this envelope was generated by the demo/simulation store. The dashboard
  // renders a persistent SIMULATION banner when set — simulation can never
  // be confused with production telemetry.
  simulated?: boolean;
}

// ---------- [P1-015 REMEDIATION 2026-08] DATA FRESHNESS LADDER ----------
// Age-based staleness computed by the PWA itself from eventTime/receivedTime —
// the UI never trusts a payload's own quality claim alone.
//   LIVE      age < 10 s
//   DELAYED   10 s ≤ age < 60 s
//   STALE     age ≥ 60 s
//   NO_DATA   no envelope at all (or timestamp 0 / never received)
export type DataFreshness = 'LIVE' | 'DELAYED' | 'STALE' | 'NO_DATA';

export const FRESHNESS_LIVE_MS = 10_000;
export const FRESHNESS_STALE_MS = 60_000;

/**
 * Compute the freshness ladder for a status envelope.
 * NOTE: thresholds are calibrated to the ~5 s telemetry interval; callers
 * may pass a tighter interval when the device reports one.
 */
export function computeFreshness(
  timestamp: number | null | undefined,
  opts?: { intervalMs?: number; now?: number },
): DataFreshness {
  const now = opts?.now ?? Date.now();
  if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) {
    return 'NO_DATA';
  }
  const age = now - timestamp;
  if (age < 0) return 'LIVE';               // clock skew — treat as live
  if (age < FRESHNESS_LIVE_MS) return 'LIVE';
  if (age < FRESHNESS_STALE_MS) return 'DELAYED';
  return 'STALE';
}

/**
 * [P1-011] Effective quality of a measurement: the WORSE of the payload's
 * own quality and the age-derived freshness. A STALE envelope can never
 * render as VALID, whatever the payload claims.
 */
export function effectiveQuality(
  quality: MeasurementQuality,
  freshness: DataFreshness,
): MeasurementQuality {
  if (freshness === 'NO_DATA') return 'NOT_AVAILABLE';
  if (freshness === 'STALE' && quality !== 'NOT_AVAILABLE' && quality !== 'SENSOR_ERROR') {
    return 'STALE';
  }
  if (freshness === 'DELAYED' && quality === 'VALID') return 'SUSPECT';
  return quality;
}

// ---------- CONFIG (PWA-side config view) ----------
export type SystemConfig = {
  deviceName: string;
  siteName: string;
  timezone: string;
  config: DeviceConfig;
  calibration: Calibration;
};

// ---------- FIRMWARE / VERSION ----------
export type FirmwareInfo = {
  currentVersion: string;
  buildDate: string;
  protocolVersion: number;
  configSchemaVersion: number;
  latestAvailable: string | null;
  updateAvailable: boolean | null;
  signatureVerified: boolean | null;
  otaStatus:
    | 'up-to-date'
    | 'update-available'
    | 'uploading'
    | 'verifying'
    | 'installing'
    | 'failed'
    | 'rollback'
    | 'unknown';
  lastUpdateAt: number | null;
  lastUpdateStatus: 'success' | 'failed' | 'rollback' | null;
};

export type OtaHistoryEntry = {
  id: number;
  timestamp: number;
  fromVersion: string;
  toVersion: string;
  status: 'success' | 'failed' | 'rollback';
  durationSeconds: number;
  // [W13-3] Present when sourced from the GAS OtaEvents sheet (OTA_LOG):
  // the raw device-reported event verb + message (ACTIVATED / ROLLBACK /
  // DOWNLOAD_FAILED / REFUSED / VERIFICATION_FAILED / BOOT_FAILED).
  event?: string;
  message?: string;
};

// ---------- AI INSIGHTS (advisory only — Gemini via ESP32 HMAC proxy) ----------
// brief §94-95: PWA NEVER calls GAS directly. ESP32 proxies via HMAC.
export type InsightSeverity = 'info' | 'warning' | 'critical';

export type InsightCategory =
  | 'battery_analysis'
  | 'energy_analysis'
  | 'energy_anomaly'
  | 'maintenance_suggestion'
  | 'environment_alert';

export type AiInsight = {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  body: string;
  generatedAt: number;
  source: 'gemini' | 'mock';
  advisoryOnly: true;                          // ALWAYS true (brief §94-95)
};

export type InsightsEnvelope = {
  success: boolean;
  insights?: AiInsight[];
  cached?: boolean;
  mock?: boolean;
  error?: string;
  message?: string;
};

// ---------- REPORTS (brief §66, §96) ----------
export type ReportRange = 'daily' | 'weekly' | 'monthly' | 'custom';
export type ReportFormat = 'csv' | 'pdf' | 'json';

export interface ReportRequest {
  range: ReportRange;
  from: number;                                // ms epoch
  to: number;                                  // ms epoch
  format: ReportFormat;
}

export interface DailyEnergyRecord {
  date: string;                                // YYYY-MM-DD
  chargeWh: number;
  dischargeWh: number;
  netWh: number;
  chargeAh: number;
  dischargeAh: number;
  peakChargeA: number | null;
  peakDischargeA: number | null;
  socMin: number | null;
  socMax: number | null;
  alarmCount: number;
  telemetryCompleteness: number;               // 0..1
  deviceAvailability: number;                  // 0..1
}

// ---------- FACTORY RESET ----------
export type FactoryResetPrepareResponse = {
  token: string;
  expiresAt: number;                          // ms epoch (60s TTL)
};

export type FactoryResetConfirmRequest = {
  token: string;
  confirm: 'RESET';
};
