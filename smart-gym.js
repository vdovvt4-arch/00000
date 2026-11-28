/* =========================================================
   smart-gym.js v4.0 — أدوات اللياقة وحاسبات الحديد والدايت ومؤشر الازدحام
   (مفصول نظيفاً عن smart-ops.js بدون أي تعارض في دوال الواتساب)
   ========================================================= */
(function () {
  'use strict';

  const CROWD_KEY = 'pg_crowd_status_v1';
  const $ = id => document.getElementById(id);

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

  window.openSmartGymToolsModal = function () {
    const crowd = readJson(CROWD_KEY, { iron: 'medium', cardio: 'low', updatedAt: '' });
    const old = $('pgSmartToolsModal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'pgSmartToolsModal';
    modal.className = 'fixed inset-0 z-[88] modal-backdrop flex items-center justify-center p-3 overflow-y-auto';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `
      <section class="card-bg w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl p-5 space-y-5 border border-amber-500/25">
        <header class="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h2 class="text-lg font-black text-white flex items-center gap-2">
              <i class="fa-solid fa-dumbbell text-amber-400"></i> أدوات القاعة وحاسبات الحديد والدايت
            </h2>
            <p class="text-[11px] text-zinc-400">حالة الازدحام المباشرة + حاسبة أقصى وزن (1RM) والسعرات والبروتين</p>
          </div>
          <button onclick="document.getElementById('pgSmartToolsModal').remove()" class="rounded-xl bg-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-200">إغلاق ✕</button>
        </header>

        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3">
          <h3 class="text-sm font-black text-amber-300">حالة الازدحام الحالية (تُزامن في قاعدة البيانات)</h3>
          <div class="grid md:grid-cols-2 gap-3">
            <div class="rounded-xl bg-zinc-950/80 border border-zinc-800 p-3">
              <p class="text-xs font-bold text-zinc-200 mb-2"><i class="fa-solid fa-dumbbell text-amber-400 ml-1"></i> قسم الحديد</p>
              <div class="grid grid-cols-3 gap-1.5">
                ${['low:هادئ', 'medium:متوسط', 'high:مزدحم'].map(opt => {
                  const [k, label] = opt.split(':');
                  const active = crowd.iron === k;
                  return `<button onclick="pgSetCrowd('iron','${k}')" class="rounded-lg py-1.5 text-xs font-bold ${active ? 'gold-gradient text-black' : 'bg-zinc-800 text-zinc-300'}">${label}</button>`;
                }).join('')}
              </div>
            </div>
            <div class="rounded-xl bg-zinc-950/80 border border-zinc-800 p-3">
              <p class="text-xs font-bold text-zinc-200 mb-2"><i class="fa-solid fa-heart-pulse text-rose-400 ml-1"></i> قسم الكارديو</p>
              <div class="grid grid-cols-3 gap-1.5">
                ${['low:هادئ', 'medium:متوسط', 'high:مزدحم'].map(opt => {
                  const [k, label] = opt.split(':');
                  const active = crowd.cardio === k;
                  return `<button onclick="pgSetCrowd('cardio','${k}')" class="rounded-lg py-1.5 text-xs font-bold ${active ? 'gold-gradient text-black' : 'bg-zinc-800 text-zinc-300'}">${label}</button>`;
                }).join('')}
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3">
          <h3 class="text-sm font-black text-sky-300">حاسبة أقصى وزن لعدة واحدة (1RM)</h3>
          <div class="grid grid-cols-3 gap-2">
            <input id="pgRmWeight" type="number" min="1" placeholder="الوزن (كغم)" class="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white" />
            <input id="pgRmReps" type="number" min="1" max="20" placeholder="التكرارات (1-15)" class="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white" />
            <button onclick="pgCalc1RM()" class="rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold">احسب 1RM</button>
          </div>
          <div id="pgRmResult" class="text-xs text-zinc-300"></div>
        </div>

        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3">
          <h3 class="text-sm font-black text-emerald-300">حاسبة السعرات والبروتين اليومي</h3>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
            <input id="pgCalWeight" type="number" placeholder="الوزن (كغم)" class="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white" />
            <input id="pgCalHeight" type="number" placeholder="الطول (سم)" class="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white" />
            <input id="pgCalAge" type="number" placeholder="العمر" class="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white" />
            <select id="pgCalGoal" class="rounded-xl border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-white">
              <option value="bulk">تضخيم عضلي</option>
              <option value="cut">تنشيف وحرق دهون</option>
              <option value="maintain">ثبات ولياقة</option>
            </select>
            <button onclick="pgCalcCalories()" class="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">احسب</button>
          </div>
          <div id="pgCalResult" class="text-xs text-zinc-300"></div>
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
    if (typeof updateDashboardStats === 'function') updateDashboardStats();
    showToast?.('تم تحديث حالة الازدحام ✓', 'success');
    window.openSmartGymToolsModal();
  };

  window.pgCalc1RM = function () {
    const w = Number($('pgRmWeight')?.value || 0);
    const r = Number($('pgRmReps')?.value || 0);
    if (w <= 0 || r <= 0) return;
    const oneRm = r === 1 ? w : Math.round(w * (1 + r / 30));
    $('pgRmResult').innerHTML = `
      <div class="rounded-xl bg-zinc-950 p-3 border border-sky-500/30 flex flex-wrap gap-4">
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
    const tdee = Math.round(bmr * 1.55);
    const target = goal === 'bulk' ? tdee + 350 : (goal === 'cut' ? Math.max(1500, tdee - 450) : tdee);
    const protein = Math.round(w * 2);
    $('pgCalResult').innerHTML = `
      <div class="rounded-xl bg-zinc-950 p-3 border border-emerald-500/30 flex flex-wrap gap-4">
        <span>السعرات المستهدفة: <strong class="text-emerald-400">${target} سعرة/يوم</strong></span>
        <span>البروتين المقترح: <strong class="text-sky-400">${protein} غرام/يوم</strong></span>
        <span>سعرات الثبات: <strong>${tdee} سعرة</strong></span>
      </div>`;
  };
})();
