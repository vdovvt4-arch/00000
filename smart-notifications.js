/* =========================================================
   smart-notifications.js — مركز إشعارات الكابتن والمشرفين
   جرس إشعارات حي في الهيدر + تنبيه تلقائي عند الفتح + إشعارات الجهاز
   ========================================================= */
(function () {
  'use strict';

  const LAST_POPUP_KEY = 'pg_last_notif_popup_v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayStr = () => new Date().toISOString().slice(0, 10);

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

  function dayDiff(a, b) {
    const da = new Date(String(a).slice(0, 10) + 'T00:00:00Z');
    const db = new Date(String(b).slice(0, 10) + 'T00:00:00Z');
    return Math.round((db - da) / 86400000);
  }

  function collectAlerts() {
    const t = todayStr();
    const frozen = getFrozenSet();
    const list = getPlayers().filter(p => !frozen.has(String(p.id)));
    const alerts = [];

    list.forEach(p => {
      if (p.endDate) {
        const left = dayDiff(t, p.endDate);
        if (left < 0) {
          alerts.push({
            level: 'expired',
            title: `اشتراك منتهي: ${p.name}`,
            sub: `انتهى منذ ${Math.abs(left)} يوم (${p.endDate})`,
            action: `openSmartWhatsAppCenter?.('expired')`,
            btn: 'إشعار واتساب'
          });
        } else if (left <= 3) {
          alerts.push({
            level: 'soon',
            title: left === 0 ? `ينتهي اليوم: ${p.name}` : `ينتهي قريباً: ${p.name}`,
            sub: left === 0 ? `ينتهي اشتراكه اليوم (${p.endDate})` : `باقي ${left} يوم (${p.endDate})`,
            action: `openSmartWhatsAppCenter?.('soon')`,
            btn: 'تذكير واتساب'
          });
        }
      }
      if (Number(p.debtAmount) > 0) {
        alerts.push({
          level: 'debt',
          title: `دين مستحق: ${p.name}`,
          sub: `المتبقي: ${Number(p.debtAmount).toLocaleString('en-US')} د.ع`,
          action: `openSmartWhatsAppCenter?.('debt')`,
          btn: 'مطالبة واتساب'
        });
      }
    });

    return alerts;
  }

  function updateBellBadge() {
    const badge = $('pgNotifCount');
    if (!badge) return;
    const alerts = collectAlerts();
    const count = alerts.length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('hidden', count === 0);
  }

  window.pgToggleNotifPanel = function () {
    const existing = $('pgNotifModal');
    if (existing) { existing.remove(); return; }

    const alerts = collectAlerts();
    const canNotify = ('Notification' in window);
    const perm = canNotify ? Notification.permission : 'unsupported';

    const m = document.createElement('div');
    m.id = 'pgNotifModal';
    m.className = 'fixed inset-0 z-[92] modal-backdrop flex items-start justify-center p-4 pt-16 overflow-y-auto';
    m.onclick = e => { if (e.target === m) m.remove(); };

    const colors = {
      expired: 'border-rose-500/35 bg-rose-950/20 text-rose-300',
      soon: 'border-sky-500/35 bg-sky-950/20 text-sky-300',
      debt: 'border-cyan-500/30 bg-cyan-950/15 text-cyan-300'
    };

    m.innerHTML = `
      <section class="card-bg w-full max-w-lg max-h-[82vh] overflow-y-auto rounded-3xl p-4 space-y-3 border border-cyan-500/30 shadow-2xl">
        <header class="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <div>
            <h3 class="text-sm font-black text-white flex items-center gap-2">
              <i class="fa-solid fa-bell text-cyan-400"></i> مركز تنبيهات القاعة (${alerts.length})
            </h3>
            <p class="text-[10px] text-slate-400">تنبيهات فورية للكابتن والمشرفين</p>
          </div>
          <div class="flex items-center gap-1.5">
            ${canNotify && perm !== 'granted' ? `<button type="button" onclick="pgEnableSystemNotifs()" class="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-2.5 py-1 text-[10px] font-bold text-white">تفعيل إشعارات الجهاز</button>` : ''}
            <button type="button" onclick="document.getElementById('pgNotifModal').remove()" class="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-300">✕</button>
          </div>
        </header>
        <div class="space-y-2">
          ${alerts.length ? alerts.slice(0, 40).map(a => `
            <div class="flex items-center justify-between gap-2 rounded-2xl border p-3 ${colors[a.level] || ''}">
              <div class="min-w-0">
                <p class="text-xs font-black text-white truncate">${esc(a.title)}</p>
                <p class="text-[11px] mt-0.5">${esc(a.sub)}</p>
              </div>
              <button type="button" onclick="document.getElementById('pgNotifModal').remove(); ${a.action}" class="shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-white">${esc(a.btn)}</button>
            </div>
          `).join('') : '<p class="py-8 text-center text-xs text-slate-400">لا توجد تنبيهات عاجلة حالياً — كل الاشتراكات منتظمة ✓</p>'}
        </div>
      </section>
    `;
    document.body.appendChild(m);
  };

  window.pgEnableSystemNotifs = async function () {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      if (typeof showToast === 'function') showToast('تم تفعيل إشعارات الجهاز بنجاح 🔔', 'success');
      sendSystemNotificationIfNeeded(true);
      const m = $('pgNotifModal');
      if (m) { m.remove(); window.pgToggleNotifPanel(); }
    } else if (typeof showToast === 'function') {
      showToast('لم يتم منح إذن الإشعارات من المتصفح', 'warning');
    }
  };

  function sendSystemNotificationIfNeeded(force) {
    const alerts = collectAlerts();
    if (!alerts.length) return;
    const today = todayStr();
    const expiredCount = alerts.filter(a => a.level === 'expired').length;
    const soonCount = alerts.filter(a => a.level === 'soon').length;
    const debtCount = alerts.filter(a => a.level === 'debt').length;

    if (!force && sessionStorage.getItem(LAST_POPUP_KEY) === today) return;
    sessionStorage.setItem(LAST_POPUP_KEY, today);

    const parts = [];
    if (expiredCount) parts.push(`${expiredCount} منتهي`);
    if (soonCount) parts.push(`${soonCount} ينتهي قريباً`);
    if (debtCount) parts.push(`${debtCount} عليه دين`);
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
    btn.title = 'تنبيهات الاشتراكات والديون';
    btn.className = 'relative flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs font-bold text-slate-200 hover:border-cyan-400/50 transition';
    btn.innerHTML = `
      <i class="fa-solid fa-bell text-cyan-400 text-sm"></i>
      <span id="pgNotifCount" class="hidden -mt-3 -mr-1 rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-black text-white">0</span>
    `;
    const refChild = headerRow.children[1];
    if (refChild) headerRow.insertBefore(btn, refChild);
    else headerRow.appendChild(btn);

    updateBellBadge();
  }

  function init() {
    injectBell();
    setInterval(updateBellBadge, 5000);
    setTimeout(() => {
      updateBellBadge();
      sendSystemNotificationIfNeeded(false);
    }, 2200);
    window.addEventListener('pg-phonedb-restored', () => setTimeout(updateBellBadge, 400));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
