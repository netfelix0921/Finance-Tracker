/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FELIX FINANCE TRACKER — charts-engine.js                       ║
 * ║  Performant Chart Generation & Update System                     ║
 * ║  ─────────────────────────────────────────────────────────────  ║
 * ║  Responsibilities:                                               ║
 * ║  • Lazy chart initialization (only draw when visible)           ║
 * ║  • IntersectionObserver-based chart loading                     ║
 * ║  • Intelligent re-render prevention (dirty tracking)            ║
 * ║  • Net worth history line chart                                  ║
 * ║  • Spending heatmap (calendar view)                             ║
 * ║  • Category comparison (month vs month)                         ║
 * ║  • All existing draw* functions are wrapped and optimized       ║
 * ║                                                                  ║
 * ║  Requires: finance-engine.js, insights-engine.js                ║
 * ║                                                                  ║
 * ║  The existing drawBar / drawDonut / drawLine / drawHBar         ║
 * ║  functions are preserved. This engine WRAPS them with:          ║
 * ║  1. Lazy loading (only draw when canvas is in viewport)         ║
 * ║  2. Dirty tracking (skip re-draw if data hasn't changed)        ║
 * ║  3. ResizeObserver-based redraws on container resize            ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

var ChartsEngine = (function () {
  'use strict';

  // ── INTERNAL STATE ────────────────────────────────────────────────────────────

  var _pendingCharts = {};    // id → {fn, args} — queued lazy charts
  var _dirtyKeys = {};        // id → data fingerprint — skip unchanged redraws
  var _observer = null;       // IntersectionObserver instance
  var _resizeObserver = null; // ResizeObserver instance
  var _initialized = false;

  // ── HELPERS ──────────────────────────────────────────────────────────────────

  function _ge(id) { return typeof ge === 'function' ? ge(id) : document.getElementById(id); }
  function _fmt(n) { return typeof fmt === 'function' ? fmt(n) : '₱' + Number(n).toFixed(2); }
  function _cur() { return typeof cur === 'function' ? cur() : '₱'; }
  function _dark() { return typeof _darkMode !== 'undefined' ? _darkMode : document.documentElement.getAttribute('data-theme') === 'dark'; }

  /**
   * Create a lightweight fingerprint of data to detect changes.
   * Returns a string hash to compare against cached state.
   * @private
   */
  function _fingerprint(data) {
    try {
      return JSON.stringify(data).length + ':' + (JSON.stringify(data).slice(0, 120));
    } catch (e) {
      return String(Date.now());
    }
  }

  /**
   * Check if data has changed since last draw for a given chart id.
   * @private
   */
  function _isDirty(id, data) {
    var fp = _fingerprint(data);
    if (_dirtyKeys[id] === fp) return false;
    _dirtyKeys[id] = fp;
    return true;
  }

  /** Invalidate all chart caches (call after state mutations). */
  function invalidateAll() {
    _dirtyKeys = {};
    _pendingCharts = {};
  }

  // ── LAZY LOADING INFRASTRUCTURE ──────────────────────────────────────────────

  /**
   * Initialize the IntersectionObserver for lazy chart rendering.
   * Called once at boot.
   *
   * @example
   *   // Add to boot sequence after DOM ready:
   *   ChartsEngine.init();
   */
  function init() {
    if (_initialized) return;
    _initialized = true;

    // IntersectionObserver: draw charts when they enter viewport
    if ('IntersectionObserver' in window) {
      _observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var id = entry.target.id;
            if (_pendingCharts[id]) {
              var pending = _pendingCharts[id];
              delete _pendingCharts[id];
              _observer.unobserve(entry.target);
              try {
                pending.fn.apply(null, pending.args);
              } catch (e) {
                console.warn('[ChartsEngine] Lazy chart draw failed for', id, e);
              }
            }
          }
        });
      }, { rootMargin: '100px 0px', threshold: 0.01 });
    }

    // ResizeObserver: redraw charts when their container resizes
    if ('ResizeObserver' in window) {
      var _resizeDebounce = {};
      _resizeObserver = new ResizeObserver(function (entries) {
        entries.forEach(function (entry) {
          var id = entry.target.querySelector('canvas') ? entry.target.querySelector('canvas').id : null;
          if (!id) return;
          if (_resizeDebounce[id]) clearTimeout(_resizeDebounce[id]);
          _resizeDebounce[id] = setTimeout(function () {
            if (_dirtyKeys[id]) delete _dirtyKeys[id]; // Force redraw
            if (typeof renderDash === 'function' && ['c-dash-bar', 'c-dash-pie'].indexOf(id) > -1) {
              renderDash();
            } else if (typeof renderCharts === 'function') {
              renderCharts();
            }
          }, 250);
        });
      });
    }
  }

  /**
   * Queue a chart draw to happen lazily (when canvas enters viewport).
   *
   * @param {string} canvasId - The canvas element ID
   * @param {function} drawFn - The drawing function (e.g., drawBar)
   * @param {Array} args - Arguments to pass to drawFn
   * @param {*} [dataSignal] - Data to fingerprint for dirty-checking
   *
   * @example
   *   ChartsEngine.lazy('c-dash-bar', drawBar, ['c-dash-bar', labels, datasets, opts], trend);
   */
  function lazy(canvasId, drawFn, args, dataSignal) {
    if (!drawFn) return;

    // Dirty check — skip if data is identical to last render
    if (dataSignal !== undefined && !_isDirty(canvasId, dataSignal)) return;

    var el = _ge(canvasId);
    if (!el) return;

    // Is canvas already in viewport? Draw immediately.
    var rect = el.getBoundingClientRect();
    var inViewport = rect.top < window.innerHeight + 200 && rect.bottom > -200;

    if (inViewport) {
      try { drawFn.apply(null, args); } catch (e) { console.warn('[ChartsEngine] Draw failed for', canvasId, e); }
      return;
    }

    // Queue for lazy render
    _pendingCharts[canvasId] = { fn: drawFn, args: args };
    if (_observer) _observer.observe(el);
  }

  // ── DASHBOARD CHART RENDERING ─────────────────────────────────────────────────

  /**
   * Render all dashboard charts using lazy loading.
   * Drop-in replacement for the charts section of the existing renderDash().
   *
   * @param {Object} S - App state
   *
   * @example
   *   // At the end of renderDash(), replace the setTimeout chart block with:
   *   ChartsEngine.renderDashCharts(S);
   */
  function renderDashCharts(S) {
    if (typeof FinanceEngine === 'undefined') return;

    var trend = FinanceEngine.getMonthlyTrend(S, 6);
    var ym = typeof curYM === 'function' ? curYM() : new Date().toISOString().slice(0, 7);

    // Bar chart: Income vs Expenses (6 months)
    var iC = _dark() ? 'rgba(32,204,120,0.70)' : 'rgba(14,168,96,0.72)';
    var eC = _dark() ? 'rgba(255,85,102,0.68)' : 'rgba(232,53,74,0.65)';

    var hasBarData = trend.income.some(function (v) { return v > 0; }) || trend.expenses.some(function (v) { return v > 0; });

    if (hasBarData && typeof drawBar === 'function') {
      ChartsEngine.lazy('c-dash-bar', drawBar, [
        'c-dash-bar',
        trend.labels,
        [{ label: 'Income', data: trend.income, color: iC }, { label: 'Expenses', data: trend.expenses, color: eC }],
        { yCur: _cur() }
      ], { inc: trend.income, exp: trend.expenses });
    } else if (typeof emptyCanvas === 'function') {
      var cv = _ge('c-dash-bar');
      if (cv) emptyCanvas(cv, 'No data yet — log income or expenses to see your chart');
    }

    // Donut chart: Expense categories (current month)
    var spend = FinanceEngine.getSpendingByCategory(S, ym);
    var CC_COLORS = ['#3B6BFF', '#0EA860', '#E8354A', '#8B3CF7', '#D97706', '#0891B2', '#6B44EE', '#a855f7'];

    if (spend.categories.length > 0 && typeof drawDonut === 'function') {
      ChartsEngine.lazy('c-dash-pie', drawDonut, [
        'c-dash-pie',
        spend.categories.map(function (c) { return c.name; }),
        spend.categories.map(function (c) { return c.amount; }),
        CC_COLORS
      ], spend.categories);
    } else {
      var pc = _ge('c-dash-pie');
      if (pc && typeof emptyCanvas === 'function') emptyCanvas(pc, 'No expenses this month.');
    }
  }

  // ── NET WORTH HISTORY CHART ───────────────────────────────────────────────────

  /**
   * Render the Net Worth History line chart.
   * Reads from StorageEngine.getNetWorthHistory() for actual tracked data,
   * with a fallback to FinanceEngine.getNetWorthHistory() for estimation.
   *
   * @param {Object} S
   * @param {string} [canvasId='c-nw-history']
   *
   * @example
   *   // Add a canvas to the Net Worth panel:
   *   // <canvas id="c-nw-history" class="chart-canvas" style="height:160px"></canvas>
   *   // Then call in renderNetWorth():
   *   ChartsEngine.renderNetWorthHistory(S);
   */
  function renderNetWorthHistory(S, canvasId) {
    canvasId = canvasId || 'c-nw-history';
    if (!_ge(canvasId) || typeof drawLine !== 'function') return;

    // Prefer actual snapshots, fall back to estimation
    var history;
    if (typeof StorageEngine !== 'undefined') {
      history = StorageEngine.getNetWorthHistory(S);
    } else if (typeof FinanceEngine !== 'undefined') {
      history = FinanceEngine.getNetWorthHistory(S, 12);
    } else {
      return;
    }

    if (!history.hasData) {
      var cv = _ge(canvasId);
      if (cv && typeof emptyCanvas === 'function') {
        emptyCanvas(cv, 'Net worth history will appear after 2+ months of data.');
      }
      return;
    }

    var lineColor = _dark() ? '#60A5FA' : '#2563EB';
    ChartsEngine.lazy(canvasId, drawLine, [canvasId, history.labels, history.values, lineColor], history.values);
  }

  // ── SPENDING HEATMAP ──────────────────────────────────────────────────────────

  /**
   * Render a calendar-style spending heatmap for the current month.
   * Uses a plain canvas grid — no external library required.
   *
   * @param {Object} S
   * @param {string} canvasId - Canvas element ID
   *
   * @example
   *   // Add to a dashboard card:
   *   // <canvas id="c-heatmap" class="chart-canvas" style="height:120px"></canvas>
   *   ChartsEngine.renderSpendingHeatmap(S, 'c-heatmap');
   */
  function renderSpendingHeatmap(S, canvasId) {
    var cv = _ge(canvasId);
    if (!cv || typeof setupCanvas !== 'function') return;

    var ym = typeof curYM === 'function' ? curYM() : new Date().toISOString().slice(0, 7);
    var parts = ym.split('-');
    var year = parseInt(parts[0]);
    var month = parseInt(parts[1]);
    var daysInMonth = new Date(year, month, 0).getDate();
    var firstDay = new Date(year, month - 1, 1).getDay();

    // Build daily totals
    var dailySpend = {};
    var expenses = (S.expense || []).filter(function (e) { return e.date && e.date.startsWith(ym); });
    expenses.forEach(function (e) {
      var day = parseInt(e.date.split('-')[2]);
      dailySpend[day] = (dailySpend[day] || 0) + (e.amt || 0);
    });

    var maxSpend = Math.max.apply(null, Object.values(dailySpend).concat([1]));

    var W = typeof canvasW === 'function' ? canvasW(cv, 400) : (cv.parentElement ? cv.parentElement.clientWidth : 400);
    var H = 110;
    var ctx = setupCanvas(cv, W, H);
    ctx.clearRect(0, 0, W, H);

    var cols = 7;
    var rows = 6;
    var cellW = Math.floor((W - 20) / cols);
    var cellH = Math.floor((H - 20) / rows);
    var padX = (W - cellW * cols) / 2;
    var padY = 16;

    // Day labels
    var DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    ctx.fillStyle = typeof themeText === 'function' ? themeText() : 'rgba(70,80,130,0.65)';
    ctx.font = '9px ' + (document.body.style.fontFamily || 'sans-serif');
    ctx.textAlign = 'center';
    DAY_LABELS.forEach(function (lbl, i) {
      ctx.fillText(lbl, padX + i * cellW + cellW / 2, 10);
    });

    for (var day = 1; day <= daysInMonth; day++) {
      var totalOffset = firstDay + day - 1;
      var col = totalOffset % 7;
      var row = Math.floor(totalOffset / 7);
      var x = padX + col * cellW + 1;
      var y = padY + row * cellH + 1;
      var w = cellW - 2;
      var h = cellH - 2;

      var spend = dailySpend[day] || 0;
      var intensity = maxSpend > 0 ? spend / maxSpend : 0;

      var r, g, b;
      if (_dark()) {
        r = Math.round(37 + intensity * (232 - 37));
        g = Math.round(99 + intensity * (53 - 99));
        b = Math.round(235 + intensity * (74 - 235));
      } else {
        r = Math.round(219 + intensity * (232 - 219));
        g = Math.round(234 + intensity * (53 - 234));
        b = Math.round(254 + intensity * (74 - 254));
      }
      var alpha = spend > 0 ? 0.15 + intensity * 0.85 : 0.07;

      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, w, h, 3) : ctx.rect(x, y, w, h);
      ctx.fill();

      // Day number
      ctx.fillStyle = spend > 0 ? (typeof themeTextStrong === 'function' ? themeTextStrong() : '#0f1130') : (typeof themeText === 'function' ? themeText() : 'rgba(70,80,130,0.65)');
      ctx.font = (spend > 0 ? '500 ' : '') + '9px ' + (document.body.style.fontFamily || 'sans-serif');
      ctx.textAlign = 'center';
      ctx.fillText(String(day), x + w / 2, y + h / 2 + 3.5);
    }
  }

  // ── CATEGORY MONTH-OVER-MONTH ──────────────────────────────────────────────────

  /**
   * Render a horizontal bar chart comparing category spending:
   * current month vs previous month.
   *
   * @param {Object} S
   * @param {string} canvasId
   *
   * @example
   *   ChartsEngine.renderCategoryComparison(S, 'c-cat-compare');
   */
  function renderCategoryComparison(S, canvasId) {
    if (!_ge(canvasId) || typeof FinanceEngine === 'undefined') return;

    var ym = typeof curYM === 'function' ? curYM() : new Date().toISOString().slice(0, 7);
    var d = new Date();
    d.setMonth(d.getMonth() - 1);
    var prevYM = d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);

    var curr = FinanceEngine.getSpendingByCategory(S, ym);
    var prev = FinanceEngine.getSpendingByCategory(S, prevYM);

    if (!curr.categories.length) {
      var cv2 = _ge(canvasId);
      if (cv2 && typeof emptyCanvas === 'function') emptyCanvas(cv2, 'No expense data for this month.');
      return;
    }

    // Build comparison datasets (top 6 categories)
    var cats = curr.categories.slice(0, 6).map(function (c) { return c.name; });
    var currAmts = cats.map(function (cat) { return curr.categories.find(function (c) { return c.name === cat; }) ? curr.categories.find(function (c) { return c.name === cat; }).amount : 0; });
    var prevAmts = cats.map(function (cat) { var found = prev.categories.find(function (c) { return c.name === cat; }); return found ? found.amount : 0; });

    if (typeof drawBar === 'function') {
      ChartsEngine.lazy(canvasId, drawBar, [
        canvasId,
        cats,
        [
          { label: 'This Month', data: currAmts, color: _dark() ? 'rgba(255,85,102,0.70)' : 'rgba(232,53,74,0.65)' },
          { label: 'Last Month', data: prevAmts, color: _dark() ? 'rgba(100,110,180,0.50)' : 'rgba(139,149,200,0.45)' }
        ],
        { yCur: _cur() }
      ], { curr: currAmts, prev: prevAmts });
    }
  }

  // ── SAVINGS GROWTH CHART ──────────────────────────────────────────────────────

  /**
   * Render cumulative savings growth as a line chart.
   *
   * @param {Object} S
   * @param {string} [canvasId='c-savings-growth']
   */
  function renderSavingsGrowth(S, canvasId) {
    canvasId = canvasId || 'c-savings-growth';
    if (!_ge(canvasId) || typeof drawLine !== 'function') return;

    var savings = (S.savings || []).slice().sort(function (a, b) { return a.date.localeCompare(b.date); });

    if (savings.length < 2) {
      var cv = _ge(canvasId);
      if (cv && typeof emptyCanvas === 'function') emptyCanvas(cv, 'Log savings to track growth over time.');
      return;
    }

    var running = 0;
    var labels = [];
    var values = [];

    savings.forEach(function (e) {
      running += e.type === 'Deposit' ? (e.amt || 0) : -(e.amt || 0);
      labels.push(e.date.slice(5)); // MM-DD
      values.push(+running.toFixed(2));
    });

    var lineColor = _dark() ? '#A78BFA' : '#7C3AED';
    ChartsEngine.lazy(canvasId, drawLine, [canvasId, labels, values, lineColor], values);
  }

  // ── PUBLIC API ───────────────────────────────────────────────────────────────

  return {
    init: init,
    lazy: lazy,
    invalidateAll: invalidateAll,
    renderDashCharts: renderDashCharts,
    renderNetWorthHistory: renderNetWorthHistory,
    renderSpendingHeatmap: renderSpendingHeatmap,
    renderCategoryComparison: renderCategoryComparison,
    renderSavingsGrowth: renderSavingsGrowth
  };
})();
