/* =========================================================
   cloud-sync.js — المزامنة السحابية المجانية (Supabase REST)
   + نظام تعدد المشرفين (كابتن / مشرف) + العمل بدون إنترنت (Offline-First)
   ========================================================= */
(function () {
  'use strict';

  const CONFIG_KEY = 'pg_cloud_sync_config_v1';
  const ROLE_KEY = 'pg_device_role_v1';
  const DIRTY_KEY = 'pg_cloud_dirty_keys_v1';

  const SYNCED_KEYS = [
    'power_gym_players_v1',
    'power_gym_finance_ledger_v2',
    'power_gym_profile_v2',
    'power_gym_audit_v1',
    'pg_attendance_v1',
    'pg_inventory_v1',
    'pg_sales_v1',
    'pg_trainers_v1',
    'pg_daily_closes_v1',
    'pg_whatsapp_sent_v1',
    'pg_crowd_status_v1',
    'pg_freezes_v1',
    'pg_wa_templates_v1',
    'pg_ops_settings_v1'
  ];

  const ARRAY_MERGE_KEYS = new Set([
    'pg_freezes_v1',
    'power_gym_players_v1',
    'power_gym_audit_v1',
    'pg_attendance_v1',
    'pg_inventory_v1',
    'pg_sales_v1',
    'pg_trainers_v1',
    'pg_daily_closes_v1'
  ]);

  const DEFAULT_CONFIG = {
    enabled: true,
    supabaseUrl: 'https://bpwjdjkqcfxerizrssbs.supabase.co',
    supabaseAnonKey: 'sb_publishable_GwS8ghvuEC6cCFb4GJ0j5Q_NBpXAgKO',
    gymId: 'powergym-main',
    syncSecret: 'aff212db9e4d8564e1e63ba328fa4867',
    lastSyncAt: ''
  };

  const DEFAULT_ROLE = {
    role: 'captain', // 'captain' | 'supervisor'
    supervisorName: 'الكابتن',
    captainPin: ''
  };

  let rawLS = window.localStorage;
  let isApplyingRemote = false;
  let pushTimer = null;
  let pollTimer = null;
  let syncInFlight = false;
  let remoteTimestamps = {};

  function safeJsonParse(str, fallback) {
    try {
      const v = JSON.parse(str);
      return v === null || v === undefined ? fallback : v;
    } catch {
      return fallback;
    }
  }

  // إعدادات السحابة مثبتة في الكود ولا يغيّرها الكابتن؛ المبرمج فقط عبر وضع المطوّر
  const FIXED_CONFIG = {
    enabled: true,
    supabaseUrl: DEFAULT_CONFIG.supabaseUrl,
    supabaseAnonKey: DEFAULT_CONFIG.supabaseAnonKey,
    gymId: DEFAULT_CONFIG.gymId,
    syncSecret: DEFAULT_CONFIG.syncSecret
  };
  const DEV_KEY = 'pg_dev_mode_v1';
  const DEV_CODE = 'frd2026';
  const isDev = () => rawLS.getItem(DEV_KEY) === '1';

  function getConfig() {
    const raw = rawLS.getItem(CONFIG_KEY);
    const merged = Object.assign({}, DEFAULT_CONFIG, safeJsonParse(raw, {}));
    return isDev() ? merged : Object.assign(merged, FIXED_CONFIG);
  }

  function saveConfig(cfg) {
    const clean = {
      enabled: Boolean(cfg.enabled),
      supabaseUrl: String(cfg.supabaseUrl || '').trim().replace(/\/+$/, ''),
      supabaseAnonKey: String(cfg.supabaseAnonKey || '').trim(),
      gymId: String(cfg.gymId || 'powergym-main').trim() || 'powergym-main',
      syncSecret: String(cfg.syncSecret || '').trim(),
      lastSyncAt: String(cfg.lastSyncAt || '')
    };
    rawLS.setItem(CONFIG_KEY, JSON.stringify(clean));
    updateSyncBadge();
    return clean;
  }

  function getRoleInfo() {
    const raw = rawLS.getItem(ROLE_KEY);
    return Object.assign({}, DEFAULT_ROLE, safeJsonParse(raw, {}));
  }

  function saveRoleInfo(info) {
    const clean = {
      role: info.role === 'supervisor' ? 'supervisor' : 'captain',
      supervisorName: String(info.supervisorName || '').trim() || (info.role === 'supervisor' ? 'مشرف' : 'الكابتن'),
      captainPin: String(info.captainPin || '').trim()
    };
    rawLS.setItem(ROLE_KEY, JSON.stringify(clean));
    applyRoleRestrictions();
    updateSyncBadge();
    return clean;
  }

  function getDirtySet() {
    const arr = safeJsonParse(rawLS.getItem(DIRTY_KEY), []);
    return new Set(Array.isArray(arr) ? arr : []);
  }

  function setDirtySet(set) {
    rawLS.setItem(DIRTY_KEY, JSON.stringify(Array.from(set)));
  }

  function markKeyDirty(key) {
    if (!SYNCED_KEYS.includes(key) || isApplyingRemote) return;
    const dirty = getDirtySet();
    dirty.add(key);
    setDirtySet(dirty);
    schedulePush();
  }

  // التفاف آمن على localStorage.setItem لرصد أي حفظ من أي ملف تلقائياً
  function hookLocalStorage() {
    if (window.__pgCloudHooked) return;
    window.__pgCloudHooked = true;
    const origSetItem = rawLS.setItem.bind(rawLS);
    const wrapped = Object.create(Object.getPrototypeOf(rawLS));
    ['getItem', 'removeItem', 'clear', 'key'].forEach(fn => {
      if (typeof rawLS[fn] === 'function') wrapped[fn] = rawLS[fn].bind(rawLS);
    });
    Object.defineProperty(wrapped, 'length', {
      get: () => rawLS.length
    });
    wrapped.setItem = function (key, value) {
      origSetItem(key, value);
      markKeyDirty(String(key));
    };
    try {
      Object.defineProperty(window, 'localStorage', { value: wrapped, configurable: true });
      rawLS = wrapped;
    } catch (e) {
      console.warn('CloudSync localStorage hook fallback:', e);
    }
  }

  function isConfigured(cfg) {
    return Boolean(cfg && cfg.enabled && cfg.supabaseUrl && cfg.supabaseAnonKey && cfg.gymId);
  }

  function headersFor(cfg, extra) {
    const h = {
      apikey: cfg.supabaseAnonKey,
      'Content-Type': 'application/json'
    };
    if (!String(cfg.supabaseAnonKey || '').startsWith('sb_publishable_')) {
      h.Authorization = `Bearer ${cfg.supabaseAnonKey}`;
    }
    return Object.assign(h, extra || {});
  }

  function mergeArrayById(localArr, remoteArr) {
    if (!Array.isArray(localArr)) localArr = [];
    if (!Array.isArray(remoteArr)) remoteArr = [];
    const map = new Map();
    remoteArr.forEach(item => {
      if (item && item.id) map.set(String(item.id), item);
    });
    localArr.forEach(item => {
      if (!item || !item.id) return;
      const id = String(item.id);
      const existing = map.get(id);
      if (!existing) {
        map.set(id, item);
      } else {
        const localTs = Date.parse(item.updatedAt || item.createdAt || 0) || 0;
        const remoteTs = Date.parse(existing.updatedAt || existing.createdAt || 0) || 0;
        if (localTs >= remoteTs) map.set(id, item);
      }
    });
    return Array.from(map.values());
  }

  async function rpcCall(cfg, name, args) {
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: headersFor(cfg),
      body: JSON.stringify(args)
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message || text; } catch { /* ignore */ }
      const err = new Error(msg.slice(0, 160));
      err.notInstalled = res.status === 404 || /Could not find the function/i.test(msg);
      if (/bad_secret/.test(msg)) err.message = 'مفتاح المزامنة غير صحيح؛ استخدم رابط المشرف الجديد من الكابتن';
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }

  // أول جهاز يشغّل المزامنة بعد التأمين يُنشئ مفتاح المزامنة السري تلقائياً
  async function ensureSecret(cfg) {
    if (cfg.syncSecret) return cfg;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const secret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const ok = await rpcCall(cfg, 'gym_access_init', { p_gym: cfg.gymId, p_secret: secret });
    if (!ok) throw new Error('هذه القاعة مؤمّنة بمفتاح؛ استخدم رابط المشرف الجديد من الكابتن');
    return saveConfig(Object.assign({}, cfg, { syncSecret: secret }));
  }

  async function pushKeys(keysToPush) {
    let cfg = getConfig();
    if (!isConfigured(cfg) || !navigator.onLine) return { ok: false, reason: 'offline_or_unconfigured' };
    if (!keysToPush || !keysToPush.length) return { ok: true, count: 0 };

    const roleInfo = getRoleInfo();
    const rows = [];
    keysToPush.forEach(key => {
      const val = rawLS.getItem(key);
      if (val === null) return;
      rows.push({
        gym_id: cfg.gymId,
        storage_key: key,
        payload: val,
        updated_by: `${roleInfo.role}:${roleInfo.supervisorName}`,
        updated_at: new Date().toISOString()
      });
    });

    if (!rows.length) return { ok: true, count: 0 };

    let saved = [];
    try {
      cfg = await ensureSecret(cfg);
      saved = await rpcCall(cfg, 'gym_sync_push', {
        p_gym: cfg.gymId,
        p_secret: cfg.syncSecret,
        p_rows: rows.map(r => ({ storage_key: r.storage_key, payload: r.payload, updated_by: r.updated_by }))
      });
    } catch (e) {
      if (!e.notInstalled) throw e;
      // وضع التوافق: قبل تشغيل كود التأمين يستمر الحفظ المباشر القديم
      const url = `${cfg.supabaseUrl}/rest/v1/gym_sync?on_conflict=gym_id,storage_key`;
      const res = await fetch(url, {
        method: 'POST',
        headers: headersFor(cfg, { Prefer: 'resolution=merge-duplicates,return=representation' }),
        body: JSON.stringify(rows)
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 140)}`);
      }
      saved = await res.json().catch(() => []);
    }
    if (Array.isArray(saved)) {
      saved.forEach(r => {
        if (r && r.storage_key && r.updated_at) remoteTimestamps[r.storage_key] = r.updated_at;
      });
    }

    const dirty = getDirtySet();
    keysToPush.forEach(k => dirty.delete(k));
    setDirtySet(dirty);
    saveConfig(Object.assign(cfg, { lastSyncAt: new Date().toISOString() }));
    return { ok: true, count: rows.length };
  }

  async function pullFromCloud(forceOverwrite) {
    let cfg = getConfig();
    if (!isConfigured(cfg) || !navigator.onLine) return { ok: false, changed: false };
    let rows;
    try {
      cfg = await ensureSecret(cfg);
      rows = await rpcCall(cfg, 'gym_sync_pull', { p_gym: cfg.gymId, p_secret: cfg.syncSecret });
    } catch (e) {
      if (!e.notInstalled) throw e;
      const url = `${cfg.supabaseUrl}/rest/v1/gym_sync?gym_id=eq.${encodeURIComponent(cfg.gymId)}&select=storage_key,payload,updated_at,updated_by`;
      const res = await fetch(url, { headers: headersFor(cfg) });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 140)}`);
      }
      rows = await res.json();
    }
    if (!Array.isArray(rows)) return { ok: true, changed: false };

    const dirty = getDirtySet();
    let changed = false;

    isApplyingRemote = true;
    try {
      rows.forEach(row => {
        const key = row.storage_key;
        if (!SYNCED_KEYS.includes(key) || typeof row.payload !== 'string') return;
        const prevTs = remoteTimestamps[key] || '';
        if (!forceOverwrite && prevTs === row.updated_at) return;

        const localVal = rawLS.getItem(key);
        if (!forceOverwrite && dirty.has(key) && ARRAY_MERGE_KEYS.has(key) && localVal) {
          const merged = mergeArrayById(safeJsonParse(localVal, []), safeJsonParse(row.payload, []));
          const mergedStr = JSON.stringify(merged);
          if (mergedStr !== localVal) {
            rawLS.setItem(key, mergedStr);
            changed = true;
          }
        } else if (forceOverwrite || localVal !== row.payload) {
          rawLS.setItem(key, row.payload);
          changed = true;
        }
        remoteTimestamps[key] = row.updated_at;
      });
    } finally {
      isApplyingRemote = false;
    }

    saveConfig(Object.assign(cfg, { lastSyncAt: new Date().toISOString() }));
    if (changed && typeof window.reloadPowerGymStateFromPhoneDB === 'function') {
      window.reloadPowerGymStateFromPhoneDB();
    }
    return { ok: true, changed };
  }

  function schedulePush() {
    const cfg = getConfig();
    if (!isConfigured(cfg)) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      syncNow(false).catch(() => {});
    }, 1200);
  }

  async function syncNow(showFeedback) {
    const cfg = getConfig();
    if (!isConfigured(cfg)) {
      if (showFeedback && typeof showToast === 'function') showToast('يرجى إعداد بيانات السحابة أولاً', 'warning');
      return;
    }
    if (!navigator.onLine) {
      updateSyncBadge();
      if (showFeedback && typeof showToast === 'function') showToast('لا يوجد إنترنت؛ التغييرات محفوظة محلياً وستُرفع تلقائياً', 'info');
      return;
    }
    if (syncInFlight) return;
    syncInFlight = true;
    updateSyncBadge('syncing');
    try {
      const pulled = await pullFromCloud(false);
      const dirty = Array.from(getDirtySet());
      if (dirty.length) await pushKeys(dirty);
      updateSyncBadge('ok');
      if (showFeedback && typeof showToast === 'function') {
        showToast(pulled.changed ? 'تمت المزامنة وتحديث البيانات بنجاح ☁️' : 'البيانات محدثة بالكامل ✓', 'success');
      }
    } catch (err) {
      console.warn('Cloud sync error:', err);
      updateSyncBadge('error');
      if (showFeedback && typeof showToast === 'function') {
        showToast('تعذرت المزامنة: ' + (err.message || 'خطأ في الاتصال'), 'error');
      }
    } finally {
      syncInFlight = false;
    }
  }

  async function pushAllLocalToCloud() {
    const cfg = getConfig();
    if (!isConfigured(cfg)) {
      showToast?.('احفظ إعدادات السحابة وفعلها أولاً', 'warning');
      return;
    }
    try {
      updateSyncBadge('syncing');
      const res = await pushKeys(SYNCED_KEYS);
      updateSyncBadge('ok');
      showToast?.(`تم رفع ${res.count} حزمة بيانات للسحابة بنجاح ☁️`, 'success');
    } catch (e) {
      updateSyncBadge('error');
      showToast?.('فشل الرفع: ' + e.message, 'error');
    }
  }

  async function pullAllFromCloud() {
    const cfg = getConfig();
    if (!isConfigured(cfg)) {
      showToast?.('احفظ إعدادات السحابة وفعلها أولاً', 'warning');
      return;
    }
    try {
      updateSyncBadge('syncing');
      await pullFromCloud(true);
      updateSyncBadge('ok');
      showToast?.('تم جلب أحدث نسخة من السحابة وتحديث الجهاز ✓', 'success');
    } catch (e) {
      updateSyncBadge('error');
      showToast?.('فشل الجلب: ' + e.message, 'error');
    }
  }

  function applyRoleRestrictions() {
    const roleInfo = getRoleInfo();
    const isSup = roleInfo.role === 'supervisor';
    document.documentElement.classList.toggle('pg-supervisor-role', isSup);

    // إظهار/إخفاء عناصر الكابتن فقط للمشرف
    const restrictedSelectors = [
      'button[onclick*="openFinanceModal(\'profits\'"]',
      'button[onclick*="pgDailyClose"]',
      'button[onclick*="openSettingsModal"]'
    ];
    restrictedSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.display = isSup ? 'none' : '';
      });
    });

    const badge = document.getElementById('pgRoleChip');
    if (badge) {
      badge.textContent = isSup ? `مشرف: ${roleInfo.supervisorName}` : 'وضع الكابتن (مدير)';
      badge.className = isSup
        ? 'inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/15 px-2.5 py-0.5 text-[10px] font-bold text-sky-300'
        : 'inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/15 px-2.5 py-0.5 text-[10px] font-bold text-sky-300';
    }
  }

  function updateSyncBadge(state) {
    const el = document.getElementById('pgCloudStatusBadge');
    if (!el) return;
    const cfg = getConfig();
    if (!isConfigured(cfg)) {
      el.innerHTML = '<i class="fa-solid fa-database text-slate-400"></i> <span>حفظ محلي فقط</span>';
      return;
    }
    if (!navigator.onLine) {
      el.innerHTML = '<i class="fa-solid fa-wifi text-sky-400"></i> <span>أوفلاين (محفوظ)</span>';
      return;
    }
    if (state === 'syncing') {
      el.innerHTML = '<i class="fa-solid fa-rotate fa-spin text-sky-400"></i> <span>جارٍ المزامنة...</span>';
    } else if (state === 'error') {
      el.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-rose-400"></i> <span>خطأ مزامنة</span>';
    } else {
      const dirtyCount = getDirtySet().size;
      el.innerHTML = dirtyCount > 0
        ? `<i class="fa-solid fa-cloud-arrow-up text-sky-400"></i> <span>بانتظار الرفع (${dirtyCount})</span>`
        : '<i class="fa-solid fa-cloud-check text-emerald-400"></i> <span>متزامن سحابياً</span>';
    }
  }

  const SQL_SETUP_SNIPPET = `create table if not exists public.gym_sync (
  gym_id text not null,
  storage_key text not null,
  payload text not null,
  updated_by text default '',
  updated_at timestamptz default now(),
  primary key (gym_id, storage_key)
);
alter table public.gym_sync enable row level security;
grant all on table public.gym_sync to anon, authenticated;
drop policy if exists "gym_sync_all" on public.gym_sync;
create policy "gym_sync_all" on public.gym_sync for all using (true) with check (true);`;

  window.openCloudSyncModal = function () {
    const cfg = getConfig();
    const roleInfo = getRoleInfo();
    const old = document.getElementById('pgCloudSyncModal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'pgCloudSyncModal';
    modal.className = 'fixed inset-0 z-[90] modal-backdrop flex items-center justify-center p-3 overflow-y-auto';
    modal.innerHTML = `
      <section class="card-bg w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl p-5 space-y-4">
        <header class="flex items-center justify-between border-b border-slate-700 pb-3">
          <div>
            <h2 class="text-lg font-black text-white flex items-center gap-2">
              <i class="fa-solid fa-cloud text-sky-400"></i> السيرفر المجاني ومشاركة المشرفين
            </h2>
            <p class="text-[11px] text-slate-400">مزامنة فورية مجانية عبر Supabase + وضع الأوفلاين التلقائي</p>
          </div>
          <button onclick="document.getElementById('pgCloudSyncModal').remove()" class="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200">إغلاق ✕</button>
        </header>

        <div class="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-3.5 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-black text-sky-300">1. دور هذا الجهاز</span>
            <span id="pgRoleChip"></span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
            <select id="pgRoleSelect" class="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white">
              <option value="captain" ${roleInfo.role === 'captain' ? 'selected' : ''}>الكابتن (صلاحية كاملة)</option>
              <option value="supervisor" ${roleInfo.role === 'supervisor' ? 'selected' : ''}>مشرف (تسجيل وحضور وتنبيه)</option>
            </select>
            <input id="pgSupNameInput" value="${roleInfo.supervisorName.replace(/"/g, '&quot;')}" placeholder="اسم الكابتن أو المشرف" class="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
            <input id="pgCaptainPinInput" type="password" value="${roleInfo.captainPin.replace(/"/g, '&quot;')}" placeholder="رمز الكابتن (للرجوع للمدير)" class="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" dir="ltr" />
          </div>
        </div>

        <div class="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-3.5 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-black text-sky-300">2. ربط قاعدة بيانات Supabase المجانية</span>
            <label class="flex items-center gap-2 text-xs font-bold text-slate-200 cursor-pointer">
              <input id="pgSyncEnabled" type="checkbox" ${cfg.enabled ? 'checked' : ''} class="accent-sky-400 w-4 h-4" />
              تفعيل المزامنة
            </label>
          </div>
          <div class="space-y-2">
            <input id="pgSupabaseUrl" value="${cfg.supabaseUrl.replace(/"/g, '&quot;')}" placeholder="Project URL (https://xxxx.supabase.co)" class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" dir="ltr" />
            <input id="pgSupabaseKey" type="password" value="${cfg.supabaseAnonKey.replace(/"/g, '&quot;')}" placeholder="Anon Public Key (eyJ...)" class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" dir="ltr" />
            <input id="pgGymIdInput" value="${cfg.gymId.replace(/"/g, '&quot;')}" placeholder="معرف القاعة (مثلاً: powergym-karbala)" class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" dir="ltr" />
          </div>
          <div class="flex flex-wrap gap-2">
            <button onclick="pgSaveCloudSettings()" class="flex-1 gold-gradient text-black font-black py-2 px-4 rounded-xl text-xs">حفظ ومزامنة</button>
            <button onclick="pgPushAllCloud()" class="bg-emerald-700 hover:bg-emerald-600 text-white font-bold py-2 px-3 rounded-xl text-xs">رفع بياناتي للسحابة</button>
            <button onclick="pgPullAllCloud()" class="bg-sky-700 hover:bg-sky-600 text-white font-bold py-2 px-3 rounded-xl text-xs">جلب من السحابة</button>
          </div>
        </div>

        <div class="rounded-2xl border border-emerald-500/25 bg-emerald-950/20 p-3.5 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-black text-emerald-300">3. دعوة المشرفين (رابط ربط تلقائي بضغطة زر)</span>
            <button onclick="pgCopySupervisorLink()" class="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-white">نسخ رابط المشرف</button>
          </div>
          <p class="text-[11px] text-slate-300">أرسل هذا الرابط للمشرف على واتساب؛ بمجرد فتحه يربط جهازه بقاعدة البيانات تلقائياً بصفة (مشرف).</p>
        </div>

        <div class="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-3.5 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-black text-rose-300">4. تأمين بيانات القاعة (مهم قبل نشر رابط المتجر)</span>
            <button onclick="pgCopySecureSql()" class="rounded-lg bg-rose-600 hover:bg-rose-500 px-3 py-1.5 text-[11px] font-bold text-white">نسخ كود التأمين</button>
          </div>
          <p class="text-[11px] text-slate-300">الصق الكود في Supabase SQL Editor واضغط Run. بعدها لا يقرأ بيانات اللاعبين إلا من يملك مفتاح المزامنة السري (يُنشأ تلقائياً ويُرسل داخل رابط المشرف).</p>
        </div>

        <details class="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
          <summary class="cursor-pointer font-bold text-sky-300">خطوات إنشاء قاعدة البيانات المجانية (مرة واحدة فقط - دقيقتين)</summary>
          <ol class="mt-2 list-decimal pr-5 space-y-1 text-slate-300 leading-6">
            <li>ادخل إلى <span dir="ltr" class="text-sky-300">supabase.com</span> وأنشئ مشروعاً مجانياً.</li>
            <li>من القائمة اليسرى اختر <b>SQL Editor</b> والصق الكود التالي ثم اضغط <b>Run</b>:</li>
          </ol>
          <pre dir="ltr" class="mt-2 overflow-x-auto rounded-xl bg-slate-900 p-2.5 text-[10px] text-emerald-300 select-all">${SQL_SETUP_SNIPPET}</pre>
          <p class="mt-2 text-slate-400">3. من <b>Project Settings → API</b> انسخ الـ <b>Project URL</b> والـ <b>anon public key</b> وضعهما في الأعلى.</p>
        </details>
      </section>
    `;
    document.body.appendChild(modal);
    applyRoleRestrictions();
  };

  window.pgSaveCloudSettings = async function () {
    const currentRole = getRoleInfo();
    const nextRole = document.getElementById('pgRoleSelect').value;
    const pinInput = document.getElementById('pgCaptainPinInput').value.trim();

    if (currentRole.role === 'supervisor' && nextRole === 'captain' && currentRole.captainPin && pinInput !== currentRole.captainPin) {
      showToast?.('رمز الكابتن غير صحيح للعودة إلى صلاحية المدير', 'error');
      return;
    }

    saveRoleInfo({
      role: nextRole,
      supervisorName: document.getElementById('pgSupNameInput').value,
      captainPin: pinInput || currentRole.captainPin
    });

    const prev = getConfig();
    saveConfig({
      enabled: document.getElementById('pgSyncEnabled').checked,
      supabaseUrl: document.getElementById('pgSupabaseUrl').value,
      supabaseAnonKey: document.getElementById('pgSupabaseKey').value,
      gymId: document.getElementById('pgGymIdInput').value,
      syncSecret: prev.syncSecret
    });

    await syncNow(true);
  };

  window.pgCopySecureSql = async function () {
    let sql = '';
    try { sql = await (await fetch('gym-sync-secure.sql')).text(); } catch { /* ignore */ }
    try {
      await navigator.clipboard.writeText(sql);
      showToast?.('تم نسخ كود التأمين ✓ — الصقه في Supabase SQL Editor ثم Run', 'success');
    } catch {
      prompt('انسخ الكود:', sql);
    }
  };

  window.pgPushAllCloud = pushAllLocalToCloud;
  window.pgPullAllCloud = pullAllFromCloud;

  window.pgCopySupervisorLink = async function () {
    let cfg = getConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      showToast?.('أدخل بيانات Supabase واحفظها أولاً', 'warning');
      return;
    }
    try {
      cfg = await ensureSecret(cfg);
    } catch (e) {
      if (!e.notInstalled) {
        showToast?.(e.message, 'error');
        return;
      }
    }
    const base = window.location.origin + window.location.pathname;
    const params = new URLSearchParams({
      pgRole: 'supervisor'
    });
    const link = `${base}?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast?.('تم نسخ رابط المشرف! أرسله له على واتساب 📲', 'success');
    } catch {
      prompt('انسخ رابط المشرف:', link);
    }
  };

  function checkInviteParams() {
    const sp = new URLSearchParams(window.location.search);
    let changed = false;

    // وضع المطوّر (للمبرمج فقط)
    const dev = sp.get('dev');
    if (dev === DEV_CODE) { rawLS.setItem(DEV_KEY, '1'); changed = true; }
    else if (dev === 'off') { rawLS.removeItem(DEV_KEY); changed = true; }

    // رابط دعوة المشرف أو استرجاع وضع الكابتن
    if (sp.get('pgRole') === 'supervisor') {
      const cur = getRoleInfo();
      if (cur.role !== 'supervisor') {
        saveRoleInfo({ role: 'supervisor', supervisorName: cur.supervisorName === 'الكابتن' ? 'مشرف' : cur.supervisorName, captainPin: cur.captainPin });
      }
      changed = true;
    } else if (sp.get('pgRole') === 'captain' && dev === DEV_CODE) {
      const cur = getRoleInfo();
      saveRoleInfo({ role: 'captain', supervisorName: cur.supervisorName === 'مشرف' ? 'الكابتن' : cur.supervisorName, captainPin: cur.captainPin });
      changed = true;
    }
    if (changed) window.history.replaceState({}, '', window.location.pathname);
  }

  // أول تشغيل بعد التحديث (للكابتن والمشرفين): دمج ورفع كل البيانات المحفوظة محلياً للسحابة تلقائياً
  function autoInitialMigration() {
    const FLAG = 'pg_initial_sync_v2';
    if (rawLS.getItem(FLAG) === '1') return;
    const dirty = getDirtySet();
    SYNCED_KEYS.forEach(k => {
      const v = rawLS.getItem(k);
      if (v && v !== '[]' && v !== '{}' && v !== 'null') dirty.add(k);
    });
    setDirtySet(dirty);
    rawLS.setItem(FLAG, '1');
  }

  function injectCloudUi() {
    const nav = document.querySelector('#desktopSidebar nav');
    if (isDev() && nav && !document.getElementById('pgCloudNavBtn')) {
      const btn = document.createElement('button');
      btn.id = 'pgCloudNavBtn';
      btn.className = 'sidebar-link';
      btn.onclick = () => { window.openCloudSyncModal(); if (typeof closeMobileMenu === 'function') closeMobileMenu(); };
      btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up text-sky-400"></i><span>السيرفر والمشرفين</span>';
      const sysHeader = Array.from(nav.querySelectorAll('section')).pop();
      if (sysHeader) sysHeader.appendChild(btn);
      else nav.appendChild(btn);
    }

    if (nav && !document.getElementById('pgInviteNavBtn') && !isDev()) {
      const inv = document.createElement('button');
      inv.id = 'pgInviteNavBtn';
      inv.className = 'sidebar-link';
      inv.onclick = () => { window.pgCopySupervisorLink(); if (typeof closeMobileMenu === 'function') closeMobileMenu(); };
      inv.innerHTML = '<i class="fa-solid fa-user-plus text-sky-400"></i><span>نسخ رابط دعوة مشرف</span>';
      const last = Array.from(nav.querySelectorAll('section')).pop();
      if (last) last.appendChild(inv);
    }

    const headerTitle = document.querySelector('#desktopSidebar .border-b');
    if (headerTitle && !document.getElementById('pgCloudStatusBadge')) {
      const bar = document.createElement('div');
      bar.className = 'mt-2.5 flex items-center justify-between gap-2 text-[10px] font-bold text-slate-300';
      bar.innerHTML = `
        <button id="pgCloudStatusBadge" onclick="pgCloudSyncNow()" class="flex items-center gap-1.5 rounded-lg bg-slate-900/90 border border-slate-700/70 px-2 py-1 hover:border-sky-400/50"></button>
        <button id="pgRoleChip" type="button" onclick="pgSwitchRoleQuick()" title="تبديل أو إدارة صلاحية الكابتن" class="cursor-pointer hover:brightness-110"></button>
      `;
      headerTitle.appendChild(bar);
    }

    updateSyncBadge();
    applyRoleRestrictions();
  }

  window.pgSwitchRoleQuick = function () {
    const info = getRoleInfo();
    if (info.role === 'supervisor') {
      const entered = prompt('للرجوع إلى وضع الكابتن (المدير)، أدخل رمز الكابتن:');
      if (entered === null) return;
      const clean = entered.trim();
      const validPin = info.captainPin && clean === info.captainPin;
      const validDev = clean === DEV_CODE;
      if (!validPin && !validDev) {
        showToast?.('الرمز غير صحيح', 'error');
        return;
      }
      saveRoleInfo({ role: 'captain', supervisorName: 'الكابتن', captainPin: info.captainPin });
      showToast?.('تمت استعادة وضع الكابتن (المدير) بنجاح ✅', 'success');
      return;
    }

    const newPin = prompt('أنت الآن في وضع الكابتن (المدير).\nأدخل رمز الكابتن لحفظه (تحتاجه إذا تحولت لمشرف بالخطأ):', info.captainPin || '');
    if (newPin === null) return;
    saveRoleInfo({ role: 'captain', supervisorName: info.supervisorName || 'الكابتن', captainPin: newPin.trim() });
    showToast?.('تم حفظ رمز الكابتن بنجاح ✓', 'success');
  };

  window.pgCloudSyncNow = () => syncNow(true);

  window.pgCloudSync = {
    getConfig,
    saveConfig,
    getRoleInfo,
    saveRoleInfo,
    syncNow,
    pushAllLocalToCloud,
    pullAllFromCloud
  };

  function init() {
    hookLocalStorage();
    checkInviteParams();
    autoInitialMigration();
    injectCloudUi();

    window.addEventListener('online', () => {
      updateSyncBadge();
      syncNow(false);
    });
    window.addEventListener('offline', () => updateSyncBadge());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncNow(false);
    });

    if (isConfigured(getConfig())) {
      setTimeout(() => syncNow(false), 1200);
    }
    pollTimer = setInterval(() => {
      if (!document.hidden && isConfigured(getConfig())) syncNow(false);
    }, 15000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
