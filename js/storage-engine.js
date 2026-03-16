/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FELIX FINANCE TRACKER — storage-engine.js                      ║
 * ║  Optimized Storage & Data Management Layer                       ║
 * ║  ─────────────────────────────────────────────────────────────  ║
 * ║  Responsibilities:                                               ║
 * ║  • Debounced localStorage persistence (prevents I/O storms)     ║
 * ║  • Data migration between app versions                           ║
 * ║  • Import / Export (JSON + CSV)                                  ║
 * ║  • Data integrity validation                                     ║
 * ║  • Net worth history snapshots                                   ║
 * ║  • Account CRUD helpers                                          ║
 * ║  • Computed/cached property system                               ║
 * ║                                                                  ║
 * ║  Integration:                                                    ║
 * ║  Load BEFORE the main app script block. StorageEngine.init()    ║
 * ║  is called at boot. The existing save() function can be         ║
 * ║  replaced with StorageEngine.save(S) for debounced writes.      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

var StorageEngine = (function () {
  'use strict';

  var SK = 'felix_v6';           // Primary storage key (matches existing app)
  var SK_HISTORY = 'felix_nw_history'; // Net worth snapshot history
  var SK_CACHE = 'felix_cache';  // Computed value cache
  var SK_PREFS = 'felix_prefs';  // User preferences

  var _saveTimer = null;
  var _cache = {};
  var _dirty = false;

  // ── HELPERS ──────────────────────────────────────────────────────────────────

  function _today() { return new Date().toISOString().split('T')[0]; }
  function _ym() { return new Date().toISOString().slice(0, 7); }

  function _safeGet(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }

  function _safeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  // ── STATE DEFAULTS ────────────────────────────────────────────────────────────

  /**
   * Returns a fresh default state object.
   * Mirrors the existing defaultState() but adds new fields for v7+ features.
   * @returns {Object}
   */
  function getDefaultState() {
    return {
      accounts: [],
      income: [],
      expense: [],
      transfer: [],
      credit: [],
      savings: [],
      subscriptions: [],
      goals: [],
      installments: [],
      bills: [],
      profile: { name: '', tagline: '', currency: '₱', photo: '' },
      netWorthHistory: [],  // NEW: monthly snapshots [{ym, value, date}]
      prefs: {              // NEW: user preferences
        defaultView: 'dashboard',
        chartPeriod: 6,
        showHealth: true,
        showForecast: true
      },
      nextId: 1,
      _version: 7
    };
  }

  // ── LOAD STATE ────────────────────────────────────────────────────────────────

  /**
   * Load and migrate state from localStorage.
   * Handles forward migrations from v3–v6.
   *
   * @returns {Object} - Validated, migrated state
   *
   * @example
   *   // Replace existing loadState() call at boot:
   *   S = StorageEngine.load();
   */
  function load() {
    try {
      var raw = localStorage.getItem(SK);
      // Migration path: try felix_v3 fallback
      if (!raw) raw = localStorage.getItem('felix_v3');

      if (raw) {
        var data = JSON.parse(raw);
        if (data && data.accounts) {
          return _migrate(data);
        }
      }
    } catch (e) {
      console.warn('[StorageEngine] Load failed, using defaults:', e.message);
    }
    return getDefaultState();
  }

  /**
   * Migrate state from older versions to current schema.
   * Non-destructive: adds missing fields, never removes existing data.
   * @private
   */
  function _migrate(data) {
    var defaults = getDefaultState();

    // Ensure all required arrays exist
    ['accounts', 'income', 'expense', 'transfer', 'credit', 'savings',
     'subscriptions', 'goals', 'installments', 'bills'].forEach(function (key) {
      if (!Array.isArray(data[key])) data[key] = [];
    });

    // Ensure profile exists
    if (!data.profile) data.profile = defaults.profile;
    if (!data.profile.currency) data.profile.currency = '₱';

    // Migrate nextId
    if (!data.nextId || data.nextId < 1) data.nextId = Date.now();

    // v6 → v7: add new fields
    if (!data.netWorthHistory) data.netWorthHistory = [];
    if (!data.prefs) data.prefs = defaults.prefs;
    if (!data._version) data._version = 7;

    // Clean orphaned/invalid fields
    delete data.cardDues; // Removed in v6

    // Validate all IDs are unique integers
    data = _normalizeIds(data);

    return data;
  }

  /**
   * Ensure all transaction IDs are valid and unique.
   * @private
   */
  function _normalizeIds(data) {
    var seen = new Set ? new Set() : { _m: {}, has: function (v) { return !!this._m[v]; }, add: function (v) { this._m[v] = true; } };
    var maxId = data.nextId || 1;

    ['income', 'expense', 'transfer', 'credit', 'savings', 'subscriptions', 'goals', 'installments', 'bills', 'accounts'].forEach(function (key) {
      (data[key] || []).forEach(function (item) {
        if (!item.id) item.id = maxId++;
        if (seen.has(String(item.id))) item.id = maxId++;
        seen.add(String(item.id));
        maxId = Math.max(maxId, parseInt(item.id) + 1);
      });
    });

    data.nextId = maxId;
    return data;
  }

  // ── SAVE (DEBOUNCED) ──────────────────────────────────────────────────────────

  /**
   * Save state to localStorage with 300ms debounce.
   * Prevents excessive writes during rapid user interactions.
   *
   * @param {Object} S - App state to persist
   * @param {boolean} [immediate=false] - Skip debounce and save now
   *
   * @example
   *   // Replace every save() call in the app with:
   *   StorageEngine.save(S);
   *
   *   // For critical saves (e.g., before export):
   *   StorageEngine.save(S, true);
   */
  function save(S, immediate) {
    _dirty = true;
    if (immediate) {
      _doSave(S);
      return;
    }
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () { _doSave(S); }, 300);
  }

  function _doSave(S) {
    try {
      // Take a net worth snapshot at most once per day
      _maybeSnapshotNetWorth(S);

      var json = JSON.stringify(S);

      // Check storage quota (rough estimate: 5MB limit)
      if (json.length > 4 * 1024 * 1024) {
        console.warn('[StorageEngine] State is large (' + (json.length / 1024).toFixed(0) + 'KB). Consider archiving old data.');
      }

      localStorage.setItem(SK, json);
      _dirty = false;

      // Update save indicator in UI
      var el = typeof ge === 'function' ? ge('spill') : document.getElementById('spill');
      if (el) {
        el.textContent = 'saved ✓';
        el.className = 'tb-chip ok';
        setTimeout(function () { el.textContent = 'auto-save on'; el.className = 'tb-chip'; }, 2000);
      }
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        if (typeof toast === 'function') toast('⚠ Storage full. Export your data to free space.', 'error');
        console.error('[StorageEngine] QuotaExceededError — localStorage is full.');
      } else {
        if (typeof toast === 'function') toast('⚠ Save failed.', 'error');
        console.error('[StorageEngine] Save failed:', e);
      }
    }
  }

  // ── NET WORTH HISTORY SNAPSHOTS ───────────────────────────────────────────────

  /**
   * Take a net worth snapshot if we haven't taken one this month.
   * Stores up to 24 monthly snapshots.
   * @private
   */
  function _maybeSnapshotNetWorth(S) {
    if (!S || !Array.isArray(S.accounts)) return;

    var ym = _ym();
    var history = S.netWorthHistory || [];

    // Already have snapshot for this month?
    var exists = history.some(function (h) { return h.ym === ym; });
    if (exists) return;

    var assets = (S.accounts || []).filter(function (a) { return !a.isCC; }).reduce(function (s, a) { return s + (a.balance || 0); }, 0);
    var liabilities = (S.accounts || []).filter(function (a) { return a.isCC; }).reduce(function (s, a) { return s + (a.usedCredit || 0); }, 0);
    var nw = +(assets - liabilities).toFixed(2);

    history.push({ ym: ym, value: nw, assets: +assets.toFixed(2), liabilities: +liabilities.toFixed(2), date: _today() });

    // Keep last 24 months
    if (history.length > 24) history = history.slice(-24);
    S.netWorthHistory = history;
  }

  /**
   * Get net worth history for chart rendering.
   *
   * @param {Object} S
   * @returns {{labels: string[], values: number[], months: string[]}}
   *
   * @example
   *   var history = StorageEngine.getNetWorthHistory(S);
   *   drawLine('c-nw-history', history.labels, history.values, '#3B6BFF');
   */
  function getNetWorthHistory(S) {
    var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var history = (S.netWorthHistory || []).sort(function (a, b) { return a.ym.localeCompare(b.ym); });

    return {
      labels: history.map(function (h) {
        var parts = h.ym.split('-');
        return MN[parseInt(parts[1]) - 1] + " '" + parts[0].slice(2);
      }),
      values: history.map(function (h) { return h.value; }),
      months: history.map(function (h) { return h.ym; }),
      count: history.length,
      hasData: history.length >= 2
    };
  }

  // ── EXPORT / IMPORT ───────────────────────────────────────────────────────────

  /**
   * Export full state as a downloadable JSON file.
   *
   * @param {Object} S
   *
   * @example
   *   // Replace existing export button handler:
   *   ge('btn-export').addEventListener('click', function() { StorageEngine.exportJSON(S); });
   */
  function exportJSON(S) {
    StorageEngine.save(S, true);
    var blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'felix-finance-' + _today() + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Export transactions as CSV.
   * Exports income, expenses, and transfers in a flat format.
   *
   * @param {Object} S
   *
   * @example
   *   ge('btn-export-csv').addEventListener('click', function() { StorageEngine.exportCSV(S); });
   */
  function exportCSV(S) {
    var rows = [['Date', 'Type', 'Description', 'Category', 'Amount', 'Account', 'Note']];

    (S.income || []).forEach(function (e) {
      rows.push([e.date, 'Income', e.source || '', e.category || '', e.amt || 0, e.account || '', e.note || '']);
    });
    (S.expense || []).forEach(function (e) {
      rows.push([e.date, 'Expense', e.desc || '', e.category || '', -(e.amt || 0), e.account || '', e.note || '']);
    });
    (S.transfer || []).forEach(function (e) {
      rows.push([e.date, 'Transfer', 'Transfer', '', e.amt || 0, (e.from || '') + ' → ' + (e.to || ''), e.note || '']);
    });
    (S.credit || []).forEach(function (e) {
      rows.push([e.date, 'Credit/' + (e.type || ''), e.desc || '', e.category || '', e.type === 'Charge' ? -(e.amt || 0) : (e.amt || 0), e.card || '', e.note || '']);
    });

    // Sort by date descending
    var header = rows.shift();
    rows.sort(function (a, b) { return b[0].localeCompare(a[0]); });
    rows.unshift(header);

    var csv = rows.map(function (row) {
      return row.map(function (cell) {
        var s = String(cell).replace(/"/g, '""');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s + '"' : s;
      }).join(',');
    }).join('\n');

    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'felix-transactions-' + _today() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Import state from a JSON file, with validation.
   *
   * @param {File} file - File object from input[type=file]
   * @param {function} onSuccess - Called with the loaded state: function(newState)
   * @param {function} [onError] - Called on failure: function(errorMsg)
   *
   * @example
   *   ge('import-file').addEventListener('change', function() {
   *     StorageEngine.importJSON(this.files[0], function(newS) {
   *       S = newS; save(); renderDash(); toast('Data imported ✓', 'success');
   *     }, function(err) { toast(err, 'error'); });
   *   });
   */
  function importJSON(file, onSuccess, onError) {
    if (!file) { if (onError) onError('No file selected.'); return; }
    var reader = new FileReader();
    reader.onload = function (evt) {
      try {
        var parsed = JSON.parse(evt.target.result);
        if (!parsed || !Array.isArray(parsed.accounts)) {
          if (onError) onError('Invalid file format. Not a Felix Finance export.');
          return;
        }
        var migrated = _migrate(parsed);
        if (onSuccess) onSuccess(migrated);
      } catch (e) {
        if (onError) onError('Failed to parse file: ' + e.message);
      }
    };
    reader.onerror = function () { if (onError) onError('Failed to read file.'); };
    reader.readAsText(file);
  }

  // ── STORAGE STATS ─────────────────────────────────────────────────────────────

  /**
   * Get storage usage statistics.
   *
   * @param {Object} S
   * @returns {{usedKB: number, totalEntries: number, breakdown: Object, isLarge: boolean}}
   */
  function getStorageStats(S) {
    var json = '';
    try { json = JSON.stringify(S); } catch (e) {}
    var usedKB = (json.length / 1024).toFixed(1);

    return {
      usedKB: parseFloat(usedKB),
      totalEntries: (S.income || []).length + (S.expense || []).length + (S.transfer || []).length + (S.credit || []).length + (S.savings || []).length,
      breakdown: {
        income: (S.income || []).length,
        expense: (S.expense || []).length,
        transfer: (S.transfer || []).length,
        credit: (S.credit || []).length,
        savings: (S.savings || []).length,
        accounts: (S.accounts || []).length,
        bills: (S.bills || []).length,
        subscriptions: (S.subscriptions || []).length
      },
      isLarge: parseFloat(usedKB) > 2048 // > 2MB warning
    };
  }

  // ── CACHE ─────────────────────────────────────────────────────────────────────

  /**
   * Simple in-memory cache for expensive computed values.
   * Cache is invalidated when the state changes (dirty flag).
   *
   * @param {string} key
   * @param {function} computeFn - Called if cache miss
   * @returns {*}
   *
   * @example
   *   var nw = StorageEngine.cached('netWorth', function() { return FinanceEngine.getNetWorth(S); });
   */
  function cached(key, computeFn) {
    if (!_dirty && _cache[key] !== undefined) return _cache[key];
    _cache[key] = computeFn();
    return _cache[key];
  }

  /** Invalidate the cache (call after any state mutation). */
  function invalidateCache() {
    _cache = {};
    _dirty = true;
  }

  // ── ACCOUNT HELPERS ───────────────────────────────────────────────────────────

  /**
   * Get all non-archived accounts with enriched balance info.
   *
   * @param {Object} S
   * @returns {Array<{id, name, type, balance, displayBalance, isCC, isLow, isCritical}>}
   */
  function getActiveAccounts(S) {
    return (S.accounts || [])
      .filter(function (a) { return !a.archived; })
      .map(function (a) {
        var balance = a.isCC ? -(a.usedCredit || 0) : (a.balance || 0);
        return {
          id: a.id,
          name: a.name,
          type: a.type,
          balance: a.isCC ? a.usedCredit || 0 : a.balance || 0,
          displayBalance: balance,
          isCC: !!a.isCC,
          creditLimit: a.creditLimit || 0,
          available: a.isCC ? Math.max(0, (a.creditLimit || 0) - (a.usedCredit || 0)) : null,
          utilization: a.isCC && a.creditLimit ? ((a.usedCredit || 0) / a.creditLimit) * 100 : null,
          color: a.accentColor || a.color || '#3B6BFF',
          logo: a.logo || null,
          isLow: !a.isCC && (a.balance || 0) < 1000,
          isCritical: !a.isCC && (a.balance || 0) < 0
        };
      });
  }

  // ── PUBLIC API ───────────────────────────────────────────────────────────────

  return {
    load: load,
    save: save,
    exportJSON: exportJSON,
    exportCSV: exportCSV,
    importJSON: importJSON,
    getNetWorthHistory: getNetWorthHistory,
    getStorageStats: getStorageStats,
    getActiveAccounts: getActiveAccounts,
    getDefaultState: getDefaultState,
    cached: cached,
    invalidateCache: invalidateCache,
    // Constants
    SK: SK
  };
})();
