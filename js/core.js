'use strict';
// =========================================================
// Power Gym — Core State, Security, Dates & Storage (js/core.js)
// =========================================================

const SCHEMA_VERSION = '3.0.0';
const BOT_USERNAME = 'Powargym_bot';
const COACH_MODE = new URLSearchParams(window.location.search).get('pgCoach') === '1';
const COACH_PENDING_STORAGE_KEY = 'power_gym_coach_pending_v1';
const COACH_GYM_STORAGE_KEY = 'power_gym_coach_gym_id_v1';
window.pgCoachRegistrationMode = COACH_MODE;

const STORAGE_KEYS = Object.freeze({
  PLAYERS: 'power_gym_players_v1',
  SETTINGS: 'power_gym_settings_v1',
  PIN_HASH: 'power_gym_pin_sha256_v1',
  AUDIT_LOG: 'power_gym_audit_v1',
  TELEGRAM_TOKEN_ROTATION: 'power_gym_telegram_token_rotation_v1',
  FINANCE_LEDGER: 'power_gym_finance_ledger_v2',
  GYM_PROFILE: 'power_gym_profile_v2',
  TELEGRAM_DIRECTORY: 'power_gym_tg_directory_v2'
});

const DEFAULT_AVATAR = 'https://cdn-icons-png.flaticon.com/512/847/847969.png';

// Centralized Application State
var players = [];
var auditLogs = [];
var financeLedger = {
  manualProfitAdjustment: 0,
  manualDebtAdjustment: 0,
  transactions: [],
  debtEntries: [],
  debtPayments: [],
  renewals: [],
  receipts: [],
  receiptCounter: 0,
  receiptSettings: {}
};
var gymProfile = {
  gymName: 'Power Gym | بور جم',
  gymBranch: 'كربلاء - الحر - قرب فلكة الثورة',
  supervisorName: '',
  receiptStamp: '',
  defaultPrices: {
    '0.5': 15000,
    '1': 25000,
    '2': 45000,
    '3': 65000,
    '6': 120000,
    '12': 220000
  }
};
var telegramDirectory = {
  phoneToChatId: {},
  lastUpdateOffset: 0
};

var currentFilter = 'all';
var currentViewMode = 'cards';
var compressedPhotoDataUrl = '';
var courseImagesDraft = [];
var calendarViewYear = new Date().getFullYear();
var calendarViewMonth = new Date().getMonth();
var selectedCalendarDateStr = '';

const ARABIC_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const ARABIC_MONTHS = [
  'كانون الثاني (يناير)', 'شباط (فبراير)', 'آذار (مارس)', 'نيسان (أبريل)',
  'أيار (مايو)', 'حزيران (يونيو)', 'تموز (يوليو)', 'آب (أغسطس)',
  'أيلول (سبتمبر)', 'تشرين الأول (أكتوبر)', 'تشرين الثاني (نوفمبر)', 'كانون الأول (ديسمبر)'
];

// =========================================================
// 1. Security & Sanitization
// =========================================================
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeTelegramHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeId(id) {
  return String(id ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function sanitizePhotoSource(photo) {
  if (!photo || typeof photo !== 'string') return DEFAULT_AVATAR;
  if (
    photo.startsWith('data:image/jpeg;base64,') ||
    photo.startsWith('data:image/png;base64,') ||
    photo.startsWith('data:image/webp;base64,')
  ) {
    return photo;
  }
  return DEFAULT_AVATAR;
}

function sanitizeCourseImage(image) {
  return typeof image === 'string' &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)
    ? image
    : '';
}

function isValidDateString(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
}

function formatIraqiPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('00964')) {
    digits = '964' + digits.slice(5);
  } else if (digits.startsWith('07')) {
    digits = '964' + digits.slice(1);
  } else if (digits.startsWith('7') && digits.length === 10) {
    digits = '964' + digits;
  }
  return digits;
}

function sanitizePlayerRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const today = getTodayDateString();
  const startDate = isValidDateString(raw.startDate) ? raw.startDate : today;
  const durationMonths = [0.5, 1, 2, 3, 6, 12].includes(Number(raw.durationMonths)) ? Number(raw.durationMonths) : 1;
  const endDate = isValidDateString(raw.endDate) ? raw.endDate : addMonthsToDate(startDate, durationMonths);
  const rawPhone = String(raw.phone || '').replace(/[^\d+]/g, '').slice(0, 15);
  const intlPhone = formatIraqiPhone(rawPhone);

  const matchedTgId =
    String(raw.playerChatId || raw.telegram?.playerChatId || telegramDirectory?.phoneToChatId?.[intlPhone]?.chatId || '')
      .replace(/[^0-9-]/g, '');

  const remindersArr = Array.isArray(raw.threeDayRemindersSent)
    ? raw.threeDayRemindersSent.map(x => String(x))
    : Array.isArray(raw.telegram?.threeDayRemindersSent)
      ? raw.telegram.threeDayRemindersSent.map(x => String(x))
      : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    id: sanitizeId(raw.id) || ('plr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)),
    code: String(raw.code || '').trim().slice(0, 15),
    name: String(raw.name || 'لاعب بدون اسم').trim().slice(0, 80),
    age: Math.min(80, Math.max(10, parseInt(raw.age, 10) || 20)),
    phone: rawPhone,
    intlPhone,
    planType: String(raw.planType || 'حديد عام (كمال أجسام)').slice(0, 50),
    startDate,
    durationMonths,
    endDate,
    paidAmount: Math.max(0, Number(raw.paidAmount) || 0),
    debtAmount: Math.max(0, Number(raw.debtAmount) || 0),
    notes: String(raw.notes || '').trim().slice(0, 160),
    courseNotes: String(raw.courseNotes || '').trim().slice(0, 2000),
    courseImages: Array.isArray(raw.courseImages)
      ? raw.courseImages.map(sanitizeCourseImage).filter(Boolean).slice(0, 5)
      : [],
    attendanceCount: Math.max(0, parseInt(raw.attendanceCount, 10) || 0),
    lastCheckIn: isValidDateString(raw.lastCheckIn) ? raw.lastCheckIn : '',
    photo: sanitizePhotoSource(raw.photo) === DEFAULT_AVATAR ? '' : raw.photo,
    telegramFileId: String(raw.telegramFileId || '').replace(/[^a-zA-Z0-9_-]/g, ''),
    playerChatId: matchedTgId,
    activationSent: Boolean(raw.activationSent || raw.telegram?.activationSent),
    threeDayRemindersSent: remindersArr,
    lastReminderDate: isValidDateString(raw.lastReminderDate) ? raw.lastReminderDate : '',
    coachSubmissionId: String(raw.coachSubmissionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100),
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString())
  };
}

function generateNextPlayerCode(existingCodes = players.map(player => player.code)) {
  const usedCodes = new Set(existingCodes.map(code => String(code || '').toUpperCase()));
  let highestSerial = 0;
  usedCodes.forEach(code => {
    const match = code.match(/^PG-(\d+)$/);
    if (match) highestSerial = Math.max(highestSerial, Number(match[1]));
  });
  let nextSerial = highestSerial + 1;
  let nextCode = `PG-${String(nextSerial).padStart(4, '0')}`;
  while (usedCodes.has(nextCode)) {
    nextSerial++;
    nextCode = `PG-${String(nextSerial).padStart(4, '0')}`;
  }
  return nextCode;
}

function ensureUniquePlayerCodes(playerList) {
  let changed = false;
  const usedCodes = new Set();
  playerList.forEach(player => {
    const normalizedCode = String(player.code || '').trim().toUpperCase();
    if (!normalizedCode || usedCodes.has(normalizedCode)) {
      player.code = generateNextPlayerCode([...usedCodes]);
      changed = true;
    }
    usedCodes.add(player.code.toUpperCase());
  });
  return changed;
}

