/* =========================================================
   store-admin.js — إدارة متجر القاعة v3.0
   ربط ذكي بالمخزن والمبيعات + دعم تعدد الأقسام + تنظيم الخيارات
   ========================================================= */
(function () {
  'use strict';

  const PIN_KEY = 'pg_store_pin_v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'info'); };

  const ERR = {
    bad_pin: 'رمز المتجر غير صحيح',
    pin_too_short: 'الرمز يجب أن يكون 6 خانات على الأقل',
    invalid_product: 'بيانات المنتج غير صالحة'
  };
  const STATUS = {
    new: ['جديد', 'bg-amber-500/20 text-amber-300'],
    contacted: ['تم التواصل', 'bg-sky-500/20 text-sky-300'],
    delivered: ['تم التسليم', 'bg-emerald-500/20 text-emerald-300'],
    cancelled: ['ملغي', 'bg-zinc-600/40 text-zinc-300']
  };
  const COLORS = [
    ['#f59e0b', 'ذهبي'],
    ['#0891b2', 'سماوي'],
    ['#059669', 'أخضر'],
    ['#dc2626', 'أحمر'],
    ['#0f172a', 'أسود'],
    ['#7c3aed', 'بنفسجي']
  ];
  const PRESET_CATS = ['بروتينات', 'كرياتين وطاقة', 'مشروبات', 'ملابس وإكسسوارات', 'فيتامينات', 'عروض خاصة'];

  let state = { view: 'products', resFilter: 'all', products: [], reservations: [], info: {}, editing: null, image: '', selectedCats: [] };

  function cfg() {
    const c = window.pgCloudSync ? window.pgCloudSync.getConfig() : {};
    return {
      url: c.supabaseUrl || 'https://bpwjdjkqcfxerizrssbs.supabase.co',
      key: c.supabaseAnonKey || 'sb_publishable_GwS8ghvuEC6cCFb4GJ0j5Q_NBpXAgKO',
      gym: c.gymId || 'powergym-main',
      secret: c.syncSecret || 'aff212db9e4d8564e1e63ba328fa4867'
    };
  }
  const getPin = () => {
    let p = '';
    try { p = window.sessionStorage.getItem(PIN_KEY) || ''; } catch { /* ignore */ }
    if (!p) {
      const legacy = window.localStorage.getItem(PIN_KEY) || '';
      if (legacy) {
        p = legacy;
        try { window.sessionStorage.setItem(PIN_KEY, legacy); window.localStorage.removeItem(PIN_KEY); } catch { /* ignore */ }
      }
    }
    return p || cfg().secret;
  };
  const setPin = v => {
    try {
      if (v) window.sessionStorage.setItem(PIN_KEY, v);
      else window.sessionStorage.removeItem(PIN_KEY);
    } catch { /* ignore */ }
    window.localStorage.removeItem(PIN_KEY);
  };

  function getPrefs() {
    const def = { t: '', c: '#f59e0b', bg: 'dark', open: 1, so: 1, nt: 1, hr: '', cur: 'د.ع', cat: '' };
    const s = String((state.info && state.info.note) || '').trim();
    if (s.startsWith('{')) {
      try { return Object.assign(def, JSON.parse(s)); } catch { /* ignore */ }
    }
    def.t = s;
    return def;
  }
  const money = n => Math.round(Number(n) || 0).toLocaleString('en-US') + ' ' + (getPrefs().cur || 'د.ع');

  function parseCategories(desc) {
    const m = String(desc || '').match(/^\[([^\]]{1,80})\]\s*\n?([\s\S]*)$/);
    if (!m) return { cats: [], cat: '', text: String(desc || '').trim() };
    const cats = m[1].split(/[,،]/).map(x => x.trim()).filter(Boolean);
    return { cats, cat: cats.join('، '), text: m[2].trim() };
  }

  function getAllSectionList() {
    const fromPrefs = String(getPrefs().cat || '').split(/[,،]/).map(x => x.trim()).filter(Boolean);
    const fromProds = state.products.flatMap(p => parseCategories(p.description).cats);
    return Array.from(new Set([...fromPrefs, ...fromProds]));
  }

  function hdrs(c) {
    const h = { apikey: c.key, 'Content-Type': 'application/json' };
    if (!String(c.key || '').startsWith('sb_publishable_')) h.Authorization = `Bearer ${c.key}`;
    return h;
  }
  async function rpc(name, args) {
    const c = cfg();
    if (!c.url || !c.key) throw new Error('no_config');
    const res = await fetch(`${c.url}/rest/v1/rpc/${name}`, { method: 'POST', headers: hdrs(c), body: JSON.stringify(args) });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message || text; } catch { /* ignore */ }
      if (res.status === 404 || /Could not find the function/i.test(msg)) throw new Error('not_installed');
      throw new Error(msg);
    }
    return text ? JSON.parse(text) : null;
  }
  async function loadProducts() {
    const c = cfg();
    const res = await fetch(`${c.url}/rest/v1/store_products?gym_id=eq.${encodeURIComponent(c.gym)}&select=*&order=sort_order.asc,updated_at.desc`, { headers: hdrs(c) });
    if (!res.ok) throw new Error('not_installed');
    return res.json();
  }
  const errText = e => ERR[e.message] || (e.message === 'no_config' ? 'فعّل السيرفر والمزامنة أولاً' : 'حدث خطأ: ' + e.message);

  function storeUrl() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    return `${base}store.html?g=${encodeURIComponent(cfg().gym)}`;
  }
  const finalPrice = p => Math.round((Number(p.price) || 0) * (1 - Math.min(100, Math.max(0, Number(p.discount_percent) || 0)) / 100));

  function shell(inner) {
    let m = $('pgStoreModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'pgStoreModal';
      m.className = 'fixed inset-0 z-[90] modal-backdrop flex items-center justify-center p-3 overflow-y-auto';
      document.body.appendChild(m);
    }
    m.innerHTML = `
      <section class="card-bg w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl p-5 space-y-4">
        <header class="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h2 class="text-lg font-black text-white"><i class="fa-solid fa-store text-amber-400"></i> إدارة متجر القاعة</h2>
            <p class="text-[11px] text-zinc-400">مربوط بالسيرفر والمخزن والمبيعات · تعدد الأقسام والحجوزات</p>
          </div>
          <button onclick="document.getElementById('pgStoreModal').remove()" class="rounded-xl bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-xs font-bold text-amber-300">← العودة للموقع</button>
        </header>
        ${inner}
      </section>`;
  }

  window.openStoreAdmin = async function () {
    shell('<p class="py-10 text-center text-sm text-zinc-400">جارٍ التحميل من السيرفر...</p>');
    const c = cfg();
    if (!c.url || !c.key) return shell('<p class="py-8 text-center text-sm text-amber-300">فعّل السيرفر السحابي أولاً.</p>');
    try {
      state.info = (await rpc('store_get_info', { p_gym: c.gym })) || {};
    } catch { return shell('<p class="py-8 text-center text-sm text-rose-300">تعذر الاتصال بقاعدة بيانات المتجر.</p>'); }
    if (!state.info.configured) {
      try {
        await rpc('store_init', { p_gym: c.gym, p_pin: getPin() });
        setPin(getPin());
      } catch { /* ignore if already configured */ }
    }
    state.view = 'products';
    await refreshAll();
  };

  async function refreshAll() {
    try {
      state.products = (await loadProducts()) || [];
    } catch (e) {
      state.products = [];
      toast(errText(e), 'error');
    }
    try {
      state.reservations = (await rpc('store_list_reservations', { p_gym: cfg().gym, p_pin: getPin() })) || [];
    } catch {
      state.reservations = [];
    }
    render();
  }

  function render() {
    const newCount = state.reservations.filter(r => r.status === 'new').length;
    const availCount = state.products.filter(p => p.available).length;
    const delivCount = state.reservations.filter(r => r.status === 'delivered').length;
    const tab = (id, label) => `<button onclick="pgStoreView('${id}')" class="rounded-xl px-3.5 py-2 text-xs ${state.view === id ? 'font-black gold-gradient' : 'font-bold bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}">${label}</button>`;
    const body = state.view === 'products' ? productsView() : state.view === 'reservations' ? reservationsView() : settingsView();
    shell(`
      <div class="grid grid-cols-4 gap-2 text-center">
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2"><p class="text-[10px] text-zinc-400">المنتجات</p><p class="text-sm font-black text-white">${state.products.length}</p></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2"><p class="text-[10px] text-zinc-400">المتوفر</p><p class="text-sm font-black text-emerald-400">${availCount}</p></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2"><p class="text-[10px] text-zinc-400">حجوزات جديدة</p><p class="text-sm font-black text-amber-300">${newCount}</p></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2"><p class="text-[10px] text-zinc-400">تم تسليمها</p><p class="text-sm font-black text-emerald-300">${delivCount}</p></div>
      </div>
      <div class="flex flex-wrap gap-2">
        ${tab('products', `المنتجات (${state.products.length})`)}
        ${tab('reservations', `الحجوزات${newCount ? ` (${newCount} جديد)` : ''}`)}
        ${tab('settings', 'الأقسام والمظهر والرابط')}
      </div>
      ${body}`);
  }
  window.pgStoreView = v => { state.view = v; state.editing = null; render(); };

  function productsView() {
    if (state.editing) return editorView();
    const invItems = window.PGInventoryBridge ? window.PGInventoryBridge.getAll() : [];
    const unlinkedInv = invItems.filter(it => !state.products.some(p => p.id === it.storeProductId || p.name.trim() === it.name.trim()));

    const list = state.products.map(p => {
      const d = Number(p.discount_percent) || 0;
      const parsed = parseCategories(p.description);
      const matchedInv = invItems.find(it => it.storeProductId === p.id || it.name.trim() === p.name.trim());
      return `
        <div class="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3">
          <div class="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-500">${p.image ? `<img src="${esc(p.image)}" class="h-full w-full object-cover">` : '<i class="fa-solid fa-image"></i>'}</div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-black text-white">${esc(p.name)}</p>
            <div class="flex flex-wrap items-center gap-1 mt-0.5">
              ${parsed.cats.map(c => `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-bold">${esc(c)}</span>`).join('')}
              ${matchedInv ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-bold">مخزون: ${matchedInv.qty}</span>` : ''}
            </div>
            <p class="text-xs text-emerald-300 mt-0.5">${money(finalPrice(p))} ${d > 0 ? `<span class="text-zinc-500 line-through">${money(p.price)}</span> <span class="text-rose-300">-${Math.round(d)}%</span>` : ''}</p>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button onclick="pgStoreToggleAvail('${esc(p.id)}')" class="rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${p.available ? 'bg-emerald-900/60 text-emerald-300' : 'bg-zinc-800 text-zinc-400'}">${p.available ? 'متوفر ✓' : 'نفد ✕'}</button>
            <button onclick="pgStoreDuplicate('${esc(p.id)}')" class="rounded-lg bg-zinc-800 px-2.5 py-1.5 text-[11px] font-bold text-zinc-200">نسخ</button>
            <button onclick="pgStoreEdit('${esc(p.id)}')" class="rounded-lg bg-zinc-800 px-3 py-1.5 text-[11px] font-bold text-amber-300">تعديل</button>
            <button onclick="pgStoreDelete('${esc(p.id)}')" class="rounded-lg bg-rose-900/60 px-3 py-1.5 text-[11px] font-bold text-rose-200">حذف</button>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="flex flex-wrap items-center gap-2">
        <button onclick="pgStoreEdit('')" class="gold-gradient font-black py-2.5 px-5 rounded-xl text-sm"><i class="fa-solid fa-plus"></i> إضافة منتج جديد</button>
        ${unlinkedInv.length ? `
          <div class="flex items-center gap-1.5 bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5">
            <select id="pgInvPickSelect" class="bg-transparent text-xs text-white focus:outline-none">
              ${unlinkedInv.map(it => `<option value="${esc(it.id)}">${esc(it.name)} (${it.qty}) — ${money(it.price)}</option>`).join('')}
            </select>
            <button onclick="pgStoreImportFromInv()" class="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1 text-[11px] font-black text-white">سحب من المخزن</button>
          </div>
        ` : ''}
      </div>
      <div class="space-y-2">${list || '<p class="py-8 text-center text-sm text-zinc-500">لا توجد منتجات بعد. أضف أول منتج!</p>'}</div>`;
  }

  window.pgStoreImportFromInv = async function () {
    const invId = $('pgInvPickSelect')?.value;
    if (!invId || !window.PGInventoryBridge) return;
    const item = window.PGInventoryBridge.getAll().find(x => x.id === invId);
    if (!item) return;
    await window.PGStoreBridge.syncInventoryItem(item, false);
    await refreshAll();
  };

  window.pgStoreToggleAvail = async function (id) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;
    try {
      await rpc('store_upsert_product', {
        p_gym: cfg().gym, p_pin: getPin(),
        p: { id: p.id, name: p.name, price: p.price, discount_percent: p.discount_percent, description: p.description, image: p.image, available: !p.available, sort_order: p.sort_order }
      });
      await refreshAll();
    } catch (e) { toast(errText(e), 'error'); }
  };

  window.pgStoreDuplicate = function (id) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;
    state.editing = Object.assign({}, p, { id: 'prd_' + Date.now(), name: p.name + ' (نسخة)' });
    state.image = state.editing.image || '';
    state.selectedCats = parseCategories(state.editing.description).cats;
    render();
  };

  window.pgStoreEdit = function (id) {
    const p = id ? state.products.find(x => x.id === id) : null;
    state.editing = p ? Object.assign({}, p) : { id: 'prd_' + Date.now(), name: '', description: '', price: '', discount_percent: 0, image: '', available: true, sort_order: 0 };
    state.image = state.editing.image || '';
    state.selectedCats = parseCategories(state.editing.description).cats;
    render();
  };

  window.pgStoreToggleProdCat = function (cat) {
    if (state.selectedCats.includes(cat)) state.selectedCats = state.selectedCats.filter(c => c !== cat);
    else state.selectedCats.push(cat);
    const box = $('pgProdCatChips');
    if (box) box.innerHTML = renderProdCatChips();
  };

  window.pgStoreAddCustomProdCat = function () {
    const inp = $('pgPNewCat');
    const val = (inp?.value || '').trim().replace(/[\[\],،]/g, '');
    if (!val) return;
    if (!state.selectedCats.includes(val)) state.selectedCats.push(val);
    if (inp) inp.value = '';
    const box = $('pgProdCatChips');
    if (box) box.innerHTML = renderProdCatChips();
  };

  function renderProdCatChips() {
    const all = Array.from(new Set([...getAllSectionList(), ...state.selectedCats]));
    return all.map(c => {
      const active = state.selectedCats.includes(c);
      return `<button type="button" onclick="pgStoreToggleProdCat('${esc(c)}')" class="rounded-lg px-2.5 py-1 text-[11px] font-bold border transition ${active ? 'bg-amber-500 text-zinc-950 border-amber-400 font-black' : 'bg-zinc-950 text-zinc-300 border-zinc-700 hover:border-amber-400/50'}">${active ? '✓ ' : '+ '}${esc(c)}</button>`;
    }).join('');
  }

  function editorView() {
    const p = state.editing;
    const parsed = parseCategories(p.description);
    const inp = 'w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white';
    return `
      <div class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3">
        <p class="text-sm font-black text-amber-300">${state.products.some(x => x.id === p.id) ? 'تعديل المنتج' : 'منتج جديد'}</p>
        <div>
          <label class="block text-xs font-bold text-zinc-300 mb-1">اسم المنتج *</label>
          <input id="pgPName" class="${inp}" maxlength="120" value="${esc(p.name)}">
        </div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
          <label class="block text-xs font-bold text-amber-300">الأقسام (يمكن اختيار أكثر من قسم)</label>
          <div id="pgProdCatChips" class="flex flex-wrap gap-1.5">${renderProdCatChips()}</div>
          <div class="flex gap-1.5 pt-1">
            <input id="pgPNewCat" class="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-white" maxlength="28" placeholder="أو اكتب اسم قسم جديد...">
            <button type="button" onclick="pgStoreAddCustomProdCat()" class="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-xs font-bold text-amber-300">+ إضافة قسم</button>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="block text-xs font-bold text-zinc-300 mb-1">السعر *</label><input id="pgPPrice" type="number" min="0" class="${inp}" value="${esc(p.price)}" oninput="pgStoreCalc()"></div>
          <div><label class="block text-xs font-bold text-zinc-300 mb-1">الخصم %</label><input id="pgPDisc" type="number" min="0" max="100" class="${inp}" value="${esc(p.discount_percent)}" oninput="pgStoreCalc()"></div>
          <div><label class="block text-xs font-bold text-zinc-300 mb-1">ترتيب العرض</label><input id="pgPSort" type="number" class="${inp}" value="${esc(p.sort_order || 0)}"></div>
        </div>
        <p id="pgPFinal" class="text-xs text-emerald-300"></p>
        <div><label class="block text-xs font-bold text-zinc-300 mb-1">وصف / ملاحظات للاعب</label><textarea id="pgPDesc" rows="2" maxlength="900" class="${inp}">${esc(parsed.text)}</textarea></div>
        <div>
          <label class="block text-xs font-bold text-zinc-300 mb-1">صورة المنتج</label>
          <input type="file" accept="image/*" onchange="pgStoreImage(event)" class="block w-full text-xs text-zinc-300 file:ml-3 file:rounded-lg file:border-0 file:bg-amber-500 file:px-3 file:py-2 file:font-black file:text-zinc-950">
          <div id="pgPImgBox" class="mt-2">${state.image ? `<img src="${esc(state.image)}" class="h-24 w-24 rounded-xl object-cover">` : ''}</div>
        </div>
        <label class="flex items-center gap-2 text-xs font-bold text-zinc-200"><input id="pgPAvail" type="checkbox" ${p.available ? 'checked' : ''} class="accent-amber-400 h-4 w-4"> متوفر للحجز</label>
        <div class="flex gap-2 pt-1">
          <button onclick="pgStoreSave()" class="flex-1 gold-gradient font-black py-2.5 rounded-xl text-sm">حفظ المنتج</button>
          <button onclick="pgStoreView('products')" class="rounded-xl bg-zinc-800 px-5 text-xs font-bold text-zinc-300">إلغاء</button>
        </div>
      </div>`;
  }

  window.pgStoreCalc = function () {
    const el = $('pgPFinal');
    if (!el) return;
    const price = Number($('pgPPrice').value) || 0;
    const d = Math.min(100, Math.max(0, Number($('pgPDisc').value) || 0));
    el.textContent = d > 0 ? `السعر بعد الخصم: ${money(price * (1 - d / 100))}` : '';
  };

  window.pgStoreImage = function (ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 640;
        const r = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * r);
        cv.height = Math.round(img.height * r);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        state.image = cv.toDataURL('image/jpeg', 0.72);
        $('pgPImgBox').innerHTML = `<img src="${state.image}" class="h-24 w-24 rounded-xl object-cover">`;
      };
      img.onerror = () => toast('تعذر قراءة الصورة', 'error');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  window.pgStoreSave = async function () {
    const p = state.editing;
    const name = $('pgPName').value.trim();
    const price = Number($('pgPPrice').value);
    if (!name || !(price >= 0) || $('pgPPrice').value === '') return toast('أدخل اسم المنتج وسعره', 'warning');
    const catsStr = state.selectedCats.join(', ').slice(0, 75);
    const rawDesc = $('pgPDesc').value.trim();
    const description = catsStr ? `[${catsStr}]\n${rawDesc}` : rawDesc;
    const payload = {
      id: p.id, name, price,
      discount_percent: Math.min(100, Math.max(0, Number($('pgPDisc').value) || 0)),
      description,
      image: state.image || '',
      available: $('pgPAvail').checked,
      sort_order: Number($('pgPSort').value) || 0
    };
    try {
      await rpc('store_upsert_product', { p_gym: cfg().gym, p_pin: getPin(), p: payload });
      if (window.PGInventoryBridge) window.PGInventoryBridge.upsertFromStoreProduct(payload);
      toast('تم حفظ المنتج ومزامنته مع المخزن ✓', 'success');
      state.editing = null;
      await refreshAll();
    } catch (e) { toast(errText(e), 'error'); }
  };

  window.pgStoreDelete = async function (id) {
    const p = state.products.find(x => x.id === id);
    if (!p || !confirm(`حذف المنتج "${p.name}"؟`)) return;
    try {
      await rpc('store_delete_product', { p_gym: cfg().gym, p_pin: getPin(), p_id: id });
      toast('تم حذف المنتج', 'success');
      await refreshAll();
    } catch (e) { toast(errText(e), 'error'); }
  };

  function reservationsView() {
    const filtered = state.resFilter === 'all' ? state.reservations : state.reservations.filter(r => r.status === state.resFilter);
    const fBtn = (k, label) => `<button onclick="pgStoreResFilter('${k}')" class="rounded-lg px-2.5 py-1 text-[11px] font-bold ${state.resFilter === k ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300'}">${label}</button>`;
    const listHtml = filtered.map(r => {
      const st = STATUS[r.status] || STATUS.new;
      let intl = String(r.customer_phone || '').replace(/\D/g, '');
      if (intl.startsWith('07') && intl.length === 11) intl = '964' + intl.slice(1);
      const when = new Date(r.created_at).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' });
      return `
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3 space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="text-sm font-black text-white">${esc(r.customer_name)} <span class="text-xs font-normal text-zinc-400" dir="ltr">${esc(r.customer_phone)}</span></p>
              <p class="text-xs text-amber-300">${esc(r.product_name)} × ${Number(r.qty) || 1}</p>
              ${r.note ? `<p class="text-[11px] text-zinc-400">ملاحظة: ${esc(r.note)}</p>` : ''}
              <p class="text-[10px] text-zinc-500">${esc(when)}</p>
            </div>
            <span class="rounded-full px-2.5 py-0.5 text-[10px] font-bold ${st[1]}">${st[0]}</span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <a href="https://wa.me/${intl}?text=${encodeURIComponent(`السلام عليكم ${r.customer_name}، بخصوص حجزك (${r.product_name}) من متجر القاعة.`)}" target="_blank" rel="noopener" class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"><i class="fa-brands fa-whatsapp"></i> واتساب</a>
            ${['contacted', 'delivered', 'cancelled'].filter(s => s !== r.status).map(s => `<button onclick="pgStoreStatus('${esc(r.id)}','${s}')" class="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-xs font-bold text-zinc-200">${STATUS[s][0]}</button>`).join('')}
          </div>
        </div>`;
    }).join('');
    return `
      <div class="flex flex-wrap gap-1.5">${fBtn('all', 'الكل')}${fBtn('new', 'جديد')}${fBtn('contacted', 'تم التواصل')}${fBtn('delivered', 'تم التسليم')}${fBtn('cancelled', 'ملغي')}</div>
      <div class="space-y-2">${listHtml || '<p class="py-8 text-center text-sm text-zinc-500">لا توجد حجوزات في هذا التصنيف</p>'}</div>`;
  }
  window.pgStoreResFilter = f => { state.resFilter = f; render(); };

  window.pgStoreStatus = async function (id, status) {
    try {
      await rpc('store_set_reservation_status', { p_gym: cfg().gym, p_pin: getPin(), p_id: id, p_status: status });
      const r = state.reservations.find(x => x.id === id);
      if (r) {
        const wasDelivered = r.status === 'delivered';
        r.status = status;
        if (status === 'delivered' && !wasDelivered && window.PGInventoryBridge) {
          const res = window.PGInventoryBridge.deductOnStoreDelivery(r.product_id, r.product_name, r.qty);
          if (res.matched) {
            toast(`تم التسليم، خصم من المخزن، وإضافة ${money(res.total)} للأرباح ✓`, 'success');
            if (res.outOfStock) {
              const p = state.products.find(x => x.id === r.product_id);
              if (p && p.available) {
                await rpc('store_upsert_product', {
                  p_gym: cfg().gym, p_pin: getPin(),
                  p: { id: p.id, name: p.name, price: p.price, discount_percent: p.discount_percent, description: p.description, image: p.image, available: false, sort_order: p.sort_order }
                });
                p.available = false;
              }
            }
          }
        }
      }
      render();
    } catch (e) { toast(errText(e), 'error'); }
  };

  function settingsView() {
    const i = state.info || {};
    const pr = getPrefs();
    const cats = String(pr.cat || '').split(/[,،]/).map(x => x.trim()).filter(Boolean);
    const inp = 'w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white';
    return `
      <div class="rounded-2xl border border-emerald-500/25 bg-emerald-950/20 p-3.5 space-y-2">
        <p class="text-xs font-black text-emerald-300">1. رابط المتجر للاعبين</p>
        <input readonly value="${esc(storeUrl())}" dir="ltr" onclick="this.select()" class="${inp}">
        <div class="flex flex-wrap gap-2">
          <button onclick="pgStoreCopyLink()" class="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white">نسخ الرابط</button>
          <a href="${esc(storeUrl())}" target="_blank" rel="noopener" class="rounded-xl bg-zinc-800 px-4 py-2 text-xs font-bold text-zinc-200">معاينة المتجر</a>
        </div>
      </div>

      <div class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3">
        <p class="text-xs font-black text-amber-300">2. إدارة أقسام المتجر (أضف أكثر من قسم)</p>
        <div class="flex flex-wrap gap-1.5">
          ${cats.map(c => `<span class="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/35 px-3 py-1 text-xs font-bold text-amber-200">${esc(c)} <button type="button" onclick="pgStoreRemoveCat('${esc(c)}')" class="text-rose-300 hover:text-rose-200 font-black">×</button></span>`).join('') || '<span class="text-[11px] text-zinc-500">لا توجد أقسام مخصصة بعد</span>'}
        </div>
        <div class="flex gap-2">
          <input id="pgNewSectionInput" class="${inp}" maxlength="25" placeholder="اكتب اسم قسم جديد (مثلاً: أحذية، طاقة)...">
          <button type="button" onclick="pgStoreAddCat()" class="rounded-xl gold-gradient px-4 text-xs font-black whitespace-nowrap">+ إضافة قسم</button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <span class="text-[10px] text-zinc-400 self-center">إضافة سريعة:</span>
          ${PRESET_CATS.filter(c => !cats.includes(c)).map(c => `<button type="button" onclick="pgStoreQuickAddCat('${esc(c)}')" class="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1 text-[10px] font-bold text-zinc-300">+ ${esc(c)}</button>`).join('')}
        </div>
      </div>

      <div class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3">
        <p class="text-xs font-black text-amber-300">3. الهوية والمظهر والتحكم</p>
        <div class="grid md:grid-cols-2 gap-3">
          <div><label class="block text-[11px] font-bold text-zinc-300 mb-1">اسم المتجر</label><input id="pgSName" class="${inp}" maxlength="80" value="${esc(i.store_name)}" placeholder="متجر Power Gym"></div>
          <div><label class="block text-[11px] font-bold text-zinc-300 mb-1">رقم واتساب القاعة</label><input id="pgSWa" class="${inp}" dir="ltr" value="${esc(i.whatsapp)}" placeholder="07801234567"></div>
          <div><label class="block text-[11px] font-bold text-zinc-300 mb-1">أوقات الدوام</label><input id="pgSHours" class="${inp}" maxlength="40" value="${esc(pr.hr)}" placeholder="يومياً 10ص - 12م"></div>
          <div><label class="block text-[11px] font-bold text-zinc-300 mb-1">العملة</label><select id="pgSCur" class="${inp}"><option value="د.ع" ${pr.cur === 'د.ع' ? 'selected' : ''}>دينار عراقي (د.ع)</option><option value="$" ${pr.cur === '$' ? 'selected' : ''}>دولار ($)</option></select></div>
        </div>
        <div><label class="block text-[11px] font-bold text-zinc-300 mb-1">ملاحظة أعلى المتجر</label><input id="pgSNote" class="${inp}" maxlength="120" value="${esc(pr.t)}" placeholder="توصيل مجاني داخل القاعة"></div>
        <div class="grid md:grid-cols-2 gap-3">
          <div>
            <label class="block text-[11px] font-bold text-zinc-300 mb-1">خلفية المتجر</label>
            <select id="pgSBg" class="${inp}">
              <option value="dark" ${pr.bg === 'dark' ? 'selected' : ''}>داكن فخم</option>
              <option value="light" ${pr.bg === 'light' ? 'selected' : ''}>أبيض ناصع</option>
              <option value="soft" ${pr.bg === 'soft' ? 'selected' : ''}>رمادي ناعم</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-zinc-300 mb-1">لون الأزرار والشارات</label>
            <div class="flex flex-wrap gap-1.5 pt-1">
              ${COLORS.map(([hex, label]) => `<button type="button" onclick="pgStorePickColor('${hex}')" class="rounded-lg px-2.5 py-1 text-[10px] font-bold text-white border ${pr.c === hex ? 'border-white ring-2 ring-amber-400' : 'border-zinc-700'}" style="background:${hex}">${label}</button>`).join('')}
            </div>
            <input type="hidden" id="pgSColor" value="${esc(pr.c)}">
          </div>
        </div>
        <div class="flex flex-wrap gap-4 pt-1 text-xs text-zinc-200">
          <label class="flex items-center gap-2"><input id="pgSOpen" type="checkbox" ${Number(pr.open) !== 0 ? 'checked' : ''} class="accent-amber-400"> المتجر مفتوح</label>
          <label class="flex items-center gap-2"><input id="pgSSold" type="checkbox" ${Number(pr.so) !== 0 ? 'checked' : ''} class="accent-amber-400"> إظهار المنتهية</label>
          <label class="flex items-center gap-2"><input id="pgSNt" type="checkbox" ${Number(pr.nt) !== 0 ? 'checked' : ''} class="accent-amber-400"> ملاحظة الزبون</label>
        </div>
        <button onclick="pgStoreSaveSettings()" class="gold-gradient font-black py-2.5 px-5 rounded-xl text-sm">حفظ كل التخصيصات</button>
      </div>
      <button onclick="pgStoreLogout()" class="text-xs font-bold text-rose-300">تسجيل خروج من المتجر على هذا الجهاز</button>`;
  }

  function updatePrefsCats(nextCats) {
    const pr = getPrefs();
    pr.cat = nextCats.join(',').slice(0, 90);
    state.info.note = JSON.stringify(pr);
    render();
  }

  window.pgStoreAddCat = function () {
    const val = ($('pgNewSectionInput')?.value || '').trim().replace(/[,،]/g, '');
    if (!val) return;
    const cats = String(getPrefs().cat || '').split(/[,،]/).map(x => x.trim()).filter(Boolean);
    if (!cats.includes(val)) cats.push(val);
    updatePrefsCats(cats);
  };
  window.pgStoreQuickAddCat = function (val) {
    const cats = String(getPrefs().cat || '').split(/[,،]/).map(x => x.trim()).filter(Boolean);
    if (!cats.includes(val)) cats.push(val);
    updatePrefsCats(cats);
  };
  window.pgStoreRemoveCat = function (val) {
    const cats = String(getPrefs().cat || '').split(/[,،]/).map(x => x.trim()).filter(Boolean).filter(c => c !== val);
    updatePrefsCats(cats);
  };

  window.pgStorePickColor = function (hex) {
    const inp = $('pgSColor');
    if (inp) inp.value = hex;
    const pr = getPrefs();
    pr.c = hex;
    state.info.note = JSON.stringify(pr);
    render();
  };

  window.pgStoreCopyLink = async function () {
    try { await navigator.clipboard.writeText(storeUrl()); toast('تم نسخ رابط المتجر ✓', 'success'); }
    catch { prompt('انسخ الرابط:', storeUrl()); }
  };

  window.pgStoreSaveSettings = async function () {
    const pr = getPrefs();
    const packed = JSON.stringify({
      t: ($('pgSNote')?.value || '').trim().slice(0, 120),
      c: ($('pgSColor')?.value || '#f59e0b').trim(),
      bg: $('pgSBg')?.value || 'dark',
      open: $('pgSOpen')?.checked ? 1 : 0,
      so: $('pgSSold')?.checked ? 1 : 0,
      nt: $('pgSNt')?.checked ? 1 : 0,
      hr: ($('pgSHours')?.value || '').trim().slice(0, 40),
      cur: $('pgSCur')?.value || 'د.ع',
      cat: pr.cat || ''
    });
    try {
      await rpc('store_save_settings', {
        p_gym: cfg().gym, p_pin: getPin(),
        p_name: $('pgSName').value, p_whatsapp: $('pgSWa').value, p_note: packed
      });
      state.info = Object.assign({}, state.info, { store_name: $('pgSName').value, whatsapp: $('pgSWa').value, note: packed });
      toast('تم حفظ تخصيصات المتجر ✓', 'success');
    } catch (e) { toast(errText(e), 'error'); }
  };

  window.pgStoreLogout = function () { setPin(''); const m = $('pgStoreModal'); if (m) m.remove(); toast('تم تسجيل الخروج', 'info'); };

  // ---------- Bridge for advanced.js (Inventory <-> Store) ----------
  window.PGStoreBridge = {
    syncInventoryItem: async function (item, silent = true) {
      const c = cfg();
      const pin = getPin();
      if (!c.url || !c.key || !pin) {
        if (!silent) toast('سجّل دخولك إلى "متجر القاعة" أولاً لنشر المنتج سحابياً', 'warning');
        return false;
      }
      const prodId = item.storeProductId || ('prd_' + item.id.replace(/^itm_/, ''));
      const desc = item.category ? `[${item.category}]\n` : '';
      const payload = {
        id: prodId,
        name: item.name,
        price: Number(item.price) || 0,
        discount_percent: 0,
        description: desc,
        image: '',
        available: Number(item.qty) > 0,
        sort_order: 0
      };
      try {
        await rpc('store_upsert_product', { p_gym: c.gym, p_pin: pin, p: payload });
        item.storeProductId = prodId;
        if (!silent) toast(`تم نشر "${item.name}" في المتجر ✓`, 'success');
        return true;
      } catch (e) {
        if (!silent) toast(errText(e), 'error');
        return false;
      }
    }
  };

  function injectLink() {
    if (document.querySelector('[data-nav-key="store-admin"]')) return true;
    const sec = $('pgSmartToolsNav');
    if (!sec || $('pgStoreNavBtn')) return false;
    const b = document.createElement('button');
    b.id = 'pgStoreNavBtn';
    b.className = 'sidebar-link';
    b.onclick = () => { window.openStoreAdmin(); if (typeof closeMobileMenu === 'function') closeMobileMenu(); };
    b.innerHTML = '<i class="fa-solid fa-store text-amber-400"></i><span>متجر القاعة</span>';
    sec.appendChild(b);
    return true;
  }
  function init() { if (!injectLink()) setTimeout(injectLink, 700); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
