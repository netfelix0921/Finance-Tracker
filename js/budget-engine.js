/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FELIX FINANCE TRACKER — budget-engine.js                       ║
 * ║  Budget Tracking & Alert System                                  ║
 * ║  ─────────────────────────────────────────────────────────────  ║
 * ║  Responsibilities:                                               ║
 * ║  • Category budget progress tracking                             ║
 * ║  • Budget overrun detection & severity grading                   ║
 * ║  • Budget alert generation (warning, danger, info)              ║
 * ║  • Overall monthly budget summary                                ║
 * ║  • Budget recommendation engine                                  ║
 * ║  • 50/30/20 rule analysis                                        ║
 * ║                                                                  ║
 * ║  Requires: finance-engine.js (loaded first)                     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * INTEGRATION NOTES:
 * ──────────────────
 * The existing `S.goals` array stores category budgets with shape:
 *   { id, name, category, limit }
 *
 * This engine reads that array and enriches it with live spending data.
 *
 * REPLACE the existing renderAlerts() budget section with:
 *   BudgetEngine.getAlerts(S).forEach(function(alert) {
 *     alerts.push(alert);
 *   });
 *
 * REPLACE the existing renderBudget() function body with:
 *   var data = BudgetEngine.getBudgetProgress(S);
 *   renderBudgetCards(data.goals, data.summary);
 */

