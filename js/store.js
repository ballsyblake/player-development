/*
 * Persistence: the whole dataset lives in one IndexedDB record on this device.
 * Falls back to memory (with a warning) when storage is blocked, e.g. private windows.
 */
(function (root) {
  'use strict';

  var DB = 'player-development', STORE = 'kv', KEY = 'state', VERSION = 1;
  var memory = null, db = null, saveTimer = null;

  function open() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DB, VERSION);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
        req.onsuccess = function () { db = req.result; resolve(true); };
        req.onerror = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
  }

  function load() {
    return open().then(function (ok) {
      if (!ok) return memory;
      return new Promise(function (resolve) {
        try {
          var req = db.transaction(STORE).objectStore(STORE).get(KEY);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  }

  function saveNow(state) {
    memory = state;
    if (!db) return Promise.resolve(false);
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(state, KEY);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
  }

  // Debounced so rapid inline edits produce one write.
  function save(state, onDone) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveNow(state).then(function (ok) { if (onDone) onDone(ok); }); }, 250);
  }

  function persistent() { return !!db; }

  root.PD = root.PD || {};
  root.PD.store = { load: load, save: save, saveNow: saveNow, persistent: persistent };
})(window);
