'use strict';
// =========================================================
// Power Gym — Smart Calendar & Date Calculator (js/calendar.js)
// =========================================================

function openSmartCalendarModal() {
  const now = new Date();
  calendarViewYear = now.getFullYear();
  calendarViewMonth = now.getMonth();
  selectedCalendarDateStr = getTodayDateString();

  document.getElementById('calcStartDate').value = getTodayDateString();
  document.getElementById('calcDurationMonths').value = '1';
  document.getElementById('calcExtraDays').value = '0';

  renderSmartCalendar();
  runSmartDateCalculator();
  document.getElementById('smartCalendarModal').classList.remove('hidden');
}

function closeSmartCalendarModal() {
  document.getElementById('smartCalendarModal').classList.add('hidden');
}

function changeCalendarMonth(delta) {
  calendarViewMonth += delta;
  if (calendarViewMonth > 11) {
    calendarViewMonth = 0;
    calendarViewYear++;
  } else if (calendarViewMonth < 0) {
    calendarViewMonth = 11;
    calendarViewYear--;
  }
  renderSmartCalendar();
}

function resetCalendarToToday() {
  const now = new Date();
  calendarViewYear = now.getFullYear();
  calendarViewMonth = now.getMonth();
  selectedCalendarDateStr = getTodayDateString();
  renderSmartCalendar();
}

