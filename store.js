/* store.js — صفحة المتجر العامة للاعبين (تطبق كل تخصيصات المدير تلقائياً) */
(function () {
  'use strict';

  const CFG = {
    url: 'https://bpwjdjkqcfxerizrssbs.supabase.co',
    key: 'sb_publishable_GwS8ghvuEC6cCFb4GJ0j5Q_NBpXAgKO'
  };
  const GYM = new URLSearchParams(location.search).get('g') || 'powergym-main';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ERRORS = {
    invalid_name: 'اكتب اسمك (حرفان على الأقل)',
    invalid_phone: 'رقم الهاتف غير صحيح',
    invalid_qty: 'الكمية غير صحيحة',
    product_unavailable: 'هذا المنتج غير متوفر حالياً',
    too_many: 'محاولات حجز كثيرة، حاول لاحقاً'
  };

  let products = [];
  let info = {};
  let prefs = {
    t: '',
    c: '#0891b2',
    bg: 'light',
    open: 1,
    so: 1,
    nt: 1,
    hr: '',
    cur: 'د.ع',
    cat: ''
  };
  let activeCategory = 'الكل';
  let dealsOnly = false;
  let current = null;
  let qty = 1;
  let searchIndex = [];
  let renderFrame = 0;

  const headers = () => ({ apikey: CFG.key, 'Content-Type': 'application/json' });
  const money = n => Math.round(Number(n) || 0).toLocaleString('en-US') + ' ' + (prefs.cur || 'د.ع');

  function parsePrefs(rawNote) {
    const s = String(rawNote || '').trim();
    if (s.startsWith('{')) {
      try {
        const obj = JSON.parse(s);
        prefs = Object.assign({}, prefs, obj);
        return;
      } catch { /* fallback to plain text */ }
    }
    prefs.t = s;
  }

  function parseProductCategory(desc) {
    const m = String(desc || '').match(/^\[([^\]]{1,80})\]\s*\n?([\s\S]*)$/);
    if (!m) return { cats: [], cat: '', text: String(desc || '').trim() };
    const cats = m[1].split(/[,،]/).map(x => x.trim()).filter(Boolean);
    return { cats, cat: cats.join(' · '), text: m[2].trim() };
  }

  function applyTheme() {
    const root = document.documentElement;
    if (prefs.c && /^#[0-9a-fA-F]{6}$/.test(prefs.c)) {
      root.style.setProperty('--brand', prefs.c);
      root.style.setProperty('--brand-dark', prefs.c);
      const rgb = prefs.c.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16));
      root.style.setProperty('--brand-rgb', rgb.join(', '));
    }
    document.body.classList.remove('theme-soft', 'theme-dark');
    if (prefs.bg === 'soft') document.body.classList.add('theme-soft');
    else if (prefs.bg === 'dark') document.body.classList.add('theme-dark');
  }

  async function rpc(name, args) {
    const res = await fetch(`${CFG.url}/rest/v1/rpc/${name}`, { method: 'POST', headers: headers(), body: JSON.stringify(args) });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return text ? JSON.parse(text) : null;
  }

  function finalPrice(p) {
    const d = Math.min(100, Math.max(0, Number(p.discount_percent) || 0));
    return Math.round((Number(p.price) || 0) * (1 - d / 100));
  }

  function displayStoreName(name) {
    const value = String(name || '').trim();
    return !value || ['متجر القاعة', 'متجر Power Gym', 'Power Gym Store'].includes(value)
      ? 'متجر بور جم'
      : value;
  }

  function normalizeSearch(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/[ؤ]/g, 'و')
      .replace(/[ئىي]/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660))
      .replace(/[\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function buildSearchIndex() {
    searchIndex = products.map((product, index) => {
      const parsed = parseProductCategory(product.description);
      const fields = [
        { text: normalizeSearch(product.name), weight: 100 },
        { text: normalizeSearch(parsed.cats.join(' ')), weight: 75 },
        { text: normalizeSearch(parsed.text), weight: 55 },
        { text: normalizeSearch(`${product.price} ${finalPrice(product)}`), weight: 35, numeric: true, fuzzy: false }
      ].filter(field => field.text);
      fields.forEach(field => { field.words = field.text.split(' '); });
      return { product, index, fields };
    });
  }

  function isOneEditAway(a, b) {
    if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        i++;
        j++;
        continue;
      }
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }

  function searchScore(entry, terms) {
    let score = 0;
    for (const term of terms) {
      const numericTerm = /^\d+$/.test(term);
      if (numericTerm) {
        const priceField = entry.fields.find(field => field.numeric);
        const priceMatches = priceField && priceField.words.some(word =>
          word === term || (term.length >= 2 && word.startsWith(term))
        );
        if (!priceMatches) return 0;
        score += priceField.weight + 40;
        continue;
      }
      let best = 0;
      for (const field of entry.fields) {
        if (field.text.includes(term)) best = Math.max(best, field.weight + 25);
        for (const word of field.words) {
          if (word === term) best = Math.max(best, field.weight + 40);
          else if ((word.startsWith(term) || (term.length >= 3 && term.startsWith(word))) && word.length >= 3) {
            best = Math.max(best, field.weight + 25);
          } else if (word.includes(term)) best = Math.max(best, field.weight + 15);
          else if (!numericTerm && field.fuzzy !== false && term.length >= 4 && isOneEditAway(term, word)) best = Math.max(best, field.weight + 5);
        }
      }
      if (!best) return 0;
      score += best;
    }
    return score;
  }

  function scheduleRender() {
    if (renderFrame) window.cancelAnimationFrame(renderFrame);
    renderFrame = window.requestAnimationFrame(() => {
      renderFrame = 0;
      render();
    });
  }

  function clearSearch() {
    $('search').value = '';
    $('clearSearch').hidden = true;
    render();
    $('search').focus();
  }

  function renderCategories() {
    const bar = $('catsBar');
    if (!bar) return;
    const fromPrefs = String(prefs.cat || '').split(/[,،]/).map(x => x.trim()).filter(Boolean);
    const fromProds = products.flatMap(p => parseProductCategory(p.description).cats).filter(Boolean);
    const cats = Array.from(new Set([...fromPrefs, ...fromProds]));
    if (!cats.length) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const all = ['الكل', ...cats];
    bar.innerHTML = all.map(c => `
      <button type="button" class="cat-pill ${activeCategory === c ? 'active' : ''}" data-cat="${esc(c)}" aria-pressed="${activeCategory === c}">${esc(c)}</button>
    `).join('');
  }

  function renderOfferBanner() {
    const banner = $('offerBanner');
    const detail = $('offerDetail');
    if (!banner || !detail) return;
    const offers = products.filter(p => p.available && Number(p.discount_percent) > 0);
    if (!offers.length) {
      banner.classList.remove('show');
      return;
    }
    const topDiscount = Math.max(...offers.map(p => Math.min(100, Math.max(0, Number(p.discount_percent) || 0))));
    detail.textContent = `${offers.length} ${offers.length === 1 ? 'منتج عليه خصم' : 'منتجات عليها خصومات'} — وفر لحد ${Math.round(topDiscount)}٪`;
    banner.classList.add('show');
  }

  function render() {
    const terms = normalizeSearch($('search').value).split(' ').filter(Boolean);
    const ranked = searchIndex.filter(entry => {
      const p = entry.product;
      if (!prefs.so && !p.available) return false;
      const parsed = parseProductCategory(p.description);
      if (activeCategory !== 'الكل' && !parsed.cats.includes(activeCategory)) return false;
      if (dealsOnly && (!p.available || !(Number(p.discount_percent) > 0))) return false;
      entry.score = terms.length ? searchScore(entry, terms) : 0;
      return !terms.length || entry.score > 0;
    });
    const sort = $('sortProducts')?.value || 'featured';
    if (sort === 'price-low') ranked.sort((a, b) => finalPrice(a.product) - finalPrice(b.product) || a.index - b.index);
    else if (sort === 'price-high') ranked.sort((a, b) => finalPrice(b.product) - finalPrice(a.product) || a.index - b.index);
    else if (sort === 'discount') ranked.sort((a, b) => (Number(b.product.discount_percent) || 0) - (Number(a.product.discount_percent) || 0) || a.index - b.index);
    else if (terms.length) ranked.sort((a, b) => b.score - a.score || a.index - b.index);
    const list = ranked.map(entry => entry.product);

    const grid = $('grid');
    const empty = $('empty');
    $('resultsCount').textContent = `النتائج ${list.length} / ${products.length}`;
    $('dealsToggle')?.classList.toggle('is-active', dealsOnly);
    $('dealsToggle')?.setAttribute('aria-pressed', String(dealsOnly));
    if (!list.length) {
      grid.innerHTML = '';
      empty.style.display = 'block';
      empty.textContent = terms.length
        ? 'ما لقينا منتج مطابق — جرّب كلمة أقصر أو اكتبها بطريقة ثانية'
        : dealsOnly && products.some(p => Number(p.discount_percent) > 0)
          ? 'ماكو عروض مطابقة حالياً — جرب قسم ثاني'
          : products.length ? 'لا توجد منتجات بهذا القسم' : 'لا توجد منتجات حالياً، تابعنا قريباً 💪';
      return;
    }
    empty.style.display = 'none';
    const closed = Number(prefs.open) === 0;
    const highestDiscount = Math.max(0, ...products.filter(p => p.available).map(p => Math.min(100, Math.max(0, Number(p.discount_percent) || 0))));
    grid.innerHTML = list.map(p => {
      const d = Math.min(100, Math.max(0, Number(p.discount_percent) || 0));
      const sold = !p.available;
      const parsed = parseProductCategory(p.description);
      return `
        <article class="card" id="store-product-${esc(p.id)}">
          <div class="thumb">
            ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : '🛒'}
            ${d > 0 && !sold ? `<span class="badge">خصم ${Math.round(d)}%</span>` : ''}
            ${d > 0 && d === highestDiscount && !sold ? '<span class="featured-badge">أفضل عرض</span>' : ''}
            ${parsed.cat ? `<span class="cat-tag">${esc(parsed.cat)}</span>` : ''}
            ${sold ? '<div class="soldout">نفدت الكمية</div>' : ''}
          </div>
          <div class="info">
            <h3 class="name">${esc(p.name)}</h3>
            ${parsed.text ? `<p class="desc">${esc(parsed.text)}</p>` : ''}
            <div class="price">
              <span class="now">${money(finalPrice(p))}</span>
              ${d > 0 ? `<span class="old">${money(p.price)}</span>` : ''}
            </div>
            <button class="btn" ${(sold || closed) ? 'disabled' : ''} data-id="${esc(p.id)}">${closed ? 'الحجز متوقف مؤقتاً' : (sold ? 'غير متوفر' : 'احجز الآن')}</button>
          </div>
        </article>`;
    }).join('');
  }

  function openSheet(p) {
    current = p;
    qty = 1;
    drawForm();
    $('overlay').classList.add('show');
    $('cName')?.focus();
  }
  function closeSheet() { $('overlay').classList.remove('show'); }

  function updateBookingTotal() {
    const total = $('bookingTotal');
    if (total && current) total.textContent = money(finalPrice(current) * qty);
  }

  function drawForm() {
    const p = current;
    $('sheet').innerHTML = `
      <h2>حجز: ${esc(p.name)}</h2>
      <p class="sub">${money(finalPrice(p))} للقطعة — الدفع عند الاستلام من القاعة</p>
      <div id="formError" class="error"></div>
      <div class="field"><label for="cName">الاسم</label><input id="cName" maxlength="80" autocomplete="name" placeholder="اسمك الكامل"></div>
      <div class="field"><label for="cPhone">رقم الهاتف</label><input id="cPhone" type="tel" dir="ltr" maxlength="15" autocomplete="tel" placeholder="07801234567" style="text-align:right"></div>
      <div class="field"><label>الكمية</label>
        <div class="qty"><button type="button" id="qMinus">−</button><span id="qVal">${qty}</span><button type="button" id="qPlus">+</button></div>
      </div>
      <div class="booking-total"><span>المجموع</span><strong id="bookingTotal">${money(finalPrice(p) * qty)}</strong></div>
      ${Number(prefs.nt) !== 0 ? `<div class="field"><label for="cNote">ملاحظة (اختياري)</label><textarea id="cNote" rows="2" maxlength="300"></textarea></div>` : ''}
      <div class="row">
        <button class="btn ghost" id="cCancel" type="button">إلغاء</button>
        <button class="btn" id="cSend" type="button">تأكيد الحجز</button>
      </div>`;
    $('qMinus').onclick = () => { qty = Math.max(1, qty - 1); $('qVal').textContent = qty; updateBookingTotal(); };
    $('qPlus').onclick = () => { qty = Math.min(50, qty + 1); $('qVal').textContent = qty; updateBookingTotal(); };
    $('cCancel').onclick = closeSheet;
    $('cSend').onclick = submit;
  }

  function showError(msg) {
    const el = $('formError');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }

  async function submit() {
    const name = $('cName').value.trim();
    const phone = $('cPhone').value.trim();
    if (name.length < 2) return showError(ERRORS.invalid_name);
    if (phone.replace(/\D/g, '').length < 7) return showError(ERRORS.invalid_phone);
    const btn = $('cSend');
    btn.disabled = true;
    btn.textContent = 'جارٍ الإرسال...';
    try {
      await rpc('store_reserve', {
        p_gym: GYM, p_product_id: current.id, p_qty: qty,
        p_name: name, p_phone: phone, p_note: ($('cNote')?.value || '').trim()
      });
      done(name);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'تأكيد الحجز';
      showError(ERRORS[e.message] || 'تعذر إرسال الحجز، حاول مرة أخرى');
    }
  }

  function done(name) {
    const wa = String(info.whatsapp || '').replace(/[^0-9]/g, '');
    let intl = wa;
    if (intl.startsWith('07') && intl.length === 11) intl = '964' + intl.slice(1);
    const total = money(finalPrice(current) * qty);
    const msg = `السلام عليكم، أنا ${name}، حجزت (${current.name}) × ${qty} من متجر بور جم. المجموع: ${total}.`;
    $('sheet').innerHTML = `
      <div class="ok">
        <div class="tick">✅</div>
        <h3>تم استلام حجزك</h3>
        <p>شكراً ${esc(name)}، تم تسجيل طلبك بمجموع <strong>${total}</strong>. سيتواصل معك فريق القاعة قريباً للاستلام.</p>
        ${intl ? `<a class="btn" style="display:block;text-decoration:none;margin-bottom:8px" href="https://wa.me/${intl}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">تواصل عبر واتساب</a>` : ''}
        <button class="btn ghost" style="width:100%" id="okClose">إغلاق</button>
      </div>`;
    $('okClose').onclick = closeSheet;
  }

  async function load() {
    try {
      info = (await rpc('store_get_info', { p_gym: GYM })) || {};
    } catch { info = {}; }
    parsePrefs(info.note);
    applyTheme();
    const storeName = displayStoreName(info.store_name);
    $('storeTitle').textContent = storeName;
    document.title = storeName;
    const noteParts = [prefs.t || 'اختياراتك الرياضية من قاعتك المفضلة', prefs.hr ? `🕒 ${prefs.hr}` : ''].filter(Boolean);
    $('storeNote').textContent = noteParts.join(' · ');

    const status = $('storeOpenStatus');
    const isOpen = Number(prefs.open) !== 0;
    status.textContent = isOpen ? 'المتجر مفتوح' : 'الحجز متوقف';
    status.classList.toggle('is-closed', !isOpen);
    if (Number(prefs.open) === 0 && $('closedBanner')) {
      $('closedBanner').style.display = 'block';
    }

    try {
      const res = await fetch(`${CFG.url}/rest/v1/store_products?gym_id=eq.${encodeURIComponent(GYM)}&select=*&order=sort_order.asc,updated_at.desc`, { headers: { apikey: CFG.key } });
      if (!res.ok) throw new Error('load_failed');
      products = await res.json();
    } catch {
      products = [];
      const empty = $('empty');
      empty.style.display = 'block';
      empty.textContent = 'تعذر تحميل المنتجات، تحقق من الاتصال وأعد المحاولة';
      return;
    }
    buildSearchIndex();
    renderCategories();
    renderOfferBanner();
    render();
  }

  $('search').addEventListener('input', () => {
    $('clearSearch').hidden = !$('search').value;
    scheduleRender();
  });
  $('clearSearch').addEventListener('click', clearSearch);
  $('sortProducts').addEventListener('change', render);
  $('dealsToggle').addEventListener('click', () => { dealsOnly = !dealsOnly; render(); });
  if ($('catsBar')) {
    $('catsBar').addEventListener('click', e => {
      const b = e.target.closest('button[data-cat]');
      if (!b) return;
      activeCategory = b.dataset.cat;
      renderCategories();
      render();
    });
  }
  $('grid').addEventListener('click', e => {
    const b = e.target.closest('button[data-id]');
    if (!b || b.disabled) return;
    const p = products.find(x => x.id === b.dataset.id);
    if (p && p.available) openSheet(p);
  });
  $('overlay').addEventListener('click', e => { if (e.target === $('overlay')) closeSheet(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('overlay').classList.contains('show')) closeSheet();
      else if (document.activeElement === $('search') && $('search').value) clearSearch();
      return;
    }
    const target = e.target;
    const editing = target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]');
    const shortcut = (e.key === '/' && !e.altKey && !e.ctrlKey && !e.metaKey && !editing) ||
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k');
    if (shortcut && !$('overlay').classList.contains('show')) {
      e.preventDefault();
      $('search').focus();
      $('search').select();
    }
  });
  load();
})();
