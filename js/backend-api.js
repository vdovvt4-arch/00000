'use strict';
// =========================================================
// Power Gym — Structured Backend Service Layer (js/backend-api.js v4.0)
// واجهة موحّدة للتخزين المحلي + استدعاء دوال PostgreSQL الموثقة عبر Supabase Auth
// =========================================================
(function () {
  function readList(key) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeList(key, list) {
    localStorage.setItem(key, JSON.stringify(Array.isArray(list) ? list : []));
  }

  async function callSupabaseRpc(fnName, params) {
    const client = window.pgSupabase || (window.pgAuth && window.pgAuth.getClient());
    if (!client) {
      return { ok: false, reason: 'supabase_client_missing' };
    }
    const { data, error } = await client.rpc(fnName, params || {});
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, data };
  }

  function health() {
    const foundation = window.PGDataFoundation;
    const validation = foundation ? foundation.validateAll() : { ok: true, stats: {} };
    return {
      schemaVersion: 4,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      authenticated: Boolean(window.pgAuth && window.pgAuth.isAuthenticated()),
      gymId: (window.pgAuth && window.pgAuth.getGymId()) || 'powergym-main',
      role: (window.pgAuth && window.pgAuth.getRole()) || 'guest',
      validation
    };
  }

  window.PGBackend = {
    health,
    callRpc: callSupabaseRpc,
    sync: {
      now: () => (window.pgCloudSyncNow ? window.pgCloudSyncNow() : Promise.resolve(false)),
      pushAll: () => (window.pgPushAllCloud ? window.pgPushAllCloud() : Promise.resolve(false)),
      pullAll: () => (window.pgPullAllCloud ? window.pgPullAllCloud() : Promise.resolve(false))
    },
    members: {
      list: () => readList('power_gym_players_v1'),
      getById: id => readList('power_gym_players_v1').find(m => m.id === id) || null,
      upsert: member => {
        const foundation = window.PGDataFoundation;
        const clean = foundation ? foundation.normalizePlayer(member) : member;
        const list = readList('power_gym_players_v1');
        const idx = list.findIndex(m => m.id === clean.id);
        if (idx >= 0) list[idx] = clean;
        else list.unshift(clean);
        writeList('power_gym_players_v1', list);
        return clean;
      }
    },
    inventory: {
      list: () => readList('pg_inventory_v1'),
      lowStock: () => readList('pg_inventory_v1').filter(i => Number(i.qty || 0) <= Number(i.minQty || 3)),
      upsert: item => {
        const foundation = window.PGDataFoundation;
        const clean = foundation ? foundation.normalizeInventoryItem(item) : item;
        const list = readList('pg_inventory_v1');
        const idx = list.findIndex(i => i.id === clean.id);
        if (idx >= 0) list[idx] = clean;
        else list.unshift(clean);
        writeList('pg_inventory_v1', list);
        return clean;
      }
    },
    sales: {
      list: () => readList('pg_sales_v1'),
      totalRevenue: () => readList('pg_sales_v1').reduce((acc, s) => acc + Number(s.total || 0), 0),
      totalProfit: () => readList('pg_sales_v1').reduce((acc, s) => acc + Number(s.profit || 0), 0)
    }
  };
})();
