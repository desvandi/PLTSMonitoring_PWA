// =============================================================================
// i18n: Indonesian (id) + English (en) translation tables for PLTS Monitor.
// -----------------------------------------------------------------------------
// ~200 keys covering all 15 views. Drop relay/PIR/schedule keys from the
// reference. Add PLTS-specific: voltage_calibration, acs712_zero, sht31_offset,
// efc, estimated_usable_capacity, condensation_risk, dew_point, runtime_estimation,
// telemetry_completeness, device_availability, signal_quality, derived, estimated.
// =============================================================================

export type Language = "id" | "en";

export type TranslationKey =
  // App
  | "app.name"
  | "app.tagline"
  // Nav
  | "nav.dashboard"
  | "nav.battery"
  | "nav.ac"
  | "nav.environment"
  | "nav.energy"
  | "nav.calibration"
  | "nav.config"
  | "nav.alarms"
  | "nav.diagnostics"
  | "nav.sensors"
  | "nav.events"
  | "nav.reports"
  | "nav.ai"
  | "nav.settings"
  | "nav.ota"
  | "nav.fleet"
  | "nav.emergency"
  | "nav.relays"
  // Emergency control (v1.7.0 E-WAVE)
  | "emergency.title"
  | "emergency.no_device"
  | "emergency.state_run"
  | "emergency.state_isolated"
  | "emergency.state_unknown"
  | "emergency.trips"
  | "emergency.last_reason"
  | "emergency.estop_open"
  | "emergency.unknown_note"
  | "emergency.arm"
  | "emergency.disarm"
  | "emergency.disarm_confirm"
  | "emergency.disarm_go"
  | "emergency.disarm_warning"
  | "emergency.type_stop"
  | "emergency.no_admin_token"
  | "emergency.cmd_queued"
  | "emergency.cmd_failed"
  | "emergency.cmd_latency_note"
  | "emergency.flow_title"
  | "emergency.flow_aria"
  | "emergency.node_pv"
  | "emergency.node_battery"
  | "emergency.node_genset"
  | "emergency.node_inverter"
  | "emergency.node_load"
  | "emergency.config_title"
  | "emergency.config_note"
  | "emergency.config_send"
  | "emergency.config_reset"
  | "emergency.cfg_vbatLowV"
  | "emergency.cfg_vbatLowHystV"
  | "emergency.cfg_vbatHighV"
  | "emergency.cfg_vbatHighHystV"
  | "emergency.cfg_iDcOverA"
  | "emergency.cfg_iAcLoadOverA"
  | "emergency.cfg_iAcGenOverA"
  | "emergency.cfg_iAcGenOverA_hint"
  | "emergency.cfg_debounceN"
  | "emergency.cfg_recoverySec"
  | "emergency.cfg_relayPin"
  | "emergency.cfg_estopPin"
  | "emergency.cfg_estopEnabled"
  | "emergency.cfg_sensorFailPolicy"
  | "emergency.cfg_sensorFailPolicy_hint"
  | "emergency.log_title"
  | "emergency.log_empty"
  | "emergency.acs_gen_title"
  // Common
  | "common.save"
  | "common.cancel"
  | "common.confirm"
  | "common.apply"
  | "common.refresh"
  | "common.loading"
  | "common.online"
  | "common.offline"
  | "common.mock_mode"
  | "common.live_mode"
  // [P0-006/P1-015 REMEDIATION 2026-08] truth-state vocabulary
  | "common.simulation_mode"
  | "common.simulation_banner"
  | "common.no_data"
  | "common.no_data_banner"
  | "common.delayed"
  | "common.offline_banner"
  | "common.stale_banner"
  | "common.telemetry_age"
  | "common.export"
  | "common.import"
  | "common.close"
  | "common.all"
  | "common.yes"
  | "common.no"
  | "common.measured"
  | "common.derived"
  | "common.estimated"
  | "common.na"
  | "common.fresh"
  | "common.stale"
  | "common.last_seen"
  | "common.unavailable"
  | "common.unknown"
  // Login
  | "login.title"
  | "login.subtitle"
  | "login.username"
  | "login.password"
  | "login.submit"
  | "login.error_invalid"
  | "login.demo_creds"
  // Dashboard
  | "dashboard.title"
  | "dashboard.subtitle"
  | "dashboard.system_health"
  | "dashboard.battery"
  | "dashboard.ac_current"
  | "dashboard.temperature"
  | "dashboard.humidity"
  | "dashboard.active_alarms"
  | "dashboard.telemetry_freshness"
  | "dashboard.uptime"
  | "dashboard.free_heap"
  | "dashboard.wifi_rssi"
  | "dashboard.current_time"
  | "dashboard.charge_state"
  | "dashboard.discharge_state"
  | "dashboard.idle_state"
  | "dashboard.soc"
  | "dashboard.remaining_ah"
  | "dashboard.runtime_estimation"
  | "dashboard.healthy"
  | "dashboard.warning"
  | "dashboard.degraded"
  | "dashboard.failed"
  // Battery
  | "battery.title"
  | "battery.subtitle"
  | "battery.voltage"
  | "battery.current"
  | "battery.power"
  | "battery.direction"
  | "battery.soc"
  | "battery.remaining_ah"
  | "battery.charge_ah"
  | "battery.discharge_ah"
  | "battery.charge_wh"
  | "battery.discharge_wh"
  | "battery.net_wh"
  | "battery.net_ah"
  | "battery.efc"
  | "battery.estimated_usable_capacity"
  | "battery.peak_charge_current"
  | "battery.peak_discharge_current"
  | "battery.charging"
  | "battery.discharging"
  | "battery.idle"
  | "battery.coulomb_counting"
  | "battery.voltage_sync"
  | "battery.full_charge_detected"
  | "battery.synchronized"
  | "battery.estimated"
  | "battery.last_sync"
  | "battery.confidence"
  | "battery.confidence_high"
  | "battery.confidence_medium"
  | "battery.confidence_low"
  | "battery.confidence_baseline_aging"
  | "battery.time_range_1h"
  | "battery.time_range_6h"
  | "battery.time_range_12h"
  | "battery.time_range_24h"
  | "battery.time_range_7d"
  | "battery.time_range_30d"
  // BMS (v1.6.0 multi-protocol external battery)
  | "battery.bms.title"
  | "battery.bms.description"
  | "battery.bms.voltage"
  | "battery.bms.current"
  | "battery.bms.soh"
  | "battery.bms.temperature"
  | "battery.bms.cell_min"
  | "battery.bms.cell_max"
  | "battery.bms.cell_delta"
  | "battery.bms.cell_count"
  | "battery.bms.cycle_count"
  | "battery.bms.charge_limit"
  | "battery.bms.discharge_limit"
  | "battery.bms.mismatch"
  | "battery.bms.fault"
  | "battery.bms.not_authoritative"
  | "settings.bms.title"
  | "settings.bms.description"
  | "settings.bms.protocol"
  | "settings.bms.protocol_auto"
  | "settings.bms.protocol_none"
  | "settings.bms.protocol_pylontech_can"
  | "settings.bms.protocol_modbus_rtu"
  | "settings.bms.protocol_modbus_tcp"
  | "settings.bms.poll_interval"
  | "settings.bms.slave_id"
  | "settings.bms.tcp_host"
  | "settings.bms.tcp_port"
  | "settings.bms.save"
  | "settings.bms.saved"
  | "settings.bms.provenance_note"
  // AC
  | "ac.title"
  | "ac.subtitle"
  | "ac.rms_current"
  | "ac.peak_current"
  | "ac.average_current"
  | "ac.estimated_power"
  | "ac.estimated_power_disclaimer"
  | "ac.signal_quality"
  | "ac.signal_quality_good"
  | "ac.signal_quality_degraded"
  | "ac.signal_quality_poor"
  | "ac.signal_quality_invalid"
  | "ac.assumed_voltage"
  | "ac.assumed_power_factor"
  | "ac.meter_title"
  | "ac.meter_power"
  | "ac.meter_voltage"
  | "ac.meter_frequency"
  | "ac.meter_power_factor"
  | "ac.meter_energy"
  | "ac.meter_note"
  | "ac.meter_disconnected"
  // Environment
  | "environment.title"
  | "environment.subtitle"
  | "environment.temperature"
  | "environment.humidity"
  | "environment.dew_point"
  | "environment.condensation_risk"
  | "environment.condensation_risk_warning"
  | "environment.ambient_label"
  // Energy
  | "energy.title"
  | "energy.subtitle"
  | "energy.charge_wh"
  | "energy.discharge_wh"
  | "energy.net_wh"
  | "energy.charge_ah"
  | "energy.discharge_ah"
  | "energy.efc"
  | "energy.daily"
  | "energy.weekly"
  | "energy.monthly"
  | "energy.custom"
  | "energy.today"
  | "energy.yesterday"
  // Calibration
  | "calibration.title"
  | "calibration.subtitle"
  | "calibration.voltage_3_point"
  | "calibration.voltage_low"
  | "calibration.voltage_nominal"
  | "calibration.voltage_full"
  | "calibration.acs712_zero"
  | "calibration.sht31_offset"
  | "calibration.reference"
  | "calibration.raw"
  | "calibration.corrected"
  | "calibration.error_before"
  | "calibration.error_after"
  | "calibration.version"
  | "calibration.timestamp"
  | "calibration.source"
  | "calibration.confirm"
  | "calibration.operator_confirm"
  // Config
  | "config.title"
  | "config.subtitle"
  | "config.device_name"
  | "config.site_name"
  | "config.timezone"
  | "config.battery_capacity"
  | "config.nominal_voltage"
  | "config.full_voltage"
  | "config.low_voltage"
  | "config.idle_current_threshold"
  | "config.full_charge_current_threshold"
  | "config.full_charge_persistence"
  | "config.telemetry_interval"
  | "config.alarm_thresholds"
  | "config.soc_params"
  | "config.alarm_thresholds_note"
  | "config.alarm_unavailable"
  | "config.calibration_params"
  | "config.revision"
  | "config.source"
  | "config.checksum"
  // Alarms
  | "alarms.title"
  | "alarms.subtitle"
  | "alarms.active"
  | "alarms.acknowledged"
  | "alarms.cleared"
  | "alarms.history"
  | "alarms.severity"
  | "alarms.lifecycle"
  | "alarms.domain"
  | "alarms.raised_at"
  | "alarms.acknowledged_at"
  | "alarms.cleared_at"
  | "alarms.acknowledge"
  | "alarms.no_alarms"
  | "alarms.severity_info"
  | "alarms.severity_warning"
  | "alarms.severity_critical"
  | "alarms.filter_severity"
  | "alarms.filter_domain"
  // Diagnostics
  | "diagnostics.title"
  | "diagnostics.subtitle"
  | "diagnostics.uptime"
  | "diagnostics.free_heap"
  | "diagnostics.min_free_heap"
  | "diagnostics.wifi_rssi"
  | "diagnostics.wifi_reconnect_count"
  | "diagnostics.network_state"
  | "diagnostics.mqtt_state"
  | "diagnostics.gas_state"
  | "diagnostics.ntp_state"
  | "diagnostics.reset_reason"
  | "diagnostics.boot_count"
  | "diagnostics.firmware_version"
  | "diagnostics.protocol_version"
  | "diagnostics.storage_state"
  | "diagnostics.spool_size"
  | "diagnostics.sensor_health"
  | "diagnostics.calibration_versions"
  // Sensors
  | "sensors.title"
  | "sensors.subtitle"
  | "sensors.ina219"
  | "sensors.battery_adc"
  | "sensors.acs712"
  | "sensors.sht31"
  | "sensors.last_sample"
  | "sensors.status_online"
  | "sensors.status_offline"
  | "sensors.status_error"
  | "sensors.status_recovering"
  // Events
  | "events.title"
  | "events.subtitle"
  | "events.filter_type"
  | "events.empty"
  // Reports
  | "reports.title"
  | "reports.subtitle"
  | "reports.range_daily"
  | "reports.range_weekly"
  | "reports.range_monthly"
  | "reports.range_custom"
  | "reports.from"
  | "reports.to"
  | "reports.export_csv"
  | "reports.export_pdf"
  | "reports.export_json"
  | "reports.telemetry_completeness"
  | "reports.device_availability"
  | "reports.empty"
  // AI
  | "ai.title"
  | "ai.subtitle"
  | "ai.disclaimer"
  | "ai.pipeline"
  | "ai.advisory_only"
  | "ai.category.battery"
  | "ai.category.energy"
  | "ai.category.energy_anomaly"
  | "ai.category.maintenance"
  | "ai.category.environment"
  | "ai.severity.info"
  | "ai.severity.warning"
  | "ai.severity.critical"
  | "ai.last_updated"
  | "ai.mock_fallback"
  // OTA
  | "ota.title"
  | "ota.subtitle"
  | "ota.current_version"
  | "ota.latest_version"
  | "ota.update_available"
  | "ota.up_to_date"
  | "ota.check_update"
  | "ota.upload_binary"
  | "ota.uploading"
  | "ota.verifying"
  | "ota.installing"
  | "ota.rollback"
  | "ota.signature_verified"
  | "ota.history"
  | "ota.warning_stable_power"
  // Settings
  | "settings.title"
  | "settings.subtitle"
  | "settings.timezone"
  | "settings.change_password"
  | "settings.current_password"
  | "settings.new_password"
  | "settings.confirm_password"
  | "settings.backup_restore"
  | "settings.export_config"
  | "settings.import_config"
  | "settings.factory_reset"
  | "settings.factory_reset_warning"
  | "settings.factory_reset_prepare"
  | "settings.factory_reset_confirm"
  | "settings.factory_reset_token"
  | "settings.reboot"
  // Toast
  | "toast.saved"
  | "toast.error"
  | "toast.logout_success"
  | "toast.password_changed"
  | "toast.config_exported"
  | "toast.config_imported"
  | "toast.factory_reset_done"
  | "toast.ota_started"
  | "toast.ota_success"
  | "toast.ota_failed"
  | "toast.rebooting"
  | "toast.calibration_saved"
  | "toast.alarm_acked"
  | "toast.report_exported"
  // Theme
  | "theme.light"
  | "theme.dark"
  | "theme.system"
  | "theme.toggle"
  // Measurement quality
  | "quality.VALID"
  | "quality.STALE"
  | "quality.INVALID"
  | "quality.OUT_OF_RANGE"
  | "quality.SENSOR_ERROR"
  | "quality.NOT_AVAILABLE"
  | "quality.ESTIMATED"
  | "quality.DERIVED"
  | "quality.CALIBRATING"
  | "quality.SUSPECT";

