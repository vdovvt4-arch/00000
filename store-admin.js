/* =========================================================
   store-admin.js — إدارة متجر القاعة (تحكم كامل للمدير)
   منتجات + تصنيفات + ترتيب + نسخ + توفر سريع + ثيم وألوان + حجوزات
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
    new: ['جديد', 'bg-sky-500/20 text-sky-300'],
    contacted: ['تم التواصل', 'bg-cyan-500/20 text-cyan-300'],
    delivered: ['تم التسليم', 'bg-emerald-500/20 text-emerald-300'],
    cancelled: ['ملغي', 'bg-slate-600/40 text-slate-300']
  };
  const COLORS = [
    ['#0891b2', 'سماوي'],
    ['#2563eb', 'أزرق'],
    ['#059669', 'أخضر'],
    ['#dc2626', 'أحمر'],
    ['#0f172a', 'أسود'],
    ['#7c3aed', 'بنفسجي']
  ];

  let state = { view: 'products', resFilter: 'all', products: [], reservations: [], info: {}, editing: null, image: '' };

  function cfg() {
    const c = window.pgCloudSync ? window.pgCloudSync.getConfig() : {};
    return { url: c.supabaseUrl, key: c.supabaseAnonKey, gym: c.gymId || 'powergym-main' };
  }
  const getPin = () => window.localStorage.getItem(PIN_KEY) || '';
  const setPin = v => window.localStorage.setItem(PIN_KEY, v);

  function getPrefs() {
    const def = { t: '', c: '#0891b2', bg: 'light', open: 1, so: 1, nt: 1, hr: '', cur: 'د.ع', cat: '' };
    const s = String((state.info && state.info.note) || '').trim();
    if (s.startsWith('{')) {
      try { return Object.assign(def, JSON.parse(s)); } catch { /* ignore */ }
    }
    def.t = s;
    return def;
  }
  const money = n => Math.round(Number(n) || 0).toLocaleString('en-US') + ' ' + (getPrefs().cur || 'د.ع');

  function parseCategory(desc) {
    const m = String(desc || '').match(/^\[([^\]]{1,30})\]\s*\n?([\s\S]*)$/);
    return m ? { cat: m[1].trim(), text: m[2].trim() } : { cat: '', text: String(desc || '').trim() };
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
        <header class="flex items-center justify-between border-b border-slate-700 pb-3">
          <div>
            <h2 class="text-lg font-black text-white"><i class="fa-solid fa-store text-sky-400"></i> إدارة وتخصيص متجر القاعة</h2>
            <p class="text-[11px] text-slate-400">تحكم كامل بالمنتجات، التصنيفات، الألوان، الثيم، والحجوزات</p>
          </div>
          <button onclick="document.getElementById('pgStoreModal').remove()" class="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200">إغلاق ✕</button>
        </header>
        ${inner}
      </section>`;
  }

  window.openStoreAdmin = async function () {
    shell('<p class="py-10 text-center text-sm text-slate-400">جارٍ التحميل...</p>');
    const c = cfg();
    if (!c.url || !c.key) {
      shell('<p class="py-8 text-center text-sm text-sky-300">فعّل السيرفر السحابي أولاً.</p>');
      return;
    }
    try {
      state.info = (await rpc('store_get_info', { p_gym: c.gym })) || {};
    } catch { return shell('<p class="py-8 text-center text-sm text-rose-300">تعذر الاتصال بقاعدة بيانات المتجر.</p>'); }
    if (!state.info.configured) return showSetup();
    if (!getPin()) return showLogin();
    try {
      const ok = await rpc('store_pin_ok', { p_gym: c.gym, p_pin: getPin() });
      if (!ok) { setPin(''); return showLogin(); }
    } catch { return showLogin(); }
    state.view = 'products';
    await refreshAll();
  };

  function showSetup() {
    shell(`
      <div class="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 space-y-3">
        <p class="text-sm font-black text-sky-300">إنشاء رمز المتجر</p>
        <p class="text-[11px] text-slate-400">اختر رمزاً (6 خانات على الأقل) لحماية إدارة المتجر والحجوزات.</p>
        <input id="pgStorePinNew" type="password" placeholder="رمز المتجر" dir="ltr" class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" />
        <button onclick="pgStoreInit()" class="gold-gradient text-black font-black py-2.5 px-5 rounded-xl text-sm">إنشاء المتجر</button>
      </div>`);
  }
  window.pgStoreInit = async function () {
    const pin = $('pgStorePinNew').value.trim();
    try {
      const ok = await rpc('store_init', { p_gym: cfg().gym, p_pin: pin });
      if (!ok) { toast('المتجر منشأ مسبقاً', 'warning'); return window.openStoreAdmin(); }
      setPin(pin);
      toast('تم إنشاء المتجر ✓', 'success');
      window.openStoreAdmin();
    } catch (e) { toast(errText(e), 'error'); }
  };

  function showLogin() {
    shell(`
      <div class="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 space-y-3">
        <p class="text-sm font-black text-sky-300">أدخل رمز المتجر</p>
        <input id="pgStorePinIn" type="password" placeholder="رمز المتجر" dir="ltr" class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" />
        <button onclick="pgStoreLogin()" class="gold-gradient text-black font-black py-2.5 px-5 rounded-xl text-sm">دخول</button>
      </div>`);
  }
  window.pgStoreLogin = async function () {
    const pin = $('pgStorePinIn').value.trim();
    try {
      const ok = await rpc('store_pin_ok', { p_gym: cfg().gym, p_pin: pin });
      if (!ok) return toast('رمز المتجر غير صحيح', 'error');
      setPin(pin);
      window.openStoreAdmin();
    } catch (e) { toast(errText(e), 'error'); }
  };

  async function refreshAll() {
    try {
      const [prods, res] = await Promise.all([
        loadProducts(),
        rpc('store_list_reservations', { p_gym: cfg().gym, p_pin: getPin() })
      ]);
      state.products = prods || [];
      state.reservations = res || [];
    } catch (e) {
      if (e.message === 'bad_pin') { setPin(''); return showLogin(); }
      toast(errText(e), 'error');
    }
    render();
  }

  function render() {
    const newCount = state.reservations.filter(r => r.status === 'new').length;
    const availCount = state.products.filter(p => p.available).length;
    const delivCount = state.reservations.filter(r => r.status === 'delivered').length;
    const tab = (id, label) => `<button onclick="pgStoreView('${id}')" class="rounded-xl px-3.5 py-2 text-xs ${state.view === id ? 'font-black gold-gradient text-black' : 'font-bold bg-slate-800 text-slate-300'}">${label}</button>`;
    const body = state.view === 'products' ? productsView() : state.view === 'reservations' ? reservationsView() : settingsView();
    shell(`
      <div class="grid grid-cols-4 gap-2 text-center">
        <div class="rounded-xl border border-slate-800 bg-slate-900/70 p-2"><p class="text-[10px] text-slate-400">المنتجات</p><p class="text-sm font-black text-white">${state.products.length}</p></div>
        <div class="rounded-xl border border-slate-800 bg-slate-900/70 p-2"><p class="text-[10px] text-slate-400">المتوفر</p><p class="text-sm font-black text-emerald-400">${availCount}</p></div>
        <div class="rounded-xl border border-slate-800 bg-slate-900/70 p-2"><p class="text-[10px] text-slate-400">حجوزات جديدة</p><p class="text-sm font-black text-sky-300">${newCount}</p></div>
        <div class="rounded-xl border border-slate-800 bg-slate-900/70 p-2"><p class="text-[10px] text-slate-400">تم تسليمها</p><p class="text-sm font-black text-emerald-300">${delivCount}</p></div>
      </div>
      <div class="flex flex-wrap gap-2">
        ${tab('products', `المنتجات (${state.products.length})`)}
        ${tab('reservations', `الحجوزات${newCount ? ` (${newCount} جديد)` : ''}`)}
        ${tab('settings', 'التخصيص والمظهر والرابط')}
      </div>
      ${body}`);
  }
  window.pgStoreView = v => { state.view = v; state.editing = null; render(); };

  function productsView() {
    if (state.editing) return editorView();
    const list = state.products.map(p => {
      const d = Number(p.discount_percent) || 0;
      const parsed = parseCategory(p.description);
      return `
        <div class="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
          <div class="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-800 flex items-center justify-center text-slate-500">${p.image ? `<img src="${esc(p.image)}" class="h-full w-full object-cover">` : '<i class="fa-solid fa-image"></i>'}</div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-black text-white">${esc(p.name)} ${parsed.cat ? `<span class="text-[10px] text-cyan-300">[${esc(parsed.cat)}]</span>` : ''}</p>
            <p class="text-xs text-emerald-300">${money(finalPrice(p))} ${d > 0 ? `<span class="text-slate-500 line-through">${money(p.price)}</span> <span class="text-rose-300">-${Math.round(d)}%</span>` : ''} <span class="text-[10px] text-slate-500">· ترتيب: ${Number(p.sort_order) || 0}</span></p>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button onclick="pgStoreToggleAvail('${esc(p.id)}')" class="rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${p.available ? 'bg-emerald-900/60 text-emerald-300' : 'bg-slate-800 text-slate-400'}">${p.available ? 'متوفر ✓' : 'نفد ✕'}</button>
            <button onclick="pgStoreDuplicate('${esc(p.id)}')" class="rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-200" title="نسخ المنتج">نسخ</button>
            <button onclick="pgStoreEdit('${esc(p.id)}')" class="rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-sky-300">تعديل</button>
            <button onclick="pgStoreDelete('${esc(p.id)}')" class="rounded-lg bg-rose-900/60 px-3 py-1.5 text-[11px] font-bold text-rose-200">حذف</button>
          </div>
        </div>`;
    }).join('');
    return `
      <button onclick="pgStoreEdit('')" class="gold-gradient text-black font-black py-2.5 px-5 rounded-xl text-sm"><i class="fa-solid fa-plus"></i> إضافة منتج</button>
      <div class="space-y-2">${list || '<p class="py-8 text-center text-sm text-slate-500">لا توجد منتجات بعد. أضف أول منتج!</p>'}</div>`;
  }

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
    render();
  };

  window.pgStoreEdit = function (id) {
    const p = id ? state.products.find(x => x.id === id) : null;
    state.editing = p ? Object.assign({}, p) : { id: 'prd_' + Date.now(), name: '', description: '', price: '', discount_percent: 0, image: '', available: true, sort_order: 0 };
    state.image = state.editing.image || '';
    render();
  };

  function editorView() {
    const p = state.editing;
    const parsed = parseCategory(p.description);
    const inp = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white';
    return `
      <div class="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 space-y-3">
        <p class="text-sm font-black text-sky-300">${state.products.some(x => x.id === p.id) ? 'تعديل المنتج' : 'منتج جديد'}</p>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="md:col-span-2"><label class="block text-xs font-bold text-slate-300 mb-1">اسم المنتج *</label><input id="pgPName" class="${inp}" maxlength="120" value="${esc(p.name)}"></div>
          <div><label class="block text-xs font-bold text-slate-300 mb-1">القسم / التصنيف</label><input id="pgPCat" class="${inp}" maxlength="28" placeholder="مثلاً: بروتين، ملابس" value="${esc(parsed.cat)}"></div>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="block text-xs font-bold text-slate-300 mb-1">السعر *</label><input id="pgPPrice" type="number" min="0" class="${inp}" value="${esc(p.price)}" oninput="pgStoreCalc()"></div>
          <div><label class="block text-xs font-bold text-slate-300 mb-1">الخصم %</label><input id="pgPDisc" type="number" min="0" max="100" class="${inp}" value="${esc(p.discount_percent)}" oninput="pgStoreCalc()"></div>
          <div><label class="block text-xs font-bold text-slate-300 mb-1">ترتيب العرض</label><input id="pgPSort" type="number" class="${inp}" value="${esc(p.sort_order || 0)}"></div>
        </div>
        <p id="pgPFinal" class="text-xs text-emerald-300"></p>
        <div><label class="block text-xs font-bold text-slate-300 mb-1">ملاحظات تظهر للاعب</label><textarea id="pgPDesc" rows="3" maxlength="950" class="${inp}">${esc(parsed.text)}</textarea></div>
        <div>
          <label class="block text-xs font-bold text-slate-300 mb-1">صورة المنتج</label>
          <input type="file" accept="image/*" onchange="pgStoreImage(event)" class="block w-full text-xs text-slate-300 file:ml-3 file:rounded-lg file:border-0 file:bg-sky-600 file:px-3 file:py-2 file:font-bold file:text-white">
          <div id="pgPImgBox" class="mt-2">${state.image ? `<img src="${esc(state.image)}" class="h-28 w-28 rounded-xl object-cover">` : ''}</div>
        </div>
        <label class="flex items-center gap-2 text-xs font-bold text-slate-200"><input id="pgPAvail" type="checkbox" ${p.available ? 'checked' : ''} class="accent-sky-400 h-4 w-4"> متوفر للحجز</label>
        <div class="flex gap-2 pt-1">
          <button onclick="pgStoreSave()" class="flex-1 gold-gradient text-black font-black py-2.5 rounded-xl text-sm">حفظ المنتج</button>
          <button onclick="pgStoreView('products')" class="rounded-xl bg-slate-800 px-5 text-xs font-bold text-slate-300">إلغاء</button>
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
        $('pgPImgBox').innerHTML = `<img src="${state.image}" class="h-28 w-28 rounded-xl object-cover">`;
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
    const cat = ($('pgPCat').value || '').trim().replace(/[\[\]]/g, '');
    const rawDesc = $('pgPDesc').value.trim();
    const description = cat ? `[${cat}]\n${rawDesc}` : rawDesc;
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
      toast('تم حفظ المنتج ✓', 'success');
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
    const fBtn = (k, label) => `<button onclick="pgStoreResFilter('${k}')" class="rounded-lg px-2.5 py-1 text-[11px] font-bold ${state.resFilter === k ? 'bg-sky-500 text-black' : 'bg-slate-800 text-slate-300'}">${label}</button>`;
    const listHtml = filtered.map(r => {
      const st = STATUS[r.status] || STATUS.new;
      let intl = String(r.customer_phone || '').replace(/\D/g, '');
      if (intl.startsWith('07') && intl.length === 11) intl = '964' + intl.slice(1);
      const when = new Date(r.created_at).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' });
      return `
        <div class="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="text-sm font-black text-white">${esc(r.customer_name)} <span class="text-xs font-normal text-slate-400" dir="ltr">${esc(r.customer_phone)}</span></p>
              <p class="text-xs text-sky-300">${esc(r.product_name)} × ${Number(r.qty) || 1}</p>
              ${r.note ? `<p class="text-[11px] text-slate-400">ملاحظة: ${esc(r.note)}</p>` : ''}
              <p class="text-[10px] text-slate-500">${esc(when)}</p>
            </div>
            <span class="rounded-full px-2.5 py-0.5 text-[10px] font-bold ${st[1]}">${st[0]}</span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <a href="https://wa.me/${intl}?text=${encodeURIComponent(`السلام عليكم ${r.customer_name}، بخصوص حجزك (${r.product_name}) من متجر القاعة.`)}" target="_blank" rel="noopener" class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"><i class="fa-brands fa-whatsapp"></i> واتساب</a>
            ${['contacted', 'delivered', 'cancelled'].filter(s => s !== r.status).map(s => `<button onclick="pgStoreStatus('${esc(r.id)}','${s}')" class="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200">${STATUS[s][0]}</button>`).join('')}
          </div>
        </div>`;
    }).join('');
    return `
      <div class="flex flex-wrap gap-1.5">${fBtn('all', 'الكل')}${fBtn('new', 'جديد')}${fBtn('contacted', 'تم التواصل')}${fBtn('delivered', 'تم التسليم')}${fBtn('cancelled', 'ملغي')}</div>
      <div class="space-y-2">${listHtml || '<p class="py-8 text-center text-sm text-slate-500">لا توجد حجوزات في هذا التصنيف</p>'}</div>`;
  }
  window.pgStoreResFilter = f => { state.resFilter = f; render(); };

  window.pgStoreStatus = async function (id, status) {
    try {
      await rpc('store_set_reservation_status', { p_gym: cfg().gym, p_pin: getPin(), p_id: id, p_status: status });
      const r = state.reservations.find(x => x.id === id);
      if (r) r.status = status;
      render();
    } catch (e) { toast(errText(e), 'error'); }
  };

  function settingsView() {
    const i = state.info || {};
    const pr = getPrefs();
    const inp = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white';
    return `
      <div class="rounded-2xl border border-emerald-500/25 bg-emerald-950/20 p-3.5 space-y-2">
        <p class="text-xs font-black text-emerald-300">رابط المتجر للاعبين</p>
        <input readonly value="${esc(storeUrl())}" dir="ltr" onclick="this.select()" class="${inp}">
        <div class="flex flex-wrap gap-2">
          <button onclick="pgStoreCopyLink()" class="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white">نسخ الرابط</button>
          <a href="${esc(storeUrl())}" target="_blank" rel="noopener" class="rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200">معاينة المتجر</a>
        </div>
      </div>

      <div class="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 space-y-3">
        <p class="text-xs font-black text-sky-300">تخصيص الهوية والمظهر</p>
        <div class="grid md:grid-cols-2 gap-3">
          <div><label class="block text-[11px] font-bold text-slate-300 mb-1">اسم المتجر</label><input id="pgSName" class="${inp}" maxlength="80" value="${esc(i.store_name)}" placeholder="متجر Power Gym"></div>
          <div><label class="block text-[11px] font-bold text-slate-300 mb-1">رقم واتساب القاعة</label><input id="pgSWa" class="${inp}" dir="ltr" value="${esc(i.whatsapp)}" placeholder="07801234567"></div>
          <div><label class="block text-[11px] font-bold text-slate-300 mb-1">أوقات الاستلام / الدوام</label><input id="pgSHours" class="${inp}" maxlength="40" value="${esc(pr.hr)}" placeholder="يومياً 10ص - 12م"></div>
          <div><label class="block text-[11px] font-bold text-slate-300 mb-1">العملة</label><select id="pgSCur" class="${inp}"><option value="د.ع" ${pr.cur === 'د.ع' ? 'selected' : ''}>دينار عراقي (د.ع)</option><option value="$" ${pr.cur === '$' ? 'selected' : ''}>دولار ($)</option></select></div>
        </div>
        <div><label class="block text-[11px] font-bold text-slate-300 mb-1">ملاحظة أعلى المتجر (العروض والتوصيل)</label><input id="pgSNote" class="${inp}" maxlength="120" value="${esc(pr.t)}" placeholder="توصيل مجاني داخل القاعة"></div>
        <div><label class="block text-[11px] font-bold text-slate-300 mb-1">الأقسام الرئيسية (افصل بفاصلة ,)</label><input id="pgSCats" class="${inp}" maxlength="90" value="${esc(pr.cat)}" placeholder="بروتين,كرياتين,ملابس,مشروبات"></div>

        <div class="grid md:grid-cols-2 gap-3">
          <div>
            <label class="block text-[11px] font-bold text-slate-300 mb-1">خلفية المتجر</label>
            <select id="pgSBg" class="${inp}">
              <option value="light" ${pr.bg === 'light' ? 'selected' : ''}>أبيض ناصع</option>
              <option value="soft" ${pr.bg === 'soft' ? 'selected' : ''}>رمادي ناعم</option>
              <option value="dark" ${pr.bg === 'dark' ? 'selected' : ''}>داكن فخم</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-slate-300 mb-1">لون الأزرار والشارات</label>
            <div class="flex flex-wrap gap-1.5 pt-1">
              ${COLORS.map(([hex, label]) => `<button type="button" onclick="pgStorePickColor('${hex}')" class="rounded-lg px-2.5 py-1 text-[10px] font-bold text-white border ${pr.c === hex ? 'border-white ring-2 ring-sky-400' : 'border-slate-700'}" style="background:${hex}">${label}</button>`).join('')}
            </div>
            <input type="hidden" id="pgSColor" value="${esc(pr.c)}">
          </div>
        </div>

        <div class="flex flex-wrap gap-4 pt-1 text-xs text-slate-200">
          <label class="flex items-center gap-2"><input id="pgSOpen" type="checkbox" ${Number(pr.open) !== 0 ? 'checked' : ''} class="accent-sky-400"> المتجر مفتوح للحجز</label>
          <label class="flex items-center gap-2"><input id="pgSSold" type="checkbox" ${Number(pr.so) !== 0 ? 'checked' : ''} class="accent-sky-400"> إظهار المنتجات المنتهية</label>
          <label class="flex items-center gap-2"><input id="pgSNt" type="checkbox" ${Number(pr.nt) !== 0 ? 'checked' : ''} class="accent-sky-400"> السماح بملاحظة الزبون</label>
        </div>

        <button onclick="pgStoreSaveSettings()" class="gold-gradient text-black font-black py-2.5 px-5 rounded-xl text-sm">حفظ كل التخصيصات</button>
      </div>
      <button onclick="pgStoreLogout()" class="text-xs font-bold text-rose-300">تسجيل خروج من المتجر على هذا الجهاز</button>`;
  }

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
    const packed = JSON.stringify({
      t: ($('pgSNote')?.value || '').trim().slice(0, 120),
      c: ($('pgSColor')?.value || '#0891b2').trim(),
      bg: $('pgSBg')?.value || 'light',
      open: $('pgSOpen')?.checked ? 1 : 0,
      so: $('pgSSold')?.checked ? 1 : 0,
      nt: $('pgSNt')?.checked ? 1 : 0,
      hr: ($('pgSHours')?.value || '').trim().slice(0, 40),
      cur: $('pgSCur')?.value || 'د.ع',
      cat: ($('pgSCats')?.value || '').trim().slice(0, 90)
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

  function injectLink() {
    const sec = $('pgSmartToolsNav');
    if (!sec || $('pgStoreNavBtn')) return false;
    const b = document.createElement('button');
    b.id = 'pgStoreNavBtn';
    b.className = 'sidebar-link';
    b.onclick = () => { window.openStoreAdmin(); if (typeof closeMobileMenu === 'function') closeMobileMenu(); };
    b.innerHTML = '<i class="fa-solid fa-store text-sky-400"></i><span>متجر القاعة</span>';
    sec.appendChild(b);
    return true;
  }
  function init() { if (!injectLink()) setTimeout(injectLink, 700); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
