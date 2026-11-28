'use strict';
// =========================================================
// Power Gym — WhatsApp Alerts & Legacy Bot Helpers (js/telegram.js)
// =========================================================

function toggleTokenVisibility() {
  const input = document.getElementById('botTokenInput');
  const icon = document.getElementById('tokenEyeIcon');
  if (!input || !icon) return;
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'fa-solid fa-eye';
  }
}

function getTelegramSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return { botToken: '', chatId: '' };
    const parsed = JSON.parse(raw);
    return {
      botToken: String(parsed.botToken || '').trim(),
      chatId: String(parsed.chatId || '').trim()
    };
  } catch {
    return { botToken: '', chatId: '' };
  }
}

async function autoDetectChatId(silent = false) {
  const tokenInput = document.getElementById('botTokenInput')?.value.trim();
  const botToken = tokenInput || getTelegramSettings().botToken;
  if (!botToken) {
    if (!silent) showToast('أدخل توكن البوت الجديد من الإعدادات أولاً.', 'warning');
    return '';
  }
  try {
    let res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
    let data = await res.json();
    if (!data.ok && data.error_code === 409) {
      await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
      res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
      data = await res.json();
    }
    if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
      for (let i = data.result.length - 1; i >= 0; i--) {
        const upd = data.result[i];
        const chat = upd.message?.chat || upd.channel_post?.chat || upd.my_chat_member?.chat || upd.callback_query?.message?.chat;
        if (chat && chat.id) {
          const detectedId = String(chat.id);
          const btEl = document.getElementById('botTokenInput');
          const ciEl = document.getElementById('chatIdInput');
          if (btEl) btEl.value = botToken;
          if (ciEl) ciEl.value = detectedId;
          localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ botToken, chatId: detectedId }));
          updateBotIndicator();
          return detectedId;
        }
      }
    }
  } catch (err) {
    console.error('Auto detect chat ID error:', err);
  }
  return '';
}

function updateBotIndicator() {
  const { botToken, chatId } = getTelegramSettings();
  const dot = document.getElementById('botStatusDot');
  const badgeMobile = document.getElementById('botStatusBadgeMobile');
  if (!dot || !badgeMobile) return;
  if (botToken && chatId) {
    dot.classList.remove('bg-red-500');
    dot.classList.add('bg-emerald-500');
    badgeMobile.textContent = 'البوت جاهز 🟢';
  } else {
    dot.classList.remove('bg-emerald-500');
    dot.classList.add('bg-red-500');
    badgeMobile.textContent = 'البوت غير مضبوط 🔴';
  }
}

function handlePhoneInputLookup(phoneVal) {
  const intl = formatIraqiPhone(phoneVal);
  const badge = document.getElementById('playerTelegramLinkBadge');
  const chatInput = document.getElementById('playerChatIdInput');
  if (!badge || !chatInput) return;

  const matched = telegramDirectory?.phoneToChatId?.[intl];
  if (matched && matched.chatId) {
    chatInput.value = matched.chatId;
    badge.textContent = `🟢 رقم اللاعب مربوط بالبوت تلقائياً (ID: ${matched.chatId})`;
  } else {
    badge.textContent = '';
  }
}

let isPollingBotUpdates = false;
async function pollBotUpdatesForPlayers() {
  if (isPollingBotUpdates) return;
  const { botToken } = getTelegramSettings();
  if (!botToken) return;
  isPollingBotUpdates = true;
  try {
    const offsetParam = telegramDirectory.lastUpdateOffset ? `?offset=${telegramDirectory.lastUpdateOffset}` : '';
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates${offsetParam}`);
    const data = await res.json();
    if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
      let linked = 0;
      for (const upd of data.result) {
        telegramDirectory.lastUpdateOffset = Math.max(telegramDirectory.lastUpdateOffset || 0, upd.update_id + 1);
        const msg = upd.message;
        if (!msg || !msg.chat || !msg.chat.id) continue;
        const contactPhone = msg.contact?.phone_number || '';
        const text = String(msg.text || '').trim();
        let detectedPhone = contactPhone ? formatIraqiPhone(contactPhone) : (/07\d{8,9}|9647\d{8,9}/.test(text.replace(/\s+/g, '')) ? formatIraqiPhone(text) : '');
        if (detectedPhone && detectedPhone.length >= 10) {
          telegramDirectory.phoneToChatId[detectedPhone] = {
            chatId: String(msg.chat.id),
            firstName: msg.from?.first_name || '',
            username: msg.from?.username || '',
            linkedAt: new Date().toISOString()
          };
          const matchedPlayer = players.find(p => formatIraqiPhone(p.phone) === detectedPhone);
          if (matchedPlayer) {
            matchedPlayer.playerChatId = String(msg.chat.id);
            linked++;
          }
        }
      }
      saveTelegramDirectoryToStorage();
      if (linked > 0) savePlayersToStorage();
    }
  } catch { /* silent */ } finally {
    isPollingBotUpdates = false;
  }
}

function notifyPlayerAboutDebt(player, action, description, amount) {
  const intlPhone = formatIraqiPhone(player.phone);
  if (/^9647\d{9}$/.test(intlPhone)) {
    const whatsappText = `السلام عليكم كابتن ${player.name}، تم ${action === 'payment' ? 'تسجيل تسديد دين' : 'تسجيل مشتريات/دين'} في ${gymProfile.gymName}.\n📦 التفاصيل: ${description}\n💵 المبلغ: ${Number(amount).toLocaleString('en-US')} د.ع\n⚠️ الرصيد المتبقي: ${Number(player.debtAmount || 0).toLocaleString('en-US')} د.ع\n🆔 رقم العضوية: ${player.code}`;
    const whatsappUrl = `https://wa.me/${intlPhone}?text=${encodeURIComponent(whatsappText)}`;
    const openedInNewTab = openWhatsAppLink(whatsappUrl);
    showToast(
      openedInNewTab
        ? `فُتح WhatsApp لإرسال إشعار ${action === 'payment' ? 'التسديد' : 'الدين'} إلى ${player.name} ✅`
        : `جارٍ فتح WhatsApp لإشعار ${player.name}...`,
      'success'
    );
    return;
  }
  showToast(`لم يتم فتح واتساب لـ ${player.name}: رقم الهاتف غير صالح.`, 'warning');
}