type Dict = Record<TranslationKey, string>;

const id: Dict = {
  "app.name": "PLTS Monitor",
  "app.tagline": "Sistem Monitoring PLTS 48V LiFePO4",
  "nav.dashboard": "Dashboard",
  "nav.battery": "Baterai",
  "nav.ac": "Arus AC",
  "nav.environment": "Lingkungan",
  "nav.energy": "Energi",
  "nav.calibration": "Kalibrasi",
  "nav.config": "Konfigurasi",
  "nav.alarms": "Alarm",
  "nav.diagnostics": "Diagnostik",
  "nav.sensors": "Sensor",
  "nav.events": "Event",
  "nav.reports": "Laporan",
  "nav.ai": "Insight AI",
  "nav.settings": "Pengaturan",
  "nav.ota": "OTA Firmware",
  "nav.fleet": "Fleet",
  "nav.emergency": "Kontrol Darurat",
  "nav.relays": "Relay 8-CH",
  "emergency.title": "Kontrol Darurat",
  "emergency.no_device": "Belum ada perangkat terdaftar. Buka Settings dan tambahkan URL GAS + token perangkat terlebih dahulu.",
  "emergency.state_run": "SISTEM RUN",
  "emergency.state_isolated": "TERISOLASI",
  "emergency.state_unknown": "TIDAK DIKETAHUI",
  "emergency.trips": "Total trip",
  "emergency.last_reason": "Penyebab terakhir",
  "emergency.estop_open": "Jalur E-STOP fisik TERBUKA (tombol darurat ditekan atau kabel lepas)",
  "emergency.unknown_note": "Firmware perangkat belum melaporkan status relay darurat (firmware < 1.6.0). Perbarui firmware untuk mengaktifkan kontrol darurat.",
  "emergency.arm": "ARM — Nyalakan Sistem",
  "emergency.disarm": "EMERGENCY STOP",
  "emergency.disarm_confirm": "Konfirmasi penghentian sistem: relay darurat akan mati dan SELURUH sistem (PV, baterai, jenset, AC) terisolasi dari inverter.",
  "emergency.disarm_go": "HENTIKAN SISTEM",
  "emergency.disarm_warning": "Perangkat akan mengeksekusi dalam ±15 detik. Penyalaan kembali hanya lewat tombol ARM setelah kondisi kembali aman.",
  "emergency.type_stop": "Ketik STOP",
  "emergency.no_admin_token": "Admin Token belum diisi di Settings — perintah ARM/DISARM tidak dapat dikirim (fail-closed).",
  "emergency.cmd_queued": "Perintah masuk antrean",
  "emergency.cmd_failed": "Perintah gagal",
  "emergency.cmd_latency_note": "perangkat mengeksekusi dalam ±15 detik, lalu mengirim ACK.",
  "emergency.flow_title": "Aliran Energi",
  "emergency.flow_aria": "Diagram aliran energi PLTS",
  "emergency.node_pv": "PLTS",
  "emergency.node_battery": "Baterai",
  "emergency.node_genset": "Jenset",
  "emergency.node_inverter": "Inverter",
  "emergency.node_load": "Beban",
  "emergency.config_title": "Ambang Pemicu Darurat (semua sensor)",
  "emergency.config_note": "Nilai dikirim ke perangkat dan dipersisten di LittleFS. Rentang divalidasi di 3 lapis (PWA, GAS, firmware). debounceN = jumlah pembacaan beruntun sebelum trip; recoverySec = masa tenang minimum sebelum ARM diizinkan.",
  "emergency.config_send": "Kirim Konfigurasi",
  "emergency.config_reset": "Kembalikan Default",
  "emergency.cfg_vbatLowV": "VBAT rendah (V)",
  "emergency.cfg_vbatLowHystV": "Histeresis rendah (V)",
  "emergency.cfg_vbatHighV": "VBAT tinggi (V)",
  "emergency.cfg_vbatHighHystV": "Histeresis tinggi (V)",
  "emergency.cfg_iDcOverA": "Arus DC maks (A)",
  "emergency.cfg_iAcLoadOverA": "Arus beban maks (A)",
  "emergency.cfg_iAcGenOverA": "Arus jenset maks (A)",
  "emergency.cfg_iAcGenOverA_hint": "Kanal RESERVED — sensor jenset belum terpasang di revisi hardware ini (i_ac_gen terbaca null/NOT_AVAILABLE).",
  "emergency.cfg_debounceN": "Debounce (pembacaan)",
  "emergency.cfg_recoverySec": "Masa pulih (detik)",
  "emergency.cfg_relayPin": "Pin relay (GPIO)",
  "emergency.cfg_estopPin": "Pin sense E-stop",
  "emergency.cfg_estopEnabled": "E-stop aktif (1/0)",
  "emergency.cfg_sensorFailPolicy": "Kebijakan sensor gagal (1/0)",
  "emergency.cfg_sensorFailPolicy_hint": "1 = fail-closed (default): sensor arus wajib sehat — sensor hilang → ARM ditolak + sistem RUN ter-trip SENSOR_LOSS. 0 = opt-out operator (hanya untuk bench/komisioning, tidak aman produksi).",
  "emergency.log_title": "Riwayat Kejadian Darurat",
  "emergency.log_empty": "Belum ada kejadian darurat tercatat.",
  "emergency.acs_gen_title": "Arus Jenset → Inverter",
  "common.save": "Simpan",
  "common.cancel": "Batal",
  "common.confirm": "Konfirmasi",
  "common.apply": "Terapkan",
  "common.refresh": "Segarkan",
  "common.loading": "Memuat...",
  "common.online": "Online",
  "common.offline": "Offline",
  "common.mock_mode": "Mode Demo (Mock)",
  "common.live_mode": "Mode Live",
  "common.simulation_mode": "MODE SIMULASI",
  "common.simulation_banner": "MODE SIMULASI — data yang ditampilkan bukan telemetri nyata. Untuk pengembangan saja.",
  "common.no_data": "Tidak Ada Data",
  "common.no_data_banner": "TIDAK ADA DATA — tidak ada telemetri nyata yang tersedia. Periksa perangkat / koneksi.",
  "common.delayed": "Tertunda",
  "common.offline_banner": "PERANGKAT OFFLINE — menampilkan nilai terakhir yang diketahui (bukan live).",
  "common.stale_banner": "TELEMETRI LAMBAT — data lebih dari 60 detik. Bukan kondisi real-time.",
  "common.telemetry_age": "Usia telemetri",
  "common.export": "Ekspor",
  "common.import": "Impor",
  "common.close": "Tutup",
  "common.all": "Semua",
  "common.yes": "Ya",
  "common.no": "Tidak",
  "common.measured": "Terukur",
  "common.derived": "Turunan",
  "common.estimated": "Estimasi",
  "common.na": "N/A",
  "common.fresh": "Segar",
  "common.stale": "Stale",
  "common.last_seen": "Terakhir terlihat",
  "common.unavailable": "Tidak tersedia",
  "common.unknown": "Tidak diketahui",
  "login.title": "Masuk ke Dashboard",
  "login.subtitle": "Sistem Monitoring PLTS 48V LiFePO4",
  "login.username": "Nama Pengguna",
  "login.password": "Kata Sandi",
  "login.submit": "Masuk",
  "login.error_invalid": "Nama pengguna atau kata sandi salah",
  "login.demo_creds": "Akun demo: admin / admin123",
  "dashboard.title": "Dashboard Sistem",
  "dashboard.subtitle": "Status real-time PLTS 48V LiFePO4",
  "dashboard.system_health": "Kesehatan Sistem",
  "dashboard.battery": "Baterai",
  "dashboard.ac_current": "Arus AC",
  "dashboard.temperature": "Suhu",
  "dashboard.humidity": "Kelembapan",
  "dashboard.active_alarms": "Alarm Aktif",
  "dashboard.telemetry_freshness": "Kesegaran Telemetri",
  "dashboard.uptime": "Uptime",
  "dashboard.free_heap": "RAM Bebas",
  "dashboard.wifi_rssi": "Sinyal WiFi",
  "dashboard.current_time": "Waktu Sekarang",
  "dashboard.charge_state": "Mengisi",
  "dashboard.discharge_state": "Mengosongkan",
  "dashboard.idle_state": "Idle",
  "dashboard.soc": "SOC",
  "dashboard.remaining_ah": "Sisa Ah",
  "dashboard.runtime_estimation": "Estimasi Runtime",
  "dashboard.healthy": "Sehat",
  "dashboard.warning": "Peringatan",
  "dashboard.degraded": "Terdegradasi",
  "dashboard.failed": "Gagal",
  "battery.title": "Baterai 48V LiFePO4",
  "battery.subtitle": "Detail tegangan, arus, daya, SOC, dan siklus",
  "battery.voltage": "Tegangan",
  "battery.current": "Arus",
  "battery.power": "Daya",
  "battery.direction": "Arah Arus",
  "battery.soc": "SOC",
  "battery.remaining_ah": "Sisa Kapasitas",
  "battery.charge_ah": "Total Isi (Ah)",
  "battery.discharge_ah": "Total Kosong (Ah)",
  "battery.charge_wh": "Total Isi (Wh)",
  "battery.discharge_wh": "Total Kosong (Wh)",
  "battery.net_wh": "Net Energi (Wh)",
  "battery.net_ah": "Net Arus (Ah)",
  "battery.efc": "Equivalent Full Cycles",
  "battery.estimated_usable_capacity": "Estimasi Kapasitas Usable",
  "battery.peak_charge_current": "Arus Isi Puncak",
  "battery.peak_discharge_current": "Arus Kosong Puncak",
  "battery.charging": "Mengisi",
  "battery.discharging": "Mengosongkan",
  "battery.idle": "Idle",
  "battery.coulomb_counting": "Coulomb Counting",
  "battery.voltage_sync": "Voltage Sync",
  "battery.full_charge_detected": "Full Charge Detected",
  "battery.synchronized": "Tersinkron",
  "battery.estimated": "Estimasi",
  "battery.last_sync": "Sinkron Terakhir",
  "battery.confidence": "Confidence",
  "battery.confidence_high": "Tinggi",
  "battery.confidence_medium": "Sedang",
  "battery.confidence_low": "Rendah",
  "battery.confidence_baseline_aging": "Baseline Aging",
  "battery.time_range_1h": "1 Jam",
  "battery.time_range_6h": "6 Jam",
  "battery.time_range_12h": "12 Jam",
  "battery.time_range_24h": "24 Jam",
  "battery.time_range_7d": "7 Hari",
  "battery.time_range_30d": "30 Hari",
  "battery.bms.title": "Baterai Eksternal (BMS)",
  "battery.bms.description": "Data langsung dari BMS baterai via CAN / Modbus — tidak pernah dikarang",
  "battery.bms.voltage": "Tegangan BMS",
  "battery.bms.current": "Arus BMS",
  "battery.bms.soh": "SOH",
  "battery.bms.temperature": "Suhu BMS",
  "battery.bms.cell_min": "Sel Min",
  "battery.bms.cell_max": "Sel Maks",
  "battery.bms.cell_delta": "Delta Sel",
  "battery.bms.cell_count": "Jumlah Sel",
  "battery.bms.cycle_count": "Siklus",
  "battery.bms.charge_limit": "Batas Arus Isi",
  "battery.bms.discharge_limit": "Batas Arus Muang",
  "battery.bms.mismatch": "Selisih vs Shunt",
  "battery.bms.fault": "Fault",
  "battery.bms.not_authoritative": "BMS tidak aktif — SOC berasal dari estimasi shunt INA219 (provenance SHUNT_COULOMB).",
  "settings.bms.title": "Komunikasi BMS / Inverter",
  "settings.bms.description": "Protokol komunikasi baterai eksternal (CAN, Modbus RTU, Modbus TCP). Jika tidak ada BMS, sistem otomatis memakai shunt INA219 + ACS712.",
  "settings.bms.protocol": "Protokol",
  "settings.bms.protocol_auto": "Auto-detect (disarankan)",
  "settings.bms.protocol_none": "Nonaktif (shunt saja)",
  "settings.bms.protocol_pylontech_can": "Pylontech CAN (500 kbps)",
  "settings.bms.protocol_modbus_rtu": "Modbus RTU (RS485)",
  "settings.bms.protocol_modbus_tcp": "Modbus TCP",
  "settings.bms.poll_interval": "Interval Polling (ms)",
  "settings.bms.slave_id": "Modbus Slave ID",
  "settings.bms.tcp_host": "Host Modbus TCP",
  "settings.bms.tcp_port": "Port Modbus TCP",
  "settings.bms.save": "Simpan Konfigurasi BMS",
  "settings.bms.saved": "Konfigurasi BMS tersimpan",
  "settings.bms.provenance_note": "Sumber SOC selalu ditampilkan: BMS langsung > shunt coulomb > OCV. Transisi dicatat di log perangkat.",
  "ac.title": "Arus AC Output",
  "ac.subtitle": "Pengukuran ACS712 — RMS, puncak, rata-rata, dan estimasi daya",
  "ac.rms_current": "Arus RMS",
  "ac.peak_current": "Arus Puncak",
  "ac.average_current": "Arus Rata-rata",
  "ac.estimated_power": "Estimasi Daya AC",
  "ac.estimated_power_disclaimer": "Daya AC diestimasi dari arus terukur dengan asumsi tegangan dan faktor daya — bukan pengukuran langsung.",
  "ac.signal_quality": "Kualitas Sinyal",
  "ac.signal_quality_good": "Baik",
  "ac.signal_quality_degraded": "Terdegradasi",
  "ac.signal_quality_poor": "Lemah",
  "ac.signal_quality_invalid": "Tidak Valid",
  "ac.assumed_voltage": "Tegangan Asumsi",
  "ac.assumed_power_factor": "Faktor Daya Asumsi",
  "ac.meter_title": "Meter AC Nyata — PZEM-004T",
  "ac.meter_power": "Daya Terukur",
  "ac.meter_voltage": "Tegangan Terukur",
  "ac.meter_frequency": "Frekuensi",
  "ac.meter_power_factor": "Faktor Daya Terukur",
  "ac.meter_energy": "Energi Kumulatif",
  "ac.meter_note": "Daya aktif diukur langsung — bukan estimasi.",
  "ac.meter_disconnected": "Meter PZEM terpasang di firmware tetapi tidak merespons — daya terukur tidak tersedia; estimasi ACS712 tetap digunakan.",
  "environment.title": "Lingkungan",
  "environment.subtitle": "Suhu dan kelembapan ambient/enclosure",
  "environment.temperature": "Suhu Ambient",
  "environment.humidity": "Kelembapan",
  "environment.dew_point": "Titik Embun",
  "environment.condensation_risk": "Risiko Kondensasi",
  "environment.condensation_risk_warning": "Risiko kondensasi tinggi — titik embun mendekati suhu permukaan.",
  "environment.ambient_label": "Suhu Ambient / Enclosure",
  "energy.title": "Analitik Energi",
  "energy.subtitle": "Charge/discharge/net + Ah + EFC",
  "energy.charge_wh": "Energi Isi",
  "energy.discharge_wh": "Energi Kosong",
  "energy.net_wh": "Net Energi",
  "energy.charge_ah": "Arus Isi (Ah)",
  "energy.discharge_ah": "Arus Kosong (Ah)",
  "energy.efc": "Equivalent Full Cycles",
  "energy.daily": "Harian",
  "energy.weekly": "Mingguan",
  "energy.monthly": "Bulanan",
  "energy.custom": "Custom",
  "energy.today": "Hari Ini",
  "energy.yesterday": "Kemarin",
  "calibration.title": "Pusat Kalibrasi",
  "calibration.subtitle": "Tegangan 3-titik, ACS712 zero, SHT31 offset",
  "calibration.voltage_3_point": "Kalibrasi Tegangan 3-Titik",
  "calibration.voltage_low": "Tegangan Rendah (~45V)",
  "calibration.voltage_nominal": "Tegangan Nominal (~51V)",
  "calibration.voltage_full": "Tegangan Penuh (~54V)",
  "calibration.acs712_zero": "ACS712 Zero-Calibration",
  "calibration.sht31_offset": "SHT31 Offset",
  "calibration.reference": "Referensi",
  "calibration.raw": "Raw ADC",
  "calibration.corrected": "Koreksi",
  "calibration.error_before": "Error Sebelum",
  "calibration.error_after": "Error Sesudah",
  "calibration.version": "Versi Kalibrasi",
  "calibration.timestamp": "Timestamp Kalibrasi",
  "calibration.source": "Sumber",
  "calibration.confirm": "Konfirmasi Prosedur",
  "calibration.operator_confirm": "Operator wajib mengkonfirmasi setiap perubahan kalibrasi.",
  "config.title": "Pusat Konfigurasi",
  "config.subtitle": "Semua parameter dengan versioning",
  "config.device_name": "Nama Perangkat",
  "config.site_name": "Nama Lokasi",
  "config.timezone": "Zona Waktu",
  "config.battery_capacity": "Kapasitas Baterai (Ah)",
  "config.nominal_voltage": "Tegangan Nominal",
  "config.full_voltage": "Tegangan Penuh",
  "config.low_voltage": "Tegangan Rendah",
  "config.idle_current_threshold": "Threshold Arus Idle",
  "config.full_charge_current_threshold": "Threshold Arus Full-Charge",
  "config.full_charge_persistence": "Persistensi Full-Charge",
  "config.telemetry_interval": "Interval Telemetri",
  "config.alarm_thresholds": "Threshold Alarm",
  "config.soc_params": "Parameter SOC",
  "config.alarm_thresholds_note": "Kebijakan alarm dua-tingkat dievaluasi langsung oleh perangkat (AnomalyDetector) — tersimpan di NVS, aktif tanpa reboot. Urutan tier divalidasi firmware (mis. low: critical < warn).",
  "config.alarm_unavailable": "Threshold alarm tidak tersedia di firmware ini (butuh readback alarmThresholds PARITY-4). Perbarui firmware perangkat untuk mengatur kebijakan alarm di sini.",
  "config.calibration_params": "Parameter Kalibrasi",
  "config.revision": "Revisi",
  "config.source": "Sumber",
  "config.checksum": "Checksum",
  "alarms.title": "Pusat Alarm",
  "alarms.subtitle": "Aktif / Diakui / Selesai + Riwayat",
  "alarms.active": "Aktif",
  "alarms.acknowledged": "Diakui",
  "alarms.cleared": "Selesai",
  "alarms.history": "Riwayat",
  "alarms.severity": "Severity",
  "alarms.lifecycle": "Lifecycle",
  "alarms.domain": "Domain",
  "alarms.raised_at": "Dibangkitkan",
  "alarms.acknowledged_at": "Diakui Pada",
  "alarms.cleared_at": "Selesai Pada",
  "alarms.acknowledge": "Ack",
  "alarms.no_alarms": "Tidak ada alarm aktif",
  "alarms.severity_info": "Info",
  "alarms.severity_warning": "Peringatan",
  "alarms.severity_critical": "Kritis",
  "alarms.filter_severity": "Filter Severity",
  "alarms.filter_domain": "Filter Domain",
  "diagnostics.title": "Diagnostik Sistem",
  "diagnostics.subtitle": "ESP32 health, network, storage, dan kalibrasi",
  "diagnostics.uptime": "Uptime",
  "diagnostics.free_heap": "RAM Bebas",
  "diagnostics.min_free_heap": "RAM Bebas Min",
  "diagnostics.wifi_rssi": "WiFi RSSI",
  "diagnostics.wifi_reconnect_count": "Jumlah Reconnect WiFi",
  "diagnostics.network_state": "Status Jaringan",
  "diagnostics.mqtt_state": "Status MQTT",
  "diagnostics.gas_state": "Status GAS API",
  "diagnostics.ntp_state": "Status NTP",
  "diagnostics.reset_reason": "Alasan Reset",
  "diagnostics.boot_count": "Jumlah Boot",
  "diagnostics.firmware_version": "Versi Firmware",
  "diagnostics.protocol_version": "Versi Protokol",
  "diagnostics.storage_state": "Status Storage",
  "diagnostics.spool_size": "Spool Size",
  "diagnostics.sensor_health": "Kesehatan Sensor",
  "diagnostics.calibration_versions": "Versi Kalibrasi",
  "sensors.title": "Kesehatan Sensor",
  "sensors.subtitle": "Status per-sensor: INA219, ADC, ACS712, SHT31",
  "sensors.ina219": "INA219 (Arus Baterai)",
  "sensors.battery_adc": "ADC (Tegangan Baterai)",
  "sensors.acs712": "ACS712 (Arus AC)",
  "sensors.sht31": "SHT31 (Suhu/Kelembapan)",
  "sensors.last_sample": "Sampel Terakhir",
  "sensors.status_online": "Online",
  "sensors.status_offline": "Offline",
  "sensors.status_error": "Error",
  "sensors.status_recovering": "Recovering",
  "events.title": "Log Event",
  "events.subtitle": "Boot, sync, sensor failure, alarm, kalibrasi, OTA, storage",
  "events.filter_type": "Filter Tipe",
  "events.empty": "Tidak ada event untuk filter ini",
  "reports.title": "Laporan",
  "reports.subtitle": "Harian / Mingguan / Bulanan / Custom — CSV / PDF / JSON",
  "reports.range_daily": "Harian",
  "reports.range_weekly": "Mingguan",
  "reports.range_monthly": "Bulanan",
  "reports.range_custom": "Custom",
  "reports.from": "Dari",
  "reports.to": "Sampai",
  "reports.export_csv": "Ekspor CSV",
  "reports.export_pdf": "Ekspor PDF",
  "reports.export_json": "Ekspor JSON",
  "reports.telemetry_completeness": "Kelengkapan Telemetri",
  "reports.device_availability": "Ketersediaan Perangkat",
  "reports.empty": "Tidak ada data untuk rentang ini",
  "ai.title": "Insight AI",
  "ai.subtitle": "Rekomendasi advisory — analisis baterai/energi/lingkungan",
  "ai.disclaimer": "AI hanya memberikan rekomendasi advisory. Tidak ada kontrol aktuator. Keputusan akhir tetap pada pengguna atau firmware.",
  "ai.pipeline": "Pipeline: PWA → ESP32 (HMAC proxy) → GAS → Gemini → ESP32 → PWA",
  "ai.advisory_only": "Advisory Only",
  "ai.category.battery": "Analisis Baterai",
  "ai.category.energy": "Analisis Energi",
  "ai.category.energy_anomaly": "Anomali Energi",
  "ai.category.maintenance": "Saran Maintenance",
  "ai.category.environment": "Peringatan Lingkungan",
  "ai.severity.info": "Info",
  "ai.severity.warning": "Peringatan",
  "ai.severity.critical": "Kritis",
  "ai.last_updated": "Diperbarui",
  "ai.mock_fallback": "Mock fallback — tunggu ESP32 online untuk insight asli",
  "ota.title": "Manajemen Firmware OTA",
  "ota.subtitle": "Update over-the-air dengan SHA-256 + Ed25519",
  "ota.current_version": "Versi Terpasang",
  "ota.latest_version": "Versi Terbaru",
  "ota.update_available": "Update Tersedia",
  "ota.up_to_date": "Sudah Terbaru",
  "ota.check_update": "Cek Update",
  "ota.upload_binary": "Upload Binary",
  "ota.uploading": "Mengunggah...",
  "ota.verifying": "Memverifikasi Signature...",
  "ota.installing": "Menginstal...",
  "ota.rollback": "Rollback",
  "ota.signature_verified": "Signature Terverifikasi",
  "ota.history": "Riwayat OTA",
  "ota.warning_stable_power": "Pastikan daya stabil selama OTA. Jangan matikan perangkat.",
  "settings.title": "Pengaturan",
  "settings.subtitle": "Konfigurasi, keamanan, backup, dan reset",
  "settings.timezone": "Zona Waktu",
  "settings.change_password": "Ganti Kata Sandi",
  "settings.current_password": "Kata Sandi Lama",
  "settings.new_password": "Kata Sandi Baru",
  "settings.confirm_password": "Konfirmasi Kata Sandi",
  "settings.backup_restore": "Backup & Restore",
  "settings.export_config": "Ekspor Konfigurasi",
  "settings.import_config": "Impor Konfigurasi",
  "settings.factory_reset": "Factory Reset",
  "settings.factory_reset_warning": "Tindakan ini akan menghapus seluruh konfigurasi dan kembali ke pengaturan pabrik. Tidak dapat dibatalkan.",
  "settings.factory_reset_prepare": "Siapkan Reset",
  "settings.factory_reset_confirm": "Konfirmasi Reset",
  "settings.factory_reset_token": "Token Reset",
  "settings.reboot": "Reboot Sistem",
  "toast.saved": "Perubahan disimpan",
  "toast.error": "Terjadi kesalahan",
  "toast.logout_success": "Berhasil keluar",
  "toast.password_changed": "Kata sandi berhasil diubah",
  "toast.config_exported": "Konfigurasi diekspor",
  "toast.config_imported": "Konfigurasi diimpor",
  "toast.factory_reset_done": "Factory reset berhasil. Sistem rebooting.",
  "toast.ota_started": "OTA update dimulai",
  "toast.ota_success": "OTA update berhasil",
  "toast.ota_failed": "OTA update gagal",
  "toast.rebooting": "Sistem melakukan reboot...",
  "toast.calibration_saved": "Kalibrasi disimpan",
  "toast.alarm_acked": "Alarm diakui",
  "toast.report_exported": "Laporan diekspor",
  "theme.light": "Mode Terang",
  "theme.dark": "Mode Gelap",
  "theme.system": "Ikuti Sistem",
  "theme.toggle": "Ganti Tema",
  "quality.VALID": "Valid",
  "quality.STALE": "Stale",
  "quality.INVALID": "Invalid",
  "quality.OUT_OF_RANGE": "Out of Range",
  "quality.SENSOR_ERROR": "Sensor Error",
  "quality.NOT_AVAILABLE": "Tidak Tersedia",
  "quality.ESTIMATED": "Estimasi",
  "quality.DERIVED": "Turunan",
  "quality.CALIBRATING": "Mengkalibrasi",
  "quality.SUSPECT": "Mencurigakan",
};

