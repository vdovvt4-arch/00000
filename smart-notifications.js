/* =========================================================
   smart-notifications.js — مركز الإشعارات المتطور v3.0
   تصنيفات ذكية + أولوية + حذف إشعار فردي / مسح الكل / استعادة + إشعارات الجهاز
   ========================================================= */
(function () {
  'use strict';

  const LAST_POPUP_KEY = 'pg_last_notif_popup_v1';
  const DISMISSED_KEY = 'pg_dismissed_notifs_v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayStr = () => (typeof window.getBaghdadDateString === 'function' ? window.getBaghdadDateString() : new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10));

  let activeTab = 'all';

  function getPlayers() {
    if (typeof players !== 'undefined' && Array.isArray(players)) return players;
    try { return JSON.parse(localStorage.getItem('power_gym_players_v1') || '[]'); } catch { return []; }
  }

  function getFrozenSet() {
    try {
      const arr = JSON.parse(localStorage.getItem('pg_freezes_v1') || '[]');
      return new Set(arr.filter(f => !f.endedAt).map(f => String(f.playerId)));
    } catch { return new Set(); }
  }

  function getDismissedSet() {
    try {
      const arr = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
      return new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch { return new Set(); }
  }

  function saveDismissedSet(set) {
    try {
      const arr = Array.from(set).slice(-300);
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr));
    } catch { /* ignore */ }
  }

  function dayDiff(a, b) {
    const da = new Date(String(a).slice(0, 10) + 'T00:00:00Z');
    const db = new Date(String(b).slice(0, 10) + 'T00:00:00Z');
    return Math.round((db - da) / 86400000);
  }

  function collectAllAlertsRaw() {
    const t = todayStr();
    const frozen = getFrozenSet();
    const list = getPlayers().filter(p => !frozen.has(String(p.id)));
    const alerts = [];

    list.forEach(p => {
      if (p.endDate) {
        const left = dayDiff(t, p.endDate);
        if (left < 0) {
          alerts.push({
            id: `exp_${p.id}_${p.endDate}`,
            priority: 1,
            level: 'expired',
            cat: 'expired',
            icon: 'fa-circle-xmark text-rose-400',
            title: `اشتراك منتهي: ${p.name}`,
            sub: `انتهى منذ ${Math.abs(left)} يوم (${p.endDate})`,
            action: `openSmartWhatsAppCenter?.('expired')`,
            btn: 'إشعار واتساب'
          });
        } else if (left <= 3) {
          alerts.push({
            id: `soon_${p.id}_${p.endDate}`,
            priority: 2,
            level: 'soon',
            cat: 'soon',
            icon: 'fa-clock text-amber-400',
            title: left === 0 ? `ينتهي اليوم: ${p.name}` : `ينتهي قريباً: ${p.name}`,
            sub: left === 0 ? `ينتهي اشتراكه اليوم (${p.endDate})` : `باقي ${left} يوم (${p.endDate})`,
            action: `openSmartWhatsAppCenter?.('soon')`,
            btn: 'تذكير واتساب'
          });
        }
      }
      if (Number(p.debtAmount) > 0) {
        alerts.push({
          id: `debt_${p.id}_${Number(p.debtAmount)}`,
          priority: 3,
          level: 'debt',
          cat: 'debt',
          icon: 'fa-hand-holding-dollar text-amber-300',
          title: `دين مستحق: ${p.name}`,
          sub: `المتبقي: ${Number(p.debtAmount).toLocaleString('en-US')} د.ع`,
          action: `openSmartWhatsAppCenter?.('debt')`,
          btn: 'مطالبة واتساب'
        });
      }
    });

    try {
      const inv = JSON.parse(localStorage.getItem('pg_inventory_v1') || '[]');
      if (Array.isArray(inv)) {
        inv.filter(it => Number(it.qty) <= 2).forEach(it => {
          const out = Number(it.qty) <= 0;
          alerts.push({
            id: `stock_${it.id}_${Number(it.qty)}`,
            priority: out ? 1 : 4,
            level: out ? 'expired' : 'stock',
            cat: 'stock',
            icon: out ? 'fa-box-open text-rose-400' : 'fa-boxes-stacked text-amber-400',
            title: out ? `نفد من المخزن: ${it.name}` : `مخزون منخفض: ${it.name}`,
            sub: out ? 'الكمية 0 — غير متوفر بالمتجر' : `المتبقي ${it.qty} قطعة فقط`,
            action: `pgOpenInventory?.()`,
            btn: 'فتح المخزن'
          });
        });
      }
    } catch { /* ignore */ }

    alerts.sort((a, b) => a.priority - b.priority);
    return alerts;
  }

  function collectAlerts() {
    const dismissed = getDismissedSet();
    return collectAllAlertsRaw().filter(a => !dismissed.has(a.id));
  }

  function updateBellBadge() {
    const badge = $('pgNotifCount');
    if (!badge) return;
    const count = collectAlerts().length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('hidden', count === 0);
  }

  window.pgDismissNotif = function (id) {
    const set = getDismissedSet();
    set.add(String(id));
    saveDismissedSet(set);
    updateBellBadge();
    renderNotifModalBody();
  };

  window.pgClearAllNotifs = function () {
    const alerts = collectAllAlertsRaw();
    if (!alerts.length) return;
    const set = getDismissedSet();
    alerts.forEach(a => set.add(a.id));
    saveDismissedSet(set);
    updateBellBadge();
    renderNotifModalBody();
    if (typeof showToast === 'function') showToast('تم مسح جميع الإشعارات الحالية ✓', 'info');
  };

  window.pgRestoreNotifs = function () {
    localStorage.removeItem(DISMISSED_KEY);
    updateBellBadge();
    renderNotifModalBody();
    if (typeof showToast === 'function') showToast('تمت استعادة الإشعارات المحذوفة ✓', 'success');
  };

  window.pgSetNotifTab = function (t) {
    activeTab = t;
    renderNotifModalBody();
  };

  function renderNotifModalBody() {
    const body = $('pgNotifBody');
    if (!body) return;

    const allRaw = collectAllAlertsRaw();
    const dismissed = getDismissedSet();
    const alerts = allRaw.filter(a => !dismissed.has(a.id));
    const dismissedCount = allRaw.length - alerts.length;
    const filtered = activeTab === 'all' ? alerts : alerts.filter(a => a.cat === activeTab);

    const canNotify = ('Notification' in window);
    const perm = canNotify ? Notification.permission : 'unsupported';

    const countOf = c => (c === 'all' ? alerts.length : alerts.filter(a => a.cat === c).length);
    const tabs = [
      ['all', 'الكل'],
      ['expired', 'منتهي'],
      ['soon', 'قريباً'],
      ['debt', 'ديون'],
      ['stock', 'المخزن']
    ];

    const colors = {
      expired: 'border-rose-500/35 bg-rose-950/20 text-rose-300',
      soon: 'border-amber-500/35 bg-amber-950/20 text-amber-300',
      debt: 'border-amber-400/30 bg-zinc-900/90 text-amber-200',
      stock: 'border-sky-500/30 bg-sky-950/20 text-sky-300'
    };

    body.innerHTML = `
      <header class="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
        <div>
          <h3 class="text-base font-black text-white flex items-center gap-2">
            <i class="fa-solid fa-bell text-amber-400"></i> مركز الإشعارات (${alerts.length})
          </h3>
          <p class="text-[10px] text-zinc-400">مرتبة حسب الأولوية — يمكنك حذف أي إشعار أو مسح الكل</p>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          ${canNotify && perm !== 'granted' ? `<button type="button" onclick="pgEnableSystemNotifs()" class="rounded-lg bg-amber-500/20 border border-amber-500/35 hover:bg-amber-500/30 px-2.5 py-1 text-[10px] font-bold text-amber-300">إشعارات الجهاز</button>` : ''}
          ${alerts.length ? `<button type="button" onclick="pgClearAllNotifs()" class="rounded-lg bg-rose-500/15 border border-rose-500/30 hover:bg-rose-500/25 px-2.5 py-1 text-[10px] font-bold text-rose-300"><i class="fa-solid fa-trash-can ml-1"></i>مسح الكل</button>` : ''}
          ${dismissedCount > 0 ? `<button type="button" onclick="pgRestoreNotifs()" class="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1 text-[10px] font-bold text-zinc-300">استعادة (${dismissedCount})</button>` : ''}
          <button type="button" onclick="document.getElementById('pgNotifModal').remove()" class="rounded-lg bg-zinc-800 px-2.5 py-1 text-xs font-bold text-zinc-200">✕</button>
        </div>
      </header>

      <div class="flex flex-wrap gap-1.5">
        ${tabs.map(([k, lbl]) => `
          <button type="button" onclick="pgSetNotifTab('${k}')" class="rounded-xl px-3 py-1.5 text-[11px] font-bold transition ${activeTab === k ? 'gold-gradient font-black' : 'bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-amber-500/40'}">
            ${lbl} (${countOf(k)})
          </button>
        `).join('')}
      </div>

      <div class="space-y-2 max-h-[58vh] overflow-y-auto pr-0.5">
        ${filtered.length ? filtered.slice(0, 60).map(a => `
          <div class="flex items-center justify-between gap-2 rounded-2xl border p-3 ${colors[a.level] || ''}">
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
              <div class="w-8 h-8 rounded-xl bg-black/40 flex items-center justify-center shrink-0">
                <i class="fa-solid ${a.icon}"></i>
              </div>
              <div class="min-w-0">
                <p class="text-xs font-black text-white truncate">${esc(a.title)}</p>
                <p class="text-[11px] mt-0.5 opacity-90">${esc(a.sub)}</p>
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button type="button" onclick="document.getElementById('pgNotifModal').remove(); ${a.action}" class="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-white">${esc(a.btn)}</button>
              <button type="button" onclick="pgDismissNotif('${esc(a.id)}')" title="حذف هذا الإشعار" aria-label="حذف الإشعار" class="w-8 h-8 rounded-xl bg-zinc-900/90 hover:bg-rose-600 text-zinc-400 hover:text-white flex items-center justify-center text-xs transition">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>
        `).join('') : '<p class="py-10 text-center text-xs text-zinc-400">لا توجد إشعارات في هذا التصنيف ✓</p>'}
      </div>
    `;
  }

  window.pgToggleNotifPanel = function () {
    const existing = $('pgNotifModal');
    if (existing) { existing.remove(); return; }

    const m = document.createElement('div');
    m.id = 'pgNotifModal';
    m.className = 'fixed inset-0 z-[92] modal-backdrop flex items-start justify-center p-4 pt-16 overflow-y-auto';
    m.onclick = e => { if (e.target === m) m.remove(); };
    m.innerHTML = `<section id="pgNotifBody" class="card-bg w-full max-w-xl rounded-3xl p-4 space-y-3 border border-amber-500/30 shadow-2xl"></section>`;
    document.body.appendChild(m);
    renderNotifModalBody();
  };

  window.pgEnableSystemNotifs = async function () {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      if (typeof showToast === 'function') showToast('تم تفعيل إشعارات الجهاز بنجاح 🔔', 'success');
      sendSystemNotificationIfNeeded(true);
      renderNotifModalBody();
    } else if (typeof showToast === 'function') {
      showToast('لم يتم منح إذن الإشعارات من المتصفح', 'warning');
    }
  };

  function sendSystemNotificationIfNeeded(force) {
    const alerts = collectAlerts();
    if (!alerts.length) return;
    const today = todayStr();
    const expiredCount = alerts.filter(a => a.cat === 'expired').length;
    const soonCount = alerts.filter(a => a.cat === 'soon').length;
    const debtCount = alerts.filter(a => a.cat === 'debt').length;
    const stockCount = alerts.filter(a => a.cat === 'stock').length;

    if (!force && sessionStorage.getItem(LAST_POPUP_KEY) === today) return;
    sessionStorage.setItem(LAST_POPUP_KEY, today);

    const parts = [];
    if (expiredCount) parts.push(`${expiredCount} منتهي`);
    if (soonCount) parts.push(`${soonCount} ينتهي قريباً`);
    if (debtCount) parts.push(`${debtCount} عليه دين`);
    if (stockCount) parts.push(`${stockCount} نقص مخزن`);
    const summary = `تنبيه القاعة: ${parts.join(' · ')}`;

    if (typeof showToast === 'function') showToast(`🔔 ${summary}`, 'warning');

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Power Gym — تنبيه القاعة', { body: summary, icon: './icon-192.png' });
      } catch { /* ignore */ }
    }
  }

  function injectBell() {
    if ($('pgNotifBell')) return;
    const headerRow = document.querySelector('header.sticky .mx-auto');
    if (!headerRow) return;
    const btn = document.createElement('button');
    btn.id = 'pgNotifBell';
    btn.type = 'button';
    btn.onclick = window.pgToggleNotifPanel;
    btn.title = 'مركز الإشعارات';
    btn.className = 'relative flex items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-xs font-bold text-zinc-200 hover:border-amber-400/50 transition';
    btn.innerHTML = `
      <i class="fa-solid fa-bell text-amber-400 text-sm"></i>
      <span id="pgNotifCount" class="hidden -mt-3 -mr-1 rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-black text-white">0</span>
    `;
    const refChild = headerRow.children[1];
    if (refChild) headerRow.insertBefore(btn, refChild);
    else headerRow.appendChild(btn);

    updateBellBadge();
  }

  function init() {
    injectBell();
    setInterval(updateBellBadge, 4000);
    setTimeout(() => {
      updateBellBadge();
      sendSystemNotificationIfNeeded(false);
    }, 2000);
    window.addEventListener('pg-phonedb-restored', () => setTimeout(updateBellBadge, 400));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
