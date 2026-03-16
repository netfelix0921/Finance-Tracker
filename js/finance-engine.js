/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FELIX FINANCE TRACKER — finance-engine.js                      ║
 * ║  Core Financial Calculations Engine                              ║
 * ║  ─────────────────────────────────────────────────────────────  ║
 * ║  Responsibilities:                                               ║
 * ║  • Net worth calculation (assets - liabilities)                  ║
 * ║  • Cash flow analysis (monthly income vs expense)               ║
 * ║  • Savings rate computation                                      ║
 * ║  • Spending ratio analysis                                       ║
 * ║  • Monthly summaries                                             ║
 * ║  • Running balance calculations                                  ║
 * ║                                                                  ║
 * ║  Integration: Drop this <script> tag BEFORE the main app        ║
 * ║  <script> block in the HTML. All functions are exposed on the   ║
 * ║  global `FinanceEngine` namespace, then wired into the          ║
 * ║  existing renderDash() and renderInsightCards() calls.          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * HOW TO INTEGRATE:
 * ─────────────────
 * 1. Add before the closing </body> tag, AFTER existing <script>:
 *      <script src="finance-engine.js"></script>
 *      <script src="insights-engine.js"></script>
 *      ... etc
 *
 * 2. The engines read the global `S` state object (already set by
 *    the existing app: S = loadState()). No changes to state needed.
 *
 * 3. Replace the inline calculations in renderDash() and
 *    renderInsightCards() with calls to these engine functions.
 */

