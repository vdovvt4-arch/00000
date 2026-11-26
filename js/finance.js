'use strict';
// =========================================================
// Power Gym — Finance, Debts & Gym Customization (js/finance.js)
// =========================================================

function calculateFinancialMetrics() {
  let playersPaidTotal = 0;
  let playersDebtTotal = 0;

  players.forEach(p => {
    playersPaidTotal += Number(p.paidAmount) || 0;
    playersDebtTotal += Number(p.debtAmount) || 0;
  });

  let txIncome = 0;
  let txExpense = 0;
  (financeLedger.transactions || []).forEach(tx => {
    if (tx.type === 'expense') {
      txExpense += Number(tx.amount) || 0;
    } else if (tx.type === 'income' || !tx.type) {
      txIncome += Number(tx.amount) || 0;
    }
  });

  const manualProfit = Number(financeLedger.manualProfitAdjustment) || 0;
  const manualDebt = Number(financeLedger.manualDebtAdjustment) || 0;

  const netProfit = playersPaidTotal + txIncome + manualProfit - txExpense;
  const totalDebt = Math.max(0, playersDebtTotal + manualDebt);

  return {
    playersPaidTotal,
    playersDebtTotal,
    txIncome,
    txExpense,
    manualProfit,
    manualDebt,
    netProfit,
    totalDebt
  };
}

function openFinanceModal(defaultTab = 'profits') {
  document.getElementById('finManualProfitInput').value = financeLedger.manualProfitAdjustment || 0;
  document.getElementById('finManualDebtInput').value = financeLedger.manualDebtAdjustment || 0;
  document.getElementById('finDebtDate').value = getTodayDateString();

  document.getElementById('customGymNameInput').value = gymProfile.gymName;
  document.getElementById('customGymBranchInput').value = gymProfile.gymBranch;
  document.getElementById('customSupervisorNameInput').value = gymProfile.supervisorName || '';
  document.getElementById('customReceiptStampInput').value = gymProfile.receiptStamp || '';
  document.getElementById('priceMonthHalf').value = gymProfile.defaultPrices['0.5'] || 15000;
  document.getElementById('priceMonth1').value = gymProfile.defaultPrices['1'] || 25000;
  document.getElementById('priceMonth2').value = gymProfile.defaultPrices['2'] || 45000;
  document.getElementById('priceMonth3').value = gymProfile.defaultPrices['3'] || 65000;
  document.getElementById('priceMonth6').value = gymProfile.defaultPrices['6'] || 120000;
  document.getElementById('priceMonth12').value = gymProfile.defaultPrices['12'] || 220000;

  renderFinanceSummary();
  renderFinancePlayersList();
  switchFinanceTab(defaultTab);
  document.getElementById('financeModal').classList.remove('hidden');
}

function closeFinanceModal() {
  document.getElementById('financeModal').classList.add('hidden');
}

function switchFinanceTab(tabName) {
  ['profits', 'debts', 'customize'].forEach(t => {
    const btn = document.getElementById(`finTabBtn-${t}`);
    const content = document.getElementById(`finTabContent-${t}`);
    if (!btn || !content) return;
    if (t === tabName) {
      btn.className = 'px-4 py-2 rounded-xl text-xs font-black gold-gradient text-slate-950 transition whitespace-nowrap';
      content.classList.remove('hidden');
    } else {
      btn.className = 'px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 transition whitespace-nowrap';
      content.classList.add('hidden');
    }
  });
}

