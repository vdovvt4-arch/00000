'use strict';
// =========================================================
// Power Gym — Structured Backend Service Layer (js/backend-api.js)
// يوحّد التعامل مع التخزين المحلي (IndexedDB) + المزامنة السحابية (Supabase RPC)
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

  function getCloudConfig() {
    return window.pgCloudSync && typeof window.pgCloudSync.getConfig === 'function'
      ? window.pgCloudSync.getConfig()
      : null;
  }

  async function callSupabaseRpc(fnName, params) {
    const cfg = getCloudConfig();
    if (!cfg || !cfg.enabled || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      return { ok: false, reason: 'cloud_not_configured' };
    }
    const baseUrl = String(cfg.supabaseUrl).replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: {
        apikey: cfg.supabaseAnonKey,
        Authorization: `Bearer ${cfg.supabaseAnonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params || {})
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: await res.text().catch(() => '') };
    }
    const data = await res.json().catch(() => null);
    return { ok: true, data };
  }

  async function pushStructuredSnapshot() {
    const cfg = getCloudConfig();
    if (!cfg || !cfg.enabled || !cfg.gymId || !cfg.syncSecret) {
      return { ok: false, reason: 'cloud_not_configured' };
    }
    const foundation = window.PGDataFoundation;
    const members = readList('power_gym_players_v1').map(m => (foundation ? foundation.normalizePlayer(m) : m));
    const inventory = readList('pg_inventory_v1').map(i => (foundation ? foundation.normalizeInventoryItem(i) : i));
    const sales = readList('pg_sales_v1').map(s => (foundation ? foundation.normalizeSale(s) : s));

    return callSupabaseRpc('pg_sync_structured_snapshot', {
      p_gym: cfg.gymId,
      p_secret: cfg.syncSecret,
      p_snapshot: {
        schema_version: foundation ? foundation.SCHEMA_VERSION : 3,
        synced_at: new Date().toISOString(),
        members,
        inventory,
        sales
      }
    });
  }

  function health() {
    const foundation = window.PGDataFoundation;
    const validation = foundation ? foundation.validateAll() : { ok: true, stats: {} };
    const cfg = getCloudConfig();
    return {
      schemaVersion: foundation ? foundation.SCHEMA_VERSION : 3,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      cloudConfigured: Boolean(cfg && cfg.enabled && cfg.supabaseUrl),
      gymId: cfg ? cfg.gymId : 'local',
      validation
    };
  }

  window.PGBackend = {
    health,
    callRpc: callSupabaseRpc,
    sync: {
      now: () => (window.pgCloudSyncNow ? window.pgCloudSyncNow() : Promise.resolve(false)),
      pushStructuredSnapshot
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