async function sha256Hash(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text + '_power_gym_salt_karbala');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function logActivity(actionText) {
  const entry = {
    time: new Date().toLocaleString('ar-IQ'),
    action: String(actionText).slice(0, 180)
  };
  auditLogs.unshift(entry);
  if (auditLogs.length > 150) auditLogs = auditLogs.slice(0, 150);
  try {
    localStorage.setItem(STORAGE_KEYS.AUDIT_LOG, JSON.stringify(auditLogs));
  } catch (e) {
    console.warn('Could not save audit log:', e);
  }
}

// =========================================================
// 2. Date & Subscription Status Engine (Unified Baghdad Time UTC+3)
// =========================================================
function getTodayDateString() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Baghdad',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch { /* fallback below */ }
  const baghdad = new Date(Date.now() + 3 * 3600 * 1000);
  return baghdad.toISOString().slice(0, 10);
}
window.getBaghdadDateString = getTodayDateString;

function addMonthsToDate(dateStr, monthsToAdd) {
  const mVal = Number(monthsToAdd);
  if (mVal > 0 && mVal < 1) {
    return addDaysToDate(dateStr, Math.round(mVal * 30));
  }
  const parts = dateStr.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  date.setMonth(date.getMonth() + mVal);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysToDate(dateStr, daysToAdd) {
  const parts = dateStr.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  date.setDate(date.getDate() + Number(daysToAdd));
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getArabicDayName(dateStr) {
  if (!isValidDateString(dateStr)) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return ARABIC_DAYS[dt.getDay()] || '';
}

function getThreeReminderDates(endDateStr) {
  if (!isValidDateString(endDateStr)) return { day3: '', day2: '', day1: '' };
  return {
    day3: addDaysToDate(endDateStr, -3),
    day2: addDaysToDate(endDateStr, -2),
    day1: addDaysToDate(endDateStr, -1)
  };
}

function calculateEndDate() {
  const startInput = document.getElementById('startDate')?.value;
  const duration = parseFloat(document.getElementById('durationMonths')?.value) || 1;
  if (!startInput) return;
  const endEl = document.getElementById('endDate');
  if (endEl) endEl.value = addMonthsToDate(startInput, duration);
}

function applyDefaultPriceForDuration() {
  const editingId = document.getElementById('editingPlayerId')?.value;
  if (editingId) return;
  const duration = String(document.getElementById('durationMonths')?.value || '1');
  const defaultPrice = gymProfile.defaultPrices?.[duration] || (Number(duration) === 0.5 ? 15000 : Number(duration) * 25000);
  const paidEl = document.getElementById('paidAmount');
  if (paidEl) paidEl.value = defaultPrice;
}

function getSubscriptionStatus(endDateStr) {
  const todayStr = getTodayDateString();
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const [ey, em, ed] = (endDateStr || todayStr).split('-').map(Number);

  const todayDate = new Date(ty, tm - 1, td);
  const endDate = new Date(ey, em - 1, ed);
  const diffTime = endDate.getTime() - todayDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      status: 'expired',
      diffDays,
      label: `منتهي منذ ${Math.abs(diffDays)} يوم`,
      badgeClass: 'pg-badge pg-badge--expired',
      borderClass: 'border-rose-500/40'
    };
  } else if (diffDays <= 3) {
    return {
      status: 'soon',
      diffDays,
      label: diffDays === 0 ? 'ينتهي اليوم!' : (diffDays === 1 ? 'ينتهي غداً (باقي يوم)' : `ينتهي خلال ${diffDays} أيام`),
      badgeClass: 'pg-badge pg-badge--soon',
      borderClass: 'border-amber-400/40'
    };
  } else {
    return {
      status: 'active',
      diffDays,
      label: `فعّال (${diffDays} يوم)`,
      badgeClass: 'pg-badge pg-badge--active',
      borderClass: 'border-emerald-500/30'
    };
  }
}