async function sendPlayerDebtReminderById(playerId) {
  const player = players.find(item => item.id === sanitizeId(playerId));
  if (!player) return;
  const debt = Number(player.debtAmount) || 0;
  if (debt <= 0) {
    showToast(`لا يوجد دين مستحق على ${player.name}.`, 'info');
    return;
  }
  const intlPhone = formatIraqiPhone(player.phone);
  if (!/^9647\d{9}$/.test(intlPhone)) {
    showToast(`رقم هاتف ${player.name} غير صالح؛ حدّث الرقم العراقي أولاً.`, 'warning');
    return;
  }
  const plainText = [
    `السلام عليكم ${player.name}،`,
    `تذكير من ${gymProfile.gymName} بوجود رصيد مستحق على حسابك.`,
    `💰 الرصيد المتبقي: ${debt.toLocaleString('en-US')} د.ع`,
    `🆔 رقم العضوية: ${player.code}`,
    'إذا تم التسديد، يرجى إبلاغ الإدارة لتحديث الحساب.'
  ].join('\n');
  openWhatsAppLink(`https://wa.me/${intlPhone}?text=${encodeURIComponent(plainText)}`);
  logActivity(`فتح تذكير دين عبر WhatsApp للاعب: ${player.name}`);
  showToast('فُتحت رسالة الدين في واتساب؛ راجعها واضغط إرسال.', 'success');
}

function generateWhatsAppAlertLink(player) {
  const intlPhone = formatIraqiPhone(player.phone);
  const sub = getSubscriptionStatus(player.endDate);
  const debt = Number(player.debtAmount) || 0;
  const statusLine =
    sub.diffDays === 0 ? `⚠️ اشتراكك ينتهي اليوم!` :
    sub.diffDays === 1 ? `⏳ باقي يوم واحد على انتهاء اشتراكك (ينتهي غداً)` :
    sub.status === 'expired' ? `⛔ انتهى اشتراكك منذ ${Math.abs(sub.diffDays)} يوم` :
    sub.status === 'soon' ? `⏳ باقي ${sub.diffDays} يوم على انتهاء اشتراكك` :
    `✅ اشتراكك فعّال (باقي ${sub.diffDays} يوم)`;
  const message = [
    `السلام عليكم كابتن ${player.name} الحبيب 💪`,
    `🔔 تنبيه اشتراك من *${gymProfile.gymName}*`,
    statusLine,
    `🏁 تاريخ الانتهاء: ${player.endDate}`,
    debt > 0 ? `💰 المتبقي عليك: ${debt.toLocaleString('en-US')} د.ع` : '',
    sub.status === 'active' ? 'نتمنى لك تمريناً موفقاً 🏋️‍♂️' : 'ننتظرك لتجديد الاشتراك يا بطل 🔥'
  ].filter(Boolean).join('\n');
  return `https://wa.me/${intlPhone}?text=${encodeURIComponent(message)}`;
}

async function sendSubscriptionAlertById(playerId) {
  const player = players.find(p => p.id === playerId);
  if (!player) return;
  const intlPhone = formatIraqiPhone(player.phone);
  if (!/^9647\d{9}$/.test(intlPhone)) {
    showToast(`رقم هاتف ${player.name} غير صالح لإرسال إشعار واتساب`, 'warning');
    return;
  }
  logActivity(`إرسال إشعار اشتراك عبر واتساب للاعب: ${player.name}`);
  openWhatsAppLink(generateWhatsAppAlertLink(player));
  showToast(`تم فتح واتساب لإرسال الإشعار إلى "${player.name}" ✅`, 'success');
}

async function sendThreeDayReminderToPlayerById(playerId) {
  return sendSubscriptionAlertById(playerId);
}

async function sendPlayerActivationMessageById(playerId) {
  return sendSubscriptionAlertById(playerId);
}

async function sendDirectTelegramMessageToPlayer(player, htmlText) {
  const { botToken } = getTelegramSettings();
  const chatId = player?.playerChatId || telegramDirectory?.phoneToChatId?.[formatIraqiPhone(player?.phone)]?.chatId || '';
  if (!botToken || !chatId || !htmlText) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: htmlText, parse_mode: 'HTML' })
    });
    const data = await res.json().catch(() => ({}));
    return Boolean(data && data.ok);
  } catch {
    return false;
  }
}

async function runThreeDayCountdownReminders() {
  // التذكيرات تُدار عبر مركز الواتساب الذكي (smart-ops.js)
}

function saveSettings() {
  const botToken = document.getElementById('botTokenInput')?.value.trim() || '';
  const chatId = document.getElementById('chatIdInput')?.value.trim() || '';
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ botToken, chatId }));
  updateBotIndicator();
  showToast('تم حفظ الإعدادات بنجاح ✅', 'success');
  if (typeof closeSettingsModal === 'function') closeSettingsModal();
}
