'use strict';
// =========================================================
// Power Gym — Data Foundation, Schema Validation & Migration (v3.0.0)
// =========================================================
(function () {
  const SCHEMA_META_KEY = 'power_gym_schema_meta_v3';
  const CURRENT_SCHEMA_NUM = 3;

  function safeParse(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function safeWrite(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('PGDataFoundation write failed:', key, err);
      return false;
    }
  }

  function createEntityId(prefix) {
    const p = String(prefix || 'pg').replace(/[^a-zA-Z0-9_-]/g, '');
    const rand = Math.random().toString(36).slice(2, 8);
    return `${p}_${Date.now().toString(36)}_${rand}`;
  }

  function toNum(val, fallback) {
    const n = Number(val);
    return Number.isFinite(n) ? n : (fallback || 0);
  }

  function toIsoDate(val, fallback) {
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
      return val.slice(0, 10);
    }
    return fallback || new Date().toISOString().slice(0, 10);
  }

  function normalizePlayer(raw) {
    const p = raw && typeof raw === 'object' ? raw : {};
    const nowIso = new Date().toISOString();
    const startDate = toIsoDate(p.startDate);
    const durationMonths = toNum(p.durationMonths, 1) > 0 ? toNum(p.durationMonths, 1) : 1;
    let endDate = toIsoDate(p.endDate, '');
    if (!endDate) {
      const d = new Date(startDate);
      if (durationMonths === 0.5) {
        d.setDate(d.getDate() + 15);
      } else {
        d.setMonth(d.getMonth() + Math.round(durationMonths));
      }
      endDate = d.toISOString().slice(0, 10);
    }
    return {
      ...p,
      id: String(p.id || createEntityId('mem')),
      code: String(p.code || '').trim(),
      name: String(p.name || 'مشترك').trim(),
      phone: String(p.phone || '').trim(),
      planType: String(p.planType || 'حديد وكارديو').trim(),
      durationMonths,
      startDate,
      endDate,
      paidAmount: Math.max(0, toNum(p.paidAmount, 0)),
      debtAmount: Math.max(0, toNum(p.debtAmount, 0)),
      createdAt: p.createdAt || nowIso,
      updatedAt: p.updatedAt || nowIso,
      schemaVersion: CURRENT_SCHEMA_NUM
    };
  }

  function normalizeInventoryItem(raw) {
    const it = raw && typeof raw === 'object' ? raw : {};
    const nowIso = new Date().toISOString();
    return {
      ...it,
      id: String(it.id || createEntityId('inv')),
      name: String(it.name || 'منتج').trim(),
      category: String(it.category || 'مكملات').trim(),
      sku: String(it.sku || '').trim(),
      qty: Math.max(0, Math.round(toNum(it.qty, 0))),
      minQty: Math.max(0, Math.round(toNum(it.minQty, 3))),
      cost: Math.max(0, toNum(it.cost, 0)),
      price: Math.max(0, toNum(it.price, 0)),
      showInStore: it.showInStore !== false,
      updatedAt: it.updatedAt || nowIso
    };
  }

  function normalizeSale(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const qty = Math.max(1, Math.round(toNum(s.qty, 1)));
    const unitPrice = Math.max(0, toNum(s.unitPrice, toNum(s.price, 0)));
    const unitCost = Math.max(0, toNum(s.unitCost, toNum(s.cost, 0)));
    const total = toNum(s.total, qty * unitPrice);
    const profit = s.profit != null ? toNum(s.profit, 0) : Math.max(0, total - qty * unitCost);
    return {
      ...s,
      id: String(s.id || createEntityId('sale')),
      itemId: String(s.itemId || ''),
      itemName: String(s.itemName || s.name || 'مبيع').trim(),
      category: String(s.category || 'عام').trim(),
      qty,
      unitPrice,
      unitCost,
      total,
      profit,
      source: String(s.source || 'pos').trim(),
      date: toIsoDate(s.date),
      createdAt: s.createdAt || new Date().toISOString()
    };
  }

  function dedupeById(list, normalizer) {
    if (!Array.isArray(list)) return [];
    const seen = new Map();
    for (const item of list) {
      const normalized = normalizer(item);
      seen.set(normalized.id, normalized);
    }
    return Array.from(seen.values());
  }

  function normalizeFinanceLedger(raw) {
    const l = raw && typeof raw === 'object' ? raw : {};
    return {
      manualProfitAdjustment: toNum(l.manualProfitAdjustment, 0),
      manualDebtAdjustment: toNum(l.manualDebtAdjustment, 0),
      transactions: Array.isArray(l.transactions) ? l.transactions : [],
      debtEntries: Array.isArray(l.debtEntries) ? l.debtEntries : [],
      debtPayments: Array.isArray(l.debtPayments) ? l.debtPayments : [],
      renewals: Array.isArray(l.renewals) ? l.renewals : [],
      receipts: Array.isArray(l.receipts) ? l.receipts : [],
      receiptCounter: Math.max(0, Math.round(toNum(l.receiptCounter, 0))),
      receiptSettings: l.receiptSettings && typeof l.receiptSettings === 'object' ? l.receiptSettings : {}
    };
  }

  function migrateAndNormalize() {
    const report = {
      schemaVersion: CURRENT_SCHEMA_NUM,
      migratedAt: new Date().toISOString(),
      counts: {}
    };

    const rawPlayers = safeParse('power_gym_players_v1', []);
    const cleanPlayers = dedupeById(rawPlayers, normalizePlayer);
    if (Array.isArray(rawPlayers) && JSON.stringify(rawPlayers) !== JSON.stringify(cleanPlayers)) {
      safeWrite('power_gym_players_v1', cleanPlayers);
    }
    report.counts.players = cleanPlayers.length;

    const rawInv = safeParse('pg_inventory_v1', []);
    const cleanInv = dedupeById(rawInv, normalizeInventoryItem);
    if (Array.isArray(rawInv) && JSON.stringify(rawInv) !== JSON.stringify(cleanInv)) {
      safeWrite('pg_inventory_v1', cleanInv);
    }
    report.counts.inventory = cleanInv.length;

    const rawSales = safeParse('pg_sales_v1', []);
    const cleanSales = dedupeById(rawSales, normalizeSale);
    if (Array.isArray(rawSales) && JSON.stringify(rawSales) !== JSON.stringify(cleanSales)) {
      safeWrite('pg_sales_v1', cleanSales);
    }
    report.counts.sales = cleanSales.length;

    const rawLedger = safeParse('power_gym_finance_ledger_v2', {});
    const cleanLedger = normalizeFinanceLedger(rawLedger);
    if (JSON.stringify(rawLedger) !== JSON.stringify(cleanLedger)) {
      safeWrite('power_gym_finance_ledger_v2', cleanLedger);
    }
    report.counts.transactions = cleanLedger.transactions.length;

    safeWrite(SCHEMA_META_KEY, report);
    return report;
  }

  function validateAll() {
    const p = safeParse('power_gym_players_v1', []);
    const inv = safeParse('pg_inventory_v1', []);
    const sales = safeParse('pg_sales_v1', []);
    const issues = [];
    if (!Array.isArray(p)) issues.push('players_not_array');
    if (!Array.isArray(inv)) issues.push('inventory_not_array');
    if (!Array.isArray(sales)) issues.push('sales_not_array');
    const missingPhones = Array.isArray(p) ? p.filter(x => !x || !x.phone).length : 0;
    const lowStock = Array.isArray(inv) ? inv.filter(x => toNum(x.qty, 0) <= toNum(x.minQty, 3)).length : 0;
    return {
      ok: issues.length === 0,
      schemaVersion: CURRENT_SCHEMA_NUM,
      issues,
      stats: {
        players: Array.isArray(p) ? p.length : 0,
        missingPhones,
        inventory: Array.isArray(inv) ? inv.length : 0,
        lowStock,
        sales: Array.isArray(sales) ? sales.length : 0
      }
    };
  }

  const bootReport = migrateAndNormalize();

  window.PGDataFoundation = {
    SCHEMA_VERSION: CURRENT_SCHEMA_NUM,
    bootReport,
    createEntityId,
    normalizePlayer,
    normalizeInventoryItem,
    normalizeSale,
    normalizeFinanceLedger,
    migrateAndNormalize,
    validateAll,
    getMeta: () => safeParse(SCHEMA_META_KEY, bootReport)
  };
})();
