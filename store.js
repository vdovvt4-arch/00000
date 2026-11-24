/* store.js — صفحة المتجر العامة للاعبين (عرض المنتجات + الحجز) */
(function () {
  'use strict';

  const CFG = {
    url: 'https://bpwjdjkqcfxerizrssbs.supabase.co',
    key: 'sb_publishable_GwS8ghvuEC6cCFb4GJ0j5Q_NBpXAgKO'
  };
  const GYM = new URLSearchParams(location.search).get('g') || 'powergym-main';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Math.round(Number(n) || 0).toLocaleString('en-US') + ' د.ع';

  const ERRORS = {
    invalid_name: 'اكتب اسمك (حرفان على الأقل)',
    invalid_phone: 'رقم الهاتف غير صحيح',
    invalid_qty: 'الكمية غير صحيحة',
    product_unavailable: 'هذا المنتج غير متوفر حالياً',
    too_many: 'محاولات حجز كثيرة، حاول لاحقاً'
  };

  let products = [];
  let info = {};
  let current = null;
  let qty = 1;

  const headers = () => ({ apikey: CFG.key, 'Content-Type': 'application/json' });

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

  function render() {
    const q = ($('search').value || '').trim().toLowerCase();
    const list = products.filter(p => !q || (p.name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
    const grid = $('grid');
    const empty = $('empty');
    if (!list.length) {
      grid.innerHTML = '';
      empty.style.display = 'block';
      empty.textContent = products.length ? 'لا توجد نتائج مطابقة' : 'لا توجد منتجات حالياً، تابعنا قريباً 💪';
      return;
    }
    empty.style.display = 'none';
    grid.innerHTML = list.map(p => {
      const d = Number(p.discount_percent) || 0;
      const sold = !p.available;
      return `
        <article class="card">
          <div class="thumb">
            ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : '🛒'}
            ${d > 0 && !sold ? `<span class="badge">خصم ${Math.round(d)}%</span>` : ''}
            ${sold ? '<div class="soldout">نفدت الكمية</div>' : ''}
          </div>
          <div class="info">
            <h3 class="name">${esc(p.name)}</h3>
            ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
            <div class="price">
              <span class="now">${money(finalPrice(p))}</span>
              ${d > 0 ? `<span class="old">${money(p.price)}</span>` : ''}
            </div>
            <button class="btn" ${sold ? 'disabled' : ''} data-id="${esc(p.id)}">${sold ? 'غير متوفر' : 'احجز الآن'}</button>
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
    $('sheet').innerHTML = `
      <h2>حجز: ${esc(p.name)}</h2>
      <p class="sub">${money(finalPrice(p))} للقطعة — الدفع عند الاستلام من القاعة</p>
      <div id="formError" class="error"></div>
      <div class="field"><label for="cName">الاسم</label><input id="cName" maxlength="80" autocomplete="name" placeholder="اسمك الكامل"></div>
      <div class="field"><label for="cPhone">رقم الهاتف</label><input id="cPhone" type="tel" dir="ltr" maxlength="15" autocomplete="tel" placeholder="07801234567" style="text-align:right"></div>
      <div class="field"><label>الكمية</label>
        <div class="qty"><button type="button" id="qMinus">−</button><span id="qVal">${qty}</span><button type="button" id="qPlus">+</button></div>
      </div>
      <div class="field"><label for="cNote">ملاحظة (اختياري)</label><textarea id="cNote" rows="2" maxlength="300"></textarea></div>
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
    btn.textContent = 'جارٍ الإرسال...';
    try {
      await rpc('store_reserve', {
        p_gym: GYM, p_product_id: current.id, p_qty: qty,
        p_name: name, p_phone: phone, p_note: $('cNote').value.trim()
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
    const msg = `السلام عليكم، أنا ${name}، حجزت (${current.name}) × ${qty} من متجر القاعة.`;
    $('sheet').innerHTML = `
      <div class="ok">
        <div class="tick">✅</div>
        <h3>تم استلام حجزك</h3>
        <p>شكراً ${esc(name)}، سيتواصل معك فريق القاعة قريباً، ويمكنك استلام طلبك من القاعة.</p>
        ${intl ? `<a class="btn" style="display:block;text-decoration:none;margin-bottom:8px" href="https://wa.me/${intl}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">تواصل عبر واتساب</a>` : ''}
        <button class="btn ghost" style="width:100%" id="okClose">إغلاق</button>
      </div>`;
    $('okClose').onclick = closeSheet;
  }

  async function load() {
    try {
      info = (await rpc('store_get_info', { p_gym: GYM })) || {};
    } catch { info = {}; }
    if (info.store_name) {
      $('storeTitle').textContent = info.store_name;
      document.title = info.store_name;
    }
    $('storeNote').textContent = info.note || '';

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
    render();
  }

  $('search').addEventListener('input', render);
  $('grid').addEventListener('click', e => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    const p = products.find(x => x.id === b.dataset.id);
    if (p && p.available) openSheet(p);
  });
  $('overlay').addEventListener('click', e => { if (e.target === $('overlay')) closeSheet(); });
  load();
})();
