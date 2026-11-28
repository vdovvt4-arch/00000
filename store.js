/* store.js v4.0 — صفحة المتجر الفرعي العامة للاعبين (مربوطة بـ PostgreSQL + Google Sign-In) */
(function () {
  'use strict';

  const CFG = {
    url: 'https://bpwjdjkqcfxerizrssbs.supabase.co',
    key: 'sb_publishable_GwS8ghvuEC6cCFb4GJ0j5Q_NBpXAgKO'
  };
  const GYM = new URLSearchParams(location.search).get('g') || 'powergym-main';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const supabase = window.supabase
    ? window.supabase.createClient(CFG.url, CFG.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'pg_supabase_auth_token_v2' }
      })
    : null;

  const ERRORS = {
    invalid_name: 'اكتب اسمك (حرفان على الأقل)',
    invalid_phone: 'رقم الهاتف غير صحيح',
    invalid_qty: 'الكمية غير صحيحة',
    product_unavailable: 'هذا المنتج غير متوفر حالياً',
    too_many: 'محاولات حجز كثيرة، حاول لاحقاً'
  };
  const STATUS_LABELS = {
    new: 'قيد المراجعة',
    contacted: 'تم التواصل',
    delivered: 'تم التسليم ✓',
    cancelled: 'ملغي'
  };

  let products = [];
  let info = {};
  let storeUser = null;
  let prefs = {
    t: '',
    c: '#f59e0b',
    bg: 'dark',
    open: 1,
    so: 1,
    nt: 1,
    hr: '',
    cur: 'د.ع',
    cat: '',
    promoOn: 1,
    promoSpd: 4,
    promos: [
      { badge: 'عرض خاص', title: 'أقوى المكملات والملابس الرياضية متوفرة الآن', sub: 'احجز طلبك أونلاين واستلم من القاعة مباشرة', color: '#f59e0b' },
      { badge: 'تنبيه القاعة', title: 'خصومات حصرية لمشتركي Power Gym', sub: 'تابع العروض اليومية المتجددة داخل المتجر', color: '#0891b2' }
    ]
  };
  let activeCategory = 'الكل';
  let current = null;
  let qty = 1;
  let promoIdx = 0;
  let promoTimer = null;

  const money = n => Math.round(Number(n) || 0).toLocaleString('en-US') + ' ' + (prefs.cur || 'د.ع');

  function renderStoreAuthBar() {
    const bar = $('storeAuthBar');
    if (!bar || !supabase) return;

    if (!storeUser) {
      bar.innerHTML = `
        <button type="button" id="storeGoogleBtn" class="google-btn">
          <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
            <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
            <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
          </svg>
          <span>تسجيل دخول Google</span>
        </button>
      `;
      $('storeGoogleBtn').onclick = async () => {
        const redirectTo = window.location.origin + window.location.pathname + window.location.search;
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, queryParams: { prompt: 'select_account' } }
        });
        if (error) alert('تعذر تسجيل الدخول عبر Google حالياً: ' + error.message);
      };
      return;
    }

    const name = storeUser.user_metadata?.full_name || storeUser.user_metadata?.name || storeUser.email || 'مشترك';
    const avatar = storeUser.user_metadata?.avatar_url || storeUser.user_metadata?.picture || '';
    bar.innerHTML = `
      <span class="user-chip">
        ${avatar ? `<img src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">` : ''}
        <span>${esc(name)}</span>
      </span>
      <button type="button" id="storeMyOrdersBtn" class="google-btn">حجوزاتي</button>
      <button type="button" id="storeLogoutBtn" class="google-btn">خروج</button>
    `;
    $('storeMyOrdersBtn').onclick = openMyReservationsSheet;
    $('storeLogoutBtn').onclick = async () => {
      await supabase.auth.signOut().catch(() => {});
      storeUser = null;
      renderStoreAuthBar();
    };
  }

  async function openMyReservationsSheet() {
    if (!supabase || !storeUser) return;
    $('sheet').innerHTML = '<h2>حجوزاتي في المتجر</h2><p class="sub">جارٍ التحميل من قاعدة البيانات...</p>';
    $('overlay').classList.add('show');

    const { data, error } = await supabase.rpc('store_my_reservations', { p_gym: GYM });
    if (error) {
      $('sheet').innerHTML = `<h2>حجوزاتي</h2><p class="sub">تعذر جلب الحجوزات: ${esc(error.message)}</p><button class="btn ghost" style="width:100%" id="closeMyRes">إغلاق</button>`;
      $('closeMyRes').onclick = closeSheet;
      return;
    }

    const list = Array.isArray(data) ? data : [];
    $('sheet').innerHTML = `
      <h2>حجوزاتي (${list.length})</h2>
      <p class="sub">المرتبطة بحساب ${esc(storeUser.email || '')}</p>
      <div>
        ${list.length ? list.map(r => `
          <div class="res-item">
            <div>
              <div style="font-weight:800">${esc(r.product_name)} × ${Number(r.qty) || 1}</div>
              <div style="font-size:11px;color:var(--muted)">${Number(r.total_price) > 0 ? money(r.total_price) + ' · ' : ''}${esc(new Date(r.created_at).toLocaleDateString('ar-IQ'))}</div>
            </div>
            <span class="res-status">${esc(STATUS_LABELS[r.status] || r.status)}</span>
          </div>
        `).join('') : '<p style="text-align:center;color:var(--muted);padding:24px 0">لا توجد حجوزات مسجلة بهذا الحساب بعد.</p>'}
      </div>
      <button class="btn ghost" style="width:100%;margin-top:10px" id="closeMyRes">إغلاق</button>
    `;
    $('closeMyRes').onclick = closeSheet;
  }

  function parsePrefs(rawNote) {
    const s = String(rawNote || '').trim();
    if (s.startsWith('{')) {
      try {
        const obj = JSON.parse(s);
        prefs = Object.assign({}, prefs, obj);
        return;
      } catch { /* fallback */ }
    }
    if (s) prefs.t = s;
  }

  function parseProductCategory(desc, rowCats) {
    if (Array.isArray(rowCats) && rowCats.length) {
      const m = String(desc || '').match(/^\[([^\]]{1,80})\]\s*\n?([\s\S]*)$/);
      return { cats: rowCats.map(x => String(x).trim()).filter(Boolean), cat: rowCats.join(' · '), text: m ? m[2].trim() : String(desc || '').trim() };
    }
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
    }
    document.body.classList.remove('theme-soft', 'theme-dark');
    if (prefs.bg === 'soft') document.body.classList.add('theme-soft');
    else if (prefs.bg === 'dark') document.body.classList.add('theme-dark');
  }

  function finalPrice(p) {
    const d = Math.min(100, Math.max(0, Number(p.discount_percent) || 0));
    return Math.round((Number(p.price) || 0) * (1 - d / 100));
  }

  function renderPromos() {
    const wrap = $('promoBanner');
    if (!wrap) return;
    if (promoTimer) { clearInterval(promoTimer); promoTimer = null; }
    const list = Array.isArray(prefs.promos) ? prefs.promos.filter(x => x && x.title) : [];
    if (Number(prefs.promoOn) === 0 || !list.length) {
      wrap.classList.remove('show');
      wrap.innerHTML = '';
      return;
    }
    if (promoIdx >= list.length) promoIdx = 0;
    wrap.classList.add('show');
    wrap.innerHTML = `
      <div id="promoTrack" class="promo-track" style="transform: translateX(${promoIdx * 100}%)">
        ${list.map(item => {
          const bgCol = /^#[0-9a-fA-F]{6}$/.test(item.color || '') ? item.color : '#f59e0b';
          return `
            <div class="promo-slide" style="background: linear-gradient(135deg, ${bgCol}26 0%, #09090b 85%);">
              <div>
                ${item.badge ? `<span class="promo-badge" style="background:${bgCol}">${esc(item.badge)}</span>` : ''}
                <div class="promo-title">${esc(item.title)}</div>
                ${item.sub ? `<div class="promo-sub">${esc(item.sub)}</div>` : ''}
              </div>
              <div style="font-size:28px;opacity:.9">🔥</div>
            </div>`;
        }).join('')}
      </div>
      ${list.length > 1 ? `
        <div class="promo-controls">
          <div class="promo-dots">
            ${list.map((_, idx) => `<button type="button" class="promo-dot ${idx === promoIdx ? 'active' : ''}" data-pidx="${idx}" aria-label="عرض ${idx + 1}"></button>`).join('')}
          </div>
          <div class="promo-nav">
            <button type="button" id="promoPrevBtn" aria-label="السابق">‹</button>
            <button type="button" id="promoNextBtn" aria-label="التالي">›</button>
          </div>
        </div>` : ''}`;

    const goTo = idx => {
      promoIdx = (idx + list.length) % list.length;
      const track = $('promoTrack');
      if (track) track.style.transform = `translateX(${promoIdx * 100}%)`;
      wrap.querySelectorAll('.promo-dot').forEach((d, i) => d.classList.toggle('active', i === promoIdx));
    };

    wrap.querySelectorAll('.promo-dot').forEach(btn => {
      btn.addEventListener('click', () => goTo(Number(btn.dataset.pidx) || 0));
    });
    const prev = $('promoPrevBtn');
    const next = $('promoNextBtn');
    if (prev) prev.addEventListener('click', () => goTo(promoIdx - 1));
    if (next) next.addEventListener('click', () => goTo(promoIdx + 1));

    if (list.length > 1) {
      const ms = Math.max(2, Math.min(12, Number(prefs.promoSpd) || 4)) * 1000;
      promoTimer = setInterval(() => goTo(promoIdx + 1), ms);
    }
  }

  function renderCategories() {
    const bar = $('catsBar');
    if (!bar) return;
    const fromPrefs = String(prefs.cat || '').split(/[,،]/).map(x => x.trim()).filter(Boolean);
    const fromInfo = Array.isArray(info.categories) ? info.categories : [];
    const fromProds = products.flatMap(p => parseProductCategory(p.description, p.categories).cats).filter(Boolean);
    const cats = Array.from(new Set([...fromPrefs, ...fromInfo, ...fromProds]));
    if (!cats.length) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const all = ['الكل', ...cats];
    bar.innerHTML = all.map(c => `
      <button type="button" class="cat-pill ${activeCategory === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>
    `).join('');
  }

  function render() {
    const q = ($('search').value || '').trim().toLowerCase();
    const list = products.filter(p => {
      if (!prefs.so && !p.available) return false;
      const parsed = parseProductCategory(p.description, p.categories);
      if (activeCategory !== 'الكل' && !parsed.cats.includes(activeCategory)) return false;
      return !q || (p.name || '').toLowerCase().includes(q) || parsed.text.toLowerCase().includes(q);
    });

    const grid = $('grid');
    const empty = $('empty');
    if (!list.length) {
      grid.innerHTML = '';
      empty.style.display = 'block';
      empty.textContent = products.length ? 'لا توجد نتائج مطابقة' : 'لا توجد منتجات حالياً، تابعنا قريباً 💪';
      return;
    }
    empty.style.display = 'none';
    const closed = Number(prefs.open) === 0;
    grid.innerHTML = list.map(p => {
      const d = Number(p.discount_percent) || 0;
      const sold = !p.available;
      const parsed = parseProductCategory(p.description, p.categories);
      return `
        <article class="card">
          <div class="thumb">
            ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : '🛒'}
            ${d > 0 && !sold ? `<span class="badge">خصم ${Math.round(d)}%</span>` : ''}
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
  }
  function closeSheet() { $('overlay').classList.remove('show'); }

  function drawForm() {
    const p = current;
    const defaultName = storeUser ? (storeUser.user_metadata?.full_name || storeUser.user_metadata?.name || '') : '';
    $('sheet').innerHTML = `
      <h2>حجز: ${esc(p.name)}</h2>
      <p class="sub">${money(finalPrice(p))} للقطعة — الدفع عند الاستلام من القاعة</p>
      <div id="formError" class="error"></div>
      <div class="field"><label for="cName">الاسم</label><input id="cName" maxlength="80" autocomplete="name" value="${esc(defaultName)}" placeholder="اسمك الكامل"></div>
      <div class="field"><label for="cPhone">رقم الهاتف</label><input id="cPhone" type="tel" dir="ltr" maxlength="15" autocomplete="tel" placeholder="07801234567" style="text-align:right"></div>
      <div class="field"><label>الكمية</label>
        <div class="qty"><button type="button" id="qMinus">−</button><span id="qVal">${qty}</span><button type="button" id="qPlus">+</button></div>
      </div>
      ${Number(prefs.nt) !== 0 ? `<div class="field"><label for="cNote">ملاحظة (اختياري)</label><textarea id="cNote" rows="2" maxlength="300"></textarea></div>` : ''}
      <div class="row">
        <button class="btn ghost" id="cCancel" type="button">إلغاء</button>
        <button class="btn" id="cSend" type="button">تأكيد الحجز</button>
      </div>`;
    $('qMinus').onclick = () => { qty = Math.max(1, qty - 1); $('qVal').textContent = qty; };
    $('qPlus').onclick = () => { qty = Math.min(50, qty + 1); $('qVal').textContent = qty; };
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
    btn.textContent = 'جارٍ الحفظ في قاعدة البيانات...';
    try {
      const { error } = await supabase.rpc('store_reserve', {
        p_gym: GYM,
        p_product_id: current.id,
        p_qty: qty,
        p_name: name,
        p_phone: phone,
        p_note: ($('cNote')?.value || '').trim()
      });
      if (error) throw new Error(error.message);
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
    const msg = `السلام عليكم، أنا ${name}، حجزت (${current.name}) × ${qty} من متجر القاعة.`;
    $('sheet').innerHTML = `
      <div class="ok">
        <div class="tick">✅</div>
        <h3>تم تسجيل حجزك في قاعدة البيانات</h3>
        <p>شكراً ${esc(name)}، تم حفظ طلبك وسيتم تجهيزه للاستلام من القاعة.</p>
        ${intl ? `<a class="btn" style="display:block;text-decoration:none;margin-bottom:8px" href="https://wa.me/${intl}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">تأكيد عبر واتساب</a>` : ''}
        <button class="btn ghost" style="width:100%" id="okClose">إغلاق</button>
      </div>`;
    $('okClose').onclick = closeSheet;
  }

  async function load() {
    if (supabase) {
      const { data: sessionRes } = await supabase.auth.getSession();
      storeUser = sessionRes?.session?.user || null;
      renderStoreAuthBar();
      supabase.auth.onAuthStateChange((_ev, session) => {
        storeUser = session?.user || null;
        renderStoreAuthBar();
      });
    }

    try {
      const { data } = await supabase.rpc('store_get_info', { p_gym: GYM });
      info = data || {};
    } catch { info = {}; }

    parsePrefs(info.note);
    applyTheme();
    if (info.store_name) {
      $('storeTitle').textContent = info.store_name;
      document.title = info.store_name;
    }
    const noteParts = [prefs.t, prefs.hr ? `🕒 ${prefs.hr}` : ''].filter(Boolean);
    $('storeNote').textContent = noteParts.join(' · ');

    if (Number(prefs.open) === 0 && $('closedBanner')) {
      $('closedBanner').style.display = 'block';
    }

    try {
      const { data, error } = await supabase
        .from('store_products')
        .select('*')
        .eq('gym_id', GYM)
        .order('sort_order', { ascending: true })
        .order('updated_at', { ascending: false });
      if (error) throw error;
      products = data || [];
    } catch {
      products = [];
      const empty = $('empty');
      empty.style.display = 'block';
      empty.textContent = 'تعذر تحميل المنتجات، تحقق من الاتصال وأعد المحاولة';
      return;
    }
    renderPromos();
    renderCategories();
    render();
  }

  $('search').addEventListener('input', render);
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
  load();
})();
