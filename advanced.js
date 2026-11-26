/* Power Gym Advanced Pack 3.0 — Inventory & Sales <-> Store Bridge, Attendance, Daily Close */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const KEYS = {
    attendance: 'pg_attendance_v1',
    inventory: 'pg_inventory_v1',
    sales: 'pg_sales_v1',
    trainers: 'pg_trainers_v1',
    closes: 'pg_daily_closes_v1'
  };
  const read = (k, fallback = []) => {
    try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return Array.isArray(v) ? v : fallback; }
    catch { return fallback; }
  };
  const write = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) {
      console.error(e);
      if (typeof showToast === 'function') showToast('تعذر الحفظ: مساحة التخزين غير كافية', 'error');
      return false;
    }
  };

  let attendance = read(KEYS.attendance);
  let inventory = read(KEYS.inventory);
  let sales = read(KEYS.sales);
  let trainers = read(KEYS.trainers);
  let closes = read(KEYS.closes);

  const money = n => (Number(n) || 0).toLocaleString('en-US') + ' د.ع';
  const today = () => new Date().toISOString().slice(0, 10);
  const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function modal(title, body) {
    let el = $('pgAdvancedModal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pgAdvancedModal';
      el.className = 'fixed inset-0 z-[80] modal-backdrop flex items-center justify-center p-3 overflow-y-auto';
      document.body.appendChild(el);
    }
    el.innerHTML = `<section class="card-bg w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-3xl p-4 md:p-6"><header class="flex items-center justify-between gap-3 border-b border-zinc-800 pb-3 mb-4"><h2 class="text-lg font-black text-white">${title}</h2><button onclick="pgCloseAdvanced()" class="rounded-xl bg-zinc-800 px-3 py-2 text-xs font-bold text-zinc-200">إغلاق ✕</button></header>${body}</section>`;
  }

  window.pgCloseAdvanced = () => {
    const el = $('pgAdvancedModal');
    if (el) el.remove();
    if (window.pgStopScanner) window.pgStopScanner();
  };

  function addNav() {
    if (document.querySelector('[data-nav-key="attendance"]')) return;
    const nav = document.querySelector('#desktopSidebar nav');
    if (!nav || $('pgAdvancedNav')) return;
    const sec = document.createElement('section');
    sec.id = 'pgAdvancedNav';
    sec.className = 'space-y-1';
    sec.innerHTML = `<p class="px-3 pb-1 text-[10px] font-black text-slate-500">الإدارة المتقدمة</p>
      <button class="sidebar-link" onclick="pgOpenAttendance();closeMobileMenu?.()"><i class="fa-solid fa-clipboard-check"></i><span>الحضور والانصراف</span></button>
      <button class="sidebar-link" onclick="pgOpenInventory();closeMobileMenu?.()"><i class="fa-solid fa-boxes-stacked"></i><span>المخزن والمبيعات</span></button>`;
    nav.appendChild(sec);
  }

  // ---------- Attendance ----------
  function recordAttendance(rawCode) {
    let code = String(rawCode || '').trim();
    if (code.startsWith('PowerGym|')) {
      code = String(code.split('|')[1] || '').trim();
    }
    const p = (typeof players !== 'undefined' ? players : []).find(x =>
      String(x.code).toLowerCase() === code.toLowerCase() ||
      String(x.phone) === code ||
      String(x.id) === code
    );
    if (!p) { showToast?.('لم يتم العثور على لاعب بهذا الكود أو الرقم', 'error'); return; }
    if (p.endDate && p.endDate < today()) { showToast?.('الاشتراك منتهي؛ لم يتم تسجيل الدخول', 'warning'); return; }
    const duplicate = attendance.find(a => a.playerId === p.id && a.date === today() && a.type === 'in');
    if (duplicate) { showToast?.('تم تسجيل حضور هذا اللاعب اليوم مسبقاً', 'info'); return; }
    const row = { id: 'att_' + Date.now(), playerId: p.id, code: p.code, name: p.name, date: today(), time: new Date().toLocaleTimeString('ar-IQ'), type: 'in' };
    attendance.unshift(row);
    p.attendanceCount = (Number(p.attendanceCount) || 0) + 1;
    p.lastCheckIn = today();
    write(KEYS.attendance, attendance);
    if (typeof savePlayersToStorage === 'function') savePlayersToStorage();
    if (typeof logActivity === 'function') logActivity(`تسجيل حضور اللاعب ${p.name} (${p.code})`);
    showToast?.(`تم تسجيل حضور ${p.name}`, 'success');
    renderAttendance();
  }

  function renderAttendance() {
    const list = attendance.filter(a => a.date === today());
    const body = list.map(a => `<tr class="border-t border-zinc-800"><td class="p-2">${safe(a.name)}</td><td class="p-2" dir="ltr">${safe(a.code)}</td><td class="p-2">${safe(a.time)}</td></tr>`).join('');
    const target = $('pgAttendanceRows');
    if (target) target.innerHTML = body || '<tr><td colspan="3" class="p-4 text-center text-zinc-500">لا توجد تسجيلات اليوم</td></tr>';
    const count = $('pgAttendanceCount');
    if (count) count.textContent = list.length;
  }

  window.pgOpenAttendance = () => {
    modal('الحضور والانصراف', `
      <div class="grid md:grid-cols-2 gap-3 mb-4">
        <div class="rounded-2xl bg-zinc-900 p-4 border border-zinc-800">
          <p class="text-xs text-zinc-400">حضور اليوم</p>
          <strong id="pgAttendanceCount" class="text-3xl text-emerald-400">0</strong>
        </div>
        <div class="rounded-2xl bg-zinc-900 p-4 border border-zinc-800">
          <label class="block text-xs text-zinc-300 mb-2">كود العضوية أو رقم الهاتف</label>
          <div class="flex gap-2">
            <input id="pgAttendCode" class="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white text-sm" placeholder="PG-0001"/>
            <button onclick="pgAttendSubmit()" class="rounded-xl gold-gradient px-4 font-black text-xs">تسجيل</button>
          </div>
          <button onclick="pgStartScanner()" class="mt-2 text-xs text-amber-300 font-bold">فتح قارئ QR بالكاميرا</button>
          <div id="pgScannerBox" class="mt-2"></div>
        </div>
      </div>
      <div class="overflow-x-auto rounded-xl border border-zinc-800">
        <table class="w-full text-right text-sm"><thead class="bg-zinc-900"><tr><th class="p-2">اللاعب</th><th class="p-2">الكود</th><th class="p-2">الوقت</th></tr></thead><tbody id="pgAttendanceRows"></tbody></table>
      </div>`);
    renderAttendance();
  };

  window.pgAttendSubmit = () => { const x = $('pgAttendCode'); if (x) { recordAttendance(x.value); x.value = ''; x.focus(); } };

  let scanStream = null, scanTimer = null;
  window.pgStopScanner = () => { if (scanTimer) clearInterval(scanTimer); if (scanStream) scanStream.getTracks().forEach(t => t.stop()); scanStream = null; scanTimer = null; };
  window.pgStartScanner = async () => {
    const box = $('pgScannerBox');
    if (!('BarcodeDetector' in window)) { box.textContent = 'قارئ QR غير مدعوم في هذا المتصفح. استخدم إدخال الكود يدوياً.'; return; }
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      box.innerHTML = '<video id="pgScanVideo" autoplay playsinline class="w-full max-h-56 rounded-xl"></video>';
      const v = $('pgScanVideo');
      v.srcObject = scanStream;
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      scanTimer = setInterval(async () => {
        try {
          const codes = await detector.detect(v);
          if (codes[0]?.rawValue) { recordAttendance(codes[0].rawValue); pgStopScanner(); box.innerHTML = ''; }
        } catch { /* ignore */ }
      }, 500);
    } catch {
      box.textContent = 'تعذر تشغيل الكاميرا. تحقق من الإذن.';
    }
  };

  // ---------- Inventory & Sales <-> Store Bridge ----------
  function refreshInventoryCache() {
    inventory = read(KEYS.inventory);
    sales = read(KEYS.sales);
  }

  function recordSaleInternal(item, qtySold, sourceLabel, saleId, salePrice) {
    if (saleId) {
      const existingSale = sales.find(s => s.id === saleId);
      const existingIncome = typeof financeLedger !== 'undefined' && Array.isArray(financeLedger.transactions)
        ? financeLedger.transactions.find(tx => tx.id === `tx_sale_${saleId}`)
        : null;
      if (existingSale || existingIncome) {
        const existingCost = existingIncome && financeLedger.transactions.find(tx => tx.id === `tx_cost_${saleId}`);
        const sale = existingSale || {
          id: saleId,
          total: Number(existingIncome.amount) || 0,
          costTotal: Number(existingCost && existingCost.amount) || 0,
          profit: (Number(existingIncome.amount) || 0) - (Number(existingCost && existingCost.amount) || 0)
        };
        return { sale, remainingQty: item.qty, duplicate: true };
      }
    }
    const q = Math.max(1, Number(qtySold) || 1);
    item.qty = Math.max(0, (Number(item.qty) || 0) - q);
    const unitPrice = Number.isFinite(Number(salePrice)) ? Math.max(0, Number(salePrice)) : (Number(item.price) || 0);
    const total = q * unitPrice;
    const costTotal = q * (Number(item.cost) || 0);
    const profit = total - costTotal;
    const s = {
      id: saleId || ('sale_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5)),
      itemId: item.id,
      name: item.name,
      qty: q,
      total,
      costTotal,
      profit,
      source: sourceLabel || 'المخزن',
      date: today(),
      time: new Date().toLocaleTimeString('ar-IQ')
    };
    sales.unshift(s);
    if (sales.length > 200) sales.length = 200;
    write(KEYS.inventory, inventory);
    write(KEYS.sales, sales);

    if (typeof financeLedger !== 'undefined') {
      financeLedger.transactions = Array.isArray(financeLedger.transactions) ? financeLedger.transactions : [];
      const createdAt = new Date().toISOString();
      const addTransaction = tx => {
        if (!financeLedger.transactions.some(existing => existing.id === tx.id)) {
          financeLedger.transactions.unshift(tx);
        }
      };
      addTransaction({
        id: `tx_sale_${s.id}`,
        type: 'income',
        amount: total,
        title: `${sourceLabel || 'مبيعات مخزن'}: ${item.name} × ${q}`,
        description: `${sourceLabel || 'مبيعات مخزن'}: ${item.name} × ${q}`,
        date: today(),
        createdAt
      });
      if (costTotal > 0) {
        addTransaction({
          id: `tx_cost_${s.id}`,
          type: 'expense',
          amount: costTotal,
          title: `تكلفة ${sourceLabel || 'مبيعات مخزن'}: ${item.name} × ${q}`,
          description: `تكلفة ${sourceLabel || 'مبيعات مخزن'}: ${item.name} × ${q}`,
          date: today(),
          createdAt
        });
      }
      if (typeof saveFinanceLedgerToStorage === 'function') saveFinanceLedgerToStorage();
    }
    return { sale: s, remainingQty: item.qty };
  }

  function syncItemToStoreIfConnected(item, silent = true) {
    if (window.PGStoreBridge && typeof window.PGStoreBridge.syncInventoryItem === 'function') {
      return window.PGStoreBridge.syncInventoryItem(item, silent);
    }
    return Promise.resolve(false);
  }

  function renderInventory() {
    refreshInventoryCache();
    const el = $('pgInventoryRows');
    if (!el) return;
    el.innerHTML = inventory.map((p, i) => `
      <tr class="border-t border-zinc-800/80 hover:bg-zinc-900/40">
        <td class="p-2.5">
          <div class="font-bold text-white">${safe(p.name)}</div>
          <div class="flex flex-wrap gap-1 mt-0.5">
            ${p.category ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-bold">${safe(p.category)}</span>` : ''}
            ${p.storeProductId ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-bold">مربوط بالمتجر ✓</span>` : ''}
          </div>
        </td>
        <td class="p-2.5 font-black ${p.qty <= 0 ? 'text-rose-400' : p.qty <= 3 ? 'text-amber-400' : 'text-emerald-400'}">${p.qty}</td>
        <td class="p-2.5 font-bold text-zinc-200">
          <div>${money(p.price)}</div>
          ${Number(p.cost) > 0 ? `<div class="text-[10px] text-zinc-400">التكلفة: ${money(p.cost)} · ربح القطعة: <b class="text-emerald-400">${money(p.price - p.cost)}</b></div>` : ''}
        </td>
        <td class="p-2.5">
          <div class="flex flex-wrap gap-1.5">
            <button onclick="pgSellItem(${i})" class="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1 text-xs font-bold text-white">بيع</button>
            <button onclick="pgSetItemCost(${i})" class="rounded-lg bg-cyan-900/60 hover:bg-cyan-800 px-2.5 py-1 text-xs font-bold text-cyan-200">${Number(p.cost) > 0 ? 'تعديل التكلفة' : 'إضافة التكلفة'}</button>
            <button onclick="pgPushItemToStore(${i})" class="rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 px-2.5 py-1 text-xs font-bold text-amber-300" title="نشر أو تحديث في المتجر">
              <i class="fa-solid fa-store ml-1"></i>${p.storeProductId ? 'تحديث المتجر' : 'نشر بالمتجر'}
            </button>
            <button onclick="pgDeleteItem(${i})" class="rounded-lg bg-rose-900/70 hover:bg-rose-800 px-2.5 py-1 text-xs font-bold text-rose-200">حذف</button>
          </div>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="4" class="p-6 text-center text-zinc-500">المخزن فارغ</td></tr>';

    const salesBox = $('pgRecentSalesBox');
    if (salesBox) {
      const todaySales = sales.filter(s => s.date === today());
      const totalToday = todaySales.reduce((acc, x) => acc + (Number(x.total) || 0), 0);
      const profitToday = todaySales.reduce((acc, x) => acc + (typeof x.profit === 'number' ? x.profit : (Number(x.total) || 0)), 0);
      salesBox.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span class="text-xs font-black text-amber-300">سجل المبيعات الأخيرة (${todaySales.length} اليوم)</span>
          <div class="flex items-center gap-3 text-xs font-black">
            <span class="text-emerald-400">مبيعات اليوم: ${money(totalToday)}</span>
            <span class="text-amber-300">الربح الصافي: ${money(profitToday)}</span>
          </div>
        </div>
        <div class="space-y-1.5 max-h-40 overflow-y-auto">
          ${sales.slice(0, 10).map(s => `
            <div class="flex items-center justify-between rounded-xl bg-zinc-900/80 border border-zinc-800 px-3 py-1.5 text-xs">
              <div><b class="text-white">${safe(s.name)}</b> × ${s.qty} <span class="text-[10px] text-zinc-400">(${safe(s.source || 'المخزن')})</span></div>
              <div class="flex items-center gap-2">
                <span class="text-emerald-400 font-black">${money(s.total)}</span>
                ${typeof s.profit === 'number' && s.costTotal > 0 ? `<span class="text-[10px] text-amber-300">(ربح: ${money(s.profit)})</span>` : ''}
                <span class="text-[10px] text-zinc-500">${safe(s.date)}</span>
              </div>
            </div>
          `).join('') || '<p class="text-xs text-zinc-500 text-center py-2">لا توجد مبيعات مسجلة بعد</p>'}
        </div>`;
    }
  }

  window.pgOpenInventory = () => {
    refreshInventoryCache();
    modal('المخزن والمبيعات (مربوط بالمتجر)', `
      <form onsubmit="pgAddItem(event)" class="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4 bg-zinc-900/70 p-3 rounded-2xl border border-zinc-800">
        <input id="pgItemName" required maxlength="60" placeholder="اسم المنتج *" class="col-span-2 rounded-xl bg-zinc-950 border border-zinc-700 p-2.5 text-xs text-white"/>
        <input id="pgItemCat" maxlength="40" placeholder="القسم (مثلاً: بروتين)" class="rounded-xl bg-zinc-950 border border-zinc-700 p-2.5 text-xs text-white"/>
        <input id="pgItemQty" required type="number" min="0" placeholder="الكمية *" class="rounded-xl bg-zinc-950 border border-zinc-700 p-2.5 text-xs text-white"/>
        <input id="pgItemCost" type="number" min="0" placeholder="سعر الشراء (اختياري)" class="rounded-xl bg-zinc-950 border border-zinc-700 p-2.5 text-xs text-white"/>
        <input id="pgItemPrice" required type="number" min="0" placeholder="سعر البيع *" class="rounded-xl bg-zinc-950 border border-zinc-700 p-2.5 text-xs text-white"/>
        <label class="col-span-2 md:col-span-4 flex items-center gap-2 text-xs font-bold text-zinc-300 cursor-pointer px-1">
          <input id="pgItemPublishStore" type="checkbox" checked class="accent-amber-400 w-4 h-4">
          <span>نشر المنتج في متجر بور جم تلقائياً (يتطلب تسجيل دخول المتجر)</span>
        </label>
        <button class="col-span-2 rounded-xl gold-gradient py-2.5 text-xs font-black">إضافة للمخزن</button>
      </form>
      <div class="overflow-x-auto rounded-2xl border border-zinc-800 mb-4">
        <table class="w-full text-right text-xs">
          <thead class="bg-zinc-900 text-zinc-300"><tr><th class="p-2.5">المنتج</th><th class="p-2.5">المخزون</th><th class="p-2.5">السعر</th><th class="p-2.5">إجراء</th></tr></thead>
          <tbody id="pgInventoryRows"></tbody>
        </table>
      </div>
      <div id="pgRecentSalesBox" class="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3"></div>`);
    renderInventory();
  };

  window.pgAddItem = async e => {
    e.preventDefault();
    const name = $('pgItemName').value.trim();
    const category = ($('pgItemCat')?.value || '').trim();
    const qty = Number($('pgItemQty').value);
    const cost = Math.max(0, Number($('pgItemCost')?.value) || 0);
    const price = Number($('pgItemPrice').value);
    const publish = $('pgItemPublishStore')?.checked;
    if (!name || qty < 0 || price < 0) return;

    const item = {
      id: 'itm_' + Date.now(),
      name,
      category,
      qty,
      cost,
      price,
      storeProductId: ''
    };
    inventory.unshift(item);
    write(KEYS.inventory, inventory);
    showToast?.('تمت إضافة المنتج للمخزن ✓', 'success');

    if (publish) {
      await syncItemToStoreIfConnected(item, false);
      write(KEYS.inventory, inventory);
    }
    pgOpenInventory();
  };

  window.pgPushItemToStore = async i => {
    const item = inventory[i];
    if (!item) return;
    const ok = await syncItemToStoreIfConnected(item, false);
    if (ok) {
      write(KEYS.inventory, inventory);
      renderInventory();
    }
  };

  window.pgSetItemCost = i => {
    refreshInventoryCache();
    const item = inventory[i];
    if (!item) return;
    const value = prompt(`سعر شراء الوحدة من ${item.name} (د.ع):`, String(Number(item.cost) || 0));
    if (value === null) return;
    const cost = Number(value);
    if (!Number.isFinite(cost) || cost < 0) {
      showToast?.('أدخل تكلفة صحيحة وغير سالبة.', 'warning');
      return;
    }
    item.cost = cost;
    write(KEYS.inventory, inventory);
    renderInventory();
    showToast?.('تم تحديث تكلفة المنتج. ستُستخدم في حساب صافي ربح المبيعات القادمة.', 'success');
  };

  window.pgDeleteItem = i => {
    if (!confirm('حذف المنتج من المخزن؟')) return;
    inventory.splice(i, 1);
    write(KEYS.inventory, inventory);
    renderInventory();
  };

  window.pgSellItem = async i => {
    const p = inventory[i];
    if (!p || p.qty < 1) { showToast?.('الكمية غير متوفرة', 'warning'); return; }
    const q = Math.max(1, Math.floor(Number(prompt(`كمية البيع من ${p.name}؟`, 1) || 0)));
    if (!q || q > p.qty) { showToast?.('الكمية المدخلة غير صحيحة', 'error'); return; }

    const { sale } = recordSaleInternal(p, q, 'مبيعات مخزن');
    showToast?.(`تم تسجيل البيع: ${money(sale.total)}`, 'success');
    if (p.storeProductId && p.qty <= 0) {
      await syncItemToStoreIfConnected(p, true);
    }
    renderInventory();
  };

  // ---------- Bridge for store-admin.js ----------
  window.PGInventoryBridge = {
    getAll: () => read(KEYS.inventory),
    linkStoreProduct: (invId, storeProductId) => {
      refreshInventoryCache();
      const it = inventory.find(x => x.id === invId);
      if (it) {
        it.storeProductId = storeProductId;
        write(KEYS.inventory, inventory);
      }
    },
    upsertFromStoreProduct: (prod, defaultQty = 10) => {
      refreshInventoryCache();
      let it = inventory.find(x => x.storeProductId === prod.id || x.name.trim() === String(prod.name || '').trim());
      if (!it) {
        it = {
          id: 'itm_' + Date.now(),
          name: prod.name,
          category: '',
          qty: prod.available ? defaultQty : 0,
          price: Number(prod.price) || 0,
          storeProductId: prod.id
        };
        inventory.unshift(it);
      } else {
        it.storeProductId = prod.id;
        it.price = Number(prod.price) || it.price;
      }
      write(KEYS.inventory, inventory);
      return it;
    },
    deductOnStoreDelivery: (productId, productName, qtyDelivered, reservationId, salePrice) => {
      refreshInventoryCache();
      const it = inventory.find(x => x.storeProductId === productId || x.name.trim() === String(productName || '').trim());
      const saleId = reservationId ? `sale_store_${reservationId}` : undefined;
      const priorSale = saleId && sales.find(s => s.id === saleId);
      if (priorSale) {
        return {
          matched: Boolean(it),
          recorded: false,
          duplicate: true,
          outOfStock: Boolean(it && it.qty <= 0),
          remainingQty: it ? it.qty : 0,
          total: priorSale.total,
          costTotal: priorSale.costTotal,
          profit: priorSale.profit,
          costKnown: Boolean(it && Number(it.cost) > 0)
        };
      }
      const q = Math.max(1, Number(qtyDelivered) || 1);
      const price = Number.isFinite(Number(salePrice)) && Number(salePrice) >= 0
        ? Number(salePrice)
        : (it ? Number(it.price) || 0 : NaN);
      if (!Number.isFinite(price)) return { matched: Boolean(it), recorded: false, reason: 'price_unavailable' };
      const saleItem = it || { id: productId || saleId, name: productName || 'منتج المتجر', qty: 0, cost: 0, price };
      const res = recordSaleInternal(saleItem, q, 'بيع من المتجر', saleId, price);
      return {
        matched: Boolean(it),
        recorded: !res.duplicate,
        duplicate: Boolean(res.duplicate),
        outOfStock: Boolean(it && res.remainingQty <= 0),
        remainingQty: res.remainingQty,
        total: res.sale.total,
        costTotal: res.sale.costTotal,
        profit: res.sale.profit,
        costKnown: Boolean(it && Number(it.cost) > 0)
      };
    }
  };

  // ---------- Coach Invite & Trainers ----------
  window.pgOpenCoachInvite = () => {
    const inviteUrl = typeof getCoachRegistrationUrl === 'function' ? getCoachRegistrationUrl() : '';
    if (!inviteUrl) { showToast?.('افتح النسخة المستضافة عبر HTTPS لإنشاء QR.', 'warning'); return; }
    const image = $('coachInviteQr'), error = $('coachInviteQrError'), input = $('coachRegistrationUrl');
    if (!image || !error || !input) return;
    input.value = inviteUrl;
    error.classList.add('hidden');
    image.classList.remove('hidden');
    image.onerror = () => { image.classList.add('hidden'); error.textContent = 'تعذر تحميل صورة QR.'; error.classList.remove('hidden'); };
    image.src = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&format=svg&data=${encodeURIComponent(inviteUrl)}`;
    $('coachInviteModal').classList.remove('hidden');
  };

  window.pgOpenTrainers = () => {
    modal('إدارة المدربين', `
      <div class="mb-4 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
        <h3 class="text-sm font-black text-amber-200">تسجيل مدرب من هاتفه دون اتصال</h3>
        <button type="button" onclick="pgOpenCoachInvite()" class="mt-3 rounded-xl gold-gradient px-4 py-2 text-xs font-black"><i class="fa-solid fa-qrcode ml-1"></i> إنشاء QR التسجيل</button>
      </div>
      <div class="mb-4 rounded-2xl border border-zinc-700 bg-zinc-900/70 p-4">
        <h3 class="text-sm font-black text-white">استيراد ملفات المدربين</h3>
        <label class="mt-3 inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 text-xs font-black text-emerald-200"><i class="fa-solid fa-file-import"></i> اختيار ملف JSON<input type="file" accept=".json,application/json" class="hidden" onchange="importCoachRegistrations(event)"></label>
      </div>
      <form onsubmit="pgAddTrainer(event)" class="grid md:grid-cols-3 gap-2 mb-4"><input id="pgTrainerName" required maxlength="60" placeholder="اسم المدرب" class="rounded-xl bg-zinc-950 border border-zinc-700 p-2 text-white text-xs"/><input id="pgTrainerPhone" maxlength="20" placeholder="رقم الهاتف" class="rounded-xl bg-zinc-950 border border-zinc-700 p-2 text-white text-xs"/><input id="pgTrainerRole" maxlength="60" placeholder="الاختصاص" class="rounded-xl bg-zinc-950 border border-zinc-700 p-2 text-white text-xs"/><button class="md:col-span-3 rounded-xl gold-gradient p-2 text-xs font-black">إضافة مدرب</button></form>
      <div class="grid md:grid-cols-2 gap-3">${trainers.map((t, i) => `<article class="rounded-xl border border-zinc-700 bg-zinc-900 p-3"><b>${safe(t.name)}</b><p class="text-xs text-zinc-400">${safe(t.phone)} · ${safe(t.role)}</p><button onclick="pgDeleteTrainer(${i})" class="mt-2 text-xs text-rose-300">حذف</button></article>`).join('') || '<p class="text-zinc-500 text-xs">لا يوجد مدربون مسجلون.</p>'}</div>`);
  };
  window.pgAddTrainer = e => { e.preventDefault(); trainers.push({ id: 'tr_' + Date.now(), name: $('pgTrainerName').value.trim(), phone: $('pgTrainerPhone').value.trim(), role: $('pgTrainerRole').value.trim() }); write(KEYS.trainers, trainers); pgOpenTrainers(); };
  window.pgDeleteTrainer = i => { if (!confirm('حذف بيانات المدرب؟')) return; trainers.splice(i, 1); write(KEYS.trainers, trainers); pgOpenTrainers(); };

  window.pgDailyClose = () => {
    const tx = (typeof financeLedger !== 'undefined' ? (financeLedger.transactions || []) : []).filter(t => (t.date || String(t.createdAt || '').slice(0, 10)) === today());
    const inc = tx.filter(t => t.type !== 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const exp = tx.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const sold = sales.filter(s => s.date === today()).reduce((s, x) => s + x.total, 0);
    const closed = closes.some(c => c.date === today());
    modal('إغلاق الصندوق اليومي', `<div class="grid md:grid-cols-3 gap-3"><div class="rounded-xl bg-zinc-900 p-4"><p class="text-xs text-zinc-400">إيرادات مسجلة</p><b class="text-xl text-emerald-400">${money(inc)}</b></div><div class="rounded-xl bg-zinc-900 p-4"><p class="text-xs text-zinc-400">مصاريف مسجلة</p><b class="text-xl text-rose-400">${money(exp)}</b></div><div class="rounded-xl bg-zinc-900 p-4"><p class="text-xs text-zinc-400">صافي الحركات</p><b class="text-xl text-amber-300">${money(inc - exp)}</b></div></div><p class="mt-3 text-xs text-zinc-400">مبيعات المخزن اليوم: ${money(sold)}</p><label class="block mt-4 text-sm">مبلغ النقد الفعلي<input id="pgActualCash" type="number" min="0" class="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white"/></label><label class="block mt-3 text-sm">ملاحظات<textarea id="pgCloseNotes" class="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white" rows="2"></textarea></label><button onclick="pgSaveDailyClose(${inc - exp})" class="mt-3 rounded-xl bg-emerald-600 px-5 py-3 font-black text-white" ${closed ? 'disabled' : ''}>${closed ? 'تم إغلاق اليوم مسبقاً' : 'حفظ إغلاق اليوم'}</button>`);
  };

  window.pgSaveDailyClose = net => {
    if (closes.some(c => c.date === today())) { showToast?.('تم إغلاق اليوم مسبقاً', 'warning'); return; }
    const actual = Number($('pgActualCash').value);
    if (!Number.isFinite(actual) || actual < 0) { showToast?.('أدخل مبلغ الصندوق الفعلي', 'error'); return; }
    closes.unshift({ id: 'close_' + Date.now(), date: today(), net, actual, difference: actual - net, notes: $('pgCloseNotes').value.trim(), time: new Date().toLocaleTimeString('ar-IQ') });
    if (write(KEYS.closes, closes)) {
      if (typeof logActivity === 'function') logActivity(`إغلاق الصندوق اليومي: فعلي ${actual} د.ع`);
      showToast?.('تم حفظ إغلاق الصندوق', 'success');
      pgDailyClose();
    }
  };

  function init() { addNav(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
  else setTimeout(init, 300);
})();
