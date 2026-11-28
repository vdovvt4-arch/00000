/* =========================================================
   cloud-sync.js — محرك المزامنة العلائقية الموحد (v4.0)
   يربط التخزين المحلي السريع (Offline-First) بالجداول المهيكلة
   في PostgreSQL عبر Supabase Auth (Google Sign-In) + RLS
   ========================================================= */
(function () {
  'use strict';

  const DIRTY_KEY = 'pg_cloud_dirty_keys_v2';
  const DELETED_PLAYERS_KEY = 'pg_deleted_player_ids_v1';

  const SYNCED_KEYS = [
    'power_gym_players_v1',
    'power_gym_finance_ledger_v2',
    'power_gym_profile_v2',
    'pg_attendance_v1',
    'pg_inventory_v1',
    'pg_sales_v1',
    'pg_trainers_v1',
    'pg_daily_closes_v1',
    'pg_whatsapp_sent_v1',
    'pg_crowd_status_v1',
    'pg_freezes_v1',
    'pg_wa_templates_v1',
    'pg_ops_settings_v1',
    'pg_gym_status_reports_v1',
    'pg_accounting_archives_v1'
  ];

  let rawLS = window.localStorage;
  let isApplyingRemote = false;
  let pushTimer = null;
  let pollTimer = null;
  let syncInFlight = false;
  let lastStaffList = [];
  let lastSyncedAt = '';

  function safeJsonParse(str, fallback) {
    try {
      if (!str) return fallback;
      const v = JSON.parse(str);
      return v === null || v === undefined ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function getClient() {
    return window.pgSupabase || (window.pgAuth && window.pgAuth.getClient()) || null;
  }

  function getGymId() {
    return (window.pgAuth && window.pgAuth.getGymId()) || 'powergym-main';
  }

  function getRoleInfo() {
    if (window.pgAuth && window.pgAuth.isAuthenticated()) {
      const mem = window.pgAuth.getMembership();
      const isSup = mem.role === 'supervisor';
      return {
        role: isSup ? 'supervisor' : 'captain',
        dbRole: mem.role,
        supervisorName: mem.display_name || (isSup ? 'مشرف' : 'الكابتن'),
        email: mem.email || ''
      };
    }
    return { role: 'supervisor', dbRole: 'supervisor', supervisorName: 'مشرف', email: '' };
  }

  function getConfig() {
    const cfg = window.PG_SUPABASE_CONFIG || {};
    return {
      enabled: true,
      supabaseUrl: cfg.url || 'https://bpwjdjkqcfxerizrssbs.supabase.co',
      supabaseAnonKey: cfg.publishableKey || '',
      gymId: getGymId(),
      lastSyncAt: lastSyncedAt
    };
  }

  function getDirtySet() {
    const arr = safeJsonParse(rawLS.getItem(DIRTY_KEY), []);
    return new Set(Array.isArray(arr) ? arr : []);
  }

  function setDirtySet(set) {
    rawLS.setItem(DIRTY_KEY, JSON.stringify(Array.from(set)));
  }

  function getDeletedPlayerIds() {
    const arr = safeJsonParse(rawLS.getItem(DELETED_PLAYERS_KEY), []);
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  }

  function clearDeletedPlayerIds() {
    rawLS.removeItem(DELETED_PLAYERS_KEY);
  }

  window.pgRecordDeletedPlayer = function (playerId) {
    if (!playerId) return;
    const list = getDeletedPlayerIds();
    if (!list.includes(String(playerId))) list.push(String(playerId));
    rawLS.setItem(DELETED_PLAYERS_KEY, JSON.stringify(list));
    markKeyDirty('power_gym_players_v1');
  };

  function markKeyDirty(key) {
    if (!SYNCED_KEYS.includes(key) || isApplyingRemote) return;
    const dirty = getDirtySet();
    dirty.add(key);
    setDirtySet(dirty);
    updateSyncBadge();
    schedulePush();
  }

  function hookLocalStorage() {
    if (window.__pgCloudHooked) return;
    window.__pgCloudHooked = true;
    const origSetItem = rawLS.setItem.bind(rawLS);
    const wrapped = Object.create(Object.getPrototypeOf(rawLS));
    ['getItem', 'removeItem', 'clear', 'key'].forEach(fn => {
      if (typeof rawLS[fn] === 'function') wrapped[fn] = rawLS[fn].bind(rawLS);
    });
    Object.defineProperty(wrapped, 'length', { get: () => rawLS.length });
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

  function mergeArrayByIdRespectingDeletes(localArr, remoteArr, deletedSet) {
    const map = new Map();
    (Array.isArray(remoteArr) ? remoteArr : []).forEach(item => {
      if (item && item.id && !deletedSet.has(String(item.id))) {
        map.set(String(item.id), item);
      }
    });
    (Array.isArray(localArr) ? localArr : []).forEach(item => {
      if (!item || !item.id || deletedSet.has(String(item.id))) return;
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

  async function pullFromCloud(forceOverwrite = false) {
    const client = getClient();
    if (!client || !navigator.onLine || !window.pgAuth?.isAuthenticated()) {
      return { ok: false, changed: false };
    }

    const { data, error } = await client.rpc('pg_pull_full_state', { p_gym: getGymId() });
    if (error) throw error;
    if (!data || !data.ok) return { ok: false, changed: false };

    lastStaffList = Array.isArray(data.staff) ? data.staff : [];
    const dirty = getDirtySet();
    const localDeleted = new Set(getDeletedPlayerIds());
    (Array.isArray(data.deletedPlayerIds) ? data.deletedPlayerIds : []).forEach(id => localDeleted.add(String(id)));

    let changed = false;
    const writeIfDiff = (key, obj) => {
      const nextStr = JSON.stringify(obj);
      const curStr = rawLS.getItem(key);
      if (forceOverwrite || curStr !== nextStr) {
        rawLS.setItem(key, nextStr);
        changed = true;
      }
    };

    isApplyingRemote = true;
    try {
      // 1. Profile, Crowd, Templates, Ops
      const g = data.gym || {};
      if (forceOverwrite || !dirty.has('power_gym_profile_v2')) {
        writeIfDiff('power_gym_profile_v2', {
          gymName: g.gymName || 'Power Gym | بور جم',
          gymBranch: g.gymBranch || 'كربلاء - الحر - قرب فلكة الثورة',
          supervisorName: g.supervisorName || '',
          receiptStamp: g.receiptStamp || '',
          defaultPrices: g.defaultPrices || { '0.5': 15000, '1': 25000, '2': 45000, '3': 65000, '6': 120000, '12': 220000 }
        });
      }
      if (g.crowd && (forceOverwrite || !dirty.has('pg_crowd_status_v1'))) {
        writeIfDiff('pg_crowd_status_v1', g.crowd);
      }
      if (g.waTemplates && Object.keys(g.waTemplates).length && (forceOverwrite || !dirty.has('pg_wa_templates_v1'))) {
        writeIfDiff('pg_wa_templates_v1', g.waTemplates);
      }
      if (g.opsSettings && Object.keys(g.opsSettings).length && (forceOverwrite || !dirty.has('pg_ops_settings_v1'))) {
        writeIfDiff('pg_ops_settings_v1', g.opsSettings);
      }

      // 2. Players
      const remotePlayers = Array.isArray(data.players) ? data.players : [];
      if (!forceOverwrite && dirty.has('power_gym_players_v1')) {
        const localPlayers = safeJsonParse(rawLS.getItem('power_gym_players_v1'), []);
        writeIfDiff('power_gym_players_v1', mergeArrayByIdRespectingDeletes(localPlayers, remotePlayers, localDeleted));
      } else {
        writeIfDiff('power_gym_players_v1', remotePlayers.filter(p => !localDeleted.has(String(p.id))));
      }

      // 3. Finance Ledger (rebuilt cleanly from normalized PostgreSQL tables!)
      const remoteLedger = {
        manualProfitAdjustment: Number(g.manualProfitAdjustment) || 0,
        manualDebtAdjustment: Number(g.manualDebtAdjustment) || 0,
        transactions: Array.isArray(data.transactions) ? data.transactions : [],
        debtEntries: Array.isArray(data.debtEntries) ? data.debtEntries : [],
        debtPayments: Array.isArray(data.debtPayments) ? data.debtPayments : [],
        renewals: Array.isArray(data.renewals) ? data.renewals : [],
        receipts: Array.isArray(data.receipts) ? data.receipts : [],
        receiptCounter: Math.max(
          Number(g.receiptCounter) || 0,
          ...(Array.isArray(data.receipts) ? data.receipts.map(r => Number(r.serial) || 0) : [0])
        ),
        receiptSettings: (g.receiptSettings && typeof g.receiptSettings === 'object') ? g.receiptSettings : {}
      };

      if (!forceOverwrite && dirty.has('power_gym_finance_ledger_v2')) {
        const localLedger = safeJsonParse(rawLS.getItem('power_gym_finance_ledger_v2'), {});
        const emptySet = new Set();
        writeIfDiff('power_gym_finance_ledger_v2', {
          manualProfitAdjustment: localLedger.manualProfitAdjustment ?? remoteLedger.manualProfitAdjustment,
          manualDebtAdjustment: localLedger.manualDebtAdjustment ?? remoteLedger.manualDebtAdjustment,
          transactions: mergeArrayByIdRespectingDeletes(localLedger.transactions, remoteLedger.transactions, emptySet),
          debtEntries: mergeArrayByIdRespectingDeletes(localLedger.debtEntries, remoteLedger.debtEntries, emptySet),
          debtPayments: mergeArrayByIdRespectingDeletes(localLedger.debtPayments, remoteLedger.debtPayments, emptySet),
          renewals: mergeArrayByIdRespectingDeletes(localLedger.renewals, remoteLedger.renewals, emptySet),
          receipts: mergeArrayByIdRespectingDeletes(localLedger.receipts, remoteLedger.receipts, emptySet),
          receiptCounter: Math.max(Number(localLedger.receiptCounter) || 0, remoteLedger.receiptCounter),
          receiptSettings: Object.assign({}, remoteLedger.receiptSettings, localLedger.receiptSettings || {})
        });
      } else {
        writeIfDiff('power_gym_finance_ledger_v2', remoteLedger);
      }

      // 4. Operational Collections
      const mapCollections = [
        ['pg_freezes_v1', data.freezes],
        ['pg_attendance_v1', data.attendance],
        ['pg_inventory_v1', data.inventory],
        ['pg_sales_v1', data.sales],
        ['pg_trainers_v1', data.trainers],
        ['pg_daily_closes_v1', data.dailyCloses],
        ['pg_accounting_archives_v1', data.accountingArchives],
        ['pg_gym_status_reports_v1', data.statusReports]
      ];
      const emptyDel = new Set();
      mapCollections.forEach(([key, remoteArr]) => {
        if (!Array.isArray(remoteArr)) return;
        if (!forceOverwrite && dirty.has(key)) {
          const localArr = safeJsonParse(rawLS.getItem(key), []);
          writeIfDiff(key, mergeArrayByIdRespectingDeletes(localArr, remoteArr, emptyDel));
        } else {
          writeIfDiff(key, remoteArr);
        }
      });

      if (data.whatsappSent && typeof data.whatsappSent === 'object') {
        const curWa = safeJsonParse(rawLS.getItem('pg_whatsapp_sent_v1'), {});
        writeIfDiff('pg_whatsapp_sent_v1', forceOverwrite ? data.whatsappSent : Object.assign({}, data.whatsappSent, curWa));
      }
    } finally {
      isApplyingRemote = false;
    }

    lastSyncedAt = new Date().toISOString();
    applyRoleRestrictions();
    if (changed && typeof window.reloadPowerGymStateFromPhoneDB === 'function') {
      window.reloadPowerGymStateFromPhoneDB();
    }
    return { ok: true, changed };
  }

  async function pushDirtyKeys(forceAll = false) {
    const client = getClient();
    if (!client || !navigator.onLine || !window.pgAuth?.isAuthenticated()) {
      return { ok: false, count: 0 };
    }

    const dirty = forceAll ? new Set(SYNCED_KEYS) : getDirtySet();
    const deletedIds = getDeletedPlayerIds();
    if (dirty.size === 0 && deletedIds.length === 0) {
      return { ok: true, count: 0 };
    }

    const payload = {};
    let pushedGroups = 0;

    if (dirty.has('power_gym_profile_v2')) {
      payload.profile = safeJsonParse(rawLS.getItem('power_gym_profile_v2'), {});
      pushedGroups++;
    }
    if (dirty.has('pg_crowd_status_v1')) {
      payload.crowd = safeJsonParse(rawLS.getItem('pg_crowd_status_v1'), {});
      pushedGroups++;
    }
    if (dirty.has('pg_wa_templates_v1')) {
      payload.waTemplates = safeJsonParse(rawLS.getItem('pg_wa_templates_v1'), {});
      pushedGroups++;
    }
    if (dirty.has('pg_ops_settings_v1')) {
      payload.opsSettings = safeJsonParse(rawLS.getItem('pg_ops_settings_v1'), {});
      pushedGroups++;
    }
    if (dirty.has('power_gym_players_v1') || deletedIds.length > 0) {
      payload.players = safeJsonParse(rawLS.getItem('power_gym_players_v1'), []);
      payload.deletedPlayerIds = deletedIds;
      payload.playersFullSync = Boolean(forceAll && window.pgAuth?.isManager());
      pushedGroups++;
    }
    if (dirty.has('power_gym_finance_ledger_v2')) {
      payload.financeLedger = safeJsonParse(rawLS.getItem('power_gym_finance_ledger_v2'), {});
      pushedGroups++;
    }
    if (dirty.has('pg_freezes_v1')) {
      payload.freezes = safeJsonParse(rawLS.getItem('pg_freezes_v1'), []);
      pushedGroups++;
    }
    if (dirty.has('pg_attendance_v1')) {
      payload.attendance = safeJsonParse(rawLS.getItem('pg_attendance_v1'), []);
      pushedGroups++;
    }
    if (dirty.has('pg_inventory_v1')) {
      payload.inventory = safeJsonParse(rawLS.getItem('pg_inventory_v1'), []);
      pushedGroups++;
    }
    if (dirty.has('pg_sales_v1')) {
      payload.sales = safeJsonParse(rawLS.getItem('pg_sales_v1'), []);
      pushedGroups++;
    }
    if (dirty.has('pg_trainers_v1') && window.pgAuth?.isManager()) {
      payload.trainers = safeJsonParse(rawLS.getItem('pg_trainers_v1'), []);
      pushedGroups++;
    }
    if (dirty.has('pg_daily_closes_v1') && window.pgAuth?.isManager()) {
      payload.dailyCloses = safeJsonParse(rawLS.getItem('pg_daily_closes_v1'), []);
      pushedGroups++;
    }
    if (dirty.has('pg_accounting_archives_v1') && window.pgAuth?.isManager()) {
      payload.accountingArchives = safeJsonParse(rawLS.getItem('pg_accounting_archives_v1'), []);
      pushedGroups++;
    }
    if (dirty.has('pg_gym_status_reports_v1')) {
      payload.statusReports = safeJsonParse(rawLS.getItem('pg_gym_status_reports_v1'), []);
      pushedGroups++;
    }
    if (dirty.has('pg_whatsapp_sent_v1')) {
      payload.whatsappSent = safeJsonParse(rawLS.getItem('pg_whatsapp_sent_v1'), {});
      pushedGroups++;
    }

    const { error } = await client.rpc('pg_push_normalized_state', {
      p_gym: getGymId(),
      p_payload: payload
    });
    if (error) throw error;

    setDirtySet(new Set());
    clearDeletedPlayerIds();
    lastSyncedAt = new Date().toISOString();
    return { ok: true, count: pushedGroups };
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      syncNow(false).catch(() => {});
    }, 900);
  }

  async function syncNow(showFeedback = false) {
    if (!window.pgAuth?.isAuthenticated()) return false;
    if (!navigator.onLine) {
      updateSyncBadge();
      if (showFeedback && typeof showToast === 'function') {
        showToast('لا يوجد إنترنت حالياً؛ التغييرات محفوظة محلياً وستُزامَن فور عودة الاتصال', 'info');
      }
      return false;
    }
    if (syncInFlight) return false;
    syncInFlight = true;
    updateSyncBadge('syncing');
    try {
      const dirtyCountBefore = getDirtySet().size + getDeletedPlayerIds().length;
      if (dirtyCountBefore > 0) {
        await pushDirtyKeys(false);
      }
      const pulled = await pullFromCloud(false);
      updateSyncBadge('ok');
      if (showFeedback && typeof showToast === 'function') {
        showToast(pulled.changed ? 'تمت المزامنة مع قاعدة البيانات وتحديث السجلات ☁️' : 'قاعدة البيانات متزامنة ومحدثة بالكامل ✓', 'success');
      }
      return true;
    } catch (err) {
      console.warn('Relational sync error:', err);
      updateSyncBadge('error');
      if (showFeedback && typeof showToast === 'function') {
        showToast('تعذرت المزامنة: ' + (err.message || 'خطأ في الاتصال'), 'error');
      }
      return false;
    } finally {
      syncInFlight = false;
    }
  }

  async function pushAllLocalToCloud() {
    if (!window.pgAuth?.isAuthenticated()) return;
    try {
      updateSyncBadge('syncing');
      const res = await pushDirtyKeys(true);
      await pullFromCloud(false);
      updateSyncBadge('ok');
      if (typeof showToast === 'function') {
        showToast(`تم حفظ ومزامنة ${res.count} جداول في قاعدة البيانات بنجاح ☁️`, 'success');
      }
    } catch (e) {
      updateSyncBadge('error');
      if (typeof showToast === 'function') showToast('فشل الرفع: ' + e.message, 'error');
    }
  }

  async function pullAllFromCloud() {
    if (!window.pgAuth?.isAuthenticated()) return;
    try {
      updateSyncBadge('syncing');
      await pullFromCloud(true);
      updateSyncBadge('ok');
      if (typeof showToast === 'function') {
        showToast('تم جلب أحدث البيانات من قاعدة البيانات السحابية ✓', 'success');
      }
    } catch (e) {
      updateSyncBadge('error');
      if (typeof showToast === 'function') showToast('فشل الجلب: ' + e.message, 'error');
    }
  }

  function applyRoleRestrictions() {
    const roleInfo = getRoleInfo();
    const isSup = roleInfo.role === 'supervisor';
    document.documentElement.classList.toggle('pg-supervisor-role', isSup);

    const restrictedSelectors = [
      '[data-captain-only]',
      '#mnav-finance',
      '#pgAccountingNavBtn',
      'button[onclick*="openFinanceModal(\'profits\'"]',
      'button[onclick*="openSmartAccountingModal"]',
      'button[onclick*="pgDailyClose"]',
      'button[onclick*="openSettingsModal"]',
      'button[onclick*="openCloudSyncModal"]'
    ];
    restrictedSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.display = isSup ? 'none' : '';
      });
    });

    if (window.pgAuth && typeof window.pgAuth.refreshBadge === 'function') {
      window.pgAuth.refreshBadge();
    }
  }

  function updateSyncBadge(state) {
    const el = document.getElementById('pgCloudStatusBadge');
    if (!el) return;
    if (!navigator.onLine) {
      el.innerHTML = '<i class="fa-solid fa-wifi-slash text-amber-400"></i><span>وضع أوفلاين</span>';
      return;
    }
    if (state === 'syncing') {
      el.innerHTML = '<i class="fa-solid fa-rotate fa-spin text-sky-400"></i><span>جارٍ المزامنة...</span>';
    } else if (state === 'error') {
      el.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-rose-400"></i><span>خطأ مزامنة</span>';
    } else {
      const dirtyCount = getDirtySet().size + getDeletedPlayerIds().length;
      el.innerHTML = dirtyCount > 0
        ? `<i class="fa-solid fa-cloud-arrow-up text-amber-400"></i><span>بانتظار الحفظ (${dirtyCount})</span>`
        : '<i class="fa-solid fa-database text-emerald-400"></i><span>متزامن مع PostgreSQL</span>';
    }
  }

  window.pgCreateInviteLink = async function (role = 'supervisor') {
    const client = getClient();
    if (!client || !window.pgAuth?.isManager()) {
      showToast?.('هذه الميزة متاحة لمالك القاعة أو الكابتن المدير فقط', 'warning');
      return;
    }
    const labelInput = document.getElementById('pgInviteLabelInput');
    const label = (labelInput?.value || '').trim() || (role === 'captain' ? 'كابتن مدير' : 'مشرف');

    const { data, error } = await client.rpc('pg_create_staff_invite', {
      p_gym: getGymId(),
      p_role: role,
      p_label: label
    });
    if (error || !data?.ok) {
      showToast?.('تعذر إنشاء رابط الدعوة: ' + (error?.message || 'خطأ'), 'error');
      return;
    }

    const link = `${window.location.origin}${window.location.pathname}?pgInvite=${encodeURIComponent(data.token)}`;
    const outBox = document.getElementById('pgGeneratedInviteBox');
    if (outBox) {
      outBox.classList.remove('hidden');
      outBox.innerHTML = `
        <p class="text-[11px] font-bold text-emerald-300 mb-1">تم إنشاء رابط الدعوة (صالح لـ 14 يوماً — يُستخدم مرة واحدة بحساب Google الخاص بالمشرف):</p>
        <div class="flex gap-2">
          <input readonly value="${esc(link)}" dir="ltr" onclick="this.select()" class="min-w-0 flex-1 rounded-xl border border-emerald-500/40 bg-zinc-950 px-3 py-2 text-xs text-emerald-200">
          <button type="button" onclick="navigator.clipboard.writeText('${esc(link)}').then(()=>showToast('تم نسخ الرابط ✓','success'))" class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white">نسخ</button>
        </div>
      `;
    }
    try {
      await navigator.clipboard.writeText(link);
      showToast?.('تم إنشاء ونسخ رابط دعوة المشرف بنجاح 📲', 'success');
    } catch { /* shown in box */ }
  };

  window.pgCopySupervisorLink = () => window.pgCreateInviteLink('supervisor');

  window.openCloudSyncModal = async function () {
    if (!window.pgAuth?.isManager()) {
      showToast?.('إدارة قاعدة البيانات والمشرفين متاحة للمدير فقط', 'warning');
      return;
    }
    await pullFromCloud(false).catch(() => {});

    const old = document.getElementById('pgCloudSyncModal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'pgCloudSyncModal';
    modal.className = 'fixed inset-0 z-[90] modal-backdrop flex items-center justify-center p-3 overflow-y-auto';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `
      <section class="card-bg w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl p-5 space-y-4 border border-amber-500/30">
        <header class="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h2 class="text-lg font-black text-white flex items-center gap-2">
              <i class="fa-solid fa-database text-emerald-400"></i> قاعدة البيانات السحابية وإدارة المشرفين
            </h2>
            <p class="text-[11px] text-zinc-400">جداول PostgreSQL علائقية منظمة + حماية RLS + مصادقة Google</p>
          </div>
          <button onclick="document.getElementById('pgCloudSyncModal').remove()" class="rounded-xl bg-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-200">إغلاق ✕</button>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
          <div class="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-3">
            <span class="text-zinc-400 block text-[10px]">حالة القاعدة</span>
            <strong class="text-emerald-300 font-black">متصل ومؤمّن (RLS) ✓</strong>
          </div>
          <div class="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3">
            <span class="text-zinc-400 block text-[10px]">معرف القاعة</span>
            <strong class="text-amber-300 font-black" dir="ltr">${esc(getGymId())}</strong>
          </div>
          <div class="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3">
            <span class="text-zinc-400 block text-[10px]">المشرفون المرتبطون</span>
            <strong class="text-sky-300 font-black">${lastStaffList.length} حساب</strong>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <button onclick="pgCloudSyncNow()" class="flex-1 gold-gradient rounded-xl py-2.5 px-4 text-xs font-black">مزامنة فورية الآن</button>
          <button onclick="pgPushAllCloud()" class="rounded-xl bg-emerald-700 hover:bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white">رفع كل السجلات المحلية</button>
          <button onclick="pgPullAllCloud()" class="rounded-xl bg-sky-700 hover:bg-sky-600 px-4 py-2.5 text-xs font-bold text-white">تحديث كامل من السحابة</button>
        </div>

        <div class="rounded-2xl border border-amber-500/25 bg-zinc-900/80 p-4 space-y-3">
          <h3 class="text-xs font-black text-amber-300 flex items-center gap-1.5">
            <i class="fa-solid fa-user-plus"></i> دعوة مشرف أو كابتن جديد (بحساب Google الخاص به)
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input id="pgInviteLabelInput" placeholder="اسم المشرف (مثلاً: كابتن علي)" class="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white">
            <button type="button" onclick="pgCreateInviteLink('supervisor')" class="rounded-xl bg-emerald-600 hover:bg-emerald-500 py-2 px-3 text-xs font-black text-white">إنشاء رابط مشرف</button>
            <button type="button" onclick="pgCreateInviteLink('captain')" class="rounded-xl bg-sky-700 hover:bg-sky-600 py-2 px-3 text-xs font-bold text-white">إنشاء رابط مدير</button>
          </div>
          <div id="pgGeneratedInviteBox" class="hidden pt-1"></div>
        </div>

        <div class="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-2">
          <h3 class="text-xs font-black text-zinc-200">الحسابات المخوّلة بالوصول للقاعة (${lastStaffList.length})</h3>
          <div class="space-y-1.5 max-h-48 overflow-y-auto">
            ${lastStaffList.map(st => `
              <div class="flex items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/90 px-3 py-2 text-xs">
                <div class="min-w-0">
                  <p class="font-bold text-white truncate">${esc(st.displayName || 'مستخدم')}</p>
                  <p class="text-[10px] text-zinc-400 truncate" dir="ltr">${esc(st.email)}</p>
                </div>
                <span class="rounded-full px-2.5 py-0.5 text-[10px] font-black ${st.role === 'owner' ? 'bg-amber-500/20 text-amber-300' : st.role === 'captain' ? 'bg-sky-500/20 text-sky-300' : 'bg-emerald-500/20 text-emerald-300'}">
                  ${st.role === 'owner' ? 'المالك' : st.role === 'captain' ? 'مدير' : 'مشرف'}
                </span>
              </div>
            `).join('') || '<p class="text-xs text-zinc-500 py-2 text-center">لا توجد حسابات إضافية بعد.</p>'}
          </div>
        </div>
      </section>
    `;
    document.body.appendChild(modal);
  };

  window.pgSwitchRoleQuick = function () {
    if (window.pgAuth?.isManager()) {
      window.openCloudSyncModal();
    } else {
      showToast?.('أنت مسجّل كمشرف؛ لتبديل الصلاحية سجّل الخروج وادخل بحساب المدير.', 'info');
    }
  };

  window.pgPushAllCloud = pushAllLocalToCloud;
  window.pgPullAllCloud = pullAllFromCloud;
  window.pgCloudSyncNow = () => syncNow(true);

  window.pgCloudSync = {
    getConfig,
    getRoleInfo,
    syncNow,
    pushAllLocalToCloud,
    pullAllFromCloud
  };

  function init() {
    hookLocalStorage();
    applyRoleRestrictions();

    window.addEventListener('pg-auth-ready', () => {
      applyRoleRestrictions();
      syncNow(false);
    });

    window.addEventListener('online', () => {
      updateSyncBadge();
      syncNow(false);
    });
    window.addEventListener('offline', () => updateSyncBadge());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && window.pgAuth?.isAuthenticated()) syncNow(false);
    });

    pollTimer = setInterval(() => {
      if (!document.hidden && navigator.onLine && window.pgAuth?.isAuthenticated()) {
        syncNow(false);
      }
    }, 20000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