function renderFinanceSummary() {
  const m = calculateFinancialMetrics();
  const paidEl = document.getElementById('finPlayersPaidTotal');
  const extraEl = document.getElementById('finExtraIncomeTotal');
  const expEl = document.getElementById('finExpensesTotal');
  const netEl = document.getElementById('finNetProfitDisplay');
  const debtBannerEl = document.getElementById('finTotalDebtBanner');

  if (paidEl) paidEl.textContent = `${m.playersPaidTotal.toLocaleString('en-US')} د.ع`;
  if (extraEl) extraEl.textContent = `${(m.txIncome + m.manualProfit).toLocaleString('en-US')} د.ع`;
  if (expEl) expEl.textContent = `${m.txExpense.toLocaleString('en-US')} د.ع`;
  if (netEl) netEl.textContent = `${m.netProfit.toLocaleString('en-US')} د.ع`;
  if (debtBannerEl) debtBannerEl.textContent = `${m.totalDebt.toLocaleString('en-US')} د.ع`;

  const txListEl = document.getElementById('finTransactionsList');
  if (!txListEl) return;

  if (!financeLedger.transactions || financeLedger.transactions.length === 0) {
    txListEl.innerHTML = `<p class="text-[11px] text-slate-500 text-center py-2">لا توجد حركات مالية إضافية مسجلة.</p>`;
  } else {
    txListEl.innerHTML = financeLedger.transactions.map(tx => `
      <div class="flex items-center justify-between bg-slate-950/90 border border-slate-800 px-3 py-2 rounded-xl text-xs">
        <div class="flex items-center gap-2">
          <span class="px-2 py-0.5 rounded text-[10px] font-black ${tx.type === 'expense' ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}">
            ${tx.type === 'expense' ? 'مصروف ➖' : 'إيراد ➕'}
          </span>
          <span class="font-bold text-white">${escapeHtml(tx.title || tx.description || 'حركة مالية')}</span>
          <span class="text-[10px] text-slate-500" dir="ltr">${escapeHtml(tx.date || '')}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-black ${tx.type === 'expense' ? 'text-rose-400' : 'text-emerald-400'}">${Number(tx.amount).toLocaleString('en-US')} د.ع</span>
          <button onclick="deleteFinanceTransaction('${sanitizeId(tx.id)}')" class="text-rose-400 hover:text-rose-300 p-1">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
    `).join('');
  }
}

function saveManualFinanceAdjustments() {
  const manualProfit = Number(document.getElementById('finManualProfitInput').value) || 0;
  const manualDebt = Number(document.getElementById('finManualDebtInput').value) || 0;

  financeLedger.manualProfitAdjustment = manualProfit;
  financeLedger.manualDebtAdjustment = manualDebt;
  saveFinanceLedgerToStorage();
  renderFinanceSummary();
  logActivity(`تعديل يدوي للأرباح (${manualProfit} د.ع) والديون (${manualDebt} د.ع)`);
  showToast('تم حفظ تعديلات الأرباح والديون بنجاح 💰✅', 'success');
}

function addFinanceTransaction() {
  const title = document.getElementById('finTxTitle').value.trim();
  const type = document.getElementById('finTxType').value === 'expense' ? 'expense' : 'income';
  const amount = Math.max(0, Number(document.getElementById('finTxAmount').value) || 0);

  if (!title || amount <= 0) {
    showToast('يرجى إدخال وصف الحركة والمبلغ بشكل صحيح!', 'warning');
    return;
  }

  const tx = {
    id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    title: title.slice(0, 100),
    type,
    amount,
    date: getTodayDateString()
  };

  financeLedger.transactions.unshift(tx);
  document.getElementById('finTxTitle').value = '';
  document.getElementById('finTxAmount').value = '';

  saveFinanceLedgerToStorage();
  renderFinanceSummary();
  logActivity(`إضافة حركة مالية (${type === 'expense' ? 'مصروف' : 'إيراد'}): ${tx.title} (${amount} د.ع)`);
  showToast('تمت إضافة الحركة المالية وتحديث صافي الأرباح بنجاح ✅', 'success');
}

function deleteFinanceTransaction(txId) {
  financeLedger.transactions = (financeLedger.transactions || []).filter(t => t.id !== txId);
  saveFinanceLedgerToStorage();
  renderFinanceSummary();
  showToast('تم حذف الحركة المالية وتحديث الأرباح', 'info');
}

