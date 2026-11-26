/* =========================================================
   smart-ops.js — عمليات القاعة الذكية
   1) تقرير الأرباح اليومي (إرسال لواتساب الكابتن)
   2) تجميد الاشتراك (تمديد تلقائي عند الرجوع)
   3) تنبيه الغياب (لاعبون غابوا 7+ أيام)
   4) قوالب رسائل الواتساب القابلة للتعديل
   * يستبدل مركز الواتساب القديم بنسخة محسّنة
   ========================================================= */
(function () {
  'use strict';

  const WA_SENT_KEY = 'pg_whatsapp_sent_v1';
  const TPL_KEY = 'pg_wa_templates_v1';
  const FREEZE_KEY = 'pg_freezes_v1';
  const OPS_KEY = 'pg_ops_settings_v1';
  const ABSENT_DAYS_DEFAULT = 7;

  const DEFAULT_TEMPLATES = {
    expired: 'السلام عليكم كابتن {name}، اشتراكك في {gym} انتهى بتاريخ {date}. بانتظارك لتجديد الاشتراك ومواصلة التمرين 💪🔥',
    soon: 'السلام عليكم كابتن {name}، نذكرك بأن اشتراكك في {gym} ينتهي بتاريخ {date} (باقي {days} يوم). يسعدنا تجديدك للاستمرار معنا 💪',
    debt: 'السلام عليكم كابتن {name}، نود تذكيرك بوجود مبلغ متبقي قدره {debt} د.ع في {gym}. نتمنى لك تمريناً موفقاً 💪',
    absent: 'السلام عليكم كابتن {name}، افتقدناك في {gym}! لم نرك منذ {days} يوم، بانتظارك للعودة للتمرين 💪🔥'
  };
  const TAB_LABELS = { expired: 'منتهي الاشتراك', soon: 'ينتهي خلال 3 أيام', debt: 'ديون مستحقة', absent: 'غائبون' };

  const $ = id => document.getElementById(id);
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => (Number(n) || 0).toLocaleString('en-US');
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'info'); };

  function readJson(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || 'null');
      return v === null || v === undefined ? fallback : v;
    } catch { return fallback; }
  }
  function writeJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
  }

  function dayDiff(a, b) { // b - a بالأيام
    const da = new Date(String(a).slice(0, 10) + 'T00:00:00Z');
    const db = new Date(String(b).slice(0, 10) + 'T00:00:00Z');
    return Math.round((db - da) / 86400000);
  }
  function addDays(dateStr, n) {
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  const daysLeft = endDate => (endDate ? dayDiff(todayStr(), endDate) : 999);

  function getPlayers() {
    if (typeof players !== 'undefined' && Array.isArray(players)) return players;
    return readJson('power_gym_players_v1', []);
  }
  function gymName() {
    if (typeof gymProfile !== 'undefined' && gymProfile && gymProfile.gymName) return gymProfile.gymName;
    return readJson('power_gym_profile_v2', {}).gymName || 'Power Gym';
  }
  function senderName() {
    try { return window.pgCloudSync.getRoleInfo().supervisorName || 'الكابتن'; } catch { return 'الكابتن'; }
  }
  function toIntlPhone(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('07') && d.length === 11) d = '964' + d.slice(1);
    else if (d.startsWith('7') && d.length === 10) d = '964' + d;
    return d;
  }
  function openWa(url) {
    if (typeof openWhatsAppLink === 'function') openWhatsAppLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  }
  function persistPlayers() {
    if (typeof savePlayersToStorage === 'function') savePlayersToStorage();
    else writeJson('power_gym_players_v1', getPlayers());
  }

  /* ---------------- التجميد ---------------- */
  const getFreezes = () => readJson(FREEZE_KEY, []);
  const activeFreeze = pid => getFreezes().find(f => String(f.playerId) === String(pid) && !f.endedAt);
  const isFrozen = pid => Boolean(activeFreeze(pid));

  /* ---------------- القوالب ---------------- */
  const getTemplates = () => Object.assign({}, DEFAULT_TEMPLATES, readJson(TPL_KEY, {}));
  function fillTemplate(kind, p) {
    const d = daysLeft(p.endDate);
    const last = p.lastCheckIn || String(p.createdAt || '').slice(0, 10) || p.startDate;
    return (getTemplates()[kind] || DEFAULT_TEMPLATES[kind] || '')
      .replace(/\{name\}/g, p.name || '')
      .replace(/\{gym\}/g, gymName())
      .replace(/\{date\}/g, p.endDate || '')
      .replace(/\{debt\}/g, money(p.debtAmount))
      .replace(/\{days\}/g, String(kind === 'absent' ? Math.max(0, dayDiff(last, todayStr())) : Math.abs(d)));
  }

  /* ---------------- مركز الواتساب v2 ---------------- */
  let tab = 'expired';

  function buildQueues() {
    const t = todayStr();
    const act = getPlayers().filter(p => !isFrozen(p.id));
    const absentDays = Number(readJson(OPS_KEY, {}).absentDays) || ABSENT_DAYS_DEFAULT;
    return {
      expired: act.filter(p => p.endDate && daysLeft(p.endDate) < 0),
      soon: act.filter(p => p.endDate && daysLeft(p.endDate) >= 0 && daysLeft(p.endDate) <= 3),
      debt: getPlayers().filter(p => Number(p.debtAmount) > 0),
      absent: act.filter(p => {
        if (!p.endDate || daysLeft(p.endDate) < 0) return false;
        const last = p.lastCheckIn || String(p.createdAt || '').slice(0, 10) || p.startDate;
        return last && dayDiff(last, t) >= absentDays;
      }),
      absentDays
    };
  }

  window.openSmartWhatsAppCenter = function (t) {
    if (t && TAB_LABELS[t]) tab = t;
    const old = $('pgSmartWaModal');
    if (old) old.remove();
    const m = document.createElement('div');
    m.id = 'pgSmartWaModal';
    m.className = 'fixed inset-0 z-[88] modal-backdrop flex items-center justify-center p-3 overflow-y-auto';
    m.innerHTML = `
      <section class="card-bg w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl p-5 space-y-4">
        <header class="flex items-center justify-between border-b border-slate-700 pb-3">
          <div>
            <h2 class="text-lg font-black text-white flex items-center gap-2"><i class="fa-brands fa-whatsapp text-emerald-400"></i> مركز إشعارات الواتساب</h2>
            <p class="text-[11px] text-slate-400">الإرسال يُسجَّل ويُزامَن حتى لا يكرر المشرفون نفس الرسالة</p>
          </div>
          <div class="flex gap-2">
            <button onclick="pgOpenTemplates()" class="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-bold text-sky-300"><i class="fa-solid fa-pen"></i> القوالب</button>
            <button onclick="document.getElementById('pgSmartWaModal').remove()" class="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200">إغلاق ✕</button>
          </div>
        </header>
        <div id="pgWaTabs" class="flex flex-wrap gap-2"></div>
        <div id="pgWaQueueList" class="space-y-2.5"></div>
      </section>`;
    document.body.appendChild(m);
    renderQueue();
  };
  window.pgSwitchWaTab = function (t) { tab = t; renderQueue(); };

  function renderQueue() {
    const q = buildQueues();
    const tabs = $('pgWaTabs');
    const box = $('pgWaQueueList');
    if (!tabs || !box) return;
    tabs.innerHTML = Object.keys(TAB_LABELS).map(k => {
      const label = k === 'absent' ? `غائبون ${q.absentDays}+ أيام` : TAB_LABELS[k];
      return `<button onclick="pgSwitchWaTab('${k}')" class="rounded-xl px-3.5 py-2 text-xs ${tab === k ? 'font-black gold-gradient text-black' : 'font-bold bg-slate-800 text-slate-300 hover:bg-slate-700'}">${label} (${q[k].length})</button>`;
    }).join('');

    const items = q[tab];
    if (!items.length) {
      box.innerHTML = '<div class="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center text-sm text-slate-400">لا يوجد لاعبون في هذه القائمة حالياً ✓</div>';
      return;
    }
    const sentLog = readJson(WA_SENT_KEY, {});
    const t = todayStr();
    box.innerHTML = items.map(p => {
      const info = sentLog[`${tab}_${p.id}`];
      const sentToday = info && info.date === t;
      const last = p.lastCheckIn || String(p.createdAt || '').slice(0, 10) || p.startDate;
      const d = daysLeft(p.endDate);
      const status = tab === 'debt' ? `المتبقي: ${money(p.debtAmount)} د.ع`
        : tab === 'absent' ? `آخر حضور: ${safe(last || 'لم يحضر')} (منذ ${dayDiff(last, t)} يوم)`
        : (d < 0 ? `منتهي منذ ${Math.abs(d)} يوم (${safe(p.endDate)})` : (d === 0 ? 'ينتهي اليوم!' : `باقي ${d} يوم (${safe(p.endDate)})`));
      return `
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border ${sentToday ? 'border-emerald-500/30 bg-emerald-950/15' : 'border-slate-800 bg-slate-900/80'} p-3.5">
          <div class="min-w-0">
            <p class="font-black text-white text-sm">${safe(p.name)} <span class="text-[11px] font-normal text-slate-400" dir="ltr">(${safe(p.code || '')})</span></p>
            <p class="text-xs text-sky-300 mt-0.5">${status}</p>
            ${info ? `<p class="text-[10px] text-emerald-400 mt-1">✓ آخر رسالة: ${safe(info.date)} بواسطة ${safe(info.by)}</p>` : ''}
          </div>
          <button onclick="pgSendSmartWa('${safe(p.id)}')" class="rounded-xl ${sentToday ? 'bg-slate-700 text-slate-200' : 'bg-emerald-600 hover:bg-emerald-500 text-white'} px-3.5 py-2 text-xs font-bold flex items-center gap-1.5">
            <i class="fa-brands fa-whatsapp"></i><span>${sentToday ? 'إعادة إرسال' : 'إرسال واتساب'}</span>
          </button>
        </div>`;
    }).join('');
  }

  window.pgSendSmartWa = function (playerId) {
    const p = getPlayers().find(x => String(x.id) === String(playerId));
    if (!p) return;
    const intl = toIntlPhone(p.phone);
    if (!intl) { toast(`رقم هاتف ${p.name} غير صالح للواتساب`, 'error'); return; }
    openWa(`https://wa.me/${intl}?text=${encodeURIComponent(fillTemplate(tab, p))}`);
    const log = readJson(WA_SENT_KEY, {});
    log[`${tab}_${p.id}`] = { date: todayStr(), by: senderName() };
    writeJson(WA_SENT_KEY, log);
    if (typeof logActivity === 'function') logActivity(`إرسال تذكير واتساب (${TAB_LABELS[tab]}) إلى ${p.name}`);
    renderQueue();
  };

  /* ---------------- محرر القوالب ---------------- */
  window.pgOpenTemplates = function () {
    const tpl = getTemplates();
    const ops = readJson(OPS_KEY, {});
    const old = $('pgTplModal');
    if (old) old.remove();
    const m = document.createElement('div');
    m.id = 'pgTplModal';
    m.className = 'fixed inset-0 z-[92] modal-backdrop flex items-center justify-center p-3 overflow-y-auto';
    m.innerHTML = `
      <section class="card-bg w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl p-5 space-y-3">
        <header class="flex items-center justify-between border-b border-slate-700 pb-3">
          <h2 class="text-lg font-black text-white"><i class="fa-solid fa-pen-to-square text-sky-400"></i> قوالب رسائل الواتساب</h2>
          <button onclick="document.getElementById('pgTplModal').remove()" class="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200">إغلاق ✕</button>
        </header>
        <p class="text-[11px] text-slate-400">المتغيرات: <code dir="ltr">{name}</code> اسم اللاعب · <code dir="ltr">{gym}</code> اسم القاعة · <code dir="ltr">{date}</code> تاريخ الانتهاء · <code dir="ltr">{days}</code> الأيام · <code dir="ltr">{debt}</code> الدين</p>
        ${Object.keys(TAB_LABELS).map(k => `
          <div>
            <label class="block text-xs font-bold text-sky-300 mb-1">${TAB_LABELS[k]}</label>
            <textarea id="pgTpl_${k}" rows="3" class="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white">${safe(tpl[k])}</textarea>
          </div>`).join('')}
        <div class="flex items-center gap-2 text-xs text-slate-300">
          <label for="pgAbsentDays" class="font-bold">اعتبار اللاعب غائباً بعد</label>
          <input id="pgAbsentDays" type="number" min="2" max="60" value="${Number(ops.absentDays) || ABSENT_DAYS_DEFAULT}" class="w-16 rounded-lg border border-slate-700 bg-slate-950 p-1.5 text-center text-white" />
          <span>أيام بدون حضور</span>
        </div>
        <div class="flex gap-2 pt-1">
          <button onclick="pgSaveTemplates()" class="flex-1 gold-gradient text-black font-black py-2.5 rounded-xl text-sm">حفظ القوالب</button>
          <button onclick="pgResetTemplates()" class="rounded-xl bg-slate-800 px-4 text-xs font-bold text-slate-300">استعادة الافتراضي</button>
        </div>
      </section>`;
    document.body.appendChild(m);
  };
  window.pgSaveTemplates = function () {
    const next = {};
    Object.keys(TAB_LABELS).forEach(k => { next[k] = ($('pgTpl_' + k).value || '').trim() || DEFAULT_TEMPLATES[k]; });
    writeJson(TPL_KEY, next);
    const ops = readJson(OPS_KEY, {});
    ops.absentDays = Math.min(60, Math.max(2, Number($('pgAbsentDays').value) || ABSENT_DAYS_DEFAULT));
    writeJson(OPS_KEY, ops);
    toast('تم حفظ القوالب ✓', 'success');
    $('pgTplModal')?.remove();
    if ($('pgSmartWaModal')) renderQueue();
  };
  window.pgResetTemplates = function () {
    writeJson(TPL_KEY, {});
    toast('تمت استعادة القوالب الافتراضية', 'info');
    window.pgOpenTemplates();
  };

  /* ---------------- الإرسال التلقائي عبر السيرفر (Meta API) ---------------- */
  window.pgOpenAutoWaModal = function () {
    const old = $('pgAutoWaModal');
    if (old) old.remove();
    const m = document.createElement('div');
    m.id = 'pgAutoWaModal';
    m.className = 'fixed inset-0 z-[94] modal-backdrop flex items-center justify-center p-3 overflow-y-auto';
    m.onclick = e => { if (e.target === m) m.remove(); };
    m.innerHTML = `
      <section class="card-bg w-full max-w-xl rounded-3xl p-5 space-y-4 border border-amber-500/30">
        <header class="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h2 class="text-base font-black text-white flex items-center gap-2">
              <i class="fa-solid fa-robot text-amber-400"></i> الإرسال التلقائي 24/7 (Meta WhatsApp API)
            </h2>
            <p class="text-[11px] text-zinc-400">يعمل عبر Supabase Edge Function + Cron يومياً بدون تدخل بشري</p>
          </div>
          <button onclick="document.getElementById('pgAutoWaModal').remove()" class="rounded-xl bg-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-200">✕</button>
        </header>

        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3.5 text-xs text-zinc-300 space-y-1.5 leading-6">
          <p class="font-black text-amber-300">حالة الربط البرمجي:</p>
          <p>• دالة السيرفر: <code dir="ltr" class="text-emerald-300">supabase/functions/auto-whatsapp-alerts/index.ts</code></p>
          <p>• الجدولة اليومية: <code dir="ltr" class="text-emerald-300">supabase/auto-whatsapp-cron.sql</code> (10:00 ص بغداد)</p>
          <p>• دليل التفعيل الكامل: <code dir="ltr" class="text-amber-200">AUTO_WHATSAPP_SETUP.md</code></p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button type="button" onclick="pgTriggerAutoWa(true)" class="flex-1 rounded-xl bg-zinc-800 hover:bg-zinc-700 py-2.5 px-3 text-xs font-bold text-zinc-100">
            <i class="fa-solid fa-eye ml-1"></i> معاينة المستحقين اليوم (Dry Run)
          </button>
          <button type="button" onclick="pgTriggerAutoWa(false)" class="flex-1 gold-gradient rounded-xl py-2.5 px-3 text-xs font-black">
            <i class="fa-solid fa-paper-plane ml-1"></i> إرسال تلقائي الآن
          </button>
        </div>

        <div id="pgAutoWaResult" class="text-xs text-zinc-300"></div>
      </section>`;
    document.body.appendChild(m);
  };

  window.pgTriggerAutoWa = async function (dryRun) {
    const box = $('pgAutoWaResult');
    if (!window.pgCloudSync) { toast('المزامنة السحابية غير مفعّلة', 'warning'); return; }
    const c = window.pgCloudSync.getConfig();
    if (!c.supabaseUrl || !c.syncSecret) { toast('تأكد من إعدادات السيرفر والمزامنة', 'warning'); return; }
    if (box) box.innerHTML = '<p class="text-amber-300 font-bold py-2">جارٍ الاتصال بالسيرفر...</p>';
    try {
      const res = await fetch(`${c.supabaseUrl}/functions/v1/auto-whatsapp-alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: c.supabaseAnonKey },
        body: JSON.stringify({ gym_id: c.gymId, sync_secret: c.syncSecret, dryRun })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        const msg = data.error === 'missing_whatsapp_env'
          ? 'الدالة منشورة، لكن يجب إضافة مفاتيح Meta (WHATSAPP_TOKEN و WHATSAPP_PHONE_NUMBER_ID) في Supabase Secrets.'
          : (res.status === 404 ? 'الدالة غير منشورة بعد على Supabase — اتبع خطوات AUTO_WHATSAPP_SETUP.md.' : (data.error || `HTTP ${res.status}`));
        if (box) box.innerHTML = `<div class="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-rose-300">${safe(msg)}</div>`;
        return;
      }
      const list = Array.isArray(data.results) ? data.results : [];
      if (box) {
        box.innerHTML = `
          <div class="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 space-y-1.5">
            <p class="font-black text-emerald-300">${dryRun ? `معاينة (${list.length} رسالة مستحقة اليوم)` : `تم الإرسال: ${data.sentCount} | فشل: ${data.failedCount}`}</p>
            ${list.slice(0, 12).map(r => `<p class="text-[11px] text-zinc-300">• ${safe(r.name)} (${safe(r.phone)}) — ${r.kind === 'soon' ? 'قرب الانتهاء' : 'منتهي'} [${safe(r.status)}]</p>`).join('')}
          </div>`;
      }
    } catch {
      if (box) box.innerHTML = '<div class="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-amber-200">تعذر الوصول للدالة على Supabase (تأكد من نشرها عبر `supabase functions deploy auto-whatsapp-alerts --no-verify-jwt`).</div>';
    }
  };

  /* ---------------- تجميد الاشتراك ---------------- */
  let freezeSearch = '';
  window.openFreezeModal = function () {
    const old = $('pgFreezeModal');
    if (old) old.remove();
    const m = document.createElement('div');
    m.id = 'pgFreezeModal';
    m.className = 'fixed inset-0 z-[88] modal-backdrop flex items-center justify-center p-3 overflow-y-auto';
    m.innerHTML = `
      <section class="card-bg w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl p-5 space-y-4">
        <header class="flex items-center justify-between border-b border-slate-700 pb-3">
          <div>
            <h2 class="text-lg font-black text-white"><i class="fa-solid fa-snowflake text-sky-300"></i> تجميد الاشتراكات</h2>
            <p class="text-[11px] text-slate-400">عند إلغاء التجميد تُضاف أيام التجميد لتاريخ انتهاء الاشتراك تلقائياً</p>
          </div>
          <button onclick="document.getElementById('pgFreezeModal').remove()" class="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200">إغلاق ✕</button>
        </header>
        <div id="pgFrozenList" class="space-y-2"></div>
        <div>
          <input id="pgFreezeSearch" oninput="pgFreezeFilter(this.value)" placeholder="ابحث باسم اللاعب أو الكود لتجميد اشتراكه" class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" />
          <div id="pgFreezeResults" class="mt-2 space-y-2"></div>
        </div>
      </section>`;
    document.body.appendChild(m);
    freezeSearch = '';
    renderFreeze();
  };
  window.pgFreezeFilter = v => { freezeSearch = String(v || '').trim().toLowerCase(); renderFreeze(true); };

  function renderFreeze(onlyResults) {
    const list = $('pgFrozenList');
    const res = $('pgFreezeResults');
    if (!list || !res) return;
    if (!onlyResults) {
      const frozen = getFreezes().filter(f => !f.endedAt);
      list.innerHTML = frozen.length
        ? `<p class="text-xs font-black text-sky-300">مجمّدون حالياً (${frozen.length})</p>` + frozen.map(f => `
          <div class="flex items-center justify-between gap-2 rounded-2xl border border-sky-500/30 bg-sky-950/20 p-3">
            <div><p class="text-sm font-black text-white">${safe(f.name)}</p><p class="text-[11px] text-slate-400">مجمّد منذ ${safe(f.startDate)} (${Math.max(0, dayDiff(f.startDate, todayStr()))} يوم)</p></div>
            <button onclick="pgUnfreeze('${safe(f.id)}')" class="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-xs font-bold text-white">إلغاء التجميد</button>
          </div>`).join('')
        : '<p class="text-xs text-slate-500">لا توجد اشتراكات مجمّدة حالياً</p>';
    }
    if (!freezeSearch) { res.innerHTML = ''; return; }
    const found = getPlayers().filter(p => !isFrozen(p.id) && ((p.name || '').toLowerCase().includes(freezeSearch) || String(p.code || '').toLowerCase().includes(freezeSearch) || String(p.phone || '').includes(freezeSearch))).slice(0, 8);
    res.innerHTML = found.map(p => `
      <div class="flex items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
        <div><p class="text-sm font-black text-white">${safe(p.name)} <span class="text-[11px] font-normal text-slate-400" dir="ltr">${safe(p.code || '')}</span></p><p class="text-[11px] text-slate-400">ينتهي: ${safe(p.endDate || '-')}</p></div>
        <button onclick="pgFreeze('${safe(p.id)}')" class="rounded-xl bg-sky-700 hover:bg-sky-600 px-3 py-2 text-xs font-bold text-white">تجميد</button>
      </div>`).join('') || '<p class="text-xs text-slate-500">لا نتائج</p>';
  }

  window.pgFreeze = function (pid) {
    const p = getPlayers().find(x => String(x.id) === String(pid));
    if (!p || isFrozen(pid)) return;
    if (!confirm(`تجميد اشتراك ${p.name}؟`)) return;
    const arr = getFreezes();
    arr.unshift({ id: 'frz_' + Date.now(), playerId: p.id, name: p.name, startDate: todayStr(), endedAt: '', addedDays: 0, by: senderName(), updatedAt: new Date().toISOString() });
    writeJson(FREEZE_KEY, arr);
    if (typeof logActivity === 'function') logActivity(`تجميد اشتراك اللاعب ${p.name}`);
    toast(`تم تجميد اشتراك ${p.name} ❄️`, 'success');
    freezeSearch = '';
    const s = $('pgFreezeSearch'); if (s) s.value = '';
    renderFreeze();
  };

  window.pgUnfreeze = function (fid) {
    const arr = getFreezes();
    const f = arr.find(x => x.id === fid);
    if (!f || f.endedAt) return;
    const days = Math.max(0, dayDiff(f.startDate, todayStr()));
    const p = getPlayers().find(x => String(x.id) === String(f.playerId));
    if (p && p.endDate) {
      p.endDate = addDays(p.endDate, days);
      p.updatedAt = new Date().toISOString();
      persistPlayers();
    }
    f.endedAt = todayStr();
    f.addedDays = days;
    f.updatedAt = new Date().toISOString();
    writeJson(FREEZE_KEY, arr);
    if (typeof logActivity === 'function') logActivity(`إلغاء تجميد ${f.name} وإضافة ${days} يوم لاشتراكه`);
    toast(`تم إلغاء التجميد وإضافة ${days} يوم لاشتراك ${f.name} ✓`, 'success');
    renderFreeze();
  };

  /* ---------------- تقرير الأرباح اليومي ---------------- */
  function computeReport(day) {
    const list = getPlayers();
    const ledger = (typeof financeLedger !== 'undefined' && financeLedger) ? financeLedger : readJson('power_gym_finance_ledger_v2', {});
    const attendance = readJson('pg_attendance_v1', []);
    const sales = readJson('pg_sales_v1', []);

    const attIds = new Set(attendance.filter(a => a.date === day && a.type === 'in').map(a => String(a.playerId)));
    list.forEach(p => { if (p.lastCheckIn === day) attIds.add(String(p.id)); });

    const renewals = (ledger.renewals || []).filter(r => r.date === day);
    const renewIncome = renewals.reduce((s, r) => s + (Number(r.paidAmount) || 0), 0);
    const tx = (ledger.transactions || []).filter(t => (t.date || String(t.createdAt || '').slice(0, 10)) === day);
    const otherIncome = tx.filter(t => t.type === 'income' || !t.type).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const expense = tx.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const debtRows = (ledger.debtPayments || []).filter(d => (d.date || String(d.createdAt || '').slice(0, 10)) === day);
    const debtPaid = debtRows.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const sameDayExtraByPlayer = {};
    debtRows.forEach(d => { sameDayExtraByPlayer[d.playerId] = (sameDayExtraByPlayer[d.playerId] || 0) + (Number(d.amount) || 0); });
    renewals.forEach(r => { sameDayExtraByPlayer[r.playerId] = (sameDayExtraByPlayer[r.playerId] || 0) + (Number(r.paidAmount) || 0); });
    const newPlayers = list.filter(p => String(p.createdAt || '').slice(0, 10) === day);
    const newIncome = newPlayers.reduce((s, p) => s + Math.max(0, (Number(p.paidAmount) || 0) - (sameDayExtraByPlayer[p.id] || 0)), 0);
    const totalDebt = list.reduce((s, p) => s + (Number(p.debtAmount) || 0), 0);
    const salesToday = sales.filter(s => s.date === day).reduce((s, x) => s + (Number(x.total) || 0), 0);
    const q = buildQueues();
    const income = newIncome + renewIncome + otherIncome + debtPaid;
    return {
      day, attendance: attIds.size, newCount: newPlayers.length, newIncome, renewCount: renewals.length, renewIncome,
      otherIncome, debtPaid, salesToday, expense, income, net: income - expense, totalDebt,
      expiredCount: q.expired.length, soonCount: q.soon.length, absentCount: q.absent.length,
      frozenCount: getFreezes().filter(f => !f.endedAt).length
    };
  }

  function reportText(r) {
    return `📊 *تقرير ${gymName()}*\n📅 ${r.day}\n━━━━━━━━━━━━\n` +
      `👥 الحضور: ${r.attendance}\n` +
      `🆕 مشتركون جدد: ${r.newCount} (${money(r.newIncome)} د.ع)\n` +
      `🔄 تجديدات: ${r.renewCount} (${money(r.renewIncome)} د.ع)\n` +
      (r.otherIncome ? `🛒 إيرادات أخرى: ${money(r.otherIncome)} د.ع\n` : '') +
      (r.debtPaid ? `💳 ديون مسددة: ${money(r.debtPaid)} د.ع\n` : '') +
      `━━━━━━━━━━━━\n💰 إجمالي الدخل: ${money(r.income)} د.ع\n` +
      `💸 المصروفات: ${money(r.expense)} د.ع\n✅ *الصافي: ${money(r.net)} د.ع*\n━━━━━━━━━━━━\n` +
      `⚠️ منتهون: ${r.expiredCount} | ينتهون قريباً: ${r.soonCount} | غائبون: ${r.absentCount}\n` +
      `🔴 إجمالي الديون: ${money(r.totalDebt)} د.ع\n` +
      `✍️ أُرسل بواسطة: ${senderName()}`;
  }

  window.openDailyReport = function (day) {
    day = day || todayStr();
    const r = computeReport(day);
    const ops = readJson(OPS_KEY, {});
    const old = $('pgDailyReportModal');
    if (old) old.remove();
    const card = (label, val, cls) => `<div class="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 text-center"><p class="text-[11px] text-slate-400">${label}</p><p class="mt-1 text-base font-black ${cls || 'text-white'}">${val}</p></div>`;
    const m = document.createElement('div');
    m.id = 'pgDailyReportModal';
    m.className = 'fixed inset-0 z-[88] modal-backdrop flex items-center justify-center p-3 overflow-y-auto';
    m.innerHTML = `
      <section class="card-bg w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl p-5 space-y-4">
        <header class="flex items-center justify-between border-b border-slate-700 pb-3">
          <h2 class="text-lg font-black text-white"><i class="fa-solid fa-chart-pie text-emerald-400"></i> تقرير الأرباح اليومي</h2>
          <button onclick="document.getElementById('pgDailyReportModal').remove()" class="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200">إغلاق ✕</button>
        </header>
        <div class="flex items-center gap-2 text-xs text-slate-300">
          <span class="font-bold">التاريخ:</span>
          <input type="date" value="${day}" onchange="openDailyReport(this.value)" class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-white" />
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
          ${card('الحضور', r.attendance, 'text-sky-300')}
          ${card('مشتركون جدد', r.newCount)}
          ${card('التجديدات', r.renewCount)}
          ${card('مبيعات المخزن', money(r.salesToday))}
          ${card('إجمالي الدخل', money(r.income), 'text-emerald-400')}
          ${card('المصروفات', money(r.expense), 'text-rose-400')}
          ${card('الصافي', money(r.net), r.net >= 0 ? 'text-emerald-400' : 'text-rose-400')}
          ${card('إجمالي الديون', money(r.totalDebt), 'text-sky-400')}
        </div>
        <pre class="whitespace-pre-wrap rounded-2xl bg-slate-950 border border-slate-800 p-3 text-[11px] leading-6 text-slate-300">${safe(reportText(r))}</pre>
        <div class="space-y-2 rounded-2xl border border-slate-700/80 bg-slate-900/70 p-3.5">
          <label class="block text-xs font-bold text-emerald-300">رقم واتساب الكابتن لاستلام التقرير</label>
          <div class="flex gap-2">
            <input id="pgCaptainPhone" value="${safe(ops.captainPhone || '')}" placeholder="07801234567" dir="ltr" class="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
            <button onclick="pgSendDailyReport('${day}')" class="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 text-xs font-black text-white"><i class="fa-brands fa-whatsapp"></i> إرسال</button>
            <button onclick="pgCopyDailyReport('${day}')" class="rounded-xl bg-slate-800 px-3 text-xs font-bold text-slate-200">نسخ</button>
          </div>
        </div>
      </section>`;
    document.body.appendChild(m);
  };

  window.pgSendDailyReport = function (day) {
    const phone = ($('pgCaptainPhone')?.value || '').trim();
    const intl = toIntlPhone(phone);
    if (!intl) { toast('أدخل رقم واتساب الكابتن أولاً', 'warning'); return; }
    const ops = readJson(OPS_KEY, {});
    ops.captainPhone = phone;
    ops.lastReportSent = todayStr();
    writeJson(OPS_KEY, ops);
    openWa(`https://wa.me/${intl}?text=${encodeURIComponent(reportText(computeReport(day)))}`);
  };
  window.pgCopyDailyReport = async function (day) {
    try { await navigator.clipboard.writeText(reportText(computeReport(day))); toast('تم نسخ التقرير ✓', 'success'); }
    catch { prompt('انسخ التقرير:', reportText(computeReport(day))); }
  };

  /* ---------------- إبلاغ المدير بوضع القاعة (من المشرف لواتساب المدير) ---------------- */
  const CROWD_LABELS = { low: 'هادئ 🟢', medium: 'متوسط 🟡', high: 'مزدحم 🔴' };

  window.openSupervisorGymReportModal = function () {
    const ops = readJson(OPS_KEY, {});
    const crowd = readJson('pg_crowd_status_v1', { iron: 'medium', cardio: 'low' });
    const reports = readJson('pg_gym_status_reports_v1', []);
    const old = $('pgSupStatusModal');
    if (old) old.remove();

    const m = document.createElement('div');
    m.id = 'pgSupStatusModal';
    m.className = 'fixed inset-0 z-[90] modal-backdrop flex items-center justify-center p-3 overflow-y-auto';
    m.onclick = e => { if (e.target === m) m.remove(); };
    m.innerHTML = `
      <section class="card-bg w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl p-5 space-y-4">
        <header class="flex items-center justify-between border-b border-slate-700 pb-3">
          <div>
            <h2 class="text-lg font-black text-white flex items-center gap-2">
              <i class="fa-brands fa-whatsapp text-emerald-400"></i> إبلاغ المدير بوضع القاعة
            </h2>
            <p class="text-[11px] text-slate-400">يرسل إشعاراً فورياً من واتساب المشرف إلى واتساب المدير ويُحدّث الحالة</p>
          </div>
          <button onclick="document.getElementById('pgSupStatusModal').remove()" class="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200">إغلاق ✕</button>
        </header>

        <div class="grid md:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-sky-300 mb-1">حالة قسم الحديد</label>
            <select id="pgSupIron" class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white">
              <option value="low" ${crowd.iron === 'low' ? 'selected' : ''}>هادئ 🟢</option>
              <option value="medium" ${crowd.iron === 'medium' ? 'selected' : ''}>متوسط 🟡</option>
              <option value="high" ${crowd.iron === 'high' ? 'selected' : ''}>مزدحم 🔴</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold text-sky-300 mb-1">حالة قسم الكارديو</label>
            <select id="pgSupCardio" class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white">
              <option value="low" ${crowd.cardio === 'low' ? 'selected' : ''}>هادئ 🟢</option>
              <option value="medium" ${crowd.cardio === 'medium' ? 'selected' : ''}>متوسط 🟡</option>
              <option value="high" ${crowd.cardio === 'high' ? 'selected' : ''}>مزدحم 🔴</option>
            </select>
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold text-sky-300 mb-1">الوضع العام للقاعة</label>
          <select id="pgSupCondition" class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white">
            <option value="مفتوحة وتعمل بشكل طبيعي ✅">مفتوحة وتعمل بشكل طبيعي ✅</option>
            <option value="ازدحام شديد في القاعة 🔥">ازدحام شديد في القاعة 🔥</option>
            <option value="عطل أو صيانة في أحد الأجهزة 🔧">عطل أو صيانة في أحد الأجهزة 🔧</option>
            <option value="نقص في المخزن / المشروبات 📦">نقص في المخزن / المشروبات 📦</option>
            <option value="ملاحظة طارئة / إغلاق مؤقت ⚠️">ملاحظة طارئة / إغلاق مؤقت ⚠️</option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-300 mb-1">ملاحظة المشرف للمدير</label>
          <textarea id="pgSupNote" rows="3" maxlength="350" placeholder="مثلاً: القاعة ممتازة، جهاز الكيبل يحتاج شد سلك، حضور اليوم قوي..." class="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white"></textarea>
        </div>

        <div class="rounded-2xl border border-emerald-500/25 bg-emerald-950/20 p-3.5 space-y-2">
          <label class="block text-xs font-bold text-emerald-300">رقم واتساب المدير (يُحفظ ويصل لكل المشرفين)</label>
          <input id="pgSupManagerPhone" value="${safe(ops.captainPhone || '')}" placeholder="07801234567" dir="ltr" class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
        </div>

        <button onclick="pgSendSupervisorGymReport()" class="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 py-3 text-xs font-black text-white flex items-center justify-center gap-2">
          <i class="fa-brands fa-whatsapp text-base"></i> حفظ وإرسال الإشعار للمدير على واتساب
        </button>

        ${reports.length ? `
          <div class="border-t border-slate-800 pt-3 space-y-2">
            <p class="text-xs font-black text-slate-300">آخر البلاغات المرسلة:</p>
            ${reports.slice(0, 3).map(r => `
              <div class="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5 text-[11px] text-slate-300">
                <div class="flex justify-between text-sky-300 font-bold">
                  <span>${safe(r.by)} — ${safe(r.condition)}</span>
                  <span class="text-slate-500">${safe(r.time)}</span>
                </div>
                <p class="mt-1">الحديد: ${CROWD_LABELS[r.iron] || r.iron} · الكارديو: ${CROWD_LABELS[r.cardio] || r.cardio}</p>
                ${r.note ? `<p class="mt-0.5 text-slate-400">${safe(r.note)}</p>` : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}
      </section>
    `;
    document.body.appendChild(m);
  };

  window.pgSendSupervisorGymReport = function () {
    const phone = ($('pgSupManagerPhone')?.value || '').trim();
    const intl = toIntlPhone(phone);
    if (!intl) {
      toast('أدخل رقم واتساب المدير أولاً', 'warning');
      return;
    }

    const iron = $('pgSupIron')?.value || 'medium';
    const cardio = $('pgSupCardio')?.value || 'low';
    const condition = $('pgSupCondition')?.value || 'مفتوحة وتعمل بشكل طبيعي ✅';
    const note = ($('pgSupNote')?.value || '').trim();
    const nowTime = new Date().toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
    const day = todayStr();
    const attToday = readJson('pg_attendance_v1', []).filter(a => a.date === day && a.type === 'in').length;

    const ops = readJson(OPS_KEY, {});
    ops.captainPhone = phone;
    writeJson(OPS_KEY, ops);

    writeJson('pg_crowd_status_v1', { iron, cardio, updatedAt: new Date().toISOString() });

    const reports = readJson('pg_gym_status_reports_v1', []);
    reports.unshift({
      id: 'rep_' + Date.now(),
      by: senderName(),
      iron,
      cardio,
      condition,
      note,
      date: day,
      time: `${day} ${nowTime}`,
      updatedAt: new Date().toISOString()
    });
    if (reports.length > 30) reports.length = 30;
    writeJson('pg_gym_status_reports_v1', reports);

    if (typeof logActivity === 'function') logActivity(`بلاغ وضع القاعة للمدير: ${condition}`);

    const msg = [
      `📢 *بلاغ وضع القاعة — ${gymName()}*`,
      `👤 المبلّغ: *${senderName()}*`,
      `🕒 الوقت: ${day} (${nowTime})`,
      `━━━━━━━━━━━━`,
      `🏋️ قسم الحديد: ${CROWD_LABELS[iron] || iron}`,
      `🏃 قسم الكارديو: ${CROWD_LABELS[cardio] || cardio}`,
      `👥 حضور اليوم: ${attToday} لاعب`,
      `📌 الوضع العام: *${condition}*`,
      note ? `📝 ملاحظة: ${note}` : ''
    ].filter(Boolean).join('\n');

    openWa(`https://wa.me/${intl}?text=${encodeURIComponent(msg)}`);
    toast('تم حفظ البلاغ وفتح واتساب لإشعار المدير ✅', 'success');
    window.openSupervisorGymReportModal();
  };

  /* ---------------- الواجهة ---------------- */
  function injectLinks() {
    if (document.querySelector('[data-nav-key="smart-ops"]')) return true;
    const sec = $('pgSmartToolsNav');
    if (!sec || $('pgOpsNav')) return false;
    const wrap = document.createElement('div');
    wrap.id = 'pgOpsNav';
    wrap.className = 'space-y-1';
    wrap.innerHTML = `
      <button class="sidebar-link" onclick="openSupervisorGymReportModal(); closeMobileMenu?.()"><i class="fa-solid fa-bullhorn text-emerald-400"></i><span>إبلاغ المدير بوضع القاعة</span></button>
      <button class="sidebar-link" onclick="openDailyReport(); closeMobileMenu?.()"><i class="fa-solid fa-chart-pie text-emerald-400"></i><span>تقرير الأرباح اليومي</span></button>
      <button class="sidebar-link" onclick="openFreezeModal(); closeMobileMenu?.()"><i class="fa-solid fa-snowflake text-sky-300"></i><span>تجميد الاشتراكات</span></button>
      <button class="sidebar-link" onclick="openSmartWhatsAppCenter('absent'); closeMobileMenu?.()"><i class="fa-solid fa-user-clock text-sky-400"></i><span>تنبيه الغياب</span></button>
      <button class="sidebar-link" onclick="pgOpenTemplates(); closeMobileMenu?.()"><i class="fa-solid fa-pen-to-square text-sky-400"></i><span>قوالب الواتساب</span></button>`;
    sec.appendChild(wrap);
    return true;
  }

  function dailyReminder() {
    const ops = readJson(OPS_KEY, {});
    const h = new Date().getHours();
    if (h >= 21 && ops.lastReportSent !== todayStr() && getPlayers().length) {
      toast('📊 تقرير اليوم جاهز — افتحه من القائمة وأرسله للكابتن', 'info');
    }
  }

  function init() {
    if (!injectLinks()) setTimeout(injectLinks, 600);
    setTimeout(dailyReminder, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
