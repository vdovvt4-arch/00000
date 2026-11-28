/* =========================================================
   smart-accounting.js — المحاسب الذكي والمرن لقاعة Power Gym
   تصفية حسب الفترة (اليوم / الأسبوع / الشهر / مخصص) + تصنيف مصروفات
   + توقع الدخل + أرشفة الشهر + تعديل وحذف الحركات
   ========================================================= */
(function () {
  'use strict';

  const ARCHIVE_KEY = 'pg_accounting_archives_v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Math.round(Number(n) || 0).toLocaleString('en-US') + ' د.ع';
  const todayStr = () => (typeof window.getBaghdadDateString === 'function' ? window.getBaghdadDateString() : new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10));
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'info'); };

  const EXP_CATS = ['كهرباء ومولدة', 'رواتب ومدربين', 'صيانة أجهزة', 'مستلزمات ونظافة', 'إيجار ومصاريف عامة'];
  const INC_CATS = ['اشتراك يومي', 'مشروبات وبروتين', 'تدريب خاص (PT)', 'إيراد متفرق'];

  let rangeMode = 'all'; // today | week | month | all | custom
  let customFrom = todayStr().slice(0, 7) + '-01';
  let customTo = todayStr();

  function getPlayers() {
    return (typeof players !== 'undefined' && Array.isArray(players)) ? players : [];
  }

  function getLedger() {
    if (typeof financeLedger !== 'undefined' && financeLedger) return financeLedger;
    try { return JSON.parse(localStorage.getItem('power_gym_finance_ledger_v2') || '{}'); } catch { return {}; }
  }

  function saveLedger() {
    if (typeof saveFinanceLedgerToStorage === 'function') saveFinanceLedgerToStorage();
    if (typeof renderFinanceSummary === 'function') renderFinanceSummary();
  }

  function getBounds() {
    const t = todayStr();
    if (rangeMode === 'today') return [t, t];
    if (rangeMode === 'week') {
      const d = new Date(t + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - 6);
      return [d.toISOString().slice(0, 10), t];
    }
    if (rangeMode === 'month') return [t.slice(0, 7) + '-01', t];
    if (rangeMode === 'custom') return [customFrom || '2000-01-01', customTo || t];
    return ['2000-01-01', '2099-12-31'];
  }

  function inRange(dateStr, from, to) {
    const d = String(dateStr || '').slice(0, 10);
    if (!d) return rangeMode === 'all';
    return d >= from && d <= to;
  }

  function computeAccounting() {
    const list = getPlayers();
    const ledger = getLedger();
    const [from, to] = getBounds();

    const renewals = (ledger.renewals || []).filter(r => inRange(r.date, from, to));
    const debtPays = (ledger.debtPayments || []).filter(d => inRange(d.date || d.createdAt, from, to));
    const txAll = (ledger.transactions || []).filter(t => inRange(t.date || t.createdAt, from, to));

    let subsIncome = 0;
    if (rangeMode === 'all') {
      // في الوضع الكلي: paidAmount تتضمن الاشتراكات + التجديدات + تسديد الديون
      subsIncome = list.reduce((s, p) => s + (Number(p.paidAmount) || 0), 0);
    } else {
      const extraByPlayer = {};
      (ledger.renewals || []).filter(r => inRange(r.date, from, to)).forEach(r => {
        extraByPlayer[r.playerId] = (extraByPlayer[r.playerId] || 0) + (Number(r.paidAmount) || 0);
      });
      (ledger.debtPayments || []).filter(d => inRange(d.date || d.createdAt, from, to)).forEach(d => {
        extraByPlayer[d.playerId] = (extraByPlayer[d.playerId] || 0) + (Number(d.amount) || 0);
      });
      const newSubs = list
        .filter(p => inRange(p.createdAt || p.startDate, from, to))
        .reduce((s, p) => s + Math.max(0, (Number(p.paidAmount) || 0) - (extraByPlayer[p.id] || 0)), 0);
      const renewSum = renewals.reduce((s, r) => s + (Number(r.paidAmount) || 0), 0);
      const debtSum = debtPays.reduce((s, d) => s + (Number(d.amount) || 0), 0);
      subsIncome = newSubs + renewSum + debtSum;
    }

    const txIncome = txAll.filter(t => t.type === 'income' || !t.type).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const txExpense = txAll.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const manualAdj = rangeMode === 'all' ? (Number(ledger.manualProfitAdjustment) || 0) : 0;

    const totalIncome = subsIncome + txIncome + manualAdj;
    const netProfit = totalIncome - txExpense;
    const margin = totalIncome > 0 ? Math.round((netProfit / totalIncome) * 100) : 0;

    const totalDebt = Math.max(0, list.reduce((s, p) => s + (Number(p.debtAmount) || 0), 0) + (Number(ledger.manualDebtAdjustment) || 0));
    const activePlayers = list.filter(p => p.endDate && p.endDate >= todayStr());
    const avgPrice = activePlayers.length
      ? Math.round(activePlayers.reduce((s, p) => s + (Number(p.paidAmount) || 0), 0) / activePlayers.length)
      : 25000;
    const expectedNextMonth = activePlayers.length * Math.min(avgPrice, 50000);

    return {
      from, to, subsIncome, txIncome, txExpense, manualAdj, totalIncome, netProfit, margin,
      totalDebt, activeCount: activePlayers.length, expectedNextMonth, txList: txAll
    };
  }

  window.openSmartAccountingModal = function () {
    const old = $('pgAccountingModal');
    if (old) old.remove();
    const m = document.createElement('div');
    m.id = 'pgAccountingModal';
    m.className = 'fixed inset-0 z-[90] modal-backdrop flex items-center justify-center p-3 overflow-y-auto';
    m.onclick = e => { if (e.target === m) m.remove(); };
    m.innerHTML = `<section id="pgAccountingBody" class="card-bg w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-3xl p-5 space-y-4"></section>`;
    document.body.appendChild(m);
    renderAccounting();
  };

  function renderAccounting() {
    const body = $('pgAccountingBody');
    if (!body) return;
    const a = computeAccounting();
    const archives = (() => { try { return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]'); } catch { return []; } })();

    const rangeBtn = (k, label) => `<button type="button" onclick="pgAccSetRange('${k}')" class="rounded-xl px-3 py-1.5 text-xs ${rangeMode === k ? 'gold-gradient text-black font-black' : 'bg-slate-800 text-slate-300 font-bold hover:bg-slate-700'}">${label}</button>`;
    const kpi = (label, val, cls) => `<div class="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 text-center"><p class="text-[11px] text-slate-400">${label}</p><p class="mt-1 text-base font-black ${cls || 'text-white'}">${val}</p></div>`;

    body.innerHTML = `
      <header class="flex items-center justify-between border-b border-slate-700 pb-3">
        <div>
          <h2 class="text-lg font-black text-white flex items-center gap-2">
            <i class="fa-solid fa-calculator text-cyan-400"></i> المحاسب الذكي والمرن
          </h2>
          <p class="text-[11px] text-slate-400">تحليل الدخل، المصروفات، هامش الربح، وتوقع الشهر القادم</p>
        </div>
        <button onclick="document.getElementById('pgAccountingModal').remove()" class="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200">إغلاق ✕</button>
      </header>

      <div class="flex flex-wrap items-center gap-2">
        ${rangeBtn('today', 'اليوم')}
        ${rangeBtn('week', 'آخر 7 أيام')}
        ${rangeBtn('month', 'هذا الشهر')}
        ${rangeBtn('all', 'الإجمالي الكلي')}
        ${rangeBtn('custom', 'فترة مخصصة')}
        ${rangeMode === 'custom' ? `
          <div class="flex items-center gap-1.5 text-xs">
            <input type="date" value="${esc(customFrom)}" onchange="pgAccCustomDates(this.value, null)" class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-white">
            <span class="text-slate-400">إلى</span>
            <input type="date" value="${esc(customTo)}" onchange="pgAccCustomDates(null, this.value)" class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-white">
          </div>
        ` : ''}
      </div>

      <div class="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        ${kpi('دخل الاشتراكات', money(a.subsIncome), 'text-sky-300')}
        ${kpi('إيرادات أخرى', money(a.txIncome), 'text-cyan-300')}
        ${kpi('المصروفات', money(a.txExpense), 'text-rose-400')}
        ${kpi('صافي الربح', money(a.netProfit), a.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400')}
        ${kpi('هامش الربح', a.margin + '%', a.margin >= 50 ? 'text-emerald-300' : 'text-sky-300')}
      </div>

      <div class="grid md:grid-cols-3 gap-2.5 text-xs">
        <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 flex items-center justify-between">
          <span class="text-slate-400">الديون المستحقة:</span>
          <strong class="text-rose-300">${money(a.totalDebt)}</strong>
        </div>
        <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 flex items-center justify-between">
          <span class="text-slate-400">اللاعبون الفعّالون:</span>
          <strong class="text-sky-300">${a.activeCount} لاعب</strong>
        </div>
        <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 flex items-center justify-between">
          <span class="text-slate-400">توقع الشهر القادم:</span>
          <strong class="text-emerald-400">${money(a.expectedNextMonth)}</strong>
        </div>
      </div>

      <!-- إضافة حركة مالية سريعة -->
      <div class="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-4 space-y-3">
        <p class="text-xs font-black text-sky-300">تسجيل حركة مالية سريعة (مصروف أو إيراد)</p>
        <div class="grid grid-cols-1 md:grid-cols-5 gap-2">
          <select id="pgAccType" onchange="pgAccUpdateCats()" class="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white">
            <option value="expense">مصروف (-)</option>
            <option value="income">إيراد (+)</option>
          </select>
          <select id="pgAccCat" class="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white">
            ${EXP_CATS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
          <input id="pgAccDesc" placeholder="تفاصيل (اختياري)" class="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white">
          <input id="pgAccAmt" type="number" min="500" step="500" placeholder="المبلغ (د.ع)" class="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white">
          <button type="button" onclick="pgAccAddTx()" class="gold-gradient rounded-xl py-2 px-4 text-xs font-black">تسجيل الحركة</button>
        </div>
      </div>

      <!-- جدول الحركات + أرشفة -->
      <div class="grid md:grid-cols-2 gap-3">
        <div class="rounded-2xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-2 max-h-60 overflow-y-auto">
          <p class="text-xs font-black text-slate-200">سجل المصروفات والإيرادات (${a.txList.length})</p>
          ${a.txList.length ? a.txList.slice(0, 30).map(tx => `
            <div class="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs">
              <div class="min-w-0">
                <p class="font-bold text-white truncate">${esc(tx.description || 'حركة مالية')}</p>
                <p class="text-[10px] text-slate-500">${esc(tx.date || '')}</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="font-black ${tx.type === 'expense' ? 'text-rose-400' : 'text-emerald-400'}">${tx.type === 'expense' ? '-' : '+'}${money(tx.amount)}</span>
                <button type="button" onclick="pgAccDeleteTx('${esc(tx.id)}')" class="text-rose-400 hover:text-rose-300 text-[11px]" title="حذف"><i class="fa-solid fa-trash"></i></button>
              </div>
            </div>
          `).join('') : '<p class="text-xs text-slate-500 py-4 text-center">لا توجد حركات في هذه الفترة</p>'}
        </div>

        <div class="rounded-2xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-2 max-h-60 overflow-y-auto">
          <div class="flex items-center justify-between">
            <p class="text-xs font-black text-slate-200">أرشيف إغلاق الأشهر (${archives.length})</p>
            <button type="button" onclick="pgAccArchiveMonth()" class="rounded-lg bg-sky-700 hover:bg-sky-600 px-2.5 py-1 text-[10px] font-bold text-white">أرشفة لقطة الآن</button>
          </div>
          ${archives.length ? archives.slice(0, 12).map(ar => `
            <div class="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-[11px] flex items-center justify-between">
              <span class="text-slate-300 font-bold">${esc(ar.label)}</span>
              <span class="font-black text-emerald-400">${money(ar.netProfit)}</span>
            </div>
          `).join('') : '<p class="text-xs text-slate-500 py-4 text-center">اضغط "أرشفة لقطة الآن" لحفظ صافي ربح الشهر في الأرشيف</p>'}
        </div>
      </div>
    `;
  }

  window.pgAccSetRange = m => { rangeMode = m; renderAccounting(); };
  window.pgAccCustomDates = (f, t) => { if (f) customFrom = f; if (t) customTo = t; renderAccounting(); };

  window.pgAccUpdateCats = function () {
    const type = $('pgAccType')?.value || 'expense';
    const sel = $('pgAccCat');
    if (!sel) return;
    const list = type === 'expense' ? EXP_CATS : INC_CATS;
    sel.innerHTML = list.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  };

  window.pgAccAddTx = function () {
    const type = $('pgAccType')?.value || 'expense';
    const cat = $('pgAccCat')?.value || '';
    const desc = ($('pgAccDesc')?.value || '').trim();
    const amount = Number($('pgAccAmt')?.value || 0);
    if (!(amount > 0)) { toast('أدخل مبلغاً صحيحاً', 'warning'); return; }
    const ledger = getLedger();
    ledger.transactions = Array.isArray(ledger.transactions) ? ledger.transactions : [];
    ledger.transactions.unshift({
      id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type,
      amount,
      description: desc ? `${cat}: ${desc}` : cat,
      date: todayStr(),
      createdAt: new Date().toISOString()
    });
    saveLedger();
    if (typeof logActivity === 'function') logActivity(`تسجيل ${type === 'expense' ? 'مصروف' : 'إيراد'}: ${cat} (${amount})`);
    toast('تم تسجيل الحركة المالية ✓', 'success');
    renderAccounting();
  };

  window.pgAccDeleteTx = function (id) {
    if (!confirm('حذف هذه الحركة المالية؟')) return;
    const ledger = getLedger();
    ledger.transactions = (ledger.transactions || []).filter(t => t.id !== id);
    saveLedger();
    toast('تم حذف الحركة', 'info');
    renderAccounting();
  };

  window.pgAccArchiveMonth = function () {
    const a = computeAccounting();
    const label = prompt('اسم اللقطة / الشهر للأرشفة:', todayStr().slice(0, 7));
    if (!label) return;
    let archives = [];
    try { archives = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]'); } catch { archives = []; }
    archives.unshift({ id: 'arc_' + Date.now(), label: label.trim(), netProfit: a.netProfit, totalIncome: a.totalIncome, txExpense: a.txExpense, date: todayStr() });
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archives));
    toast('تمت أرشفة لقطة الأرباح بنجاح ✓', 'success');
    renderAccounting();
  };

  function injectLink() {
    if (document.querySelector('[data-nav-key="smart-accounting"]')) return true;
    const finSection = Array.from(document.querySelectorAll('#desktopSidebar nav section'))[1];
    if (!finSection || $('pgAccountingNavBtn')) return false;
    const b = document.createElement('button');
    b.id = 'pgAccountingNavBtn';
    b.className = 'sidebar-link';
    b.onclick = () => { window.openSmartAccountingModal(); if (typeof closeMobileMenu === 'function') closeMobileMenu(); };
    b.innerHTML = '<i class="fa-solid fa-calculator text-cyan-400"></i><span>المحاسب الذكي</span>';
    finSection.insertBefore(b, finSection.children[1] || null);
    return true;
  }

  function init() { if (!injectLink()) setTimeout(injectLink, 600); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