function renderFinancePlayersList() {
  const listEl = document.getElementById('financePlayersDebtList');
  if (!listEl) return;

  const debtPlayerSelect = document.getElementById('finDebtPlayerId');
  if (debtPlayerSelect) {
    const selectedPlayerId = debtPlayerSelect.value;
    debtPlayerSelect.innerHTML = players.length
      ? players.map(p => `<option value="${escapeHtml(sanitizeId(p.id))}">${escapeHtml(p.name)} (${escapeHtml(p.code)})</option>`).join('')
      : '<option value="">لا يوجد لاعبون مسجلون</option>';
    if (players.some(p => p.id === selectedPlayerId)) debtPlayerSelect.value = selectedPlayerId;
  }

  const q = (document.getElementById('finDebtSearchInput')?.value || '').trim().toLowerCase();
  const onlyDebtors = document.getElementById('finOnlyDebtorsCheckbox')?.checked;

  const filtered = players.filter(p => {
    if (onlyDebtors && (Number(p.debtAmount) || 0) <= 0) return false;
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.phone.includes(q) || (p.code && p.code.toLowerCase().includes(q));
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="text-center text-slate-400 py-6 text-xs">لا يوجد لاعبون مطابقون للبحث.</p>`;
    return;
  }

  listEl.innerHTML = filtered.map(p => {
    const safeId = sanitizeId(p.id);
    const hasDebt = (Number(p.debtAmount) || 0) > 0;
    const playerEntries = (financeLedger.debtEntries || [])
      .filter(entry => entry.playerId === p.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const playerPayments = (financeLedger.debtPayments || [])
      .filter(payment => payment.playerId === p.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const trackedDebt = playerEntries.reduce((total, entry) =>
      total + Math.max(0, Number(entry.amount) - Number(entry.paidAmount || 0)), 0);
    const untrackedDebt = Math.max(0, (Number(p.debtAmount) || 0) - trackedDebt);
    return `
      <div class="bg-slate-950/85 border ${hasDebt ? 'border-rose-500/40' : 'border-slate-800'} rounded-2xl p-3 flex flex-col items-stretch gap-3 text-xs">
        <div class="flex items-center gap-2.5 w-full md:w-auto">
          <span class="px-2 py-0.5 rounded bg-slate-800 text-cyan-400 font-black" dir="ltr">${escapeHtml(p.code)}</span>
          <div>
            <div class="font-black text-white text-sm">${escapeHtml(p.name)}</div>
            <div class="text-[11px] text-slate-400">${escapeHtml(p.phone)} | ينتهي: ${escapeHtml(p.endDate)}</div>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          <div>
            <label class="block text-[10px] text-emerald-400 font-bold">المدفوع (د.ع)</label>
            <input type="number" id="quickPaid_${safeId}" value="${Number(p.paidAmount) || 0}" step="500" min="0" class="w-28 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-bold">
          </div>
          <div>
            <label class="block text-[10px] text-rose-400 font-bold">الدين المتبقي (د.ع)</label>
            <input type="number" id="quickDebt_${safeId}" value="${Number(p.debtAmount) || 0}" step="500" min="0" class="w-28 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-bold">
          </div>
          <button onclick="updatePlayerFinanceQuick('${safeId}')" class="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black px-3 py-2 rounded-xl mt-3.5 transition">
            حفظ 💾
          </button>
          ${hasDebt ? `
            <button onclick="settlePlayerDebtFull('${safeId}')" class="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black px-3 py-2 rounded-xl mt-3.5 transition" title="تحويل كامل الدين إلى المبلغ المدفوع وتصفير الدين">
              تسديد كامل ✅
            </button>
          ` : ''}
          ${hasDebt ? `
            <button type="button" onclick="sendPlayerDebtReminderById('${safeId}', 'whatsapp')" class="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-black px-3 py-2 rounded-xl mt-3.5 transition" title="إرسال تذكير الدين عبر واتساب">
              <i class="fa-brands fa-whatsapp ml-1" aria-hidden="true"></i>إشعار دين واتساب
            </button>
          ` : ''}
          ${hasDebt ? `
            <div class="flex items-end gap-1.5">
              <div>
                <label class="block text-[10px] text-blue-300 font-bold">تحصيل جزئي (د.ع)</label>
                <input type="number" id="debtPayment_${safeId}" min="1" max="${Number(p.debtAmount) || 0}" step="500" placeholder="المبلغ" class="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-bold">
              </div>
              <button onclick="recordPlayerDebtPayment('${safeId}')" class="bg-blue-600 hover:bg-blue-500 text-white font-black px-3 py-2 rounded-xl transition">
                تحصيل
              </button>
            </div>
          ` : ''}
        </div>
        <details class="w-full border-t border-slate-800 pt-2">
          <summary class="cursor-pointer text-rose-300 font-bold">
            سجل المشتريات والديون (${playerEntries.length}) — ${trackedDebt.toLocaleString('en-US')} د.ع مسجل
          </summary>
          <div class="space-y-2 mt-2">
            ${untrackedDebt > 0 ? `<div class="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-2 text-[11px] text-cyan-200">رصيد سابق غير مفصل: ${untrackedDebt.toLocaleString('en-US')} د.ع — لا تتوفر له تفاصيل مشتريات محفوظة.</div>` : ''}
            ${playerEntries.length ? playerEntries.map(entry => {
              const remaining = Math.max(0, Number(entry.amount) - Number(entry.paidAmount || 0));
              return `<div class="bg-slate-900 border border-slate-800 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-[180px]">
                  <div class="font-black text-white">${escapeHtml(entry.description)}</div>
                  <div class="text-[10px] text-slate-400">${escapeHtml(entry.date)}${entry.notes ? ` · ${escapeHtml(entry.notes)}` : ''}</div>
                </div>
                <div class="text-[10px] text-slate-300">الأصل: ${Number(entry.amount).toLocaleString('en-US')} · المسدد: ${Number(entry.paidAmount || 0).toLocaleString('en-US')} · <b class="text-rose-300">المتبقي: ${remaining.toLocaleString('en-US')} د.ع</b></div>
              </div>`;
            }).join('') : '<p class="text-[11px] text-slate-500">لا توجد تفاصيل مشتريات مسجلة لهذا اللاعب بعد.</p>'}
            ${playerPayments.length ? `<div class="border-t border-slate-800 pt-2 mt-2">
              <p class="text-[10px] font-black text-emerald-300 mb-1">سجل التحصيلات</p>
              ${playerPayments.map(payment => `<p class="text-[10px] text-slate-300">${escapeHtml(payment.date)} · تحصيل ${Number(payment.amount).toLocaleString('en-US')} د.ع</p>`).join('')}
            </div>` : ''}
          </div>
        </details>
      </div>
    `;
  }).join('');
}

function persistPlayerDebtUpdate(playerId, previousPlayer, previousLedger) {
  const previousPlayersStorage = localStorage.getItem(STORAGE_KEYS.PLAYERS);
  const previousLedgerStorage = localStorage.getItem(STORAGE_KEYS.FINANCE_LEDGER);
  try {
    localStorage.setItem(STORAGE_KEYS.FINANCE_LEDGER, JSON.stringify(financeLedger));
    localStorage.setItem(STORAGE_KEYS.PLAYERS, JSON.stringify(players));
  } catch (error) {
    const player = players.find(p => p.id === playerId);
    if (player) Object.assign(player, previousPlayer);
    financeLedger = previousLedger;
    try {
      if (previousLedgerStorage === null) localStorage.removeItem(STORAGE_KEYS.FINANCE_LEDGER);
      else localStorage.setItem(STORAGE_KEYS.FINANCE_LEDGER, previousLedgerStorage);
      if (previousPlayersStorage === null) localStorage.removeItem(STORAGE_KEYS.PLAYERS);
      else localStorage.setItem(STORAGE_KEYS.PLAYERS, previousPlayersStorage);
    } catch (restoreError) {
      console.error('Could not restore player debt data after a failed save:', restoreError);
    }
    console.error('Could not save player debt data:', error);
    showToast('تعذر حفظ الدين أو التحصيل. لم يتم اعتماد التغيير؛ تحقق من مساحة التخزين.', 'error');
    return false;
  }
  renderPlayers();
  renderFinanceSummary();
  renderFinancePlayersList();
  return true;
}

function addPlayerDebtEntry() {
  const playerId = sanitizeId(document.getElementById('finDebtPlayerId').value);
  const player = players.find(p => p.id === playerId);
  const description = document.getElementById('finDebtDescription').value.trim().slice(0, 100);
  const amount = Number(document.getElementById('finDebtAmount').value);
  const date = document.getElementById('finDebtDate').value;
  const notes = document.getElementById('finDebtNotes').value.trim().slice(0, 160);
  if (!player || !description || !Number.isSafeInteger(amount) || amount <= 0 || !isValidDateString(date)) {
    showToast('اختر لاعباً وأدخل وصفاً ومبلغاً صحيحاً وتاريخاً صالحاً.', 'warning');
    return;
  }

  const previousPlayer = JSON.parse(JSON.stringify(player));
  const previousLedger = JSON.parse(JSON.stringify(financeLedger));
  const entry = {
    id: `debt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    playerId,
    description,
    amount,
    paidAmount: 0,
    date,
    notes,
    createdAt: new Date().toISOString()
  };
  financeLedger.debtEntries = Array.isArray(financeLedger.debtEntries) ? financeLedger.debtEntries : [];
  financeLedger.debtEntries.unshift(entry);
  player.debtAmount = (Number(player.debtAmount) || 0) + amount;
  player.updatedAt = new Date().toISOString();
  if (!persistPlayerDebtUpdate(playerId, previousPlayer, previousLedger)) return;

  document.getElementById('finDebtDescription').value = '';
  document.getElementById('finDebtAmount').value = '';
  document.getElementById('finDebtNotes').value = '';
  logActivity(`تسجيل دين للاعب ${player.name}: ${description} (${amount} د.ع)`);
  showToast(`تم تسجيل "${description}" وإضافته إلى دين ${player.name}.`, 'success');
  notifyPlayerAboutDebt(player, 'debt', description, amount);
}

function recordPlayerDebtPayment(playerId, requestedAmount = null) {
  const player = players.find(p => p.id === playerId);
  if (!player) return;
  const input = requestedAmount === null ? document.getElementById(`debtPayment_${sanitizeId(playerId)}`) : null;
  const amount = requestedAmount === null ? Number(input?.value) : Number(requestedAmount);
  const currentDebt = Number(player.debtAmount) || 0;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > currentDebt) {
    showToast(`أدخل مبلغاً صحيحاً لا يتجاوز الدين الحالي (${currentDebt.toLocaleString('en-US')} د.ع).`, 'warning');
    return;
  }

  const previousPlayer = JSON.parse(JSON.stringify(player));
  const previousLedger = JSON.parse(JSON.stringify(financeLedger));
  let remainingPayment = amount;
  const entries = (financeLedger.debtEntries || [])
    .filter(entry => entry.playerId === playerId)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  entries.forEach(entry => {
    const outstanding = Math.max(0, Number(entry.amount) - Number(entry.paidAmount || 0));
    const applied = Math.min(outstanding, remainingPayment);
    entry.paidAmount = (Number(entry.paidAmount) || 0) + applied;
    remainingPayment -= applied;
  });

  player.debtAmount = currentDebt - amount;
  player.paidAmount = (Number(player.paidAmount) || 0) + amount;
  player.updatedAt = new Date().toISOString();
  financeLedger.debtPayments = Array.isArray(financeLedger.debtPayments) ? financeLedger.debtPayments : [];
  financeLedger.debtPayments.unshift({
    id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    playerId,
    title: `تحصيل دين: ${player.name}`,
    amount,
    date: getTodayDateString()
  });
  if (!persistPlayerDebtUpdate(playerId, previousPlayer, previousLedger)) return;

  logActivity(`تحصيل ${amount} د.ع من دين اللاعب ${player.name}`);
  showToast(`تم تسجيل تحصيل ${amount.toLocaleString('en-US')} د.ع من ${player.name}.`, 'success');
  notifyPlayerAboutDebt(player, 'payment', 'تسديد من رصيد الدين', amount);
}