function renderSmartCalendar() {
  const titleEl = document.getElementById('calendarMonthTitle');
  if (titleEl) {
    titleEl.textContent = `${ARABIC_MONTHS[calendarViewMonth]} ${calendarViewYear}`;
  }

  const firstDayOfMonth = new Date(calendarViewYear, calendarViewMonth, 1).getDay();
  const daysInMonth = new Date(calendarViewYear, calendarViewMonth + 1, 0).getDate();
  const todayStr = getTodayDateString();
  const grid = document.getElementById('smartCalendarGrid');
  if (!grid) return;

  let html = '';
  for (let i = 0; i < firstDayOfMonth; i++) {
    html += `<div class="p-2 rounded-xl bg-slate-950/30 border border-slate-900/40 min-h-[64px]"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const mStr = String(calendarViewMonth + 1).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    const dateStr = `${calendarViewYear}-${mStr}-${dStr}`;

    const startedCount = players.filter(p => p.startDate === dateStr).length;
    const endedCount = players.filter(p => p.endDate === dateStr).length;
    const reminderCount = players.filter(p => {
      const r = getThreeReminderDates(p.endDate);
      return r.day3 === dateStr || r.day2 === dateStr || r.day1 === dateStr;
    }).length;

    const isToday = dateStr === todayStr;
    const isSelected = dateStr === selectedCalendarDateStr;

    html += `
      <div onclick="selectCalendarDate('${dateStr}')" class="p-2 rounded-xl cursor-pointer transition min-h-[68px] flex flex-col justify-between border ${
        isSelected
          ? 'bg-cyan-500/20 border-cyan-400 shadow-lg'
          : isToday
            ? 'bg-slate-900 border-cyan-500/60'
            : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-600'
      }">
        <div class="flex items-center justify-between">
          <span class="text-xs font-black ${isToday ? 'text-cyan-400' : 'text-slate-200'}">${day}</span>
          ${isToday ? `<span class="text-[9px] bg-cyan-400 text-slate-950 font-black px-1.5 rounded">اليوم</span>` : ''}
        </div>
        <div class="flex flex-wrap gap-1 mt-1">
          ${startedCount > 0 ? `<span class="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold" title="بدء اشتراك">${startedCount} بدء</span>` : ''}
          ${reminderCount > 0 ? `<span class="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-bold" title="إشعار تذكير">${reminderCount} تذكير</span>` : ''}
          ${endedCount > 0 ? `<span class="text-[9px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 font-bold" title="انتهاء اشتراك">${endedCount} ينتهي</span>` : ''}
        </div>
      </div>
    `;
  }

  grid.innerHTML = html;
  selectCalendarDate(selectedCalendarDateStr || todayStr);
}

function selectCalendarDate(dateStr) {
  selectedCalendarDateStr = dateStr;
  const box = document.getElementById('selectedCalendarDateDetails');
  if (!box) return;

  const dayName = getArabicDayName(dateStr);
  const started = players.filter(p => p.startDate === dateStr);
  const ending = players.filter(p => p.endDate === dateStr);
  const reminders = players.filter(p => {
    const r = getThreeReminderDates(p.endDate);
    return r.day3 === dateStr || r.day2 === dateStr || r.day1 === dateStr;
  });

  const itemsHtml = [];
  ending.forEach(p => {
    itemsHtml.push(`<div class="flex items-center justify-between bg-rose-950/30 border border-rose-500/30 px-3 py-1.5 rounded-xl">
      <span>🔴 <b>ينتهي اشتراك:</b> ${escapeHtml(p.name)} (${escapeHtml(p.phone)})</span>
      <button onclick="sendSubscriptionAlertById('${sanitizeId(p.id)}')" class="bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-300 px-2 py-0.5 rounded-lg text-[11px] font-bold">إبلاغ واتساب</button>
    </div>`);
  });

  reminders.forEach(p => {
    const r = getThreeReminderDates(p.endDate);
    const whichNum = r.day3 === dateStr ? '1/3 (قبل 3 أيام)' : r.day2 === dateStr ? '2/3 (قبل يومين)' : '3/3 (قبل يوم واحد)';
    itemsHtml.push(`<div class="flex items-center justify-between bg-cyan-950/30 border border-cyan-500/30 px-3 py-1.5 rounded-xl">
      <span>🔔 <b>موعد إشعار التذكير (${whichNum}):</b> ${escapeHtml(p.name)} — ينتهي ${escapeHtml(p.endDate)}</span>
      <button onclick="sendSubscriptionAlertById('${sanitizeId(p.id)}')" class="bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-300 px-2 py-0.5 rounded-lg text-[11px] font-bold">واتساب 🔔</button>
    </div>`);
  });

  started.forEach(p => {
    itemsHtml.push(`<div class="flex items-center justify-between bg-emerald-950/30 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
      <span>🟢 <b>بدأ اشتراك:</b> ${escapeHtml(p.name)} (${Number(p.durationMonths) === 0.5 ? 'نصف شهر' : Number(p.durationMonths) + ' شهر'} — ينتهي ${escapeHtml(p.endDate)})</span>
      <span class="text-emerald-400 font-bold">${Number(p.paidAmount).toLocaleString('en-US')} د.ع</span>
    </div>`);
  });

  let attCount = 0;
  try {
    const att = JSON.parse(localStorage.getItem('pg_attendance_v1') || '[]');
    const attIds = new Set(Array.isArray(att) ? att.filter(a => a.date === dateStr).map(a => String(a.playerId)) : []);
    players.forEach(p => { if (p.lastCheckIn === dateStr) attIds.add(String(p.id)); });
    attCount = attIds.size;
  } catch { /* ignore */ }
  if (attCount > 0) {
    itemsHtml.push(`<div class="flex items-center justify-between bg-zinc-900 border border-amber-500/25 px-3 py-1.5 rounded-xl">
      <span>🏋️ <b>الحضور المسجل بهذا اليوم:</b> ${attCount} لاعب</span>
      <button onclick="pgOpenAttendance?.()" class="text-amber-300 text-[11px] font-bold">فتح الحضور</button>
    </div>`);
  }

  box.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800">
      <span class="font-black text-cyan-400">📅 أحداث يوم ${escapeHtml(dayName)} (${escapeHtml(dateStr)})</span>
      <button onclick="openAddModalWithDate('${escapeHtml(dateStr)}')" class="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 px-2.5 py-1 rounded-lg text-[11px] font-bold">
        + تسجيل لاعب بتاريخ ${escapeHtml(dateStr)}
      </button>
    </div>
    ${itemsHtml.length > 0 ? `<div class="space-y-1.5 max-h-36 overflow-y-auto">${itemsHtml.join('')}</div>` : `<p class="text-slate-400 text-center py-2">لا توجد مواعيد انتهاء أو بداية مسجلة في هذا اليوم.</p>`}
  `;
}

function openAddModalWithDate(dateStr) {
  closeSmartCalendarModal();
  openAddModal();
  if (isValidDateString(dateStr)) {
    document.getElementById('startDate').value = dateStr;
    calculateEndDate();
  }
}