const en: Dict = {
  "app.name": "PLTS Monitor",
  "app.tagline": "48V LiFePO4 Solar Monitoring System",
  "nav.dashboard": "Dashboard",
  "nav.battery": "Battery",
  "nav.ac": "AC Current",
  "nav.environment": "Environment",
  "nav.energy": "Energy",
  "nav.calibration": "Calibration",
  "nav.config": "Configuration",
  "nav.alarms": "Alarms",
  "nav.diagnostics": "Diagnostics",
  "nav.sensors": "Sensors",
  "nav.events": "Events",
  "nav.reports": "Reports",
  "nav.ai": "AI Insights",
  "nav.settings": "Settings",
  "nav.ota": "Firmware OTA",
  "nav.fleet": "Fleet",
  "nav.emergency": "Emergency Control",
  "nav.relays": "Relay 8-CH",
  "emergency.title": "Emergency Control",
  "emergency.no_device": "No device registered yet. Open Settings and add the GAS URL + device token first.",
  "emergency.state_run": "SYSTEM RUN",
  "emergency.state_isolated": "ISOLATED",
  "emergency.state_unknown": "UNKNOWN",
  "emergency.trips": "Total trips",
  "emergency.last_reason": "Last reason",
  "emergency.estop_open": "Physical E-STOP line OPEN (button pressed or wiring fault)",
  "emergency.unknown_note": "Device firmware has not reported emergency-relay state (firmware < 1.6.0). Update the firmware to enable emergency control.",
  "emergency.arm": "ARM — Start System",
  "emergency.disarm": "EMERGENCY STOP",
  "emergency.disarm_confirm": "Confirm system shutdown: the emergency relay will drop and the WHOLE system (PV, battery, genset, AC) is isolated from the inverter.",
  "emergency.disarm_go": "STOP SYSTEM",
  "emergency.disarm_warning": "The device executes within ±15 s. Restart only via ARM once conditions are safe again.",
  "emergency.type_stop": "Type STOP",
  "emergency.no_admin_token": "Admin Token not set in Settings — ARM/DISARM cannot be sent (fail-closed).",
  "emergency.cmd_queued": "Command queued",
  "emergency.cmd_failed": "Command failed",
  "emergency.cmd_latency_note": "device executes within ±15 s, then ACKs.",
  "emergency.flow_title": "Energy Flow",
  "emergency.flow_aria": "PLTS energy flow diagram",
  "emergency.node_pv": "Solar",
  "emergency.node_battery": "Battery",
  "emergency.node_genset": "Genset",
  "emergency.node_inverter": "Inverter",
  "emergency.node_load": "Load",
  "emergency.config_title": "Emergency Trigger Thresholds (all sensors)",
  "emergency.config_note": "Values are sent to the device and persisted in LittleFS. Ranges are validated on three layers (PWA, GAS, firmware). debounceN = consecutive readings before a trip; recoverySec = minimum quiet time before ARM is allowed.",
  "emergency.config_send": "Send Configuration",
  "emergency.config_reset": "Reset Defaults",
  "emergency.cfg_vbatLowV": "VBAT low (V)",
  "emergency.cfg_vbatLowHystV": "Low hysteresis (V)",
  "emergency.cfg_vbatHighV": "VBAT high (V)",
  "emergency.cfg_vbatHighHystV": "High hysteresis (V)",
  "emergency.cfg_iDcOverA": "Max DC current (A)",
  "emergency.cfg_iAcLoadOverA": "Max load current (A)",
  "emergency.cfg_iAcGenOverA": "Max genset current (A)",
  "emergency.cfg_iAcGenOverA_hint": "RESERVED channel — no genset sensor installed on this hardware revision (i_ac_gen reads null/NOT_AVAILABLE).",
  "emergency.cfg_debounceN": "Debounce (readings)",
  "emergency.cfg_recoverySec": "Recovery window (s)",
  "emergency.cfg_relayPin": "Relay pin (GPIO)",
  "emergency.cfg_estopPin": "E-stop sense pin",
  "emergency.cfg_estopEnabled": "E-stop enabled (1/0)",
  "emergency.cfg_sensorFailPolicy": "Sensor-fail policy (1/0)",
  "emergency.cfg_sensorFailPolicy_hint": "1 = fail-closed (default): current sensors must be healthy — a lost sensor blocks ARM and trips a running system with SENSOR_LOSS. 0 = operator opt-out (bench/commissioning only, unsafe in production).",
  "emergency.log_title": "Emergency Event History",
  "emergency.log_empty": "No emergency events recorded yet.",
  "emergency.acs_gen_title": "Genset → Inverter Current",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.apply": "Apply",
  "common.refresh": "Refresh",
  "common.loading": "Loading...",
  "common.online": "Online",
  "common.offline": "Offline",
  "common.mock_mode": "Demo Mode (Mock)",
  "common.live_mode": "Live Mode",
  "common.simulation_mode": "SIMULATION MODE",
  "common.simulation_banner": "SIMULATION MODE — displayed data is not real telemetry. For development only.",
  "common.no_data": "No Data",
  "common.no_data_banner": "NO DATA — no real telemetry available. Check the device / connection.",
  "common.delayed": "Delayed",
  "common.offline_banner": "DEVICE OFFLINE — showing last known values (not live).",
  "common.stale_banner": "TELEMETRY STALE — data is more than 60 seconds old. Not real-time.",
  "common.telemetry_age": "Telemetry age",
  "common.export": "Export",
  "common.import": "Import",
  "common.close": "Close",
  "common.all": "All",
  "common.yes": "Yes",
  "common.no": "No",
  "common.measured": "Measured",
  "common.derived": "Derived",
  "common.estimated": "Estimated",
  "common.na": "N/A",
  "common.fresh": "Fresh",
  "common.stale": "Stale",
  "common.last_seen": "Last seen",
  "common.unavailable": "Unavailable",
  "common.unknown": "Unknown",
  "login.title": "Sign In to Dashboard",
  "login.subtitle": "48V LiFePO4 PLTS Monitoring System",
  "login.username": "Username",
  "login.password": "Password",
  "login.submit": "Sign In",
  "login.error_invalid": "Invalid username or password",
  "login.demo_creds": "Demo credentials: admin / admin123",
  "dashboard.title": "System Dashboard",
  "dashboard.subtitle": "Real-time status of the 48V LiFePO4 PLTS",
  "dashboard.system_health": "System Health",
  "dashboard.battery": "Battery",
  "dashboard.ac_current": "AC Current",
  "dashboard.temperature": "Temperature",
  "dashboard.humidity": "Humidity",
  "dashboard.active_alarms": "Active Alarms",
  "dashboard.telemetry_freshness": "Telemetry Freshness",
  "dashboard.uptime": "Uptime",
  "dashboard.free_heap": "Free Heap",
  "dashboard.wifi_rssi": "WiFi Signal",
  "dashboard.current_time": "Current Time",
  "dashboard.charge_state": "Charging",
  "dashboard.discharge_state": "Discharging",
  "dashboard.idle_state": "Idle",
  "dashboard.soc": "SOC",
  "dashboard.remaining_ah": "Remaining Ah",
  "dashboard.runtime_estimation": "Runtime Estimate",
  "dashboard.healthy": "Healthy",
  "dashboard.warning": "Warning",
  "dashboard.degraded": "Degraded",
  "dashboard.failed": "Failed",
  "battery.title": "48V LiFePO4 Battery",
  "battery.subtitle": "Voltage, current, power, SOC, and cycle detail",
  "battery.voltage": "Voltage",
  "battery.current": "Current",
  "battery.power": "Power",
  "battery.direction": "Current Direction",
  "battery.soc": "SOC",
  "battery.remaining_ah": "Remaining Capacity",
  "battery.charge_ah": "Total Charge (Ah)",
  "battery.discharge_ah": "Total Discharge (Ah)",
  "battery.charge_wh": "Total Charge (Wh)",
  "battery.discharge_wh": "Total Discharge (Wh)",
  "battery.net_wh": "Net Energy (Wh)",
  "battery.net_ah": "Net Current (Ah)",
  "battery.efc": "Equivalent Full Cycles",
  "battery.estimated_usable_capacity": "Estimated Usable Capacity",
  "battery.peak_charge_current": "Peak Charge Current",
  "battery.peak_discharge_current": "Peak Discharge Current",
  "battery.charging": "Charging",
  "battery.discharging": "Discharging",
  "battery.idle": "Idle",
  "battery.coulomb_counting": "Coulomb Counting",
  "battery.voltage_sync": "Voltage Sync",
  "battery.full_charge_detected": "Full Charge Detected",
  "battery.synchronized": "Synchronized",
  "battery.estimated": "Estimated",
  "battery.last_sync": "Last Sync",
  "battery.confidence": "Confidence",
  "battery.confidence_high": "High",
  "battery.confidence_medium": "Medium",
  "battery.confidence_low": "Low",
  "battery.confidence_baseline_aging": "Baseline Aging",
  "battery.time_range_1h": "1 Hour",
  "battery.time_range_6h": "6 Hours",
  "battery.time_range_12h": "12 Hours",
  "battery.time_range_24h": "24 Hours",
  "battery.time_range_7d": "7 Days",
  "battery.time_range_30d": "30 Days",
  "battery.bms.title": "External Battery (BMS)",
  "battery.bms.description": "Data read directly from the battery BMS over CAN / Modbus — never fabricated",
  "battery.bms.voltage": "BMS Voltage",
  "battery.bms.current": "BMS Current",
  "battery.bms.soh": "SOH",
  "battery.bms.temperature": "BMS Temperature",
  "battery.bms.cell_min": "Cell Min",
  "battery.bms.cell_max": "Cell Max",
  "battery.bms.cell_delta": "Cell Delta",
  "battery.bms.cell_count": "Cell Count",
  "battery.bms.cycle_count": "Cycles",
  "battery.bms.charge_limit": "Charge Current Limit",
  "battery.bms.discharge_limit": "Discharge Current Limit",
  "battery.bms.mismatch": "Mismatch vs Shunt",
  "battery.bms.fault": "Fault",
  "battery.bms.not_authoritative": "BMS not active — SOC comes from the INA219 shunt estimate (provenance SHUNT_COULOMB).",
  "settings.bms.title": "BMS / Inverter Communication",
  "settings.bms.description": "External battery protocol (CAN, Modbus RTU, Modbus TCP). Without a BMS the system automatically uses the INA219 shunt + ACS712.",
  "settings.bms.protocol": "Protocol",
  "settings.bms.protocol_auto": "Auto-detect (recommended)",
  "settings.bms.protocol_none": "Disabled (shunt only)",
  "settings.bms.protocol_pylontech_can": "Pylontech CAN (500 kbps)",
  "settings.bms.protocol_modbus_rtu": "Modbus RTU (RS485)",
  "settings.bms.protocol_modbus_tcp": "Modbus TCP",
  "settings.bms.poll_interval": "Poll Interval (ms)",
  "settings.bms.slave_id": "Modbus Slave ID",
  "settings.bms.tcp_host": "Modbus TCP Host",
  "settings.bms.tcp_port": "Modbus TCP Port",
  "settings.bms.save": "Save BMS Configuration",
  "settings.bms.saved": "BMS configuration saved",
  "settings.bms.provenance_note": "The SOC source is always shown: BMS direct > shunt coulomb > OCV. Transitions are recorded in the device log.",
  "ac.title": "AC Output Current",
  "ac.subtitle": "ACS712 measurement — RMS, peak, average, and estimated power",
  "ac.rms_current": "RMS Current",
  "ac.peak_current": "Peak Current",
  "ac.average_current": "Average Current",
  "ac.estimated_power": "Estimated AC Power",
  "ac.estimated_power_disclaimer": "AC power is estimated from measured current with assumed voltage and power factor — not a direct measurement.",
  "ac.signal_quality": "Signal Quality",
  "ac.signal_quality_good": "Good",
  "ac.signal_quality_degraded": "Degraded",
  "ac.signal_quality_poor": "Poor",
  "ac.signal_quality_invalid": "Invalid",
  "ac.assumed_voltage": "Assumed Voltage",
  "ac.assumed_power_factor": "Assumed Power Factor",
  "ac.meter_title": "Real AC Meter — PZEM-004T",
  "ac.meter_power": "Measured Power",
  "ac.meter_voltage": "Measured Voltage",
  "ac.meter_frequency": "Frequency",
  "ac.meter_power_factor": "Measured Power Factor",
  "ac.meter_energy": "Cumulative Energy",
  "ac.meter_note": "Active power measured directly — not an estimate.",
  "ac.meter_disconnected": "PZEM meter present in firmware but not responding — measured power unavailable; the ACS712 estimate remains in use.",
  "environment.title": "Environment",
  "environment.subtitle": "Ambient / enclosure temperature and humidity",
  "environment.temperature": "Ambient Temperature",
  "environment.humidity": "Humidity",
  "environment.dew_point": "Dew Point",
  "environment.condensation_risk": "Condensation Risk",
  "environment.condensation_risk_warning": "High condensation risk — dew point is close to surface temperature.",
  "environment.ambient_label": "Ambient / Enclosure Temperature",
  "energy.title": "Energy Analytics",
  "energy.subtitle": "Charge/discharge/net + Ah + EFC",
  "energy.charge_wh": "Charge Energy",
  "energy.discharge_wh": "Discharge Energy",
  "energy.net_wh": "Net Energy",
  "energy.charge_ah": "Charge (Ah)",
  "energy.discharge_ah": "Discharge (Ah)",
  "energy.efc": "Equivalent Full Cycles",
  "energy.daily": "Daily",
  "energy.weekly": "Weekly",
  "energy.monthly": "Monthly",
  "energy.custom": "Custom",
  "energy.today": "Today",
  "energy.yesterday": "Yesterday",
  "calibration.title": "Calibration Center",
  "calibration.subtitle": "Voltage 3-point, ACS712 zero, SHT31 offset",
  "calibration.voltage_3_point": "3-Point Voltage Calibration",
  "calibration.voltage_low": "Low Voltage (~45V)",
  "calibration.voltage_nominal": "Nominal Voltage (~51V)",
  "calibration.voltage_full": "Full Voltage (~54V)",
  "calibration.acs712_zero": "ACS712 Zero-Calibration",
  "calibration.sht31_offset": "SHT31 Offset",
  "calibration.reference": "Reference",
  "calibration.raw": "Raw ADC",
  "calibration.corrected": "Corrected",
  "calibration.error_before": "Error Before",
  "calibration.error_after": "Error After",
  "calibration.version": "Calibration Version",
  "calibration.timestamp": "Calibration Timestamp",
  "calibration.source": "Source",
  "calibration.confirm": "Confirm Procedure",
  "calibration.operator_confirm": "Operator must explicitly confirm each calibration change.",
  "config.title": "Configuration Center",
  "config.subtitle": "All parameters with versioning",
  "config.device_name": "Device Name",
  "config.site_name": "Site Name",
  "config.timezone": "Timezone",
  "config.battery_capacity": "Battery Capacity (Ah)",
  "config.nominal_voltage": "Nominal Voltage",
  "config.full_voltage": "Full Voltage",
  "config.low_voltage": "Low Voltage",
  "config.idle_current_threshold": "Idle Current Threshold",
  "config.full_charge_current_threshold": "Full-Charge Current Threshold",
  "config.full_charge_persistence": "Full-Charge Persistence",
  "config.telemetry_interval": "Telemetry Interval",
  "config.alarm_thresholds": "Alarm Thresholds",
  "config.soc_params": "SOC Parameters",
  "config.alarm_thresholds_note": "Two-tier alarm policy evaluated live by the device (AnomalyDetector) — persisted in NVS, applied without reboot. Warn/Critical tier order is validated by the firmware (e.g. low: critical < warn).",
  "config.alarm_unavailable": "Alarm thresholds are not available on this firmware (requires the PARITY-4 alarmThresholds readback). Update the device firmware to configure the alarm policy here.",
  "config.calibration_params": "Calibration Parameters",
  "config.revision": "Revision",
  "config.source": "Source",
  "config.checksum": "Checksum",
  "alarms.title": "Alarm Center",
  "alarms.subtitle": "Active / Acknowledged / Cleared + History",
  "alarms.active": "Active",
  "alarms.acknowledged": "Acknowledged",
  "alarms.cleared": "Cleared",
  "alarms.history": "History",
  "alarms.severity": "Severity",
  "alarms.lifecycle": "Lifecycle",
  "alarms.domain": "Domain",
  "alarms.raised_at": "Raised At",
  "alarms.acknowledged_at": "Acknowledged At",
  "alarms.cleared_at": "Cleared At",
  "alarms.acknowledge": "Ack",
  "alarms.no_alarms": "No active alarms",
  "alarms.severity_info": "Info",
  "alarms.severity_warning": "Warning",
  "alarms.severity_critical": "Critical",
  "alarms.filter_severity": "Filter Severity",
  "alarms.filter_domain": "Filter Domain",
  "diagnostics.title": "System Diagnostics",
  "diagnostics.subtitle": "ESP32 health, network, storage, and calibration",
  "diagnostics.uptime": "Uptime",
  "diagnostics.free_heap": "Free Heap",
  "diagnostics.min_free_heap": "Min Free Heap",
  "diagnostics.wifi_rssi": "WiFi RSSI",
  "diagnostics.wifi_reconnect_count": "WiFi Reconnects",
  "diagnostics.network_state": "Network State",
  "diagnostics.mqtt_state": "MQTT State",
  "diagnostics.gas_state": "GAS API State",
  "diagnostics.ntp_state": "NTP State",
  "diagnostics.reset_reason": "Reset Reason",
  "diagnostics.boot_count": "Boot Count",
  "diagnostics.firmware_version": "Firmware Version",
  "diagnostics.protocol_version": "Protocol Version",
  "diagnostics.storage_state": "Storage State",
  "diagnostics.spool_size": "Spool Size",
  "diagnostics.sensor_health": "Sensor Health",
  "diagnostics.calibration_versions": "Calibration Versions",
  "sensors.title": "Sensor Health",
  "sensors.subtitle": "Per-sensor status: INA219, ADC, ACS712, SHT31",
  "sensors.ina219": "INA219 (Battery Current)",
  "sensors.battery_adc": "ADC (Battery Voltage)",
  "sensors.acs712": "ACS712 (AC Current)",
  "sensors.sht31": "SHT31 (Temp/Humidity)",
  "sensors.last_sample": "Last Sample",
  "sensors.status_online": "Online",
  "sensors.status_offline": "Offline",
  "sensors.status_error": "Error",
  "sensors.status_recovering": "Recovering",
  "events.title": "Event Log",
  "events.subtitle": "Boot, sync, sensor failure, alarm, calibration, OTA, storage",
  "events.filter_type": "Filter Type",
  "events.empty": "No events match this filter",
  "reports.title": "Reports",
  "reports.subtitle": "Daily / Weekly / Monthly / Custom — CSV / PDF / JSON",
  "reports.range_daily": "Daily",
  "reports.range_weekly": "Weekly",
  "reports.range_monthly": "Monthly",
  "reports.range_custom": "Custom",
  "reports.from": "From",
  "reports.to": "To",
  "reports.export_csv": "Export CSV",
  "reports.export_pdf": "Export PDF",
  "reports.export_json": "Export JSON",
  "reports.telemetry_completeness": "Telemetry Completeness",
  "reports.device_availability": "Device Availability",
  "reports.empty": "No data for this range",
  "ai.title": "AI Insights",
  "ai.subtitle": "Advisory recommendations — battery/energy/environment analysis",
  "ai.disclaimer": "AI provides advisory recommendations only. There is no actuator control. Final decisions remain with the user or firmware.",
  "ai.pipeline": "Pipeline: PWA → ESP32 (HMAC proxy) → GAS → Gemini → ESP32 → PWA",
  "ai.advisory_only": "Advisory Only",
  "ai.category.battery": "Battery Analysis",
  "ai.category.energy": "Energy Analysis",
  "ai.category.energy_anomaly": "Energy Anomaly",
  "ai.category.maintenance": "Maintenance Suggestion",
  "ai.category.environment": "Environment Alert",
  "ai.severity.info": "Info",
  "ai.severity.warning": "Warning",
  "ai.severity.critical": "Critical",
  "ai.last_updated": "Updated",
  "ai.mock_fallback": "Mock fallback — wait for ESP32 online for real insights",
  "ota.title": "Firmware OTA Management",
  "ota.subtitle": "Over-the-air updates with SHA-256 + Ed25519",
  "ota.current_version": "Installed Version",
  "ota.latest_version": "Latest Version",
  "ota.update_available": "Update Available",
  "ota.up_to_date": "Up to Date",
  "ota.check_update": "Check for Updates",
  "ota.upload_binary": "Upload Binary",
  "ota.uploading": "Uploading...",
  "ota.verifying": "Verifying Signature...",
  "ota.installing": "Installing...",
  "ota.rollback": "Rollback",
  "ota.signature_verified": "Signature Verified",
  "ota.history": "OTA History",
  "ota.warning_stable_power": "Ensure stable power during OTA. Do not turn off the device.",
  "settings.title": "Settings",
  "settings.subtitle": "Configuration, security, backup, and reset",
  "settings.timezone": "Timezone",
  "settings.change_password": "Change Password",
  "settings.current_password": "Current Password",
  "settings.new_password": "New Password",
  "settings.confirm_password": "Confirm Password",
  "settings.backup_restore": "Backup & Restore",
  "settings.export_config": "Export Config",
  "settings.import_config": "Import Config",
  "settings.factory_reset": "Factory Reset",
  "settings.factory_reset_warning": "This action will erase all configuration and restore factory settings. Cannot be undone.",
  "settings.factory_reset_prepare": "Prepare Reset",
  "settings.factory_reset_confirm": "Confirm Reset",
  "settings.factory_reset_token": "Reset Token",
  "settings.reboot": "Reboot System",
  "toast.saved": "Changes saved",
  "toast.error": "An error occurred",
  "toast.logout_success": "Logged out successfully",
  "toast.password_changed": "Password changed successfully",
  "toast.config_exported": "Configuration exported",
  "toast.config_imported": "Configuration imported",
  "toast.factory_reset_done": "Factory reset complete. System rebooting.",
  "toast.ota_started": "OTA update started",
  "toast.ota_success": "OTA update successful",
  "toast.ota_failed": "OTA update failed",
  "toast.rebooting": "System rebooting...",
  "toast.calibration_saved": "Calibration saved",
  "toast.alarm_acked": "Alarm acknowledged",
  "toast.report_exported": "Report exported",
  "theme.light": "Light Mode",
  "theme.dark": "Dark Mode",
  "theme.system": "System",
  "theme.toggle": "Toggle Theme",
  "quality.VALID": "Valid",
  "quality.STALE": "Stale",
  "quality.INVALID": "Invalid",
  "quality.OUT_OF_RANGE": "Out of Range",
  "quality.SENSOR_ERROR": "Sensor Error",
  "quality.NOT_AVAILABLE": "Not Available",
  "quality.ESTIMATED": "Estimated",
  "quality.DERIVED": "Derived",
  "quality.CALIBRATING": "Calibrating",
  "quality.SUSPECT": "Suspect",
};

export const translations: Record<Language, Dict> = { id, en };

export function detectLanguage(): Language {
  if (typeof navigator === "undefined") return "id";
  const lang = navigator.language.toLowerCase();
  return lang.startsWith("id") ? "id" : "en";
}