var BudgetEngine = (function () {
  'use strict';

  // ── HELPERS ──────────────────────────────────────────────────────────────────

  function _ym() { return typeof curYM === 'function' ? curYM() : new Date().toISOString().slice(0, 7); }
  function _sum(arr) { return (arr || []).reduce(function (s, e) { return s + (e.amt || 0); }, 0); }
  function _filterMonth(arr, ym) {
    return (arr || []).filter(function (e) { return e.date && e.date.startsWith(ym); });
  }

  /**
   * Get spending for a category in a given month.
   * Matches exactly: category === goal.category, case-sensitive.
   */
  function _categorySpend(S, category, ym) {
    return _sum(_filterMonth(S.expense, ym).filter(function (e) {
      return e.category === category;
    }));
  }

  /**
   * Determine alert severity.
   * @param {number} pct - Percentage used (0–200+)
   * @returns {'safe' | 'warn' | 'danger'}
   */
  function _severity(pct) {
    if (pct >= 100) return 'danger';
    if (pct >= 80) return 'warn';
    return 'safe';
  }

  // ── BUDGET PROGRESS ──────────────────────────────────────────────────────────

  /**
   * Get full budget progress for all goals in the current month.
   * This is the primary data source for the Budget Goals panel.
   *
   * @param {Object} S - App state
   * @param {string} [ym] - YYYY-MM, defaults to current month
   * @returns {{
   *   goals: Array<BudgetGoal>,
   *   summary: BudgetSummary,
   *   hasData: boolean
   * }}
   *
   * BudgetGoal shape:
   *   { id, name, category, limit, spent, remaining, pct, severity, isOver, transactions }
   *
   * BudgetSummary shape:
   *   { totalBudgeted, totalSpent, totalRemaining, overallPct, overCount, warnCount }
   *
   * @example
   *   var data = BudgetEngine.getBudgetProgress(S);
   *   ge('budget-total-spent').textContent = fmt(data.summary.totalSpent);
   *   data.goals.forEach(function(g) { renderGoalCard(g); });
   */
  function getBudgetProgress(S, ym) {
    ym = ym || _ym();

    var goals = (S.goals || []).map(function (g) {
      var spent = _categorySpend(S, g.category, ym);
      var pct = g.limit > 0 ? Math.min(200, (spent / g.limit) * 100) : 0;
      var severity = _severity(pct);
      var remaining = Math.max(0, (g.limit || 0) - spent);

      // Get individual transactions for this category this month
      var transactions = _filterMonth(S.expense, ym)
        .filter(function (e) { return e.category === g.category; })
        .sort(function (a, b) { return b.date.localeCompare(a.date); });

      return {
        id: g.id,
        name: g.name || g.category,
        category: g.category,
        limit: +(g.limit || 0).toFixed(2),
        spent: +spent.toFixed(2),
        remaining: +remaining.toFixed(2),
        pct: +pct.toFixed(1),
        severity: severity,
        isOver: pct >= 100,
        isWarning: pct >= 80 && pct < 100,
        isSafe: pct < 80,
        transactions: transactions,
        transactionCount: transactions.length,
        // Bar fill color
        barColor: severity === 'danger' ? 'var(--red)' : severity === 'warn' ? 'var(--amber)' : 'var(--blue)'
      };
    });

    var totalBudgeted = goals.reduce(function (s, g) { return s + g.limit; }, 0);
    var totalSpent = goals.reduce(function (s, g) { return s + g.spent; }, 0);
    var totalRemaining = Math.max(0, totalBudgeted - totalSpent);
    var overallPct = totalBudgeted > 0 ? Math.min(200, (totalSpent / totalBudgeted) * 100) : 0;

    return {
      goals: goals,
      summary: {
        totalBudgeted: +totalBudgeted.toFixed(2),
        totalSpent: +totalSpent.toFixed(2),
        totalRemaining: +totalRemaining.toFixed(2),
        overallPct: +overallPct.toFixed(1),
        overCount: goals.filter(function (g) { return g.isOver; }).length,
        warnCount: goals.filter(function (g) { return g.isWarning; }).length,
        safeCount: goals.filter(function (g) { return g.isSafe; }).length,
        severity: _severity(overallPct)
      },
      hasData: goals.length > 0,
      ym: ym
    };
  }

  // ── BUDGET ALERTS ─────────────────────────────────────────────────────────────

  /**
   * Generate budget alert objects for display in the alerts banner.
   * Integrates directly into the existing renderAlerts() function.
   *
   * @param {Object} S
   * @param {string} [ym]
   * @returns {Array<{type: 'warn' | 'danger', msg: string, category: string, pct: number}>}
   *
   * @example
   *   // Inside the existing renderAlerts():
   *   BudgetEngine.getAlerts(S).forEach(function(a) { alerts.push(a); });
   */
  function getAlerts(S, ym) {
    ym = ym || _ym();
    var progress = getBudgetProgress(S, ym);
    var alerts = [];

    progress.goals.forEach(function (g) {
      if (g.isOver) {
        alerts.push({
          type: 'danger',
          category: g.category,
          pct: g.pct,
          msg: '<b>' + g.name + '</b> budget exceeded — spent ' +
            (typeof fmt === 'function' ? fmt(g.spent) : g.spent) +
            ' of ' + (typeof fmt === 'function' ? fmt(g.limit) : g.limit) +
            ' (' + Math.round(g.pct) + '%)'
        });
      } else if (g.isWarning) {
        alerts.push({
          type: 'warn',
          category: g.category,
          pct: g.pct,
          msg: '<b>' + g.name + '</b> at ' + Math.round(g.pct) + '% — ' +
            (typeof fmt === 'function' ? fmt(g.remaining) : g.remaining) + ' remaining'
        });
      }
    });

    // Sort: dangers first, then by pct descending
    alerts.sort(function (a, b) {
      if (a.type === 'danger' && b.type !== 'danger') return -1;
      if (b.type === 'danger' && a.type !== 'danger') return 1;
      return b.pct - a.pct;
    });

    return alerts.slice(0, 4); // Cap at 4 budget alerts
  }

  // ── 50/30/20 RULE ANALYSIS ────────────────────────────────────────────────────

  /**
   * Analyze spending against the 50/30/20 budgeting rule.
   * Needs & Bills ≤ 50%, Wants ≤ 30%, Savings ≥ 20%
   *
   * Category mapping:
   *   Needs: Utilities, Rent, Health, Transport, Food, Education
   *   Wants: Shopping, Entertainment, Subscription, Other
   *   Savings: Net savings (income - all expenses)
   *
   * @param {Object} S
   * @param {string} [ym]
   * @returns {{
   *   monthlyIncome: number,
   *   needs: {amount, target, pct, targetPct, status},
   *   wants: {amount, target, pct, targetPct, status},
   *   savings: {amount, target, pct, targetPct, status},
   *   overallScore: 'excellent' | 'good' | 'fair' | 'poor'
   * }}
   *
   * @example
   *   var rule = BudgetEngine.analyze5030(S);
   *   renderRuleWidget(rule);
   */
  function analyze5030(S, ym) {
    ym = ym || _ym();
    var fmtLocal = typeof fmt === 'function' ? fmt : function (n) { return n.toFixed(2); };

    var NEEDS_CATS = ['Utilities', 'Rent', 'Health', 'Transport', 'Food', 'Education'];
    var WANTS_CATS = ['Shopping', 'Entertainment', 'Subscription', 'Other', 'Travel'];

    var monthExpenses = _filterMonth(S.expense, ym);
    var monthIncome = _sum(_filterMonth(S.income, ym));

    var needsAmt = _sum(monthExpenses.filter(function (e) { return NEEDS_CATS.indexOf(e.category) > -1; }));
    var wantsAmt = _sum(monthExpenses.filter(function (e) { return WANTS_CATS.indexOf(e.category) > -1; }));
    var totalExp = _sum(monthExpenses);
    var savingsAmt = Math.max(0, monthIncome - totalExp);

    function _pct(amt) { return monthIncome > 0 ? (amt / monthIncome) * 100 : 0; }
    function _status(actual, target, isMin) {
      if (isMin) return actual >= target ? 'good' : actual >= target * 0.75 ? 'warn' : 'poor';
      return actual <= target ? 'good' : actual <= target * 1.15 ? 'warn' : 'poor';
    }

    var needsPct = _pct(needsAmt);
    var wantsPct = _pct(wantsAmt);
    var savPct = _pct(savingsAmt);

    var needsStatus = _status(needsPct, 50, false);
    var wantsStatus = _status(wantsPct, 30, false);
    var savStatus = _status(savPct, 20, true);

    var scores = [needsStatus, wantsStatus, savStatus];
    var goodCount = scores.filter(function (s) { return s === 'good'; }).length;
    var overallScore = goodCount === 3 ? 'excellent' : goodCount === 2 ? 'good' : goodCount === 1 ? 'fair' : 'poor';

    return {
      monthlyIncome: +monthIncome.toFixed(2),
      needs: {
        amount: +needsAmt.toFixed(2),
        target: +(monthIncome * 0.5).toFixed(2),
        pct: +needsPct.toFixed(1),
        targetPct: 50,
        status: needsStatus,
        categories: NEEDS_CATS
      },
      wants: {
        amount: +wantsAmt.toFixed(2),
        target: +(monthIncome * 0.3).toFixed(2),
        pct: +wantsPct.toFixed(1),
        targetPct: 30,
        status: wantsStatus,
        categories: WANTS_CATS
      },
      savings: {
        amount: +savingsAmt.toFixed(2),
        target: +(monthIncome * 0.2).toFixed(2),
        pct: +savPct.toFixed(1),
        targetPct: 20,
        status: savStatus
      },
      overallScore: overallScore,
      hasIncome: monthIncome > 0
    };
  }

  // ── BUDGET RECOMMENDATIONS ────────────────────────────────────────────────────

  /**
   * Generate actionable budget recommendations based on spending patterns.
   *
   * @param {Object} S
   * @returns {Array<{icon: string, title: string, body: string, type: 'tip' | 'warn' | 'alert'}>}
   *
   * @example
   *   var tips = BudgetEngine.getRecommendations(S);
   *   tips.forEach(function(tip) { renderTipCard(tip); });
   */
  function getRecommendations(S) {
    var tips = [];
    var ym = _ym();
    var prevYM = (function () {
      var d = new Date();
      d.setMonth(d.getMonth() - 1);
      return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
    })();

    var cf = typeof FinanceEngine !== 'undefined' ? FinanceEngine.getCashFlow(S, ym) : null;
    var prevCf = typeof FinanceEngine !== 'undefined' ? FinanceEngine.getCashFlow(S, prevYM) : null;

    // Tip: High savings rate
    if (cf && cf.savingsRate >= 50) {
      tips.push({ icon: '🎯', title: 'Excellent savings rate', body: 'You\'re saving ' + cf.savingsRate.toFixed(0) + '% of your income this month. Keep it up!', type: 'tip' });
    }

    // Warn: Low savings rate
    if (cf && cf.income > 0 && cf.savingsRate < 10) {
      tips.push({ icon: '⚠️', title: 'Low savings rate', body: 'Only ' + cf.savingsRate.toFixed(0) + '% saved this month. Try to reduce discretionary spending.', type: 'warn' });
    }

    // Tip: Spending dropped month over month
    if (cf && prevCf && prevCf.expenses > 0 && cf.expenses < prevCf.expenses * 0.9) {
      var reduction = ((prevCf.expenses - cf.expenses) / prevCf.expenses * 100).toFixed(0);
      tips.push({ icon: '📉', title: 'Spending is down', body: 'You spent ' + reduction + '% less than last month. Great discipline!', type: 'tip' });
    }

    // Alert: Spending jumped month over month
    if (cf && prevCf && prevCf.expenses > 0 && cf.expenses > prevCf.expenses * 1.3) {
      var increase = ((cf.expenses - prevCf.expenses) / prevCf.expenses * 100).toFixed(0);
      tips.push({ icon: '📈', title: 'Spending spike detected', body: 'Expenses are ' + increase + '% higher than last month. Review your recent transactions.', type: 'alert' });
    }

    // Tip: No credit card debt
    var debt = typeof FinanceEngine !== 'undefined' ? FinanceEngine.getDebtAnalysis(S) : null;
    if (debt && debt.totalUsed === 0 && debt.cards.length > 0) {
      tips.push({ icon: '✅', title: 'Zero credit card debt', body: 'Your credit cards are fully paid off. Excellent financial hygiene!', type: 'tip' });
    }

    // Warn: High CC utilization
    if (debt && debt.utilizationRate > 50) {
      tips.push({ icon: '💳', title: 'High credit utilization', body: 'Credit usage at ' + debt.utilizationRate.toFixed(0) + '%. Try to keep it below 30% to protect your credit.', type: 'warn' });
    }

    // Tip: Overdue bills
    var overdue = (S.bills || []).filter(function (b) {
      return !b.isPaid && b.dueDate && b.dueDate < (typeof _today === 'function' ? _today() : new Date().toISOString().split('T')[0]);
    });
    if (overdue.length > 0) {
      tips.push({ icon: '🔔', title: overdue.length + ' overdue bill' + (overdue.length > 1 ? 's' : ''), body: 'Pay overdue bills promptly to avoid late fees and maintain good standing.', type: 'alert' });
    }

    return tips.slice(0, 5);
  }

  // ── PUBLIC API ───────────────────────────────────────────────────────────────

  return {
    getBudgetProgress: getBudgetProgress,
    getAlerts: getAlerts,
    analyze5030: analyze5030,
    getRecommendations: getRecommendations
  };
})();