function updatePlayerFinanceQuick(playerId) {
  const idx = players.findIndex(p => p.id === playerId);
  if (idx === -1) return;

  const paidInput = document.getElementById(`quickPaid_${playerId}`);
  const debtInput = document.getElementById(`quickDebt_${playerId}`);
  if (!paidInput || !debtInput) return;

  players[idx].paidAmount = Math.max(0, Number(paidInput.value) || 0);
  players[idx].debtAmount = Math.max(0, Number(debtInput.value) || 0);
  players[idx].updatedAt = new Date().toISOString();

  savePlayersToStorage();
  renderFinanceSummary();
  renderFinancePlayersList();
  logActivity(`تعديل مالي للاعب ${players[idx].name}: مدفوع=${players[idx].paidAmount}، دين=${players[idx].debtAmount}`);
  showToast(`تم تحديث الحساب المالي للبطل "${players[idx].name}" بنجاح ✅`, 'success');
}

function settlePlayerDebtFull(playerId) {
  const idx = players.findIndex(p => p.id === playerId);
  if (idx === -1) return;
  const debt = Number(players[idx].debtAmount) || 0;
  if (debt <= 0) return;
  recordPlayerDebtPayment(playerId, debt);
}

function saveGymCustomization() {
  gymProfile.gymName = document.getElementById('customGymNameInput').value.trim() || 'Power Gym | بور جم';
  gymProfile.gymBranch = document.getElementById('customGymBranchInput').value.trim() || 'كربلاء - الحر - قرب فلكة الثورة';
  gymProfile.supervisorName = document.getElementById('customSupervisorNameInput').value.trim().slice(0, 60);
  gymProfile.receiptStamp = document.getElementById('customReceiptStampInput').value.trim().slice(0, 100);
  gymProfile.defaultPrices = {
    '0.5': Math.max(0, Number(document.getElementById('priceMonthHalf')?.value) || 15000),
    '1': Math.max(0, Number(document.getElementById('priceMonth1').value) || 25000),
    '2': Math.max(0, Number(document.getElementById('priceMonth2').value) || 45000),
    '3': Math.max(0, Number(document.getElementById('priceMonth3').value) || 65000),
    '6': Math.max(0, Number(document.getElementById('priceMonth6').value) || 120000),
    '12': Math.max(0, Number(document.getElementById('priceMonth12').value) || 220000)
  };

  localStorage.setItem(STORAGE_KEYS.GYM_PROFILE, JSON.stringify(gymProfile));
  applyGymBrandingToUI();
  logActivity('تم تحديث تخصيص اسم الجيم وأسعار الاشتراكات الافتراضية');
  showToast('تم حفظ تخصيص القاعة وأسعار الاشتراكات بنجاح ⚙️✅', 'success');
}
