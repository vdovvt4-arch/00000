'use strict';
// =========================================================
// Power Gym — Players, Analytics, Cards & Backups (js/players.js)
// =========================================================

// ---------- Image Compression (WebP/JPEG) ----------
function encodeCanvasCompressed(canvas, quality) {
  const webp = canvas.toDataURL('image/webp', quality);
  if (webp && webp.startsWith('data:image/webp')) return webp;
  return canvas.toDataURL('image/jpeg', quality);
}

function handleImageUpload(event) {
  const input = event.currentTarget || event.target;
  const file = input.files && input.files[0];
  if (!file) return;
  input.value = '';

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    showToast('يرجى اختيار صورة بصيغة JPG أو PNG أو WebP فقط.', 'error');
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    showToast('حجم الصورة كبير جداً؛ الحد الأقصى 15MB.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => showToast('تعذرت قراءة الصورة من الجهاز. حاول اختيار ملف آخر.', 'error');
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => showToast('ملف الصورة تالف أو غير مدعوم.', 'error');
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        showToast('تعذر فتح الصورة المختارة.', 'error');
        return;
      }
      const canvas = document.createElement('canvas');
      const MAX_SIZE = 320;
      let width = img.width;
      let height = img.height;
      if (width > height && width > MAX_SIZE) {
        height = Math.round((height * MAX_SIZE) / width);
        width = MAX_SIZE;
      } else if (height >= width && height > MAX_SIZE) {
        width = Math.round((width * MAX_SIZE) / height);
        height = MAX_SIZE;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        showToast('تعذر تجهيز الصورة للمعاينة.', 'error');
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      try {
        compressedPhotoDataUrl = encodeCanvasCompressed(canvas, 0.72);
        document.getElementById('photoPreview').src = compressedPhotoDataUrl;
        showToast('تم ضغط وتجهيز صورة اللاعب بنجاح ✓', 'success');
      } catch (error) {
        console.error('Could not process player photo:', error);
        showToast('تعذر ضغط الصورة المختارة. جرّب صورة أخرى.', 'error');
      }
    };
    img.src = String(reader.result || '');
  };
  reader.readAsDataURL(file);
}

function compressCourseImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذرت قراءة الصورة.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('ملف الصورة غير صالح.'));
      image.onload = () => {
        const compress = (maxSize, quality) => {
          const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('تعذر تجهيز الصورة للضغط.');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          return encodeCanvasCompressed(canvas, quality);
        };

        try {
          let dataUrl = compress(850, 0.62);
          if (Math.ceil(dataUrl.length * 0.75) > 220 * 1024) dataUrl = compress(560, 0.5);
          if (Math.ceil(dataUrl.length * 0.75) > 220 * 1024) {
            reject(new Error('حجم الصورة بعد الضغط ما زال كبيراً؛ اختر صورة أصغر.'));
            return;
          }
          resolve(dataUrl);
        } catch (error) {
          reject(error);
        }
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function renderCourseImagesPreview() {
  const preview = document.getElementById('courseImagesPreview');
  if (!preview) return;
  preview.innerHTML = courseImagesDraft.map((image, index) => `
    <div class="relative rounded-xl overflow-hidden border border-cyan-500/30 bg-slate-950">
      <img src="${image}" alt="صورة كورس ${index + 1}" class="w-full h-28 object-cover">
      <button type="button" onclick="removeCourseImage(${index})" class="absolute top-1 left-1 w-7 h-7 rounded-lg bg-slate-950/90 text-rose-300 hover:bg-rose-600 hover:text-white" aria-label="حذف الصورة ${index + 1}">
        <i class="fa-solid fa-trash-can text-xs"></i>
      </button>
    </div>
  `).join('');
}

async function handleCourseImagesUpload(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length) return;
  if (courseImagesDraft.length + files.length > 5) {
    showToast(`يمكن حفظ 5 صور كحد أقصى؛ المتبقي ${5 - courseImagesDraft.length}.`, 'warning');
    return;
  }

  for (const file of files) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showToast(`تم تجاهل "${file.name}": اختر JPG أو PNG أو WebP فقط.`, 'error');
      continue;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast(`تم تجاهل "${file.name}": الحد الأقصى لحجم الصورة 10MB.`, 'error');
      continue;
    }
    try {
      courseImagesDraft.push(await compressCourseImage(file));
      renderCourseImagesPreview();
    } catch (error) {
      console.error('Could not process course image:', error);
      showToast(error.message || 'تعذرت معالجة صورة الكورس.', 'error');
    }
  }
}

function removeCourseImage(index) {
  if (!Number.isInteger(index) || index < 0 || index >= courseImagesDraft.length) return;
  courseImagesDraft.splice(index, 1);
  renderCourseImagesPreview();
}

// ---------- Coach Mode (?pgCoach=1) ----------
function getCoachGymIdFromLink() {
  const gymId = new URLSearchParams(window.location.search).get('pgGym') || '';
  return /^[a-zA-Z0-9_-]{12,80}$/.test(gymId) ? gymId : '';
}

function rememberCoachGymIdFromLink() {
  const gymId = getCoachGymIdFromLink();
  if (!gymId) return;
  try {
    localStorage.setItem(COACH_GYM_STORAGE_KEY, gymId);
  } catch (error) {
    console.error('تعذر حفظ رمز النادي لوضع المدرب:', error);
    showToast('تعذر تهيئة وضع المدرب على هذا الجهاز.', 'error');
  }
}