// =========================================================
// 3. Storage Load/Save & Branding
// =========================================================
function loadDataFromStorage() {
  try {
    const storedDir = localStorage.getItem(STORAGE_KEYS.TELEGRAM_DIRECTORY);
    if (storedDir) {
      const parsedDir = JSON.parse(storedDir);
      telegramDirectory = {
        phoneToChatId: parsedDir.phoneToChatId && typeof parsedDir.phoneToChatId === 'object' ? parsedDir.phoneToChatId : {},
        lastUpdateOffset: Number(parsedDir.lastUpdateOffset) || 0
      };
    }
  } catch {
    telegramDirectory = { phoneToChatId: {}, lastUpdateOffset: 0 };
  }

  try {
    const storedProfile = localStorage.getItem(STORAGE_KEYS.GYM_PROFILE);
    if (storedProfile) {
      const parsedProf = JSON.parse(storedProfile);
      gymProfile = {
        gymName: String(parsedProf.gymName || 'Power Gym | بور جم').slice(0, 60),
        gymBranch: String(parsedProf.gymBranch || 'كربلاء - الحر - قرب فلكة الثورة').slice(0, 80),
        supervisorName: String(parsedProf.supervisorName || '').trim().slice(0, 60),
        receiptStamp: String(parsedProf.receiptStamp || '').trim().slice(0, 100),
        defaultPrices: {
          '0.5': Number(parsedProf.defaultPrices?.['0.5']) || 15000,
          '1': Number(parsedProf.defaultPrices?.['1']) || 25000,
          '2': Number(parsedProf.defaultPrices?.['2']) || 45000,
          '3': Number(parsedProf.defaultPrices?.['3']) || 65000,
          '6': Number(parsedProf.defaultPrices?.['6']) || 120000,
          '12': Number(parsedProf.defaultPrices?.['12']) || 220000
        }
      };
    }
  } catch (e) {
    console.warn('Profile load error:', e);
  }

  try {
    const storedFin = localStorage.getItem(STORAGE_KEYS.FINANCE_LEDGER);
    if (storedFin) {
      const parsedFin = JSON.parse(storedFin);
      financeLedger = {
        manualProfitAdjustment: Number(parsedFin.manualProfitAdjustment) || 0,
        manualDebtAdjustment: Number(parsedFin.manualDebtAdjustment) || 0,
        transactions: Array.isArray(parsedFin.transactions) ? parsedFin.transactions : [],
        debtEntries: Array.isArray(parsedFin.debtEntries) ? parsedFin.debtEntries : [],
        debtPayments: Array.isArray(parsedFin.debtPayments) ? parsedFin.debtPayments : [],
        renewals: Array.isArray(parsedFin.renewals) ? parsedFin.renewals : [],
        receipts: Array.isArray(parsedFin.receipts) ? parsedFin.receipts : [],
        receiptCounter: Math.max(0, parseInt(parsedFin.receiptCounter, 10) || 0),
        receiptSettings: (parsedFin.receiptSettings && typeof parsedFin.receiptSettings === 'object') ? parsedFin.receiptSettings : {}
      };
    }
  } catch (finErr) {
    console.error('Finance ledger load error:', finErr);
    financeLedger = { manualProfitAdjustment: 0, manualDebtAdjustment: 0, transactions: [], debtEntries: [], debtPayments: [], renewals: [], receipts: [], receiptCounter: 0, receiptSettings: {} };
  }

  try {
    const storedPlayers = localStorage.getItem(STORAGE_KEYS.PLAYERS);
    if (storedPlayers) {
      const parsed = JSON.parse(storedPlayers);
      players = Array.isArray(parsed) ? parsed.map(sanitizePlayerRecord).filter(Boolean) : [];
      if (ensureUniquePlayerCodes(players)) {
        try {
          localStorage.setItem(STORAGE_KEYS.PLAYERS, JSON.stringify(players));
        } catch (saveError) {
          console.error('Could not save player serial codes:', saveError);
          showToast('تعذر حفظ أكواد العضوية التسلسلية؛ تحقق من مساحة التخزين.', 'error');
        }
      }
    } else {
      players = [];
    }
  } catch (err) {
    console.error('Error reading players from localStorage:', err);
    players = [];
  }

  try {
    const storedLogs = localStorage.getItem(STORAGE_KEYS.AUDIT_LOG);
    auditLogs = storedLogs ? JSON.parse(storedLogs) : [];
  } catch {
    auditLogs = [];
  }

  try {
    const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    const settings = storedSettings ? JSON.parse(storedSettings) : {};
    if (localStorage.getItem(STORAGE_KEYS.TELEGRAM_TOKEN_ROTATION) !== '1') {
      settings.botToken = '';
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({
        botToken: '',
        chatId: String(settings.chatId || '').trim()
      }));
      localStorage.setItem(STORAGE_KEYS.TELEGRAM_TOKEN_ROTATION, '1');
    }
    const btEl = document.getElementById('botTokenInput');
    const ciEl = document.getElementById('chatIdInput');
    if (btEl) btEl.value = String(settings.botToken || '').trim();
    if (ciEl) ciEl.value = String(settings.chatId || '').trim();
    if (!storedSettings) localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ botToken: '', chatId: '' }));
  } catch (err) {
    console.error('Error reading settings from localStorage:', err);
  }
}

function savePlayersToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.PLAYERS, JSON.stringify(players));
    if (typeof renderPlayers === 'function') renderPlayers();
    return true;
  } catch (err) {
    showToast('تنبيه: الذاكرة المحلية ممتلئة! يرجى تحميل نسخة احتياطية.', 'error');
    return false;
  }
}

function saveFinanceLedgerToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.FINANCE_LEDGER, JSON.stringify(financeLedger));
    if (typeof updateDashboardStats === 'function') updateDashboardStats();
  } catch (e) {
    console.error('Error saving finance ledger:', e);
  }
}

function saveTelegramDirectoryToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.TELEGRAM_DIRECTORY, JSON.stringify(telegramDirectory));
  } catch (e) {
    console.error('Error saving telegram directory:', e);
  }
}

function applyGymBrandingToUI() {
  const nameParts = gymProfile.gymName.split('|');
  const mainTitle = escapeHtml(nameParts[0] || 'Power Gym');
  const subTitle = nameParts[1] ? `<span class="text-amber-400">| ${escapeHtml(nameParts[1].trim())}</span>` : '';

  const headerTitleEl = document.getElementById('headerGymTitle');
  if (headerTitleEl) headerTitleEl.innerHTML = `${mainTitle} ${subTitle}`;

  const sidebarTitleEl = document.getElementById('sidebarGymTitle');
  if (sidebarTitleEl) sidebarTitleEl.textContent = nameParts[0]?.trim() || 'Power Gym';

  const cardGymNameEl = document.getElementById('cardGymName');
  const cardGymBranchEl = document.getElementById('cardGymBranch');
  if (cardGymNameEl) cardGymNameEl.textContent = gymProfile.gymName;
  if (cardGymBranchEl) cardGymBranchEl.textContent = gymProfile.gymBranch;

  const splashTitleEl = document.getElementById('splashGymTitle');
  if (splashTitleEl) splashTitleEl.innerHTML = `${mainTitle} ${subTitle}`;

  const headerSubEl = document.getElementById('headerGymSubtitle');
  if (headerSubEl) {
    headerSubEl.innerHTML = `<i class="fa-solid fa-location-dot text-cyan-400"></i><span>${escapeHtml(gymProfile.gymBranch)}</span>`;
  }

  const splashSubEl = document.getElementById('splashGymSubtitle');
  if (splashSubEl) {
    splashSubEl.innerHTML = `<i class="fa-solid fa-location-dot text-cyan-400"></i><span>${escapeHtml(gymProfile.gymBranch)}</span>`;
  }

  const lockSubEl = document.getElementById('lockGymSubtitle');
  if (lockSubEl) {
    lockSubEl.textContent = `${gymProfile.gymName} — ${gymProfile.gymBranch}`;
  }
}

// =========================================================
// 4. Splash, Sidebar, Toast & Lock Screen
// =========================================================
let splashFinished = false;
let splashBootStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
let splashTimerInterval = null;

