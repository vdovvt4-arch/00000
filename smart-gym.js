/* =========================================================
   smart-gym.js — تطوير ذكي لقاعة الحديد والكارديو الرجالية
   1) مركز تذكيرات الواتساب الذكي (مع منع التكرار بين المشرفين)
   2) مؤشر الازدحام (قسم الحديد vs قسم الكارديو)
   3) حاسبات الحديد والكارديو (1RM + السعرات والبروتين)
   ========================================================= */
(function () {
  'use strict';

  const WA_SENT_KEY = 'pg_whatsapp_sent_v1';
  const CROWD_KEY = 'pg_crowd_status_v1';

  const $ = id => document.getElementById(id);
  const todayStr = () => new Date().toISOString().slice(0, 10);

  function safeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function readJson(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || 'null');
      return v === null || v === undefined ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch {
      return false;
    }
  }

  function toIntlPhone(phone) {
    let digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('07') && digits.length === 11) digits = '964' + digits.slice(1);
    else if (digits.startsWith('7') && digits.length === 10) digits = '964' + digits;
    return digits;
  }

  function diffDays(targetDateStr) {
    if (!targetDateStr) return 999;
    const t = new Date(todayStr() + 'T00:00:00');
    const e = new Date(String(targetDateStr).slice(0, 10) + 'T00:00:00');
    return Math.round((e - t) / 86400000);
  }

  function getPlayersList() {
    if (typeof players !== 'undefined' && Array.isArray(players)) return players;
    return readJson('power_gym_players_v1', []);
  }

  function getGymName() {
    if (typeof gymProfile !== 'undefined' && gymProfile && gymProfile.gymName) return gymProfile.gymName;
    const prof = readJson('power_gym_profile_v2', {});
    return prof.gymName || 'Power Gym';
  }

  function getSenderLabel() {
    if (window.pgCloudSync && typeof window.pgCloudSync.getRoleInfo === 'function') {
      return window.pgCloudSync.getRoleInfo().supervisorName || 'الكابتن';
    }
    return 'الكابتن';
  }

  // =========================================================
  // 1) مركز تذكيرات الواتساب الذكي (منع التكرار بين المشرفين)
  // =========================================================
  let currentWaTab = 'expired';

  window.openSmartWhatsAppCenter = function (tab) {
    if (tab) currentWaTab = tab;
    const old = $('pgSmartWaModal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'pgSmartWaModal';
    modal.className = 'fixed inset-0 z-[88] modal-backdrop flex items-center justify-center p-3 overflow-y-auto';
    modal.innerHTML = `
      <section class="card-bg w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl p-5 space-y-4">
        <header class="flex items-center justify-between border-b border-slate-700 pb-3">
          <div>
            <h2 class="text-lg font-black text-white flex items-center gap-2">
              <i class="fa-brands fa-whatsapp text-emerald-400"></i> مركز إشعارات الواتساب الذكي
            </h2>
            <p class="text-[11px] text-slate-400">إرسال فوري بضغطة زر مع مزامنة حالة الإشعار بين الكابتن والمشرفين</p>
          </div>
          <button onclick="document.getElementById('pgSmartWaModal').remove()" class="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200">إغلاق ✕</button>
        </header>

        <div class="flex flex-wrap gap-2">
          <button onclick="pgSwitchWaTab('expired')" id="pgWaTabExpired" class="rounded-xl px-3.5 py-2 text-xs font-bold"></button>
          <button onclick="pgSwitchWaTab('soon')" id="pgWaTabSoon" class="rounded-xl px-3.5 py-2 text-xs font-bold"></button>
          <button onclick="pgSwitchWaTab('debt')" id="pgWaTabDebt" class="rounded-xl px-3.5 py-2 text-xs font-bold"></button>
        </div>

        <div id="pgWaQueueList" class="space-y-2.5"></div>
      </section>
    `;
    document.body.appendChild(modal);
    renderWaQueue();
  };

  window.pgSwitchWaTab = function (tab) {
    currentWaTab = tab;
    renderWaQueue();
  };

  function renderWaQueue() {
    const list = getPlayersList();
    const sentLog = readJson(WA_SENT_KEY, {});
    const expired = list.filter(p => p.endDate && diffDays(p.endDate) < 0);
    const soon = list.filter(p => p.endDate && diffDays(p.endDate) >= 0 && diffDays(p.endDate) <= 3);
    const debt = list.filter(p => Number(p.debtAmount) > 0);

    const tabBtn = (id, label, count, active) => {
      const el = $(id);
      if (!el) return;
      el.textContent = `${label} (${count})`;
      el.className = active
        ? 'rounded-xl px-3.5 py-2 text-xs font-black gold-gradient text-black'
        : 'rounded-xl px-3.5 py-2 text-xs font-bold bg-slate-800 text-slate-300 hover:bg-slate-700';
    };

    tabBtn('pgWaTabExpired', 'منتهي الاشتراك', expired.length, currentWaTab === 'expired');
    tabBtn('pgWaTabSoon', 'ينتهي خلال 3 أيام', soon.length, currentWaTab === 'soon');
    tabBtn('pgWaTabDebt', 'ديون مستحقة', debt.length, currentWaTab === 'debt');

    const activeItems = currentWaTab === 'expired' ? expired : (currentWaTab === 'soon' ? soon : debt);
    const box = $('pgWaQueueList');
    if (!box) return;

    if (!activeItems.length) {
      box.innerHTML = '<div class="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center text-sm text-slate-400">لا يوجد لاعبون في هذه القائمة حالياً ✓</div>';
      return;
    }

    const today = todayStr();
    box.innerHTML = activeItems.map(p => {
      const pid = String(p.id);
      const sentKey = `${currentWaTab}_${pid}`;
      const sentInfo = sentLog[sentKey];
      const sentToday = sentInfo && sentInfo.date === today;
      const d = diffDays(p.endDate);
      const statusText = currentWaTab === 'debt'
        ? `المبلغ المتبقي: ${(Number(p.debtAmount) || 0).toLocaleString('en-US')} د.ع`
        : (d < 0 ? `منتهي منذ ${Math.abs(d)} يوم (${safeHtml(p.endDate)})` : (d === 0 ? 'ينتهي اليوم!' : `باقي ${d} يوم (${safeHtml(p.endDate)})`));

      return `
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border ${sentToday ? 'border-emerald-500/30 bg-emerald-950/15' : 'border-slate-800 bg-slate-900/80'} p-3.5">
          <div class="min-w-0">
            <p class="font-black text-white text-sm">${safeHtml(p.name)} <span class="text-[11px] font-normal text-slate-400" dir="ltr">(${safeHtml(p.code || '')})</span></p>
            <p class="text-xs text-sky-300 mt-0.5">${statusText}</p>
            ${sentInfo ? `<p class="text-[10px] text-emerald-400 mt-1">✓ آخر إشعار: ${safeHtml(sentInfo.date)} بواسطة ${safeHtml(sentInfo.by)}</p>` : ''}
          </div>
          <div class="flex items-center gap-2">
            <button onclick="pgSendSmartWa('${safeHtml(pid)}')" class="rounded-xl ${sentToday ? 'bg-slate-700 text-slate-200' : 'bg-emerald-600 hover:bg-emerald-500 text-white'} px-3.5 py-2 text-xs font-bold flex items-center gap-1.5">
              <i class="fa-brands fa-whatsapp"></i>
              <span>${sentToday ? 'إعادة إرسال' : 'إرسال واتساب'}</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  window.pgSendSmartWa = function (playerId) {
    const p = getPlayersList().find(x => String(x.id) === String(playerId));
    if (!p) return;
    const intl = toIntlPhone(p.phone);
    if (!intl) {
      showToast?.(`رقم هاتف ${p.name} غير صالح للواتساب`, 'error');
      return;
    }

    const gym = getGymName();
    let msg = '';
    if (currentWaTab === 'debt') {
      msg = `السلام عليكم كابتن ${p.name}، نود تذكيرك بوجود مبلغ متبقي قدره ${(Number(p.debtAmount) || 0).toLocaleString('en-US')} د.ع في ${gym}. نتمنى لك تمريناً موفقاً 💪`;
    } else if (diffDays(p.endDate) < 0) {
      msg = `السلام عليكم كابتن ${p.name}، اشتراكك في ${gym} قد انتهى بتاريخ ${p.endDate}. بانتظارك لتجديد الاشتراك ومواصلة التمرين 💪🔥`;
    } else {
      msg = `السلام عليكم كابتن ${p.name}، نذكرك بأن اشتراكك في ${gym} ينتهي بتاريخ ${p.endDate}. يسعدنا تجديدك للاستمرار معنا 💪`;
    }

    const url = `https://wa.me/${intl}?text=${encodeURIComponent(msg)}`;
    if (typeof openWhatsAppLink === 'function') openWhatsAppLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');

    const sentLog = readJson(WA_SENT_KEY, {});
    sentLog[`${currentWaTab}_${p.id}`] = { date: todayStr(), by: getSenderLabel() };
    writeJson(WA_SENT_KEY, sentLog);
    if (typeof logActivity === 'function') logActivity(`إرسال تذكير واتساب (${currentWaTab}) إلى ${p.name}`);
    renderWaQueue();
  };

  // =========================================================
  // 2) مؤشر الازدحام (قسم الحديد / قسم الكارديو) + حاسبات الحديد
  // =========================================================
  window.openSmartGymToolsModal = function () {
    const crowd = readJson(CROWD_KEY, { iron: 'medium', cardio: 'low', updatedAt: '' });
    const old = $('pgSmartToolsModal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'pgSmartToolsModal';
    modal.className = 'fixed inset-0 z-[88] modal-backdrop flex items-center justify-center p-3 overflow-y-auto';
    modal.innerHTML = `
      <section class="card-bg w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl p-5 space-y-5">
        <header class="flex items-center justify-between border-b border-slate-700 pb-3">
          <div>
            <h2 class="text-lg font-black text-white flex items-center gap-2">
              <i class="fa-solid fa-dumbbell text-sky-400"></i> أدوات قاعة الحديد والكارديو
            </h2>
            <p class="text-[11px] text-slate-400">حالة الازدحام في القاعة + حاسبات 1RM والسعرات للاعبين</p>
          </div>
          <button onclick="document.getElementById('pgSmartToolsModal').remove()" class="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200">إغلاق ✕</button>
        </header>

        <!-- مؤشر الازدحام -->
        <div class="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-4 space-y-3">
          <h3 class="text-sm font-black text-sky-300">حالة الازدحام الحالية (تُشارك بين الكابتن والمشرفين)</h3>
          <div class="grid md:grid-cols-2 gap-3">
            <div class="rounded-xl bg-slate-950/80 border border-slate-800 p-3">
              <p class="text-xs font-bold text-slate-200 mb-2"><i class="fa-solid fa-dumbbell text-sky-400 ml-1"></i> قسم الحديد</p>
              <div class="grid grid-cols-3 gap-1.5">
                ${['low:هادئ', 'medium:متوسط', 'high:مزدحم'].map(opt => {
                  const [k, label] = opt.split(':');
                  const active = crowd.iron === k;
                  return `<button onclick="pgSetCrowd('iron','${k}')" class="rounded-lg py-1.5 text-xs font-bold ${active ? 'gold-gradient text-black' : 'bg-slate-800 text-slate-300'}">${label}</button>`;
                }).join('')}
              </div>
            </div>
            <div class="rounded-xl bg-slate-950/80 border border-slate-800 p-3">
              <p class="text-xs font-bold text-slate-200 mb-2"><i class="fa-solid fa-heart-pulse text-rose-400 ml-1"></i> قسم الكارديو</p>
              <div class="grid grid-cols-3 gap-1.5">
                ${['low:هادئ', 'medium:متوسط', 'high:مزدحم'].map(opt => {
                  const [k, label] = opt.split(':');
                  const active = crowd.cardio === k;
                  return `<button onclick="pgSetCrowd('cardio','${k}')" class="rounded-lg py-1.5 text-xs font-bold ${active ? 'gold-gradient text-black' : 'bg-slate-800 text-slate-300'}">${label}</button>`;
                }).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- حاسبة 1RM -->
        <div class="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-4 space-y-3">
          <h3 class="text-sm font-black text-sky-300">حاسبة أقصى وزن لعدة واحدة (1RM) للاعبي الحديد</h3>
          <div class="grid grid-cols-3 gap-2">
            <input id="pgRmWeight" type="number" min="1" placeholder="الوزن (كغم)" class="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
            <input id="pgRmReps" type="number" min="1" max="20" placeholder="التكرارات (1-15)" class="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
            <button onclick="pgCalc1RM()" class="rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold">احسب 1RM</button>
          </div>
          <div id="pgRmResult" class="text-xs text-slate-300"></div>
        </div>

        <!-- حاسبة السعرات والبروتين للرجال -->
        <div class="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-4 space-y-3">
          <h3 class="text-sm font-black text-emerald-300">حاسبة السعرات والبروتين اليومي (للرجال)</h3>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
            <input id="pgCalWeight" type="number" placeholder="الوزن (كغم)" class="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
            <input id="pgCalHeight" type="number" placeholder="الطول (سم)" class="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
            <input id="pgCalAge" type="number" placeholder="العمر" class="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
            <select id="pgCalGoal" class="rounded-xl border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white">
              <option value="bulk">تضخيم عضلي</option>
              <option value="cut">تنشيف وحرق دهون</option>
              <option value="maintain">ثبات ولياقة</option>
            </select>
            <button onclick="pgCalcCalories()" class="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">احسب</button>
          </div>
          <div id="pgCalResult" class="text-xs text-slate-300"></div>
        </div>
      </section>
    `;
    document.body.appendChild(modal);
  };

  window.pgSetCrowd = function (zone, level) {
    const crowd = readJson(CROWD_KEY, { iron: 'medium', cardio: 'low', updatedAt: '' });
    crowd[zone] = level;
    crowd.updatedAt = new Date().toISOString();
    writeJson(CROWD_KEY, crowd);
    showToast?.('تم تحديث حالة الازدحام ✓', 'success');
    window.openSmartGymToolsModal();
  };

  window.pgCalc1RM = function () {
    const w = Number($('pgRmWeight')?.value || 0);
    const r = Number($('pgRmReps')?.value || 0);
    if (w <= 0 || r <= 0) return;
    const oneRm = r === 1 ? w : Math.round(w * (1 + r / 30));
    $('pgRmResult').innerHTML = `
      <div class="rounded-xl bg-slate-950 p-3 border border-sky-500/30 flex flex-wrap gap-4">
        <span>أقصى وزن (1RM): <strong class="text-sky-400">${oneRm} كغم</strong></span>
        <span>قوة (90%): <strong>${Math.round(oneRm * 0.9)} كغم</strong></span>
        <span>تضخيم (80%): <strong>${Math.round(oneRm * 0.8)} كغم</strong></span>
        <span>تحمل (70%): <strong>${Math.round(oneRm * 0.7)} كغم</strong></span>
      </div>`;
  };

  window.pgCalcCalories = function () {
    const w = Number($('pgCalWeight')?.value || 0);
    const h = Number($('pgCalHeight')?.value || 0);
    const age = Number($('pgCalAge')?.value || 0);
    const goal = $('pgCalGoal')?.value || 'bulk';
    if (w <= 0 || h <= 0 || age <= 0) return;
    const bmr = 10 * w + 6.25 * h - 5 * age + 5;
    const tdee = Math.round(bmr * 1.55); // نشاط متوسط - تمرين 4-5 أيام
    const target = goal === 'bulk' ? tdee + 350 : (goal === 'cut' ? Math.max(1500, tdee - 450) : tdee);
    const protein = Math.round(w * 2);
    $('pgCalResult').innerHTML = `
      <div class="rounded-xl bg-slate-950 p-3 border border-emerald-500/30 flex flex-wrap gap-4">
        <span>السعرات المستهدفة: <strong class="text-emerald-400">${target} سعرة/يوم</strong></span>
        <span>البروتين المقترح: <strong class="text-sky-400">${protein} غرام/يوم</strong></span>
        <span>سعرات الثبات: <strong>${tdee} سعرة</strong></span>
      </div>`;
  };

  function injectSmartSidebarLinks() {
    const nav = document.querySelector('#desktopSidebar nav');
    if (!nav || $('pgSmartToolsNav')) return;
    const sec = document.createElement('section');
    sec.id = 'pgSmartToolsNav';
    sec.className = 'space-y-1';
    sec.innerHTML = `
      <p class="px-3 pb-1 text-[10px] font-black text-slate-500">تطوير القاعة الذكي</p>
      <button class="sidebar-link" onclick="openSmartWhatsAppCenter('expired'); closeMobileMenu?.()">
        <i class="fa-brands fa-whatsapp text-emerald-400"></i><span>مركز تذكيرات الواتساب</span>
      </button>
      <button class="sidebar-link" onclick="openSmartGymToolsModal(); closeMobileMenu?.()">
        <i class="fa-solid fa-dumbbell text-sky-400"></i><span>الازدحام وحاسبات الحديد</span>
      </button>
    `;
    nav.appendChild(sec);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSmartSidebarLinks);
  } else {
    injectSmartSidebarLinks();
  }
})();
