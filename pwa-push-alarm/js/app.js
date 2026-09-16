/*
 * app.js - Logika UI dashboard MonitorIoT.
 * ------------------------------------------------------------------
 * Prinsip keamanan:
 *  - SEMUA data yang dirender melalui textContent / createElement,
 *    TIDAK PERNAH innerHTML (anti-XSS).
 *  - Tidak ada data sensor yang dipercaya secara buta: nilai numerik
 *    divalidasi/dibatasi sebelum ditampilkan.
 */
'use strict';

(function () {
  /* ---------------------------------------------------------------- */
  /* State                                                             */
  /* ---------------------------------------------------------------- */
  const state = {
    pushManager: null,
    pollTimer: null,
    consecutiveFailures: 0,
    lastUpdated: null,
    connectionBannerShown: false
  };

  /* ---------------------------------------------------------------- */
  /* Inisialisasi                                                      */
  /* ---------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', () => {
    registerServiceWorker();
    initPushUI();
    loadSensorData();
    startPolling();
    bindConnectionEvents();
    handleDeepLink();
  });

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((reg) => {
        // Deteksi update versi baru -> aktifkan tanpa menunggu.
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              showBanner('Versi baru tersedia. Memperbarui aplikasi...');
              sw.postMessage('SKIP_WAITING');
            }
          });
        });
        registerPeriodicSync(reg);
        // [SELF-AUDIT 2026-09-16] Kirim kredensial perangkat (kontrak GAS
        // K-7) ke SW aktif — resubscribe() latar belakang membutuhkannya.
        // Best-effort: SW belum aktif -> dilewati; dikirim ulang saat
        // halaman dibuka berikutnya.
        sendDeviceCredentialsToSw();
      })
      .catch((err) => {
        // SW gagal -> PWA jadi aplikasi biasa; alarm push tidak tersedia.
        showBanner('Service worker gagal dimuat: ' + err.message, true);
      });
  }

  /**
   * [SELF-AUDIT 2026-09-16] Dorong kredensial perangkat (localStorage
   * 'push.deviceId' / 'push.deviceToken', fallback APP_CONFIG.DEVICE_ID /
   * DEVICE_TOKEN) ke service worker aktif. SW tidak bisa membaca localStorage
   * sendiri; kredensial disimpan SW hanya di memori (tidak dipersist).
   */
  function sendDeviceCredentialsToSw() {
    try {
      var deviceId = (localStorage.getItem('push.deviceId') || '').trim();
      var deviceToken = (localStorage.getItem('push.deviceToken') || '').trim();
      if (!deviceId && typeof APP_CONFIG !== 'undefined' && APP_CONFIG.DEVICE_ID) {
        deviceId = String(APP_CONFIG.DEVICE_ID).trim();
      }
      if (!deviceToken && typeof APP_CONFIG !== 'undefined' && APP_CONFIG.DEVICE_TOKEN) {
        deviceToken = String(APP_CONFIG.DEVICE_TOKEN).trim();
      }
      var target = navigator.serviceWorker.controller;
      if (!target) return; // SW belum mengendalikan halaman — coba load berikutnya
      target.postMessage({
        type: 'PLTS_PUSH_ALARM_DEVICE_CREDENTIALS',
        credentials: (deviceId && deviceToken)
          ? { deviceId: deviceId, token: deviceToken }
          : null
      });
    } catch (e) { /* best-effort */ }
  }

  /**
   * Periodic Background Sync (Chrome/Edge): menyegarkan data secara
   * berkala di latar belakang sehingga alarm yang terlewat saat offline
   * tetap tampil saat aplikasi dibuka. Diabaikan dengan aman di browser
   * yang tidak mendukung (Safari/Firefox).
   */
  function registerPeriodicSync(reg) {
    if (!('periodicSync' in reg)) return;
    try {
      navigator.permissions.query({ name: 'periodic-background-sync' })
        .then((status) => {
          if (status.state === 'granted') {
            reg.periodicSync
              .register('miot-refresh', { minInterval: 12 * 60 * 60 * 1000 })
              .catch(() => { /* kuota/izin ditolak: abaikan */ });
          }
        })
        .catch(() => { /* API izin tidak ada: abaikan */ });
    } catch (e) { /* lama: abaikan */ }
  }

  /* ---------------------------------------------------------------- */
  /* Data sensor dari GAS                                              */
  /* ---------------------------------------------------------------- */

  async function loadSensorData() {
    const url = APP_CONFIG.API_BASE +
      '?action=snapshot&t=' + Date.now(); // cache-buster
    try {
      const res = await fetchWithTimeout(url, APP_CONFIG.FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data || data.ok === false) throw new Error((data && data.message) || 'Respons tidak valid');
      renderSnapshot(data);
      state.consecutiveFailures = 0;
      state.lastUpdated = new Date();
      setConnectionStatus('online');
      hideBanner();
    } catch (err) {
      state.consecutiveFailures++;
      if (state.consecutiveFailures >= APP_CONFIG.CONNECTION_BANNER_AFTER_FAILURES) {
        setConnectionStatus('offline');
        showBanner('Tidak dapat menghubungi server. Menampilkan data terakhir yang tersedia.', true);
      }
    } finally {
      updateTimestampLabel();
    }
  }

  function renderSnapshot(data) {
    const grid = document.getElementById('sensor-grid');
    if (!grid) return;
    const sensors = Array.isArray(data.sensors) ? data.sensors.slice(0, 24) : [];
    grid.textContent = '';
    if (sensors.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Belum ada data sensor dari firmware.';
      grid.appendChild(empty);
      return;
    }
    sensors.forEach((s) => grid.appendChild(buildSensorCard(s)));

    renderAlarms(data.alarms || []);
  }

  function buildSensorCard(s) {
    const card = document.createElement('article');
    card.className = 'sensor-card' + (s.alarm ? ' sensor-card--alarm' : '');

    const name = document.createElement('h3');
    name.textContent = String(s.name || 'Sensor').slice(0, 40);
    card.appendChild(name);

    const value = document.createElement('p');
    value.className = 'sensor-value';
    // null/undefined (sensor gagal dibaca) TIDAK boleh jadi 0.0
    // karena Number(null) === 0 (temuan X-3 audit silang) -> NaN -> '--'.
    const raw = s.value;
    const num = (raw === null || raw === undefined || raw === '') ? NaN : Number(raw);
    value.textContent = (Number.isFinite(num) ? num.toFixed(1) : '--') + ' ' +
      String(s.unit || '').slice(0, 8);
    card.appendChild(value);

    const status = document.createElement('p');
    status.className = 'sensor-status';
    status.textContent = s.alarm ? 'ALARM: ' + String(s.status || 'ambang terlampaui').slice(0, 60) : 'Normal';
    card.appendChild(status);

    return card;
  }

  function renderAlarms(alarms) {
    const list = document.getElementById('alarm-list');
    if (!list) return;
    const items = Array.isArray(alarms) ? alarms.slice(0, 20) : [];
    list.textContent = '';
    if (items.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'Tidak ada alarm aktif.';
      li.className = 'alarm-item alarm-item--none';
      list.appendChild(li);
      return;
    }
    items.forEach((a) => {
      const li = document.createElement('li');
      li.className = 'alarm-item alarm-item--' + (a.severity || 'info');
      const title = document.createElement('strong');
      title.textContent = String(a.title || 'Alarm').slice(0, 60);
      const body = document.createElement('span');
      body.textContent = ' ' + String(a.body || '').slice(0, 120);
      li.appendChild(title);
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(loadSensorData, APP_CONFIG.POLL_INTERVAL_MS);
    // Berhenti polling saat tab tersembunyi (hemat baterai/kuota).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        loadSensorData();
        startPolling();
      } else if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* UI Notifikasi Push                                                */
  /* ---------------------------------------------------------------- */

  function initPushUI() {
    const btnEnable = document.getElementById('btn-enable-push');
    const btnDisable = document.getElementById('btn-disable-push');
    const statusEl = document.getElementById('push-status');

    state.pushManager = new AlarmPushManager(
      APP_CONFIG.API_BASE, APP_CONFIG.VAPID_PUBLIC_KEY);

    if (!btnEnable || !btnDisable || !statusEl) return;

    // Izin notifikasi HANYA boleh diminta dari gestur klik,
    // bukan otomatis saat halaman dibuka.
    btnEnable.addEventListener('click', async () => {
      btnEnable.disabled = true;
      setPushStatus('Meminta izin & membuat langganan...');
      const r = await state.pushManager.enable();
      btnEnable.disabled = false;
      setPushStatus(r.message, !r.ok);
      refreshPushButtons();
      if (r.ok && r.state === 'enabled') {
        // Uji kirim (opsional) memastikan jalur GAS->push service hidup.
        requestTestPush();
      }
    });

    btnDisable.addEventListener('click', async () => {
      btnDisable.disabled = true;
      setPushStatus('Menonaktifkan langganan...');
      const r = await state.pushManager.disable();
      btnDisable.disabled = false;
      setPushStatus(r.message, !r.ok);
      refreshPushButtons();
    });

    refreshPushButtons();
    // Update tombol bila pengguna mengubah izin dari pengaturan browser.
    if (typeof PermissionObserver !== 'undefined') { /* future API guard */ }
    document.addEventListener('visibilitychange', refreshPushButtons);
  }

  async function refreshPushButtons() {
    const btnEnable = document.getElementById('btn-enable-push');
    const btnDisable = document.getElementById('btn-disable-push');
    const hint = document.getElementById('push-hint');
    if (!btnEnable || !btnDisable || !state.pushManager) return;

    const st = await state.pushManager.getState();

    if (!st.supported) {
      btnEnable.disabled = true;
      btnDisable.disabled = true;
      if (hint) hint.textContent =
        'Browser/Perangkat ini belum mendukung Web Push. ' +
        'Safari iOS memerlukan iOS 16.4+ dan PWA dipasang ke Layar Utama.';
      return;
    }

    if (st.permission === 'denied') {
      btnEnable.disabled = true;
      btnDisable.disabled = true;
      if (hint) hint.textContent =
        'Izin notifikasi diblokir. Ubah lewat ikon gembok di address bar -> Izin -> Notifikasi -> Izinkan.';
      setPushStatus('Izin notifikasi diblokir.', true);
      return;
    }

    btnEnable.disabled = st.subscribed || st.permission === 'denied';
    btnDisable.disabled = !st.subscribed;

    if (st.subscribed) {
      setPushStatus('Notifikasi alarm AKTIF di perangkat ini (' +
        (st.endpointHost || 'push service') + ').');
    } else if (st.permission === 'default') {
      setPushStatus('Tekan tombol di atas untuk mengaktifkan alarm push.');
    }
  }

  function setPushStatus(message, isError) {
    const el = document.getElementById('push-status');
    if (!el) return;
    el.textContent = message;
    el.className = 'push-status' + (isError ? ' push-status--error' : '');
  }

  async function requestTestPush() {
    try {
      await fetchWithTimeout(
        APP_CONFIG.API_BASE + '?action=testPush', APP_CONFIG.FETCH_TIMEOUT_MS);
    } catch (e) { /* best effort; status tetap sukses */ }
  }

  /* ---------------------------------------------------------------- */
  /* Util                                                              */
  /* ---------------------------------------------------------------- */

  async function fetchWithTimeout(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: ctrl.signal, credentials: 'omit' });
    } finally {
      clearTimeout(timer);
    }
  }

  function setConnectionStatus(status) {
    const dot = document.getElementById('conn-dot');
    const label = document.getElementById('conn-label');
    if (dot) dot.className = 'conn-dot conn-dot--' + status;
    if (label) label.textContent = status === 'online' ? 'Terhubung' : 'Terputus';
  }

  function updateTimestampLabel() {
    const el = document.getElementById('last-updated');
    if (el && state.lastUpdated) {
      el.textContent = 'Diperbarui ' +
        state.lastUpdated.toLocaleTimeString('id-ID');
    }
  }

  function showBanner(message, isError) {
    const banner = document.getElementById('banner');
    if (!banner) return;
    banner.textContent = message;
    banner.className = 'banner banner--visible' + (isError ? ' banner--error' : '');
    state.connectionBannerShown = true;
  }

  function hideBanner() {
    const banner = document.getElementById('banner');
    if (banner && !banner.textContent.startsWith('Versi baru')) {
      banner.className = 'banner';
      banner.textContent = '';
    }
  }

  function bindConnectionEvents() {
    window.addEventListener('online', () => { setConnectionStatus('online'); loadSensorData(); });
    window.addEventListener('offline', () => setConnectionStatus('offline'));
    setConnectionStatus(navigator.onLine ? 'online' : 'offline');
  }

  function handleDeepLink() {
    // Dukung ?section=alarms dari shortcut PWA / notifikasi.
    const params = new URLSearchParams(location.search);
    if (params.get('section') === 'alarms' || params.get('from') === 'push') {
      const alarmsSection = document.getElementById('section-alarms');
      if (alarmsSection) alarmsSection.scrollIntoView({ behavior: 'smooth' });
    }
  }
})();