var FinanceEngine = (function () {
  'use strict';

  // ── PRIVATE HELPERS ──────────────────────────────────────────────────────────

  /**
   * Returns current YYYY-MM string.
   * Uses the app's existing curYM() if available, otherwise self-computes.
   */
  function _ym() {
    return typeof curYM === 'function' ? curYM() : new Date().toISOString().slice(0, 7);
  }

  /** Returns today's YYYY-MM-DD string. */
  function _today() {
    return typeof today === 'function' ? today() : new Date().toISOString().split('T')[0];
  }

  /**
   * Safely sums `.amt` fields from an array.
   * @param {Array} arr - Array of transaction objects
   * @returns {number}
   */
  function _sum(arr) {
    return (arr || []).reduce(function (s, e) { return s + (e.amt || 0); }, 0);
  }

  /**
   * Filter an array by YYYY-MM prefix.
   * @param {Array} arr
   * @param {string} ym - e.g. '2025-06'
   * @returns {Array}
   */
  function _filterMonth(arr, ym) {
    return (arr || []).filter(function (e) { return e.date && e.date.startsWith(ym); });
  }

  /**
   * Filter an array by YYYY prefix (full year).
   * @param {Array} arr
   * @param {string} year - e.g. '2025'
   * @returns {Array}
   */
  function _filterYear(arr, year) {
    return (arr || []).filter(function (e) { return e.date && e.date.startsWith(year); });
  }

  /**
   * Returns the last N months as YYYY-MM strings (including current month).
   * @param {number} n
   * @returns {string[]}
   */
  function _lastNMonths(n) {
    var months = [];
    var d = new Date();
    for (var i = n - 1; i >= 0; i--) {
      var t = new Date(d.getFullYear(), d.getMonth() - i, 1);
      var mm = (t.getMonth() + 1 < 10 ? '0' : '') + (t.getMonth() + 1);
      months.push(t.getFullYear() + '-' + mm);
    }
    return months;
  }

  // ── NET WORTH ─────────────────────────────────────────────────────────────────

  /**
   * Calculate comprehensive net worth from the current state.
   *
   * @param {Object} S - App state object
   * @returns {{
   *   netWorth: number,
   *   totalAssets: number,
   *   totalLiabilities: number,
   *   cashAndBank: number,
   *   creditOutstanding: number,
   *   savingsBalance: number,
   *   accountBreakdown: Array
   * }}
   *
   * @example
   *   var nw = FinanceEngine.getNetWorth(S);
   *   document.getElementById('d-nw').textContent = fmt(nw.netWorth);
   */
  function getNetWorth(S) {
    var regularAccounts = (S.accounts || []).filter(function (a) { return !a.isCC && !a.archived; });
    var creditCards = (S.accounts || []).filter(function (a) { return a.isCC && !a.archived; });

    var cashAndBank = regularAccounts.reduce(function (s, a) { return s + (a.balance || 0); }, 0);
    var creditOutstanding = creditCards.reduce(function (s, a) { return s + (a.usedCredit || 0); }, 0);

    var savDeposits = _sum((S.savings || []).filter(function (e) { return e.type === 'Deposit'; }));
    var savWithdrawals = _sum((S.savings || []).filter(function (e) { return e.type === 'Withdrawal'; }));
    var savingsBalance = savDeposits - savWithdrawals;

    var totalAssets = cashAndBank;
    var totalLiabilities = creditOutstanding;
    var netWorth = totalAssets - totalLiabilities;

    var accountBreakdown = regularAccounts.map(function (a) {
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        balance: a.balance || 0,
        color: a.accentColor || a.color || '#3B6BFF',
        logo: a.logo || null,
        isCC: false
      };
    }).concat(creditCards.map(function (a) {
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        balance: -(a.usedCredit || 0),
        creditLimit: a.creditLimit || 0,
        usedCredit: a.usedCredit || 0,
        utilization: a.creditLimit ? ((a.usedCredit || 0) / a.creditLimit) * 100 : 0,
        color: a.accentColor || a.color || '#E8354A',
        logo: a.logo || null,
        isCC: true
      };
    }));

    return {
      netWorth: +netWorth.toFixed(2),
      totalAssets: +totalAssets.toFixed(2),
      totalLiabilities: +totalLiabilities.toFixed(2),
      cashAndBank: +cashAndBank.toFixed(2),
      creditOutstanding: +creditOutstanding.toFixed(2),
      savingsBalance: +savingsBalance.toFixed(2),
      accountBreakdown: accountBreakdown
    };
  }

  // ── CASH FLOW ─────────────────────────────────────────────────────────────────

  /**
   * Calculate cash flow summary for a given month.
   *
   * @param {Object} S - App state
   * @param {string} [ym] - YYYY-MM (defaults to current month)
   * @returns {{
   *   income: number,
   *   expenses: number,
   *   net: number,
   *   savingsRate: number,
   *   spendingRatio: number,
   *   isPositive: boolean,
   *   incomeCount: number,
   *   expenseCount: number
   * }}
   *
   * @example
   *   var cf = FinanceEngine.getCashFlow(S);
   *   document.getElementById('d-flow').textContent = (cf.net >= 0 ? '+' : '') + fmt(cf.net);
   */
  function getCashFlow(S, ym) {
    ym = ym || _ym();
    var income = _sum(_filterMonth(S.income, ym));
    var expenses = _sum(_filterMonth(S.expense, ym));
    var net = income - expenses;
    var savingsRate = income > 0 ? Math.max(0, Math.min(100, ((income - expenses) / income) * 100)) : 0;
    var spendingRatio = income > 0 ? Math.min(200, (expenses / income) * 100) : 0;

    return {
      income: +income.toFixed(2),
      expenses: +expenses.toFixed(2),
      net: +net.toFixed(2),
      savingsRate: +savingsRate.toFixed(1),
      spendingRatio: +spendingRatio.toFixed(1),
      isPositive: net >= 0,
      incomeCount: _filterMonth(S.income, ym).length,
      expenseCount: _filterMonth(S.expense, ym).length
    };
  }

  // ── SAVINGS RATE ─────────────────────────────────────────────────────────────

  /**
   * Calculate savings rate over a rolling period (default: last 3 months).
   *
   * @param {Object} S
   * @param {number} [months=3] - Rolling window size
   * @returns {{
   *   rate: number,
   *   totalIncome: number,
   *   totalExpenses: number,
   *   totalSaved: number,
   *   monthlyAvgIncome: number,
   *   monthlyAvgExpenses: number,
   *   trend: 'improving' | 'declining' | 'stable'
   * }}
   */
  function getSavingsRate(S, months) {
    months = months || 3;
    var mths = _lastNMonths(months);

    var monthlyData = mths.map(function (m) {
      return {
        ym: m,
        income: _sum(_filterMonth(S.income, m)),
        expenses: _sum(_filterMonth(S.expense, m))
      };
    });

    var totalIncome = monthlyData.reduce(function (s, d) { return s + d.income; }, 0);
    var totalExpenses = monthlyData.reduce(function (s, d) { return s + d.expenses; }, 0);
    var totalSaved = totalIncome - totalExpenses;
    var rate = totalIncome > 0 ? Math.max(0, (totalSaved / totalIncome) * 100) : 0;

    // Trend: compare first half vs second half of window
    var mid = Math.floor(months / 2);
    var firstHalf = monthlyData.slice(0, mid);
    var secondHalf = monthlyData.slice(mid);
    var rateFirst = _safeSavingsRate(firstHalf);
    var rateLast = _safeSavingsRate(secondHalf);
    var trend = rateLast > rateFirst + 2 ? 'improving' : rateLast < rateFirst - 2 ? 'declining' : 'stable';

    return {
      rate: +rate.toFixed(1),
      totalIncome: +totalIncome.toFixed(2),
      totalExpenses: +totalExpenses.toFixed(2),
      totalSaved: +totalSaved.toFixed(2),
      monthlyAvgIncome: +(totalIncome / months).toFixed(2),
      monthlyAvgExpenses: +(totalExpenses / months).toFixed(2),
      trend: trend,
      monthlyBreakdown: monthlyData
    };
  }

  function _safeSavingsRate(monthData) {
    var inc = monthData.reduce(function (s, d) { return s + d.income; }, 0);
    var exp = monthData.reduce(function (s, d) { return s + d.expenses; }, 0);
    return inc > 0 ? ((inc - exp) / inc) * 100 : 0;
  }

  // ── SPENDING ANALYSIS ─────────────────────────────────────────────────────────

  /**
   * Get spending breakdown by category for a given period.
   *
   * @param {Object} S
   * @param {string} [ym] - YYYY-MM, defaults to current month
   * @returns {{
   *   categories: Array<{name: string, amount: number, count: number, percentage: number, color: string}>,
   *   total: number,
   *   topCategory: string | null,
   *   avgPerDay: number
   * }}
   *
   * @example
   *   var spend = FinanceEngine.getSpendingByCategory(S);
   *   spend.categories.forEach(function(c) { console.log(c.name, c.percentage + '%'); });
   */
  function getSpendingByCategory(S, ym) {
    ym = ym || _ym();
    var expenses = _filterMonth(S.expense, ym);
    var total = _sum(expenses);
    var catMap = {};

    expenses.forEach(function (e) {
      var cat = e.category || 'Other';
      if (!catMap[cat]) catMap[cat] = { name: cat, amount: 0, count: 0 };
      catMap[cat].amount += e.amt || 0;
      catMap[cat].count++;
    });

    var CAT_COLORS = {
      Food: '#0EA860', Transport: '#0891B2', Utilities: '#3B6BFF', Health: '#E8354A',
      Shopping: '#8B3CF7', Entertainment: '#D97706', Rent: '#E8354A', Education: '#0891B2',
      Subscription: '#D97706', Other: '#8e92b8'
    };

    var categories = Object.values(catMap).map(function (c) {
      return {
        name: c.name,
        amount: +c.amount.toFixed(2),
        count: c.count,
        percentage: total > 0 ? +((c.amount / total) * 100).toFixed(1) : 0,
        color: CAT_COLORS[c.name] || '#8e92b8'
      };
    }).sort(function (a, b) { return b.amount - a.amount; });

    // Days in month for avg per day
    var parts = ym.split('-');
    var daysInMonth = new Date(parseInt(parts[0]), parseInt(parts[1]), 0).getDate();
    var daysPassed = ym === _ym() ? new Date().getDate() : daysInMonth;

    return {
      categories: categories,
      total: +total.toFixed(2),
      topCategory: categories.length > 0 ? categories[0].name : null,
      avgPerDay: daysPassed > 0 ? +(total / daysPassed).toFixed(2) : 0
    };
  }

  // ── MONTHLY TREND ─────────────────────────────────────────────────────────────

  /**
   * Get income and expense totals for the last N months.
   * Used for the dashboard bar chart and trend analysis.
   *
   * @param {Object} S
   * @param {number} [n=6] - Number of months
   * @returns {{
   *   months: string[],
   *   labels: string[],
   *   income: number[],
   *   expenses: number[],
   *   net: number[],
   *   averageIncome: number,
   *   averageExpenses: number
   * }}
   *
   * @example
   *   var trend = FinanceEngine.getMonthlyTrend(S, 6);
   *   drawBar('c-dash-bar', trend.labels, [
   *     {label: 'Income',   data: trend.income,   color: '#0EA860'},
   *     {label: 'Expenses', data: trend.expenses, color: '#E8354A'}
   *   ]);
   */
  function getMonthlyTrend(S, n) {
    n = n || 6;
    var months = _lastNMonths(n);
    var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var income = months.map(function (m) {
      return +_sum(_filterMonth(S.income, m)).toFixed(2);
    });
    var expenses = months.map(function (m) {
      return +_sum(_filterMonth(S.expense, m)).toFixed(2);
    });
    var net = months.map(function (m, i) {
      return +(income[i] - expenses[i]).toFixed(2);
    });
    var labels = months.map(function (m) {
      return MN[parseInt(m.split('-')[1]) - 1];
    });

    var nonZeroInc = income.filter(function (v) { return v > 0; });
    var nonZeroExp = expenses.filter(function (v) { return v > 0; });

    return {
      months: months,
      labels: labels,
      income: income,
      expenses: expenses,
      net: net,
      averageIncome: nonZeroInc.length ? +(nonZeroInc.reduce(function (s, v) { return s + v; }, 0) / nonZeroInc.length).toFixed(2) : 0,
      averageExpenses: nonZeroExp.length ? +(nonZeroExp.reduce(function (s, v) { return s + v; }, 0) / nonZeroExp.length).toFixed(2) : 0
    };
  }

  // ── NET WORTH HISTORY ─────────────────────────────────────────────────────────

  /**
   * Reconstruct approximate net worth history by replaying transactions in
   * reverse from current balances. Useful for the Net Worth History chart.
   *
   * @param {Object} S
   * @param {number} [months=12]
   * @returns {{
   *   labels: string[],
   *   values: number[],
   *   change: number,
   *   changePercent: number
   * }}
   *
   * @example
   *   var nwHistory = FinanceEngine.getNetWorthHistory(S, 12);
   *   drawLine('c-nw-history', nwHistory.labels, nwHistory.values, '#3B6BFF');
   */
  function getNetWorthHistory(S, months) {
    months = months || 12;
    var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var mList = _lastNMonths(months);

    // Current net worth as the end point
    var nw = getNetWorth(S);
    var currentNW = nw.netWorth;

    // Walk backwards from today: subtract income, add expenses for each prior month
    // This is an approximation — ideal if user has complete history
    var values = [];
    var runningNW = currentNW;

    // Build month-by-month deltas in reverse order
    var deltas = mList.map(function (m) {
      return _sum(_filterMonth(S.income, m)) - _sum(_filterMonth(S.expense, m));
    });

    // Fill in values from oldest to newest
    // Start from earliest month and accumulate forward
    var cumulative = currentNW;
    // Go backwards to find start value
    for (var i = deltas.length - 1; i >= 0; i--) {
      cumulative -= deltas[i];
    }
    var running = cumulative;
    for (var j = 0; j < deltas.length; j++) {
      running += deltas[j];
      values.push(+running.toFixed(2));
    }

    var labels = mList.map(function (m) {
      return MN[parseInt(m.split('-')[1]) - 1] + " '" + m.slice(2, 4);
    });

    var startVal = values[0] || 0;
    var endVal = values[values.length - 1] || 0;
    var change = endVal - startVal;
    var changePercent = startVal !== 0 ? (change / Math.abs(startVal)) * 100 : 0;

    return {
      labels: labels,
      values: values,
      months: mList,
      change: +change.toFixed(2),
      changePercent: +changePercent.toFixed(1),
      isGrowing: change > 0
    };
  }

  // ── TRANSACTION SEARCH ───────────────────────────────────────────────────────

  /**
   * Full-text search across all transaction types.
   * Powers the global search bar.
   *
   * @param {Object} S
   * @param {string} query
   * @param {number} [limit=10]
   * @returns {Array<{id, type, date, desc, amt, category, sign, cls}>}
   *
   * @example
   *   var results = FinanceEngine.search(S, 'grab food');
   *   renderSearchResults(results);
   */
  function search(S, query, limit) {
    limit = limit || 10;
    if (!query || query.trim().length < 2) return [];
    var q = query.toLowerCase().trim();
    var results = [];

    (S.income || []).forEach(function (e) {
      if ((e.source || '').toLowerCase().includes(q) ||
          (e.category || '').toLowerCase().includes(q) ||
          (e.note || '').toLowerCase().includes(q)) {
        results.push({ id: e.id, type: 'income', date: e.date, desc: e.source, amt: e.amt, category: e.category, sign: '+', cls: 'pos' });
      }
    });

    (S.expense || []).forEach(function (e) {
      if ((e.desc || '').toLowerCase().includes(q) ||
          (e.category || '').toLowerCase().includes(q) ||
          (e.note || '').toLowerCase().includes(q)) {
        results.push({ id: e.id, type: 'expense', date: e.date, desc: e.desc, amt: e.amt, category: e.category, sign: '-', cls: 'neg' });
      }
    });

    (S.transfer || []).forEach(function (e) {
      if (('transfer').includes(q) || (e.note || '').toLowerCase().includes(q)) {
        results.push({ id: e.id, type: 'transfer', date: e.date, desc: 'Transfer', amt: e.amt, category: 'Transfer', sign: '', cls: 'neu' });
      }
    });

    return results
      .sort(function (a, b) { return b.date.localeCompare(a.date); })
      .slice(0, limit);
  }

  // ── DEBT ANALYSIS ────────────────────────────────────────────────────────────

  /**
   * Analyze credit card utilization and debt health.
   *
   * @param {Object} S
   * @returns {{
   *   totalLimit: number,
   *   totalUsed: number,
   *   utilizationRate: number,
   *   status: 'healthy' | 'warning' | 'danger',
   *   cards: Array
   * }}
   */
  function getDebtAnalysis(S) {
    var cards = (S.accounts || []).filter(function (a) { return a.isCC && !a.archived; });
    var totalLimit = cards.reduce(function (s, a) { return s + (a.creditLimit || 0); }, 0);
    var totalUsed = cards.reduce(function (s, a) { return s + (a.usedCredit || 0); }, 0);
    var utilizationRate = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;

    var status = utilizationRate < 30 ? 'healthy' : utilizationRate < 70 ? 'warning' : 'danger';

    return {
      totalLimit: +totalLimit.toFixed(2),
      totalUsed: +totalUsed.toFixed(2),
      utilizationRate: +utilizationRate.toFixed(1),
      status: status,
      cards: cards.map(function (a) {
        return {
          id: a.id,
          name: a.name,
          limit: a.creditLimit || 0,
          used: a.usedCredit || 0,
          available: Math.max(0, (a.creditLimit || 0) - (a.usedCredit || 0)),
          utilization: a.creditLimit ? ((a.usedCredit || 0) / a.creditLimit) * 100 : 0
        };
      })
    };
  }

  // ── PUBLIC API ───────────────────────────────────────────────────────────────

  return {
    getNetWorth: getNetWorth,
    getCashFlow: getCashFlow,
    getSavingsRate: getSavingsRate,
    getSpendingByCategory: getSpendingByCategory,
    getMonthlyTrend: getMonthlyTrend,
    getNetWorthHistory: getNetWorthHistory,
    getDebtAnalysis: getDebtAnalysis,
    search: search,
    // Expose private helpers for use in other engines
    _sum: _sum,
    _filterMonth: _filterMonth,
    _filterYear: _filterYear,
    _lastNMonths: _lastNMonths
  };
})();