function getOrCreateCoachGymId() {
  try {
    const existingId = localStorage.getItem(COACH_GYM_STORAGE_KEY);
    if (existingId && /^[a-zA-Z0-9_-]{12,80}$/.test(existingId)) return existingId;

    const randomPart = window.crypto?.randomUUID
      ? window.crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}${Math.random().toString(36).slice(2)}`;
    const gymId = `gym_${randomPart}`;
    localStorage.setItem(COACH_GYM_STORAGE_KEY, gymId);
    return gymId;
  } catch (error) {
    console.error('تعذر إنشاء رمز نادي لوضع المدرب:', error);
    showToast('تعذر إنشاء رمز المشاركة. تحقق من مساحة التخزين.', 'error');
    return '';
  }
}

function getCoachRegistrationUrl() {
  if (!['http:', 'https:'].includes(window.location.protocol)) return '';
  const gymId = getOrCreateCoachGymId();
  if (!gymId) return '';
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set('pgCoach', '1');
  url.searchParams.set('pgGym', gymId);
  return url.toString();
}

function readCoachPendingRegistrations() {
  try {
    const stored = localStorage.getItem(COACH_PENDING_STORAGE_KEY);
    if (!stored) return [];
    const entries = JSON.parse(stored);
    if (!Array.isArray(entries) || entries.some(entry =>
      !entry || typeof entry !== 'object' ||
      typeof entry.gymId !== 'string' ||
      !entry.player || typeof entry.player !== 'object'
    )) {
      throw new TypeError('قائمة تسجيلات المدرب غير صالحة.');
    }
    return entries;
  } catch (error) {
    console.error('تعذر قراءة تسجيلات المدرب:', error);
    showToast('تعذر قراءة التسجيلات المحفوظة على هذا الهاتف.', 'error');
    return null;
  }
}

function saveCoachPendingRegistrations(entries) {
  try {
    localStorage.setItem(COACH_PENDING_STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch (error) {
    console.error('تعذر حفظ تسجيلات المدرب:', error);
    showToast('تعذر حفظ التسجيل. تحقق من مساحة التخزين على الهاتف.', 'error');
    return false;
  }
}

function renderCoachMode() {
  const gymId = getCoachGymIdFromLink();
  const errorEl = document.getElementById('coachModeError');
  const addButton = document.querySelector('#coachModePanel button[onclick="openAddModal()"]');
  const exportButton = document.querySelector('#coachModePanel button[onclick="exportCoachRegistrations()"]');
  const nameInput = document.getElementById('coachTrainerName');
  if (!errorEl || !nameInput) return;

  try {
    nameInput.value = localStorage.getItem('power_gym_coach_trainer_name_v1') || '';
  } catch { /* ignore */ }

  const validInvite = Boolean(gymId);
  errorEl.classList.toggle('hidden', validInvite);
  errorEl.textContent = validInvite
    ? ''
    : 'رابط التسجيل غير مكتمل. اطلب من المدرب الرئيسي إعادة مشاركة QR الخاص بالنادي.';
  [addButton, exportButton].forEach(button => {
    if (button) button.disabled = !validInvite;
  });

  const countEl = document.getElementById('coachPendingCount');
  const listEl = document.getElementById('coachPendingList');
  if (!countEl || !listEl) return;

  const allEntries = readCoachPendingRegistrations();
  if (!allEntries) {
    listEl.textContent = 'تعذر تحميل التسجيلات.';
    return;
  }
  const entries = validInvite ? allEntries.filter(entry => entry.gymId === gymId) : [];
  countEl.textContent = entries.length.toLocaleString('ar-IQ');
  listEl.innerHTML = entries.length
    ? entries.slice(0, 30).map(entry => `
        <div class="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <span class="truncate text-xs font-bold text-slate-200">${escapeHtml(entry.player?.name || 'لاعب بدون اسم')}</span>
          <span class="shrink-0 text-[10px] text-slate-400" dir="ltr">${escapeHtml(entry.player?.startDate || '')}</span>
        </div>
      `).join('')
    : '<p class="rounded-xl border border-dashed border-slate-700 p-4 text-center text-xs text-slate-400">لا توجد تسجيلات محفوظة بعد.</p>';
}

function saveCoachRegistration(data) {
  const gymId = getCoachGymIdFromLink();
  if (!gymId) {
    showToast('رابط التسجيل غير مكتمل؛ اطلب QR جديداً من المدرب الرئيسي.', 'error');
    return false;
  }
  const entries = readCoachPendingRegistrations();
  if (!entries) return false;

  const now = new Date().toISOString();
  const submissionId = `coach_${window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
  const player = sanitizePlayerRecord({
    ...data,
    id: submissionId,
    code: '',
    courseNotes: '',
    courseImages: [],
    attendanceCount: 0,
    lastCheckIn: '',
    photo: '',
    telegramFileId: '',
    playerChatId: '',
    activationSent: false,
    threeDayRemindersSent: [],
    lastReminderDate: '',
    coachSubmissionId: submissionId,
    createdAt: now,
    updatedAt: now
  });

  if (!player) {
    showToast('تعذر تجهيز بيانات التسجيل للتصدير.', 'error');
    return false;
  }

  const entry = {
    submissionId,
    gymId,
    trainerName: document.getElementById('coachTrainerName').value.trim().slice(0, 60),
    submittedAt: now,
    player
  };
  if (!saveCoachPendingRegistrations([entry, ...entries])) return false;

  try {
    localStorage.setItem('power_gym_coach_trainer_name_v1', entry.trainerName);
  } catch { /* ignore */ }
  return true;
}

function exportCoachRegistrations() {
  const gymId = getCoachGymIdFromLink();
  const entries = readCoachPendingRegistrations();
  if (!gymId || !entries) {
    if (!gymId) showToast('تعذر تحديد النادي لهذا الملف. افتح وضع المدرب من QR الصحيح.', 'error');
    return;
  }
  const gymEntries = entries.filter(entry => entry.gymId === gymId);
  if (!gymEntries.length) {
    showToast('لا توجد تسجيلات لهذا النادي حتى الآن.', 'warning');
    return;
  }

  const exportData = {
    format: 'power-gym-coach-registrations',
    version: 1,
    gymId,
    trainerName: document.getElementById('coachTrainerName').value.trim().slice(0, 60),
    exportedAt: new Date().toISOString(),
    entries: gymEntries.map(entry => ({
      submissionId: entry.submissionId,
      submittedAt: entry.submittedAt,
      trainerName: entry.trainerName,
      player: entry.player
    }))
  };
  const fileName = `power_gym_registrations_${getTodayDateString()}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`تم تجهيز ملف ${gymEntries.length.toLocaleString('ar-IQ')} تسجيلات. أرسله للمدرب الرئيسي للاستيراد.`, 'success');
}

function importCoachRegistrations(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('ملف تسجيلات المدربين أكبر من الحد المسموح (2 ميغابايت).', 'error');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => {
    showToast('تعذر قراءة ملف التسجيلات. جرّب نسخة أخرى.', 'error');
    event.target.value = '';
  };
  reader.onload = () => {
    const previousPlayers = players.slice();
    try {
      const imported = JSON.parse(String(reader.result || ''));
      if (imported?.format !== 'power-gym-coach-registrations' || imported.version !== 1 ||
          !Array.isArray(imported.entries) || imported.entries.length > 500) {
        throw new TypeError('صيغة ملف تسجيلات المدربين غير مدعومة.');
      }
      const gymId = localStorage.getItem(COACH_GYM_STORAGE_KEY);
      if (!gymId || imported.gymId !== gymId) {
        throw new TypeError('الملف ليس خاصاً برمز هذا النادي. افتح QR المشاركة أولاً على جهاز المدرب الرئيسي.');
      }
      if (imported.entries.length === 0) {
        showToast('لا توجد تسجيلات داخل هذا الملف.', 'info');
        return;
      }

      const importedIds = new Set(players.map(player => player.coachSubmissionId).filter(Boolean));
      const seenIds = new Set();
      const newPlayers = [];
      for (const entry of imported.entries) {
        const submissionId = String(entry?.submissionId || '');
        const rawPlayer = entry?.player;
        if (!/^[a-zA-Z0-9_-]{12,100}$/.test(submissionId) || !rawPlayer || typeof rawPlayer !== 'object' ||
            !String(rawPlayer.name || '').trim() || !String(rawPlayer.phone || '').trim() ||
            !isValidDateString(rawPlayer.startDate) || !isValidDateString(rawPlayer.endDate)) {
          throw new TypeError('يحتوي الملف على تسجيل ناقص أو غير صالح. لم يتم استيراد أي سجل.');
        }
        if (seenIds.has(submissionId) || importedIds.has(submissionId)) continue;
        seenIds.add(submissionId);

        const occupiedIds = new Set(players.concat(newPlayers).map(player => player.id));
        let playerId;
        do {
          playerId = `plr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        } while (occupiedIds.has(playerId));

        const submittedAt = Date.parse(entry.submittedAt);
        const player = sanitizePlayerRecord({
          ...rawPlayer,
          id: playerId,
          code: '',
          coachSubmissionId: submissionId,
          playerChatId: '',
          activationSent: false,
          telegramFileId: '',
          createdAt: Number.isFinite(submittedAt) ? new Date(submittedAt).toISOString() : new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        if (!player || !player.name || !player.phone) {
          throw new TypeError('تعذر التحقق من اسم أو رقم أحد اللاعبين في الملف.');
        }
        player.code = generateNextPlayerCode(players.concat(newPlayers).map(item => item.code));
        player.intlPhone = formatIraqiPhone(player.phone);
        newPlayers.push(player);
      }

      if (!newPlayers.length) {
        showToast('كل تسجيلات هذا الملف مستوردة مسبقاً.', 'info');
        return;
      }

      players = [...newPlayers, ...players];
      if (!savePlayersToStorage()) {
        players = previousPlayers;
        renderPlayers();
        return;
      }
      logActivity(`استيراد ${newPlayers.length} تسجيلات من ملف مدرب مساعد`);
      showToast(`تم استيراد ${newPlayers.length.toLocaleString('ar-IQ')} لاعبين دون تكرار.`, 'success');
    } catch (error) {
      showToast(error instanceof SyntaxError ? 'ملف التسجيلات ليس بصيغة JSON صالحة.' : (error.message || 'تعذر استيراد الملف.'), 'error');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

async function copyCoachRegistrationLink() {
  const input = document.getElementById('coachRegistrationUrl');
  const url = input?.value || '';
  if (!url) {
    showToast('لا يوجد رابط صالح للنسخ. افتح النسخة المستضافة عبر HTTPS.', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('تم نسخ رابط وضع المدرب.', 'success');
  } catch {
    input.focus();
    input.select();
    showToast('تعذر النسخ التلقائي؛ حدّد الرابط وانسخه يدوياً.', 'warning');
  }
}

// ---------- Player CRUD ----------
function openAddModal() {
  document.getElementById('editingPlayerId').value = '';
  document.getElementById('modalTitle').innerHTML = `<i class="fa-solid fa-user-plus text-cyan-400"></i><span>إضافة لاعب جديد</span>`;
  document.getElementById('saveBtn').textContent = COACH_MODE
    ? 'حفظ التسجيل على هذا الهاتف'
    : 'حفظ وإشعار واتساب';
  document.getElementById('playerForm').reset();

  compressedPhotoDataUrl = '';
  courseImagesDraft = [];
  document.getElementById('courseNotes').value = '';
  renderCourseImagesPreview();
  document.getElementById('photoPreview').src = DEFAULT_AVATAR;

  const today = getTodayDateString();
  document.getElementById('startDate').value = today;
  document.getElementById('durationMonths').value = '1';
  document.getElementById('paidAmount').value = gymProfile.defaultPrices?.['1'] || 25000;
  document.getElementById('debtAmount').value = '0';
  document.getElementById('playerChatIdInput').value = '';
  document.getElementById('sendActivationOnSave').checked = true;
  handlePhoneInputLookup('');
  calculateEndDate();

  document.getElementById('playerModal').classList.remove('hidden');
}

function openEditModal(playerId) {
  const player = players.find(p => p.id === playerId);
  if (!player) return;

  document.getElementById('editingPlayerId').value = player.id;
  document.getElementById('modalTitle').innerHTML = `<i class="fa-solid fa-user-pen text-cyan-400"></i><span>تعديل بيانات اللاعب</span>`;
  document.getElementById('saveBtn').textContent = 'حفظ التعديلات وإشعار واتساب';

  document.getElementById('playerName').value = player.name;
  document.getElementById('playerAge').value = player.age;
  document.getElementById('playerPhone').value = player.phone;
  document.getElementById('planType').value = player.planType || 'حديد عام (كمال أجسام)';
  document.getElementById('startDate').value = player.startDate;
  document.getElementById('durationMonths').value = String(player.durationMonths || 1);
  document.getElementById('endDate').value = player.endDate;
  document.getElementById('paidAmount').value = player.paidAmount ?? 25000;
  document.getElementById('debtAmount').value = player.debtAmount ?? 0;
  document.getElementById('playerNotes').value = player.notes || '';
  document.getElementById('courseNotes').value = player.courseNotes || '';
  courseImagesDraft = Array.isArray(player.courseImages) ? player.courseImages.slice(0, 5) : [];
  renderCourseImagesPreview();
  document.getElementById('playerChatIdInput').value = player.playerChatId || '';

  handlePhoneInputLookup(player.phone);
  compressedPhotoDataUrl = player.photo || '';
  document.getElementById('photoPreview').src = sanitizePhotoSource(player.photo);

  document.getElementById('playerModal').classList.remove('hidden');
}

function closePlayerModal() {
  document.getElementById('playerModal').classList.add('hidden');
}

async function savePlayer(event) {
  event.preventDefault();

  const saveBtn = document.getElementById('saveBtn');
  const editingId = document.getElementById('editingPlayerId').value;
  const name = document.getElementById('playerName').value.trim();
  const age = parseInt(document.getElementById('playerAge').value, 10);
  const phone = document.getElementById('playerPhone').value.trim();
  const planType = document.getElementById('planType').value;
  const startDate = document.getElementById('startDate').value;
  const durationMonths = parseFloat(document.getElementById('durationMonths').value) || 1;
  const endDate = document.getElementById('endDate').value;
  const paidAmount = Math.max(0, Number(document.getElementById('paidAmount').value) || 0);
  const debtAmount = Math.max(0, Number(document.getElementById('debtAmount').value) || 0);
  const notes = document.getElementById('playerNotes').value.trim();
  const courseNotes = document.getElementById('courseNotes').value.trim();
  const courseImages = courseImagesDraft.slice(0, 5);
  const customPlayerChatId = document.getElementById('playerChatIdInput').value.trim();

  if (!name || !phone || !startDate || !endDate) {
    showToast('يرجى ملء جميع الحقول المطلوبة!', 'warning');
    return;
  }

  if (COACH_MODE) {
    if (editingId) {
      showToast('وضع المدرب المساعد يسمح بإضافة تسجيلات جديدة فقط.', 'error');
      return;
    }
    saveBtn.disabled = true;
    try {
      const saved = saveCoachRegistration({ name, age, phone, planType, startDate, durationMonths, endDate, paidAmount, debtAmount, notes });
      if (!saved) return;
      closePlayerModal();
      renderCoachMode();
      showToast('تم حفظ التسجيل محلياً. صدّر الملف وسلّمه للمدرب الرئيسي.', 'success');
    } finally {
      saveBtn.disabled = false;
    }
    return;
  }

  saveBtn.disabled = true;
  const originalBtnText = saveBtn.textContent;
  saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin ml-2"></i> جاري الحفظ...`;

  try {
    const intlPhone = formatIraqiPhone(phone);
    const linkedChatId = customPlayerChatId || telegramDirectory?.phoneToChatId?.[intlPhone]?.chatId || '';
    const previousPlayers = players.slice();

    if (editingId) {
      const index = players.findIndex(p => p.id === editingId);
      if (index !== -1) {
        const existing = players[index];
        const endDateChanged = existing.endDate !== endDate;

        const updatedPlayer = sanitizePlayerRecord({
          ...existing,
          name, age, phone, planType, startDate, durationMonths, endDate,
          paidAmount, debtAmount, notes, courseNotes, courseImages,
          playerChatId: linkedChatId || existing.playerChatId || '',
          threeDayRemindersSent: endDateChanged ? [] : existing.threeDayRemindersSent,
          lastReminderDate: endDateChanged ? '' : existing.lastReminderDate,
          photo: compressedPhotoDataUrl || existing.photo || '',
          updatedAt: new Date().toISOString()
        });

        players[index] = updatedPlayer;
        if (!savePlayersToStorage()) {
          players = previousPlayers;
          renderPlayers();
          return;
        }
        const skipWaEdit = Boolean(window.__pgSkipSaveWhatsAppOnce);
        window.__pgSkipSaveWhatsAppOnce = false;
        const intlEditPhone = formatIraqiPhone(updatedPlayer.phone);
        if (!skipWaEdit && /^9647\d{9}$/.test(intlEditPhone)) {
          openWhatsAppLink(generateWhatsAppLink(updatedPlayer));
          showToast(`تم حفظ تعديلات "${updatedPlayer.name}" وفتح واتساب لإشعاره ✅`, 'success');
        } else {
          showToast(`تم حفظ تعديلات البطل "${updatedPlayer.name}" بنجاح ✅`, 'success');
        }
        logActivity(`تعديل بيانات اللاعب: ${updatedPlayer.name} (${updatedPlayer.code})`);
      }
    } else {
      const newPlayer = sanitizePlayerRecord({
        id: 'plr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        code: generateNextPlayerCode(),
        name, age, phone, planType, startDate, durationMonths, endDate,
        paidAmount, debtAmount, notes, courseNotes, courseImages,
        attendanceCount: 1,
        lastCheckIn: getTodayDateString(),
        photo: compressedPhotoDataUrl || '',
        telegramFileId: '',
        playerChatId: linkedChatId,
        activationSent: false,
        threeDayRemindersSent: [],
        lastReminderDate: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      players.unshift(newPlayer);
      if (!savePlayersToStorage()) {
        players = previousPlayers;
        renderPlayers();
        return;
      }
      const skipWaNew = Boolean(window.__pgSkipSaveWhatsAppOnce);
      window.__pgSkipSaveWhatsAppOnce = false;
      if (!skipWaNew && /^9647\d{9}$/.test(intlPhone)) {
        openWhatsAppLink(generateWhatsAppLink(newPlayer));
        showToast(`تم تسجيل "${newPlayer.name}" وفتح واتساب لإرسال تفاصيل الاشتراك ✅`, 'success');
      } else {
        showToast(`تم تسجيل وحفظ البطل "${newPlayer.name}" بنجاح 💪`, 'success');
      }
      logActivity(`إضافة لاعب جديد: ${newPlayer.name} (${newPlayer.code})`);
    }

    closePlayerModal();
  } catch (err) {
    console.error(err);
    showToast('حدث خطأ غير متوقع أثناء الحفظ', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalBtnText;
  }
}

function deletePlayer(playerId) {
  const player = players.find(p => p.id === playerId);
  if (!player) return;
  if (confirm(`هل أنت متأكد من حذف اشتراك اللاعب "${player.name}" نهائياً؟`)) {
    players = players.filter(p => p.id !== playerId);
    savePlayersToStorage();
    logActivity(`حذف اللاعب: ${player.name} (${player.code})`);
    showToast(`تم حذف اللاعب "${player.name}"`, 'info');
  }
}

function checkInPlayerToday(playerId) {
  const player = players.find(p => p.id === playerId);
  if (!player) return;

  const today = getTodayDateString();
  if (player.lastCheckIn === today) {
    showToast(`تم تسجيل حضور الكابتن "${player.name}" اليوم مسبقاً ✅`, 'info');
    return;
  }

  player.lastCheckIn = today;
  player.attendanceCount = (player.attendanceCount || 0) + 1;
  player.updatedAt = new Date().toISOString();

  // مزامنة مع سجل الحضور في advanced.js إن وجد
  try {
    const att = JSON.parse(localStorage.getItem('pg_attendance_v1') || '[]');
    if (Array.isArray(att) && !att.some(a => a.playerId === player.id && a.date === today)) {
      att.unshift({
        id: 'att_' + Date.now(),
        playerId: player.id,
        code: player.code,
        name: player.name,
        date: today,
        time: new Date().toLocaleTimeString('ar-IQ'),
        type: 'in'
      });
      localStorage.setItem('pg_attendance_v1', JSON.stringify(att));
    }
  } catch { /* ignore */ }

  savePlayersToStorage();
  logActivity(`تسجيل حضور يومي للاعب: ${player.name}`);
  showToast(`عاشت ايدك! تم تسجيل حضور البطل "${player.name}" (${player.attendanceCount} تمرين) 💪`, 'success');
}

// ---------- Renew, ID Card & Course Modal ----------
function openRenewModal(playerId) {
  const player = players.find(p => p.id === playerId);
  if (!player) return;

  document.getElementById('renewPlayerId').value = player.id;
  document.getElementById('renewPlayerName').textContent = `اللاعب: ${player.name} (${player.phone})`;
  document.getElementById('renewStartDate').value = getTodayDateString();
  const dur = String(player.durationMonths || 1);
  document.getElementById('renewDurationMonths').value = dur;
  document.getElementById('renewPaidAmount').value = gymProfile.defaultPrices?.[dur] || player.paidAmount || 25000;
  document.getElementById('renewDebtAmount').value = 0;
  calculateRenewEndDate();

  document.getElementById('renewModal').classList.remove('hidden');
}

function closeRenewModal() {
  document.getElementById('renewModal').classList.add('hidden');
}

function calculateRenewEndDate() {
  const start = document.getElementById('renewStartDate').value;
  const months = parseFloat(document.getElementById('renewDurationMonths').value) || 1;
  if (!start) return;
  document.getElementById('renewEndDate').value = addMonthsToDate(start, months);
  const defaultPrice = gymProfile.defaultPrices?.[String(months)];
  if (defaultPrice) {
    document.getElementById('renewPaidAmount').value = defaultPrice;
  }
}

async function confirmRenewSubscription() {
  const playerId = document.getElementById('renewPlayerId').value;
  const startDate = document.getElementById('renewStartDate').value;
  const durationMonths = parseFloat(document.getElementById('renewDurationMonths').value) || 1;
  const endDate = document.getElementById('renewEndDate').value;
  const paidAmount = Math.max(0, Number(document.getElementById('renewPaidAmount').value) || 0);
  const debtAmount = Math.max(0, Number(document.getElementById('renewDebtAmount').value) || 0);

  const idx = players.findIndex(p => p.id === playerId);
  if (idx === -1) return;

  players[idx].startDate = startDate;
  players[idx].durationMonths = durationMonths;
  players[idx].endDate = endDate;
  players[idx].paidAmount = (Number(players[idx].paidAmount) || 0) + paidAmount;
  players[idx].debtAmount = (Number(players[idx].debtAmount) || 0) + debtAmount;
  players[idx].threeDayRemindersSent = [];
  players[idx].lastReminderDate = '';
  players[idx].updatedAt = new Date().toISOString();

  financeLedger.renewals = Array.isArray(financeLedger.renewals) ? financeLedger.renewals : [];
  financeLedger.renewals.unshift({
    id: `ren_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    playerId,
    playerName: players[idx].name,
    startDate,
    endDate,
    durationMonths,
    paidAmount,
    date: getTodayDateString()
  });
  saveFinanceLedgerToStorage();

  savePlayersToStorage();
  closeRenewModal();
  logActivity(`تجديد اشتراك اللاعب: ${players[idx].name} لغاية ${endDate}`);
  const intlRenewPhone = formatIraqiPhone(players[idx].phone);
  if (/^9647\d{9}$/.test(intlRenewPhone)) {
    openWhatsAppLink(generateWhatsAppLink(players[idx]));
    showToast(`تم تجديد اشتراك "${players[idx].name}" لغاية ${endDate} وفتح واتساب ✅`, 'success');
  } else {
    showToast(`تم تجديد وحفظ اشتراك البطل "${players[idx].name}" لغاية ${endDate} ✅`, 'success');
  }
}

function openIdCardModal(playerId) {
  const player = players.find(p => p.id === playerId);
  if (!player) return;

  document.getElementById('cardAvatar').src = sanitizePhotoSource(player.photo);
  document.getElementById('cardName').textContent = player.name;
  document.getElementById('cardPlan').textContent = player.planType || 'حديد عام (كمال أجسام)';
  document.getElementById('cardSupervisorName').textContent = gymProfile.supervisorName || 'إدارة القاعة';
  document.getElementById('cardReceiptStamp').textContent = gymProfile.receiptStamp || '';
  document.getElementById('cardStart').textContent = player.startDate;
  document.getElementById('cardEnd').textContent = player.endDate;
  document.getElementById('cardCode').textContent = player.code || 'PG-1000';
  document.getElementById('cardPhone').textContent = player.phone;

  const qrData = encodeURIComponent(`PowerGym|${player.code}|${player.name}|${player.endDate}`);
  document.getElementById('cardQr').src = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${qrData}`;
  document.getElementById('idCardModal').classList.remove('hidden');
}

function closeIdCardModal() {
  document.getElementById('idCardModal').classList.add('hidden');
}

let currentCoursePlayerId = '';

function openPlayerCourseModal(playerId) {
  const player = players.find(item => item.id === playerId);
  if (!player) return;
  currentCoursePlayerId = player.id;
  const images = Array.isArray(player.courseImages)
    ? player.courseImages.map(sanitizeCourseImage).filter(Boolean).slice(0, 5)
    : [];
  document.getElementById('courseRecordTitle').textContent = `ملف كورس اللاعب: ${player.name}`;
  document.getElementById('courseRecordPlayerName').textContent = `${player.name} | ${player.code || ''}`;
  document.getElementById('courseRecordNotes').textContent = player.courseNotes || 'لا توجد ملاحظات محفوظة لهذا الكورس.';
  document.getElementById('courseRecordImages').innerHTML = images.length
    ? images.map((image, index) => `<img src="${image}" alt="صورة كورس ${index + 1} للاعب ${escapeHtml(player.name)}" class="w-full max-h-96 object-contain rounded-xl border border-slate-700 bg-white p-1">`).join('')
    : '<p class="text-xs text-slate-400 sm:col-span-2">لا توجد صور مضافة لهذا الكورس.</p>';
  document.getElementById('courseRecordModal').classList.remove('hidden');
}

function closePlayerCourseModal() {
  document.getElementById('courseRecordModal').classList.add('hidden');
}

function printMembershipCard() {
  document.body.dataset.printMode = 'card';
  window.print();
}

function printPlayerCourse() {
  document.body.dataset.printMode = 'course';
  window.print();
}

async function sendPlayerCourseWhatsApp() {
  const player = players.find(item => item.id === currentCoursePlayerId);
  if (!player) return;
  const images = Array.isArray(player.courseImages)
    ? player.courseImages.map(sanitizeCourseImage).filter(Boolean).slice(0, 5)
    : [];
  const text = [
    `🏋️ *ملف كورس اللاعب — ${gymProfile.gymName}*`,
    `👤 اللاعب: *${player.name}* (${player.code || '-'})`,
    player.courseNotes ? `📋 *تفاصيل الكورس:*\n${player.courseNotes}` : '📸 صور الكورس مرفقة'
  ].filter(Boolean).join('\n');

  if (images.length && navigator.share && navigator.canShare) {
    try {
      const files = await Promise.all(images.map(async (dataUrl, i) => {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        return new File([blob], `course_${player.code || 'pg'}_${i + 1}.jpg`, { type: blob.type || 'image/jpeg' });
      }));
      if (navigator.canShare({ files })) {
        await navigator.share({ title: `كورس ${player.name}`, text, files });
        logActivity(`مشاركة صور كورس اللاعب ${player.name} عبر واتساب`);
        showToast('تمت مشاركة ملف الكورس بنجاح ✅', 'success');
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }

  if (images.length) {
    images.forEach((dataUrl, i) => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `course_${player.code || 'pg'}_${i + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  const intlPhone = formatIraqiPhone(player.phone);
  if (/^9647\d{9}$/.test(intlPhone)) {
    openWhatsAppLink(`https://wa.me/${intlPhone}?text=${encodeURIComponent(text)}`);
    logActivity(`إرسال كورس اللاعب ${player.name} عبر واتساب`);
    showToast(
      images.length
        ? 'تم تنزيل صور الكورس وفتح واتساب اللاعب — أرفق الصور في المحادثة وأرسلها ✓'
        : 'تم فتح واتساب اللاعب بتفاصيل الكورس ✓',
      'success'
    );
  } else {
    showToast('تم تنزيل صور الكورس، لكن رقم هاتف اللاعب غير صالح لفتح واتساب', 'warning');
  }
}

window.addEventListener('afterprint', () => {
  delete document.body.dataset.printMode;
});

function openAuditLogModal() {
  const list = document.getElementById('auditLogList');
  if (auditLogs.length === 0) {
    list.innerHTML = `<p class="text-center text-slate-400 py-8">لا توجد حركات مسجلة بعد.</p>`;
  } else {
    list.innerHTML = auditLogs.map(item => `
      <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex justify-between items-center gap-3">
        <span class="text-slate-200 font-semibold">${escapeHtml(item.action)}</span>
        <span class="text-[10px] text-cyan-400 whitespace-nowrap" dir="ltr">${escapeHtml(item.time)}</span>
      </div>
    `).join('');
  }
  document.getElementById('auditLogModal').classList.remove('hidden');
}

function closeAuditLogModal() {
  document.getElementById('auditLogModal').classList.add('hidden');
}

// ---------- Filter, View, Stats & Analytics ----------
function getFrozenPlayerIdSet() {
  try {
    const arr = JSON.parse(localStorage.getItem('pg_freezes_v1') || '[]');
    return new Set(Array.isArray(arr) ? arr.filter(f => !f.endedAt).map(f => String(f.playerId)) : []);
  } catch {
    return new Set();
  }
}

function setFilter(filterType) {
  currentFilter = filterType;
  const filters = ['all', 'followup', 'active', 'soon', 'expired', 'frozen', 'debt'];
  filters.forEach(flt => {
    const btn = document.getElementById(`flt-${flt}`);
    if (!btn) return;
    if (flt === filterType) {
      btn.className = 'filter-btn pg-filter-pill is-active';
    } else {
      btn.className = 'filter-btn pg-filter-pill';
    }
  });
  renderPlayers();
}

function setViewMode(mode) {
  currentViewMode = mode;
  const cardsBtn = document.getElementById('viewCardsBtn');
  const tableBtn = document.getElementById('viewTableBtn');
  const grid = document.getElementById('playersGrid');
  const tableContainer = document.getElementById('playersTableContainer');

  if (mode === 'table') {
    tableBtn.className = 'px-2.5 py-1 rounded-md bg-cyan-400 text-slate-950 font-black transition';
    cardsBtn.className = 'px-2.5 py-1 rounded-md text-slate-400 hover:text-white font-bold transition';
    grid.classList.add('hidden');
    tableContainer.classList.remove('hidden');
  } else {
    cardsBtn.className = 'px-2.5 py-1 rounded-md bg-cyan-400 text-slate-950 font-black transition';
    tableBtn.className = 'px-2.5 py-1 rounded-md text-slate-400 hover:text-white font-bold transition';
    tableContainer.classList.add('hidden');
    grid.classList.remove('hidden');
  }
  renderPlayers();
}

function updateDashboardStats() {
  const total = players.length;
  let active = 0;
  let soon = 0;
  let expired = 0;
  let checkedInToday = 0;
  const today = getTodayDateString();
  const frozenSet = getFrozenPlayerIdSet();

  players.forEach(p => {
    if (p.lastCheckIn === today) checkedInToday++;
    if (frozenSet.has(String(p.id))) return;
    const { status } = getSubscriptionStatus(p.endDate);
    if (status === 'active') active++;
    else if (status === 'soon') soon++;
    else if (status === 'expired') expired++;
  });

  const fin = calculateFinancialMetrics();

  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setTxt('statTotal', total);
  setTxt('statActive', active);
  setTxt('statSoon', soon);
  setTxt('statExpired', expired);
  setTxt('sidebarPlayerCount', total);
  setTxt('heroTodayAttendance', checkedInToday);
  setTxt('heroTodayDate', `${getArabicDayName(today)} · ${today}`);

  const revEl = document.getElementById('statRevenue');
  if (revEl) revEl.innerHTML = `${fin.netProfit.toLocaleString('en-US')} <span class="text-[10px]">د.ع</span>`;
  const debtEl = document.getElementById('statDebt');
  if (debtEl) debtEl.innerHTML = `${fin.totalDebt.toLocaleString('en-US')} <span class="text-[10px]">د.ع</span>`;

  renderAnalyticsStrip(active, soon, expired, frozenSet.size);
}

function renderAnalyticsStrip(active, soon, expired, frozenCount) {
  const healthBox = document.getElementById('pgHealthChart');
  const pulseBox = document.getElementById('pgAttendancePulse');
  const crowdBox = document.getElementById('pgLiveCrowdBox');

  if (healthBox) {
    const total = Math.max(1, active + soon + expired + frozenCount);
    const pAct = Math.round((active / total) * 100);
    const pSoon = Math.round((soon / total) * 100);
    const pExp = Math.round((expired / total) * 100);
    const c1 = pAct;
    const c2 = c1 + pSoon;
    const c3 = c2 + pExp;
    healthBox.innerHTML = `
      <div class="flex items-center gap-4">
        <div class="relative w-20 h-20 shrink-0 rounded-full flex items-center justify-center"
             style="background: conic-gradient(#10b981 0% ${c1}%, #f59e0b ${c1}% ${c2}%, #f43f5e ${c2}% ${c3}%, #38bdf8 ${c3}% 100%);">
          <div class="w-14 h-14 rounded-full bg-slate-950 flex flex-col items-center justify-center">
            <span class="text-sm font-black text-white">${active + soon + expired + frozenCount}</span>
            <span class="text-[9px] text-slate-400">مشترك</span>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] flex-1">
          <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400"></span><span class="text-slate-300">فعّال:</span><b class="text-white">${active}</b></div>
          <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-amber-400"></span><span class="text-slate-300">قريباً:</span><b class="text-white">${soon}</b></div>
          <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-rose-500"></span><span class="text-slate-300">منتهي:</span><b class="text-white">${expired}</b></div>
          <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-sky-400"></span><span class="text-slate-300">مجمّد:</span><b class="text-white">${frozenCount}</b></div>
        </div>
      </div>
    `;
  }

  if (pulseBox) {
    let attLog = [];
    try { attLog = JSON.parse(localStorage.getItem('pg_attendance_v1') || '[]'); } catch { attLog = []; }
    const days = [];
    const today = getTodayDateString();
    for (let i = 6; i >= 0; i--) {
      const d = addDaysToDate(today, -i);
      const fromLog = attLog.filter(a => a.date === d).length;
      const fromPlayers = players.filter(p => p.lastCheckIn === d).length;
      const count = Math.max(fromLog, fromPlayers);
      days.push({ d, label: (getArabicDayName(d) || '').slice(0, 3), count });
    }
    const maxVal = Math.max(1, ...days.map(x => x.count));
    pulseBox.innerHTML = `
      <div class="flex items-end justify-between gap-2 h-20 pt-2">
        ${days.map(x => {
          const pct = Math.max(10, Math.round((x.count / maxVal) * 100));
          const isToday = x.d === today;
          return `
            <div class="flex-1 flex flex-col items-center gap-1 h-full justify-end" title="${x.d}: ${x.count} حضور">
              <span class="text-[9px] font-bold ${isToday ? 'text-amber-300' : 'text-zinc-400'}">${x.count}</span>
              <div class="w-full max-w-[22px] rounded-t-md transition-all ${isToday ? 'bg-gradient-to-t from-amber-500 to-amber-300' : 'bg-zinc-700/80'}" style="height:${pct}%"></div>
              <span class="text-[9px] ${isToday ? 'text-white font-black' : 'text-zinc-500'}">${escapeHtml(x.label)}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  if (crowdBox) {
    let crowd = { iron: 'medium', cardio: 'low' };
    try { crowd = Object.assign(crowd, JSON.parse(localStorage.getItem('pg_crowd_status_v1') || '{}')); } catch { /* ignore */ }
    const pill = (zone, val) => {
      const map = { low: ['هادئ', 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'], medium: ['متوسط', 'bg-amber-500/20 text-amber-300 border-amber-500/40'], high: ['مزدحم', 'bg-rose-500/20 text-rose-300 border-rose-500/40'] };
      const [lbl, cls] = map[val] || map.medium;
      return `<button type="button" onclick="pgCycleCrowd('${zone}')" class="px-2.5 py-1 rounded-lg border text-[11px] font-black transition ${cls}">${lbl}</button>`;
    };
    crowdBox.innerHTML = `
      <div class="space-y-2.5">
        <div class="pg-zone-card pg-zone-card--iron">
          <span class="text-xs font-black text-white"><i class="fa-solid fa-dumbbell text-amber-400 ml-1.5"></i>قسم الحديد</span>
          ${pill('iron', crowd.iron)}
        </div>
        <div class="pg-zone-card pg-zone-card--cardio">
          <span class="text-xs font-black text-white"><i class="fa-solid fa-heart-pulse text-rose-400 ml-1.5"></i>قسم الكارديو</span>
          ${pill('cardio', crowd.cardio)}
        </div>
      </div>
    `;
  }
}

window.pgCycleCrowd = function (zone) {
  let crowd = { iron: 'medium', cardio: 'low', updatedAt: '' };
  try { crowd = Object.assign(crowd, JSON.parse(localStorage.getItem('pg_crowd_status_v1') || '{}')); } catch { /* ignore */ }
  const order = ['low', 'medium', 'high'];
  const next = order[(order.indexOf(crowd[zone]) + 1) % order.length];
  crowd[zone] = next;
  crowd.updatedAt = new Date().toISOString();
  localStorage.setItem('pg_crowd_status_v1', JSON.stringify(crowd));
  updateDashboardStats();
  showToast('تم تحديث حالة الازدحام ✓', 'success');
};

function renderDailyFollowUp() {
  const list = document.getElementById('dailyFollowUpList');
  const count = document.getElementById('followUpCount');
  if (!list || !count) return;

  const frozenSet = getFrozenPlayerIdSet();
  const followUps = players
    .filter(player => !frozenSet.has(String(player.id)))
    .map(player => ({ player, subscription: getSubscriptionStatus(player.endDate) }))
    .filter(item => item.subscription.status === 'expired' || item.subscription.status === 'soon')
    .sort((a, b) => {
      const aPriority = a.subscription.status === 'expired' ? 0 : 1;
      const bPriority = b.subscription.status === 'expired' ? 0 : 1;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return aPriority === 0
        ? b.subscription.diffDays - a.subscription.diffDays
        : a.subscription.diffDays - b.subscription.diffDays;
    });

  count.textContent = `${followUps.length.toLocaleString('ar-IQ')} يحتاج متابعة`;

  if (followUps.length === 0) {
    list.innerHTML = `
      <div class="daily-follow-up-empty">
        <span class="daily-follow-up-empty__icon"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></span>
        <div>
          <p class="text-xs font-black text-emerald-300">كل الاشتراكات بحالة مستقرة</p>
          <p class="mt-1 text-[11px] text-slate-400">ستظهر هنا الاشتراكات المنتهية أو التي توشك على الانتهاء.</p>
        </div>
      </div>
    `;
    return;
  }

  const visibleFollowUps = followUps.slice(0, 5);
  list.innerHTML = visibleFollowUps.map(({ player, subscription }) => {
    const safeId = sanitizeId(player.id);
    const isExpired = subscription.status === 'expired';
    const safeName = escapeHtml(player.name || 'لاعب بدون اسم');
    const safeCode = escapeHtml(player.code || 'بدون كود');
    const safeEndDate = escapeHtml(player.endDate || '');

    return `
      <article class="daily-follow-up-item ${isExpired ? 'is-expired' : 'is-soon'}">
        <span class="daily-follow-up-item__icon" aria-hidden="true">
          <i class="fa-solid ${isExpired ? 'fa-triangle-exclamation' : 'fa-clock'}"></i>
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs font-black text-white">${safeName}</p>
          <p class="mt-1 text-[10px] font-semibold text-slate-400">
            <span dir="ltr">${safeCode}</span>
            <span class="mx-1.5 text-slate-600">•</span>
            <span>${escapeHtml(subscription.label)}</span>
            <span class="mx-1.5 text-slate-600">•</span>
            <span dir="ltr">${safeEndDate}</span>
          </p>
        </div>
        <button type="button" onclick="openRenewModal('${safeId}')" class="daily-follow-up-renew" aria-label="تجديد اشتراك ${safeName}">
          <i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>
          <span>تجديد</span>
        </button>
      </article>
    `;
  }).join('');

  if (followUps.length > visibleFollowUps.length) {
    list.insertAdjacentHTML('beforeend', `
      <button type="button" onclick="setFilter('followup')" class="daily-follow-up-more">
        عرض ${(followUps.length - visibleFollowUps.length).toLocaleString('ar-IQ')} اشتراكات إضافية
        <i class="fa-solid fa-arrow-left mr-1" aria-hidden="true"></i>
      </button>
    `);
  }
}

function initialsAvatarHtml(name, sizeClass) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = escapeHtml(words.map(w => w.charAt(0)).join('') || '؟');
  const hue = [...String(name || '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0);
  return `<div class="pg-avatar ${sizeClass}" style="--hue:${hue}" aria-hidden="true">${initials}</div>`;
}

function planIconClass(planType) {
  const t = String(planType || '');
  if (t.includes('VIP')) return 'fa-crown';
  if (t.includes('كارديو') || t.includes('لياقة')) return 'fa-heart-pulse';
  if (t.includes('تدريب')) return 'fa-star';
  return 'fa-dumbbell';
}

function subscriptionProgressPct(player) {
  if (!isValidDateString(player.startDate) || !isValidDateString(player.endDate)) return 0;
  const toTime = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  const total = toTime(player.endDate) - toTime(player.startDate);
  if (total <= 0) return 100;
  const used = toTime(getTodayDateString()) - toTime(player.startDate);
  return Math.round(Math.min(100, Math.max(0, (used / total) * 100)));
}

function renderPlayers() {
  updateDashboardStats();
  renderDailyFollowUp();

  const searchQuery = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  const sortMode = (document.getElementById('sortSelect')?.value) || 'newest';
  const grid = document.getElementById('playersGrid');
  const tableBody = document.getElementById('playersTableBody');
  if (!grid || !tableBody) return;

  const frozenSet = getFrozenPlayerIdSet();

  let filtered = players.filter(player => {
    const isFrozen = frozenSet.has(String(player.id));
    const { status } = getSubscriptionStatus(player.endDate);
    const matchesFilter =
      currentFilter === 'all' ? true :
      currentFilter === 'frozen' ? isFrozen :
      currentFilter === 'followup' ? (!isFrozen && (status === 'soon' || status === 'expired')) :
      currentFilter === 'debt' ? (Number(player.debtAmount) > 0) :
      (!isFrozen && status === currentFilter);

    const matchesSearch =
      player.name.toLowerCase().includes(searchQuery) ||
      player.phone.includes(searchQuery) ||
      (player.code && player.code.toLowerCase().includes(searchQuery));

    return matchesFilter && matchesSearch;
  });

  filtered.sort((a, b) => {
    if (sortMode === 'expiry_asc') return a.endDate.localeCompare(b.endDate);
    if (sortMode === 'name_asc') return a.name.localeCompare(b.name, 'ar');
    if (sortMode === 'debt_desc') return (Number(b.debtAmount) || 0) - (Number(a.debtAmount) || 0);
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  if (filtered.length === 0) {
    const hasPlayers = players.length > 0;
    const emptyTitle = hasPlayers ? 'ما لقينا لاعبين مطابقين' : 'ابدأ بإضافة أول لاعب';
    const emptyDescription = hasPlayers
      ? 'جرّب تغيير البحث أو الفلتر حتى تظهر النتائج.'
      : 'سجّل بيانات اللاعب واشتراكه حتى تبدأ بمتابعة النادي.';
    const emptyAction = hasPlayers
      ? `<button type="button" onclick="document.getElementById('searchInput').value=''; setFilter('all');" class="gold-gradient mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-black"><i class="fa-solid fa-filter-circle-xmark" aria-hidden="true"></i>مسح البحث والفلاتر</button>`
      : `<button type="button" onclick="openAddModal()" class="gold-gradient mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-black"><i class="fa-solid fa-user-plus" aria-hidden="true"></i>إضافة أول لاعب</button>`;
    grid.innerHTML = `
      <div class="col-span-full card-bg rounded-3xl p-12 text-center border border-dashed border-slate-700">
        <div class="w-16 h-16 rounded-2xl bg-slate-800/80 text-cyan-400 flex items-center justify-center text-3xl mx-auto mb-4">
          <i class="fa-solid ${hasPlayers ? 'fa-filter-circle-xmark' : 'fa-user-plus'}"></i>
        </div>
        <h3 class="text-lg font-black text-white mb-1">${emptyTitle}</h3>
        <p class="text-xs text-slate-400">${emptyDescription}</p>
        ${emptyAction}
      </div>
    `;
    tableBody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400"><p class="font-bold">${emptyTitle}</p><p class="mt-1 text-xs">${emptyDescription}</p>${emptyAction}</td></tr>`;
    return;
  }

  grid.innerHTML = filtered.map(player => {
    const safeId = sanitizeId(player.id);
    const sub = getSubscriptionStatus(player.endDate);
    const isFrozen = frozenSet.has(String(player.id));
    const waLink = player.activationSent ? generateWhatsAppAlertLink(player) : generateWhatsAppLink(player);
    const avatarSrc = sanitizePhotoSource(player.photo);
    const hasDebt = Number(player.debtAmount) > 0;
    const checkedInToday = player.lastCheckIn === getTodayDateString();
    const endDayName = getArabicDayName(player.endDate);
    const cardStatus = isFrozen ? 'frozen' : sub.status;

    return `
      <article class="pg-player-card pg-status-${cardStatus}">
        <div class="pg-player-card__top">
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] font-black px-2 py-0.5 rounded-lg bg-slate-950/90 text-cyan-300 border border-cyan-400/25" dir="ltr">${escapeHtml(player.code || 'PG')}</span>
            <button type="button" onclick="openEditModal('${safeId}')" class="pg-icon-mini" title="تعديل بيانات اللاعب" aria-label="تعديل بيانات اللاعب ${escapeHtml(player.name)}">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button type="button" onclick="deletePlayer('${safeId}')" class="pg-icon-mini pg-icon-mini--danger" title="حذف اللاعب" aria-label="حذف اللاعب ${escapeHtml(player.name)}">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
          <span class="${isFrozen ? 'pg-badge pg-badge--frozen' : sub.badgeClass}">
            ${isFrozen ? '❄️ اشتراك مجمّد' : escapeHtml(sub.label)}
          </span>
        </div>

        <div class="pg-player-card__identity">
          <div class="relative shrink-0">
            ${avatarSrc === DEFAULT_AVATAR
              ? initialsAvatarHtml(player.name, 'pg-avatar--card')
              : `<img src="${avatarSrc}" alt="${escapeHtml(player.name)}" class="w-16 h-16 rounded-2xl object-cover border border-cyan-400/30">`}
            ${checkedInToday ? `<span title="حاضر اليوم" class="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 text-[10px] flex items-center justify-center absolute -bottom-1 -left-1 border-2 border-slate-950 shadow"><i class="fa-solid fa-check"></i></span>` : ''}
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="text-base font-black text-white truncate">${escapeHtml(player.name)}</h3>
            <p class="text-[11px] font-bold text-cyan-300 mt-0.5 truncate">
              <i class="fa-solid ${planIconClass(player.planType)} ml-1"></i>${escapeHtml(player.planType || 'حديد عام')}
            </p>
            <div class="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
              <span>${Number(player.age)} سنة</span>
              <span>•</span>
              <a href="tel:${escapeHtml(player.phone)}" class="hover:text-white underline decoration-dotted" dir="ltr">${escapeHtml(player.phone)}</a>
            </div>
          </div>
        </div>

        <div class="pg-progress pg-progress--${sub.status}" title="نسبة الوقت المنقضي من الاشتراك">
          <span style="--p:${subscriptionProgressPct(player)}%"></span>
        </div>

        <div class="grid grid-cols-3 gap-2 bg-slate-950/75 border border-slate-800/80 rounded-xl p-2 text-center">
          <div>
            <span class="block text-[10px] text-slate-500">البدء</span>
            <span class="text-[11px] font-bold text-slate-200" dir="ltr">${escapeHtml(player.startDate)}</span>
          </div>
          <div class="border-x border-slate-800">
            <span class="block text-[10px] text-slate-500">المدة</span>
            <span class="text-xs font-black text-amber-300">${Number(player.durationMonths) === 0.5 ? 'نصف شهر' : Number(player.durationMonths) + ' شهر'}</span>
          </div>
          <div>
            <span class="block text-[10px] text-slate-500">ينتهي (${escapeHtml(endDayName)})</span>
            <span class="text-[11px] font-black ${sub.status === 'expired' ? 'text-rose-400' : 'text-emerald-400'}" dir="ltr">${escapeHtml(player.endDate)}</span>
          </div>
        </div>

        <div onclick="openFinanceModal('debts')" class="cursor-pointer hover:border-cyan-500/40 transition flex items-center justify-between text-[11px] bg-slate-950/60 px-3 py-2 rounded-xl border border-slate-800/80" title="اضغط لتعديل المبلغ المدفوع أو الدين">
          <div>
            <span class="text-slate-400">المدفوع:</span>
            <span class="font-black text-emerald-400">${Number(player.paidAmount || 0).toLocaleString('en-US')} د.ع</span>
          </div>
          ${hasDebt ? `
            <div class="bg-rose-500/15 text-rose-300 px-2 py-0.5 rounded-lg font-black border border-rose-500/30">
              متبقي: ${Number(player.debtAmount).toLocaleString('en-US')} د.ع
            </div>
          ` : `
            <div class="text-slate-300 text-[10px] font-bold">
              🔥 حضور: <b class="text-white">${Number(player.attendanceCount || 0)}</b>
            </div>
          `}
        </div>

        ${player.notes ? `
          <p class="text-[11px] text-slate-300 bg-slate-900/70 border-r-2 border-cyan-400 pr-2 py-1 rounded">
            <i class="fa-solid fa-note-sticky text-cyan-400 ml-1"></i>${escapeHtml(player.notes)}
          </p>
        ` : ''}

        <div class="pt-2 border-t border-slate-800/80 flex items-center gap-1.5 flex-wrap mt-auto">
          <button onclick="sendSubscriptionAlertById('${safeId}')" class="pg-card-cta flex-1" title="إرسال إشعار الاشتراك عبر واتساب">
            <i class="fa-brands fa-whatsapp text-sm"></i>
            <span>إشعار واتساب</span>
          </button>
          <button onclick="openRenewModal('${safeId}')" class="pg-card-action" title="تجديد الاشتراك">
            <i class="fa-solid fa-arrows-rotate"></i>
            <span>تجديد</span>
          </button>
          <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="pg-card-icon" title="فتح واتساب">
            <i class="fa-brands fa-whatsapp text-emerald-400"></i>
          </a>
          <button type="button" onclick="checkInPlayerToday('${safeId}')" class="pg-card-icon ${checkedInToday ? 'is-checked' : ''}" title="${checkedInToday ? 'تم تسجيل الحضور اليوم' : 'تسجيل حضور اليوم'}">
            <i class="fa-solid fa-calendar-check"></i>
          </button>
          <button type="button" onclick="openIdCardModal('${safeId}')" class="pg-card-icon" title="بطاقة العضوية">
            <i class="fa-solid fa-id-card text-cyan-300"></i>
          </button>
          <button type="button" onclick="openPlayerCourseModal('${safeId}')" class="pg-card-icon" title="ملف الكورس">
            <i class="fa-solid fa-notes-medical text-sky-300"></i>
          </button>
        </div>
      </article>
    `;
  }).join('');

  tableBody.innerHTML = filtered.map(player => {
    const safeId = sanitizeId(player.id);
    const sub = getSubscriptionStatus(player.endDate);
    const isFrozen = frozenSet.has(String(player.id));
    const waLink = player.activationSent ? generateWhatsAppAlertLink(player) : generateWhatsAppLink(player);
    const avatarSrc = sanitizePhotoSource(player.photo);

    return `
      <tr class="hover:bg-slate-900/60 transition">
        <td class="p-3">
          <div class="flex items-center gap-2.5">
            <img src="${avatarSrc}" class="w-10 h-10 rounded-xl object-cover border border-cyan-500/40">
            <div>
              <div class="font-black text-white">${escapeHtml(player.name)}</div>
              <div class="text-[11px] text-slate-400">${Number(player.age)} سنة</div>
            </div>
          </div>
        </td>
        <td class="p-3">
          <span class="text-[11px] font-bold text-cyan-400 block" dir="ltr">${escapeHtml(player.code || 'PG')}</span>
          <span class="text-[11px] text-slate-400">${escapeHtml(player.planType || 'حديد عام')}</span>
        </td>
        <td class="p-3 font-bold text-slate-200" dir="ltr">${escapeHtml(player.phone)}</td>
        <td class="p-3">
          <div class="text-slate-300">من: ${escapeHtml(player.startDate)} (${Number(player.durationMonths) === 0.5 ? 'نصف شهر' : Number(player.durationMonths) + ' شهر'})</div>
          <div class="font-bold text-amber-400">ينتهي: ${escapeHtml(player.endDate)}</div>
        </td>
        <td class="p-3">
          <div class="text-emerald-400 font-bold">${Number(player.paidAmount || 0).toLocaleString('en-US')} د.ع</div>
          ${Number(player.debtAmount) > 0 ? `<div class="text-rose-400 text-[11px] font-black">دين: ${Number(player.debtAmount).toLocaleString('en-US')}</div>` : ''}
        </td>
        <td class="p-3">
          <span class="${isFrozen ? 'pg-badge pg-badge--frozen' : sub.badgeClass}">${isFrozen ? '❄️ مجمّد' : escapeHtml(sub.label)}</span>
        </td>
        <td class="p-3">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="sendSubscriptionAlertById('${safeId}')" class="bg-emerald-600 text-white p-2 rounded-lg" title="إشعار واتساب"><i class="fa-brands fa-whatsapp"></i></button>
            <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="bg-slate-800 text-emerald-400 p-2 rounded-lg" title="فتح واتساب"><i class="fa-solid fa-paper-plane"></i></a>
            <button type="button" onclick="openRenewModal('${safeId}')" class="bg-cyan-500/20 text-cyan-300 p-2 rounded-lg" title="تجديد"><i class="fa-solid fa-arrows-rotate"></i></button>
            <button type="button" onclick="openIdCardModal('${safeId}')" class="bg-purple-500/20 text-purple-300 p-2 rounded-lg" title="بطاقة العضوية"><i class="fa-solid fa-id-card"></i></button>
            <button type="button" onclick="openPlayerCourseModal('${safeId}')" class="bg-blue-500/20 text-blue-300 p-2 rounded-lg" title="ملف الكورس"><i class="fa-solid fa-notes-medical"></i></button>
            <button type="button" onclick="openEditModal('${safeId}')" class="bg-slate-800 text-slate-300 p-2 rounded-lg" title="تعديل"><i class="fa-solid fa-pen-to-square"></i></button>
            <button type="button" onclick="deletePlayer('${safeId}')" class="bg-rose-500/20 text-rose-400 p-2 rounded-lg" title="حذف"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ---------- Settings, Export & Import ----------
function openSettingsModal() {
  const { botToken, chatId } = getTelegramSettings();
  const btEl = document.getElementById('botTokenInput');
  const ciEl = document.getElementById('chatIdInput');
  if (btEl) btEl.value = botToken;
  if (ciEl) ciEl.value = chatId;
  updateSecurityPinStatus();
  document.getElementById('settingsModal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

function exportDatabase() {
  const backupData = {
    schemaVersion: SCHEMA_VERSION,
    gymProfile,
    financeLedger,
    exportedAt: new Date().toISOString(),
    players,
    advanced: {
      attendance: JSON.parse(localStorage.getItem('pg_attendance_v1') || '[]'),
      inventory: JSON.parse(localStorage.getItem('pg_inventory_v1') || '[]'),
      sales: JSON.parse(localStorage.getItem('pg_sales_v1') || '[]'),
      trainers: JSON.parse(localStorage.getItem('pg_trainers_v1') || '[]'),
      closes: JSON.parse(localStorage.getItem('pg_daily_closes_v1') || '[]')
    }
  };

  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `power_gym_backup_${getTodayDateString()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  logActivity('تحميل نسخة احتياطية محلية JSON');
  showToast('تم تحميل النسخة الاحتياطية لقاعدة البيانات بنجاح 💾', 'success');
}

function importDatabase(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      let rawText = String(e.target.result || '');
      const embeddedMatch = rawText.match(/<script id="power_gym_backup_json" type="application\/json">([\s\S]*?)<\/script>/i);
      if (embeddedMatch && embeddedMatch[1]) rawText = embeddedMatch[1];

      const imported = JSON.parse(rawText);
      const rawPlayers = Array.isArray(imported) ? imported : imported.players;
      if (!Array.isArray(rawPlayers)) {
        showToast('ملف النسخة الاحتياطية غير صالح!', 'error');
        return;
      }

      if (imported.gymProfile && typeof imported.gymProfile === 'object') {
        gymProfile = { ...gymProfile, ...imported.gymProfile };
        localStorage.setItem(STORAGE_KEYS.GYM_PROFILE, JSON.stringify(gymProfile));
        applyGymBrandingToUI();
      }
      if (imported.financeLedger && typeof imported.financeLedger === 'object') {
        financeLedger = { ...financeLedger, ...imported.financeLedger };
        saveFinanceLedgerToStorage();
      }
      if (imported.advanced && typeof imported.advanced === 'object') {
        const adv = imported.advanced;
        ['attendance', 'inventory', 'sales', 'trainers', 'closes'].forEach(k => {
          const key = `pg_${k === 'closes' ? 'daily_closes' : k}_v1`;
          if (Array.isArray(adv[k])) localStorage.setItem(key, JSON.stringify(adv[k]));
        });
      }

      players = rawPlayers.map(sanitizePlayerRecord).filter(Boolean);
      ensureUniquePlayerCodes(players);
      savePlayersToStorage();

      logActivity(`استرجاع نسخة احتياطية (${players.length} لاعب)`);
      showToast(`تم فحص واسترجاع بيانات ${players.length} لاعب بأمان تام ✅`, 'success');
      closeSettingsModal();
    } catch (err) {
      console.error(err);
      showToast('حدث خطأ أثناء قراءة ملف النسخة الاحتياطية!', 'error');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

function exportToExcelCSV() {
  if (players.length === 0) {
    showToast('لا توجد بيانات لتصديرها حالياً!', 'warning');
    return;
  }
  const headers = ['الكود', 'اسم اللاعب', 'العمر', 'الموبايل', 'القسم', 'تاريخ الاشتراك', 'المدة (أشهر)', 'شوكت يخلص (الانتهاء)', 'المبلغ المدفوع', 'الدين المتبقي', 'عدد الحضور', 'ملاحظات', 'ملاحظات الكورس', 'عدد صور الكورس'];
  const rows = players.map(p => [
    p.code || '',
    `"${String(p.name || '').replace(/"/g, '""')}"`,
    p.age || '',
    `"${p.phone || ''}"`,
    `"${p.planType || ''}"`,
    p.startDate || '',
    p.durationMonths || '',
    p.endDate || '',
    p.paidAmount || 0,
    p.debtAmount || 0,
    p.attendanceCount || 0,
    `"${String(p.notes || '').replace(/"/g, '""')}"`,
    `"${String(p.courseNotes || '').replace(/"/g, '""')}"`,
    Array.isArray(p.courseImages) ? p.courseImages.length : 0
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `قائمة_مشتركي_بور_جم_${getTodayDateString()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  logActivity('تصدير سجل اللاعبين بصيغة Excel CSV');
  showToast('تم تصدير جدول اللاعبين بصيغة Excel بنجاح 📊', 'success');
}

// ---------- App Startup ----------
document.addEventListener('DOMContentLoaded', () => {
  if (COACH_MODE) {
    rememberCoachGymIdFromLink();
    renderCoachMode();
    return;
  }

  loadDataFromStorage();
  applyGymBrandingToUI();
  runSmartSplashAnimation();
  checkSecurityLockOnStartup();
  updateBotIndicator();
  renderPlayers();
});