function setSplashProgress(percent, stageLabel, statusText, activeStepId) {
  if (splashFinished) return;
  const bar = document.getElementById('splashProgressBar');
  const status = document.getElementById('splashStatusText');
  const pct = document.getElementById('splashPercentText');
  const stage = document.getElementById('splashStageBadge');
  const clamped = Math.max(5, Math.min(100, Number(percent) || 0));

  if (bar) bar.style.width = clamped + '%';
  if (pct) pct.textContent = Math.round(clamped) + '%';
  if (stage && stageLabel) {
    stage.innerHTML = `<i class="fa-solid fa-microchip text-[10px]"></i> <span>${escapeHtml(stageLabel)}</span>`;
  }
  if (status && statusText) {
    const icon = clamped >= 100 ? 'fa-circle-check text-emerald-400' : 'fa-bolt text-amber-400 animate-pulse';
    status.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHtml(statusText)}</span>`;
  }

  const order = ['splashStepStorage', 'splashStepSchema', 'splashStepCloud', 'splashStepReady'];
  const activeIdx = order.indexOf(activeStepId);
  order.forEach((id, idx) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('is-active', 'is-done');
    if (clamped >= 100 || (activeIdx >= 0 && idx < activeIdx)) {
      el.classList.add('is-done');
    } else if (idx === activeIdx) {
      el.classList.add('is-active');
    }
  });
}

function dismissSplashScreenNow() {
  if (splashFinished) return;
  splashFinished = true;
  if (splashTimerInterval) {
    clearInterval(splashTimerInterval);
    splashTimerInterval = null;
  }
  const splash = document.getElementById('smartSplashScreen');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => splash.classList.add('hidden'), 420);
  }
}

function runSmartSplashAnimation() {
  const timerEl = document.getElementById('splashTimerText');
  if (!splashTimerInterval && timerEl) {
    splashTimerInterval = setInterval(() => {
      if (splashFinished) return;
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      timerEl.textContent = ((now - splashBootStart) / 1000).toFixed(1) + 's';
    }, 100);
  }

  setSplashProgress(22, 'فحص التخزين', 'تهيئة قاعدة البيانات المحلية (IndexedDB)...', 'splashStepStorage');

  setTimeout(() => {
    const count = Array.isArray(players) ? players.length : 0;
    setSplashProgress(55, 'هيكل البيانات', `تطبيع والتحقق من ${count} سجل مشترك...`, 'splashStepSchema');
  }, 160);

  setTimeout(() => {
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    setSplashProgress(84, 'الباك اند والمزامنة', online ? 'ربط طبقة السيرفر السحابي (Supabase)...' : 'تفعيل الوضع المحلي السريع (Offline)...', 'splashStepCloud');
  }, 380);

  setTimeout(() => {
    const greeting = gymProfile.supervisorName
      ? `مرحباً كابتن ${gymProfile.supervisorName} — كل شيء جاهز!`
      : 'منظومة Power Gym جاهزة للعمل!';
    setSplashProgress(100, 'جاهز للتشغيل', greeting, 'splashStepReady');
  }, 640);

  setTimeout(dismissSplashScreenNow, 980);
}
window.setSplashProgress = setSplashProgress;

function toggleMobileMenu() {
  const sidebar = document.getElementById('desktopSidebar');
  const backdrop = document.getElementById('mobileMenuBackdrop');
  const toggle = document.getElementById('mobileMenuToggle');
  if (!sidebar || !backdrop) return;
  const isOpen = !backdrop.classList.contains('hidden');
  if (isOpen) {
    closeMobileMenu();
    return;
  }
  sidebar.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'إغلاق القائمة الرئيسية');
    toggle.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  }
}

function closeMobileMenu() {
  const sidebar = document.getElementById('desktopSidebar');
  const backdrop = document.getElementById('mobileMenuBackdrop');
  const toggle = document.getElementById('mobileMenuToggle');
  if (sidebar) sidebar.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'فتح القائمة الرئيسية');
    toggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
  }
}

function scrollToPlayersDirectory() {
  const directory = document.getElementById('playersDirectory');
  if (directory) directory.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function checkSecurityLockOnStartup() {
  const savedHash = localStorage.getItem(STORAGE_KEYS.PIN_HASH);
  if (savedHash) {
    document.getElementById('lockScreenModal')?.classList.remove('hidden');
  }
}

function lockSystemNow() {
  const savedHash = localStorage.getItem(STORAGE_KEYS.PIN_HASH);
  if (!savedHash) {
    showToast('قم بتعيين رمز حماية (PIN) من الإعدادات أولاً لتفعيل قفل الشاشة 🔒', 'info');
    if (typeof openSettingsModal === 'function') openSettingsModal();
    return;
  }
  const input = document.getElementById('unlockPinInput');
  if (input) input.value = '';
  document.getElementById('lockErrorMsg')?.classList.add('hidden');
  document.getElementById('lockScreenModal')?.classList.remove('hidden');
  logActivity('تم قفل شاشة النظام يدوياً');
}

async function unlockSystem(event) {
  event.preventDefault();
  const pin = document.getElementById('unlockPinInput').value;
  const savedHash = localStorage.getItem(STORAGE_KEYS.PIN_HASH);
  const inputHash = await sha256Hash(pin);

  if (inputHash === savedHash) {
    document.getElementById('lockScreenModal').classList.add('hidden');
    document.getElementById('unlockPinInput').value = '';
    showToast('مرحباً بك كابتن! تم فتح القفل بنجاح 🔓', 'success');
    logActivity('تسجيل دخول ناجح وفتح قفل النظام');
  } else {
    const errEl = document.getElementById('lockErrorMsg');
    errEl.textContent = 'رمز الحماية غير صحيح! حاول مرة أخرى.';
    errEl.classList.remove('hidden');
    logActivity('محاولة فاشلة لفتح قفل النظام برمز خاطئ');
  }
}

async function updateSecurityPin() {
  const newPin = document.getElementById('newPinInput').value.trim();
  if (!newPin) {
    showToast('أدخل رمزاً جديداً، أو استخدم زر حذف الرمز لإلغاء الحماية.', 'warning');
    return;
  }
  if (newPin.length < 4) {
    showToast('يجب أن يتكون رمز PIN من 4 أرقام أو أحرف على الأقل', 'warning');
    return;
  }
  try {
    const hash = await sha256Hash(newPin);
    localStorage.setItem(STORAGE_KEYS.PIN_HASH, hash);
    document.getElementById('newPinInput').value = '';
    updateSecurityPinStatus();
    showToast('تم تشفير وحفظ رمز الحماية (PIN) بنجاح 🛡️', 'success');
    logActivity('تم تفعيل/تحديث رمز الحماية PIN');
  } catch (error) {
    console.error('تعذر حفظ رمز الحماية PIN:', error);
    showToast('تعذر حفظ رمز الحماية. تحقق من إعدادات التخزين في الجهاز.', 'error');
  }
}

function updateSecurityPinStatus() {
  const badge = document.getElementById('securityPinStatus');
  const removeButton = document.getElementById('removeSecurityPinButton');
  if (!badge || !removeButton) return;

  const isEnabled = Boolean(localStorage.getItem(STORAGE_KEYS.PIN_HASH));
  badge.textContent = isEnabled ? 'الحماية مفعّلة' : 'الحماية غير مفعّلة';
  badge.className = isEnabled
    ? 'rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300'
    : 'rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-[10px] font-bold text-slate-400';
  removeButton.disabled = !isEnabled;
}

function removeSecurityPin() {
  if (!localStorage.getItem(STORAGE_KEYS.PIN_HASH)) {
    updateSecurityPinStatus();
    showToast('لا يوجد رمز حماية محفوظ لحذفه.', 'info');
    return;
  }
  if (!confirm('هل تريد حذف رمز PIN وإيقاف قفل التطبيق على هذا الجهاز؟')) return;

  try {
    localStorage.removeItem(STORAGE_KEYS.PIN_HASH);
    document.getElementById('newPinInput').value = '';
    document.getElementById('unlockPinInput').value = '';
    document.getElementById('lockErrorMsg').classList.add('hidden');
    document.getElementById('lockScreenModal').classList.add('hidden');
    updateSecurityPinStatus();
    logActivity('تم حذف رمز الحماية PIN وإلغاء قفل التطبيق');
    showToast('تم حذف رمز الحماية وإلغاء قفل التطبيق.', 'success');
  } catch (error) {
    console.error('تعذر حذف رمز الحماية PIN:', error);
    showToast('تعذر حذف رمز الحماية. لم يتغير قفل التطبيق.', 'error');
  }
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');

  const colors = {
    success: 'bg-emerald-950/95 border-emerald-500 text-emerald-200',
    error: 'bg-rose-950/95 border-rose-500 text-rose-200',
    warning: 'bg-amber-950/95 border-amber-400 text-amber-200',
    info: 'bg-slate-900/95 border-cyan-500 text-cyan-200'
  };

  const icons = {
    success: 'fa-circle-check text-emerald-400',
    error: 'fa-circle-exclamation text-rose-400',
    warning: 'fa-triangle-exclamation text-amber-400',
    info: 'fa-circle-info text-cyan-400'
  };

  toast.className = `pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl border-r-4 shadow-2xl backdrop-blur-md text-xs md:text-sm font-bold transition-all duration-300 ${colors[type] || colors.info}`;

  const iconEl = document.createElement('i');
  iconEl.className = `fa-solid ${icons[type] || icons.info} text-lg`;

  const textEl = document.createElement('span');
  textEl.className = 'flex-1';
  textEl.textContent = message;

  toast.appendChild(iconEl);
  toast.appendChild(textEl);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3600);
}

// =========================================================
// 5. WhatsApp Helpers
// =========================================================
function generateWhatsAppLink(player) {
  const intlPhone = formatIraqiPhone(player.phone);
  const paid = Number(player.paidAmount) || 0;
  const debt = Number(player.debtAmount) || 0;
  const lines = [
    `السلام عليكم كابتن ${player.name} الحبيب 💪🔥`,
    `تم تسجيل/تحديث اشتراكك في *${gymProfile.gymName}* (${gymProfile.gymBranch})`,
    `🆔 رقم العضوية: ${player.code || '-'}`,
    `🏋️ القسم: ${player.planType || 'حديد وكارديو'}`,
    `📅 تاريخ البدء: ${player.startDate}`,
    `⏳ المدة: ${Number(player.durationMonths) === 0.5 ? 'نصف شهر (15 يوم)' : player.durationMonths + ' شهر'}`,
    `🏁 تاريخ الانتهاء: ${player.endDate}`,
    `💵 المبلغ المدفوع: ${paid.toLocaleString('en-US')} د.ع`,
    debt > 0 ? `⚠️ المبلغ المتبقي (الدين): *${debt.toLocaleString('en-US')} د.ع*` : '',
    `\nنتمنى لك تمريناً موفقاً!`
  ].filter(Boolean).join('\n');
  return `https://wa.me/${intlPhone}?text=${encodeURIComponent(lines)}`;
}

function openWhatsAppLink(url) {
  let whatsappUrl;
  try {
    whatsappUrl = new URL(url, window.location.href);
  } catch {
    showToast('تعذر تجهيز رابط واتساب؛ تحقق من رقم اللاعب.', 'warning');
    return false;
  }

  if (whatsappUrl.protocol !== 'https:' || !['wa.me', 'api.whatsapp.com'].includes(whatsappUrl.hostname)) {
    showToast('رابط واتساب غير صالح.', 'warning');
    return false;
  }

  const popup = window.open(whatsappUrl.href, '_blank');
  if (popup) {
    popup.opener = null;
    return true;
  }

  window.location.assign(whatsappUrl.href);
  return false;
}

function dataURLtoBlob(dataurl) {
  const arr = dataurl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMobileMenu();
});
