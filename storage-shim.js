/* =========================================================
   storage-shim.js
   1) داخل تطبيق سطح المكتب (Electron): localStorage مربوط بملف على الحاسبة
   2) داخل التلفون / المتصفح (نسخة الموبايل المستقلة):
      localStorage مدعوم بقاعدة بيانات الهاتف الدائمة (IndexedDB + LocalStorage)
      بحيث تنحفظ كل البيانات والصور والكورسات داخل التلفون نفسه بدون حد الـ 5MB!
   ========================================================= */
(function () {
  'use strict';
  var bridge = window.powerGymDesktop;

  // ---------- 1) وضع سطح المكتب (Electron) ----------
  if (bridge && bridge.isDesktop) {
    var data = Object.assign({}, bridge.initialStorage || {});
    var desktopShim = {
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      },
      setItem: function (key, value) {
        data[key] = String(value);
        bridge.setItem(key, String(value));
      },
      removeItem: function (key) {
        delete data[key];
        bridge.removeItem(key);
      },
      clear: function () {
        Object.keys(data).forEach(function (k) { delete data[k]; });
        bridge.clear();
      },
      key: function (index) {
        var keys = Object.keys(data);
        return index < keys.length ? keys[index] : null;
      },
      get length() {
        return Object.keys(data).length;
      }
    };

    try {
      Object.defineProperty(window, 'localStorage', { value: desktopShim, configurable: true });
    } catch (err) {
      console.warn('تعذر ربط التخزين بملف الحاسبة:', err);
    }
    return;
  }

  // ---------- 2) وضع التلفون المستقل (IndexedDB + LocalStorage) ----------
  var rawLS = null;
  try { rawLS = window.localStorage; } catch (e) { rawLS = null; }

  var phoneData = {};
  if (rawLS) {
    try {
      for (var i = 0; i < rawLS.length; i++) {
        var k = rawLS.key(i);
        if (k) phoneData[k] = rawLS.getItem(k);
      }
    } catch (e) { /* ignore */ }
  }

  var DB_NAME = 'PowerGymPhoneDB_v1';
  var STORE_NAME = 'kv';
  var dbInstance = null;
  var pendingWrites = {};
  var isPersisted = false;

  function openPhoneDB() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) { resolve(null); return; }
      try {
        var req = window.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function (ev) {
          var db = ev.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = function (ev) {
          dbInstance = ev.target.result;
          resolve(dbInstance);
        };
        req.onerror = function () { resolve(null); };
      } catch (e) {
        resolve(null);
      }
    });
  }

  function idbSet(key, val) {
    pendingWrites[key] = val;
    if (!dbInstance) return;
    try {
      var tx = dbInstance.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(val, key);
    } catch (e) { /* ignore */ }
  }

  function idbRemove(key) {
    delete pendingWrites[key];
    if (!dbInstance) return;
    try {
      var tx = dbInstance.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
    } catch (e) { /* ignore */ }
  }

  function idbClear() {
    pendingWrites = {};
    if (!dbInstance) return;
    try {
      var tx = dbInstance.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
    } catch (e) { /* ignore */ }
  }

  var phoneShim = {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(phoneData, key) ? phoneData[key] : null;
    },
    setItem: function (key, value) {
      var sKey = String(key);
      var sVal = String(value);
      phoneData[sKey] = sVal;
      if (rawLS) {
        try { rawLS.setItem(sKey, sVal); } catch (e) {
          // إذا امتلأ localStorage العادي بسبب الصور، يستمر الحفظ في IndexedDB وذاكرة الهاتف بدون أي خطأ
        }
      }
      idbSet(sKey, sVal);
    },
    removeItem: function (key) {
      var sKey = String(key);
      delete phoneData[sKey];
      if (rawLS) {
        try { rawLS.removeItem(sKey); } catch (e) { /* ignore */ }
      }
      idbRemove(sKey);
    },
    clear: function () {
      Object.keys(phoneData).forEach(function (k) { delete phoneData[k]; });
      if (rawLS) {
        try { rawLS.clear(); } catch (e) { /* ignore */ }
      }
      idbClear();
    },
    key: function (index) {
      var keys = Object.keys(phoneData);
      return index < keys.length ? keys[index] : null;
    },
    get length() {
      return Object.keys(phoneData).length;
    }
  };

  try {
    Object.defineProperty(window, 'localStorage', { value: phoneShim, configurable: true });
  } catch (err) {
    console.warn('Phone storage shim warning:', err);
  }

  // تفعيل الحفظ الدائم في الهاتف ومزامنة IndexedDB عند بدء التشغيل
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(function (p) { isPersisted = Boolean(p); }).catch(function () {});
  }

  openPhoneDB().then(function (db) {
    if (!db) return;
    try {
      var tx = db.transaction(STORE_NAME, 'readonly');
      var store = tx.objectStore(STORE_NAME);
      var keysReq = store.getAllKeys();
      var valsReq = store.getAll();
      tx.oncomplete = function () {
        var keys = keysReq.result || [];
        var vals = valsReq.result || [];
        var restoredAny = false;

        for (var i = 0; i < keys.length; i++) {
          var k = String(keys[i]);
          var v = String(vals[i] ?? '');
          // إذا لم يكن المفتاح قد كُتب للتو خلال بدء التشغيل، وكان غير موجود أو أكبر حجماً في IndexedDB
          if (!Object.prototype.hasOwnProperty.call(pendingWrites, k)) {
            if (!phoneData[k] || (v.length > (phoneData[k] || '').length)) {
              phoneData[k] = v;
              if (rawLS) {
                try { rawLS.setItem(k, v); } catch (e) { /* ignore */ }
              }
              restoredAny = true;
            }
          }
        }

        // كتابة أي بيانات موجودة في phoneData إلى IndexedDB لضمان التطابق الكامل
        try {
          var wtx = db.transaction(STORE_NAME, 'readwrite');
          var wstore = wtx.objectStore(STORE_NAME);
          Object.keys(phoneData).forEach(function (k) {
            wstore.put(phoneData[k], k);
          });
        } catch (e) { /* ignore */ }

        if (restoredAny && typeof window.reloadPowerGymStateFromPhoneDB === 'function') {
          window.reloadPowerGymStateFromPhoneDB();
        }
      };
    } catch (e) { /* ignore */ }
  });

  window.powerGymPhoneStorage = {
    isPhoneStandalone: true,
    getUsedBytes: function () {
      var total = 0;
      Object.keys(phoneData).forEach(function (k) {
        total += k.length + (phoneData[k] ? phoneData[k].length : 0);
      });
      return total * 2;
    },
    isPersisted: function () { return isPersisted; }
  };
})();