function runSmartDateCalculator() {
  const startStr = document.getElementById('calcStartDate')?.value || getTodayDateString();
  const months = parseFloat(document.getElementById('calcDurationMonths')?.value) || 1;
  const extraDays = parseInt(document.getElementById('calcExtraDays')?.value, 10) || 0;

  const baseEnd = addMonthsToDate(startStr, months);
  const finalEnd = extraDays > 0 ? addDaysToDate(baseEnd, extraDays) : baseEnd;
  const sub = getSubscriptionStatus(finalEnd);
  const reminders = getThreeReminderDates(finalEnd);
  const defaultPrice = gymProfile.defaultPrices?.[String(months)] || (months === 0.5 ? 15000 : months * 25000);
  const durLabel = months === 0.5 ? 'نصف شهر (15 يوم)' : `${months} شهر`;

  const box = document.getElementById('smartCalcResultsBox');
  if (!box) return;

  box.innerHTML = `
    <div class="flex justify-between items-center border-b border-slate-800 pb-1.5">
      <span class="text-slate-400">تاريخ البدء:</span>
      <span class="font-bold text-white">${escapeHtml(getArabicDayName(startStr))} ${escapeHtml(startStr)}</span>
    </div>
    <div class="flex justify-between items-center border-b border-slate-800 pb-1.5">
      <span class="text-slate-400">شوكت يخلص (الانتهاء):</span>
      <span class="font-black text-emerald-400">${escapeHtml(getArabicDayName(finalEnd))} ${escapeHtml(finalEnd)}</span>
    </div>
    <div class="flex justify-between items-center border-b border-slate-800 pb-1.5">
      <span class="text-slate-400">المدة الصافية:</span>
      <span class="font-bold text-amber-400">${durLabel} ${extraDays > 0 ? `+ ${extraDays} يوم` : ''} (${escapeHtml(sub.label)})</span>
    </div>
    <div class="flex justify-between items-center border-b border-slate-800 pb-1.5">
      <span class="text-slate-400">السعر المخصص:</span>
      <span class="font-black text-purple-400">${Number(defaultPrice).toLocaleString('en-US')} د.ع</span>
    </div>
    <div class="pt-1 space-y-1">
      <span class="block text-[11px] font-black text-cyan-400">🔔 مواعيد التذكير الـ 3 قبل الانتهاء:</span>
      <div class="text-[11px] text-slate-300 bg-slate-900 px-2.5 py-1 rounded-lg flex justify-between">
        <span>1️⃣ التذكير الأول (قبل 3 أيام):</span>
        <b class="text-cyan-300" dir="ltr">${escapeHtml(reminders.day3)}</b>
      </div>
      <div class="text-[11px] text-slate-300 bg-slate-900 px-2.5 py-1 rounded-lg flex justify-between">
        <span>2️⃣ التذكير الثاني (قبل يومين):</span>
        <b class="text-cyan-300" dir="ltr">${escapeHtml(reminders.day2)}</b>
      </div>
      <div class="text-[11px] text-slate-300 bg-slate-900 px-2.5 py-1 rounded-lg flex justify-between">
        <span>3️⃣ التذكير الثالث (قبل يوم):</span>
        <b class="text-cyan-300" dir="ltr">${escapeHtml(reminders.day1)}</b>
      </div>
    </div>
  `;
}

function applyCalculatedDatesToNewPlayer() {
  const startStr = document.getElementById('calcStartDate')?.value || getTodayDateString();
  const months = parseFloat(document.getElementById('calcDurationMonths')?.value) || 1;
  const extraDays = parseInt(document.getElementById('calcExtraDays')?.value, 10) || 0;
  const baseEnd = addMonthsToDate(startStr, months);
  const finalEnd = extraDays > 0 ? addDaysToDate(baseEnd, extraDays) : baseEnd;

  closeSmartCalendarModal();
  openAddModal();
  document.getElementById('startDate').value = startStr;
  document.getElementById('durationMonths').value = String(months);
  document.getElementById('endDate').value = finalEnd;
  applyDefaultPriceForDuration();
}
