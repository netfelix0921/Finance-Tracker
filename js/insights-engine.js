/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FELIX FINANCE TRACKER — insights-engine.js                     ║
 * ║  Smart Spending Insights & Anomaly Detection                     ║
 * ║  ─────────────────────────────────────────────────────────────  ║
 * ║  Responsibilities:                                               ║
 * ║  • Financial health score (0–100) with factor breakdown         ║
 * ║  • Smart spending insights ("Spent 25% more on Shopping")       ║
 * ║  • Unusual spending detection (statistical anomalies)           ║
 * ║  • Subscription pattern detection from expenses                 ║
 * ║  • Cash flow forecast (next 30 days)                            ║
 * ║  • Savings goal ETA calculation                                 ║
 * ║                                                                  ║
 * ║  Requires: finance-engine.js (loaded first)                     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * INTEGRATION:
 * ────────────
 * The existing renderInsightCards() function populates:
 *   #health-score-val, #health-fill, #health-label, #health-factors
 *   #forecast-val, #forecast-sub, #forecast-items
 *
 * REPLACE the body of renderInsightCards() with:
 *   InsightsEngine.renderHealthScore(S);
 *   InsightsEngine.renderForecast(S);
 *
 * The existing setGreeting() insight pills can be enhanced with:
 *   InsightsEngine.getGreetingInsights(S).forEach(function(p) { pills.push(p); });
 */

var InsightsEngine = (function () {
  'use strict';

  // ── HELPERS ──────────────────────────────────────────────────────────────────

  function _ym() { return typeof curYM === 'function' ? curYM() : new Date().toISOString().slice(0, 7); }
  function _today() { return typeof today === 'function' ? today() : new Date().toISOString().split('T')[0]; }
  function _ge(id) { return typeof ge === 'function' ? ge(id) : document.getElementById(id); }
  function _st(id, v) { var el = _ge(id); if (el) el.textContent = v; }
  function _fmt(n) { return typeof fmt === 'function' ? fmt(n) : (typeof cur === 'function' ? cur() : '₱') + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function _sum(arr) { return (arr || []).reduce(function (s, e) { return s + (e.amt || 0); }, 0); }
  function _filterMonth(arr, ym) { return (arr || []).filter(function (e) { return e.date && e.date.startsWith(ym); }); }

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

  // ── FINANCIAL HEALTH SCORE ────────────────────────────────────────────────────

  /**
   * Compute a 0–100 Financial Health Score with factor breakdown.
   *
   * Scoring factors:
   *   Savings Rate (30pts): ≥20% → full pts, scales linearly
   *   Spending Control (25pts): expense/income ≤ 0.7 → full pts
   *   Debt Utilization (25pts): no CC debt or low utilization → full pts
   *   Cash Buffer (20pts): ≥3 months of expenses in accounts → full pts
   *
   * @param {Object} S
   * @returns {{
   *   score: number,
   *   label: string,
   *   color: string,
   *   factors: Array<{name, score, max, bar, description}>,
   *   summary: string
   * }}
   *
   * @example
   *   var health = InsightsEngine.getHealthScore(S);
   *   ge('health-score-val').textContent = health.score + '/100';
   *   ge('health-fill').style.width = health.score + '%';
   *   ge('health-fill').style.background = health.color;
   */
  function getHealthScore(S) {
    var ym = _ym();
    var monthIncome = _sum(_filterMonth(S.income, ym));
    var monthExpenses = _sum(_filterMonth(S.expense, ym));

    // Rolling 3-month averages for stability
    var recent3 = _lastNMonths(3);
    var avgInc3 = recent3.reduce(function (s, m) { return s + _sum(_filterMonth(S.income, m)); }, 0) / 3;
    var avgExp3 = recent3.reduce(function (s, m) { return s + _sum(_filterMonth(S.expense, m)); }, 0) / 3;

    var totalAssets = (S.accounts || []).filter(function (a) { return !a.isCC; }).reduce(function (s, a) { return s + (a.balance || 0); }, 0);
    var totalCC = (S.accounts || []).filter(function (a) { return a.isCC; }).reduce(function (s, a) { return s + (a.usedCredit || 0); }, 0);
    var totalCCLimit = (S.accounts || []).filter(function (a) { return a.isCC; }).reduce(function (s, a) { return s + (a.creditLimit || 0); }, 0);

    // ── Factor 1: Savings Rate (30 pts) ──────────────────────────────────────
    var savingsRate = avgInc3 > 0 ? Math.max(0, (avgInc3 - avgExp3) / avgInc3) : 0;
    // 20% → full 30pts; 0% → 0pts; linear
    var savingsScore = Math.min(30, Math.round((savingsRate / 0.20) * 30));
    var savingsLabel = savingsRate >= 0.30 ? 'Excellent' : savingsRate >= 0.20 ? 'Good' : savingsRate >= 0.10 ? 'Fair' : 'Needs work';

    // ── Factor 2: Spending Control (25 pts) ──────────────────────────────────
    var spendRatio = avgInc3 > 0 ? avgExp3 / avgInc3 : 1;
    // ≤0.7 → full 25pts; ≥1.1 → 0pts; linear interpolation
    var spendScore = spendRatio <= 0.70 ? 25 : spendRatio >= 1.10 ? 0 : Math.round(((1.10 - spendRatio) / 0.40) * 25);
    var spendLabel = spendRatio <= 0.70 ? 'Under control' : spendRatio <= 0.85 ? 'Moderate' : spendRatio <= 1.0 ? 'High' : 'Overspending';

    // ── Factor 3: Debt Utilization (25 pts) ──────────────────────────────────
    var utilization = totalCCLimit > 0 ? totalCC / totalCCLimit : 0;
    // 0% util → 25pts; 30% → 20pts; 70% → 5pts; 100% → 0pts
    var debtScore = utilization === 0 ? 25 : Math.max(0, Math.round((1 - utilization / 1.0) * 22));
    if (totalCCLimit === 0) debtScore = 20; // No credit cards — neutral
    var debtLabel = utilization === 0 ? 'No debt' : utilization <= 0.30 ? 'Healthy' : utilization <= 0.70 ? 'Moderate risk' : 'High risk';

    // ── Factor 4: Cash Buffer (20 pts) ───────────────────────────────────────
    // Target: 3 months of average expenses in liquid accounts
    var targetBuffer = avgExp3 * 3;
    var bufferRatio = targetBuffer > 0 ? Math.min(1, totalAssets / targetBuffer) : 1;
    var bufferScore = Math.round(bufferRatio * 20);
    var bufferLabel = bufferRatio >= 1 ? '3+ months covered' : bufferRatio >= 0.67 ? '2 months covered' : bufferRatio >= 0.33 ? '1 month covered' : 'Low buffer';

    var totalScore = Math.min(100, savingsScore + spendScore + debtScore + bufferScore);
    var label = totalScore >= 85 ? 'Excellent' : totalScore >= 70 ? 'Good' : totalScore >= 50 ? 'Fair' : totalScore >= 30 ? 'Needs Work' : 'Critical';
    var color = totalScore >= 85 ? 'var(--green)' : totalScore >= 70 ? '#10B981' : totalScore >= 50 ? 'var(--amber)' : 'var(--red)';

    var summaries = {
      Excellent: 'Your finances are in great shape. Keep up the discipline.',
      Good: 'Solid financial health. A few improvements could push you higher.',
      Fair: 'You\'re on the right track. Focus on savings and debt reduction.',
      'Needs Work': 'Several areas need attention. Prioritize cutting expenses.',
      Critical: 'Your finances need immediate attention. Start with a budget review.'
    };

    return {
      score: totalScore,
      label: label,
      color: color,
      summary: summaries[label],
      factors: [
        { name: 'Savings Rate', score: savingsScore, max: 30, bar: Math.round((savingsScore / 30) * 100), description: savingsLabel + ' — ' + (savingsRate * 100).toFixed(0) + '% saved' },
        { name: 'Spending Control', score: spendScore, max: 25, bar: Math.round((spendScore / 25) * 100), description: spendLabel + ' — ' + (spendRatio * 100).toFixed(0) + '% of income spent' },
        { name: 'Debt / Credit', score: debtScore, max: 25, bar: Math.round((debtScore / 25) * 100), description: debtLabel + (totalCCLimit > 0 ? ' — ' + (utilization * 100).toFixed(0) + '% utilization' : '') },
        { name: 'Cash Buffer', score: bufferScore, max: 20, bar: Math.round((bufferScore / 20) * 100), description: bufferLabel + ' — ' + (bufferRatio * 3).toFixed(1) + ' months' }
      ],
      raw: { savingsRate, spendRatio, utilization, bufferRatio, avgInc3, avgExp3 }
    };
  }

  // ── RENDER: HEALTH SCORE CARD ─────────────────────────────────────────────────

  /**
   * Render the Financial Health Score card into the existing DOM elements.
   * Targets: #health-score-val, #health-fill, #health-label, #health-factors
   *
   * @param {Object} S
   */
  function renderHealthScore(S) {
    var health = getHealthScore(S);

    var scoreEl = _ge('health-score-val');
    var fillEl = _ge('health-fill');
    var labelEl = _ge('health-label');
    var factorsEl = _ge('health-factors');

    if (scoreEl) {
      scoreEl.textContent = health.score + '/100';
      scoreEl.style.color = health.color;
    }

    if (fillEl) {
      fillEl.style.background = health.color;
      // Animate
      fillEl.style.width = '0%';
      setTimeout(function () { fillEl.style.width = health.score + '%'; }, 80);
    }

    if (labelEl) {
      labelEl.textContent = health.label + ' — ' + health.summary;
    }

    if (factorsEl) {
      factorsEl.innerHTML = health.factors.map(function (f) {
        var barColor = f.bar >= 80 ? 'var(--green)' : f.bar >= 50 ? 'var(--amber)' : 'var(--red)';
        return '<div class="hf-row">'
          + '<span class="hf-name">' + f.name + '</span>'
          + '<div class="hf-bar-wrap"><div class="hf-bar" style="width:' + f.bar + '%;background:' + barColor + '"></div></div>'
          + '<span class="hf-pts">' + f.score + '/' + f.max + '</span>'
          + '</div>';
      }).join('');
    }
  }

  // ── CASH FLOW FORECAST ────────────────────────────────────────────────────────

  /**
   * Predict account balance in the next 30 days.
   * Factors in: upcoming bills, active subscriptions, installments.
   *
   * @param {Object} S
   * @returns {{
   *   currentBalance: number,
   *   projectedBalance: number,
   *   projectedChange: number,
   *   isPositive: boolean,
   *   items: Array<{name, amount, date, type, daysAway}>
   * }}
   *
   * @example
   *   var forecast = InsightsEngine.getForecast(S);
   *   ge('forecast-val').textContent = fmt(forecast.projectedBalance);
   */
  function getForecast(S) {
    var td = _today();
    var futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    var futureDateStr = futureDate.toISOString().split('T')[0];

    var currentBalance = (S.accounts || []).filter(function (a) { return !a.isCC; }).reduce(function (s, a) { return s + (a.balance || 0); }, 0);

    var items = [];

    // Upcoming bills
    (S.bills || []).forEach(function (b) {
      if (!b.isPaid && b.dueDate && b.dueDate >= td && b.dueDate <= futureDateStr) {
        var daysAway = Math.ceil((new Date(b.dueDate) - new Date()) / 86400000);
        items.push({ name: b.name, amount: -(b.amt || 0), date: b.dueDate, type: 'bill', daysAway: daysAway });
      }
    });

    // Active subscriptions (next occurrence)
    (S.subscriptions || []).forEach(function (sub) {
      if (sub.active !== false && sub.nextDate && sub.nextDate >= td && sub.nextDate <= futureDateStr) {
        var daysAway = Math.ceil((new Date(sub.nextDate) - new Date()) / 86400000);
        items.push({ name: sub.name, amount: -(sub.amt || 0), date: sub.nextDate, type: 'subscription', daysAway: daysAway });
      }
    });

    // Upcoming installments
    (S.installments || []).forEach(function (inst) {
      if (inst.nextDate && inst.nextDate >= td && inst.nextDate <= futureDateStr && inst.remaining > 0) {
        var daysAway = Math.ceil((new Date(inst.nextDate) - new Date()) / 86400000);
        items.push({ name: inst.name, amount: -(inst.monthlyAmt || inst.amt || 0), date: inst.nextDate, type: 'installment', daysAway: daysAway });
      }
    });

    // Expected income: if we have salary/recurring income, project it
    var ym = _ym();
    var monthIncomeSources = _filterMonth(S.income, ym);
    if (monthIncomeSources.length === 0) {
      // Use average of last 3 months as expected income
      var prevMonths = _lastNMonths(3);
      var avgInc = prevMonths.reduce(function (s, m) { return s + _sum(_filterMonth(S.income, m)); }, 0) / 3;
      if (avgInc > 0) {
        items.push({ name: 'Expected Income (est.)', amount: avgInc, date: futureDateStr, type: 'income', daysAway: 30 });
      }
    }

    items.sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });

    var projectedChange = items.reduce(function (s, item) { return s + item.amount; }, 0);
    var projectedBalance = currentBalance + projectedChange;

    return {
      currentBalance: +currentBalance.toFixed(2),
      projectedBalance: +projectedBalance.toFixed(2),
      projectedChange: +projectedChange.toFixed(2),
      isPositive: projectedBalance >= 0,
      isGrowing: projectedChange >= 0,
      items: items,
      itemCount: items.length
    };
  }

  // ── RENDER: FORECAST CARD ─────────────────────────────────────────────────────

  /**
   * Render the 30-day forecast into existing DOM elements.
   * Targets: #forecast-val, #forecast-sub, #forecast-items
   *
   * @param {Object} S
   */
  function renderForecast(S) {
    var f = getForecast(S);
    var fmtEl = _ge('forecast-val');
    var subEl = _ge('forecast-sub');
    var itemsEl = _ge('forecast-items');

    if (fmtEl) {
      fmtEl.textContent = _fmt(f.projectedBalance);
      fmtEl.style.color = f.isPositive ? 'var(--blue)' : 'var(--red)';
    }

    if (subEl) {
      var changeStr = (f.projectedChange >= 0 ? '+' : '') + _fmt(f.projectedChange);
      subEl.textContent = changeStr + ' expected change · ' + f.itemCount + ' scheduled item' + (f.itemCount !== 1 ? 's' : '');
    }

    if (itemsEl) {
      if (!f.items.length) {
        itemsEl.innerHTML = '<div style="font-size:11.5px;color:var(--t3);padding:4px 0">No upcoming bills or subscriptions found.</div>';
        return;
      }
      itemsEl.innerHTML = f.items.slice(0, 5).map(function (item) {
        var isExpense = item.amount < 0;
        var color = item.type === 'income' ? 'var(--green)' : 'var(--red)';
        var icon = item.type === 'bill' ? '📄' : item.type === 'subscription' ? '🔄' : item.type === 'installment' ? '💳' : '💰';
        return '<div class="fc-item">'
          + '<span class="fc-name">' + icon + ' ' + (item.name || 'Unknown') + '</span>'
          + '<span class="fc-amt" style="color:' + color + '">'
          + (item.amount >= 0 ? '+' : '') + _fmt(Math.abs(item.amount))
          + '</span>'
          + '</div>';
      }).join('');
    }
  }

  // ── SMART INSIGHTS ─────────────────────────────────────────────────────────────

  /**
   * Generate plain-English spending insights by comparing current month
   * to previous month and detecting patterns.
   *
   * @param {Object} S
   * @returns {Array<{icon: string, text: string, type: 'positive' | 'negative' | 'neutral', change: number}>}
   *
   * @example
   *   var insights = InsightsEngine.getSpendingInsights(S);
   *   // → [{ icon: '🛍️', text: 'You spent 25% more on Shopping this month.', type: 'negative', change: 25 }]
   */
  function getSpendingInsights(S) {
    var ym = _ym();
    var d = new Date();
    d.setMonth(d.getMonth() - 1);
    var prevYM = d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);

    var insights = [];
    var CATS = ['Food', 'Transport', 'Shopping', 'Entertainment', 'Utilities', 'Health', 'Subscription', 'Education', 'Rent', 'Other'];
    var CAT_ICONS = { Food: '🍔', Transport: '🚗', Shopping: '🛍️', Entertainment: '🎬', Utilities: '⚡', Health: '💊', Subscription: '📱', Education: '📚', Rent: '🏠', Other: '📦' };

    CATS.forEach(function (cat) {
      var curr = _sum(_filterMonth(S.expense, ym).filter(function (e) { return e.category === cat; }));
      var prev = _sum(_filterMonth(S.expense, prevYM).filter(function (e) { return e.category === cat; }));

      if (curr === 0 && prev === 0) return;

      var change = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
      var icon = CAT_ICONS[cat] || '📦';

      if (Math.abs(change) >= 20 && prev > 0) {
        var direction = change > 0 ? 'more' : 'less';
        var type = change > 0 ? 'negative' : 'positive';
        insights.push({
          icon: icon,
          text: 'You spent ' + Math.abs(change).toFixed(0) + '% ' + direction + ' on ' + cat + ' this month.',
          type: type,
          change: +change.toFixed(1),
          category: cat,
          current: +curr.toFixed(2),
          previous: +prev.toFixed(2)
        });
      }
    });

    // Sort: biggest change first
    insights.sort(function (a, b) { return Math.abs(b.change) - Math.abs(a.change); });

    return insights.slice(0, 5);
  }

  // ── SUBSCRIPTION DETECTION ─────────────────────────────────────────────────────

  /**
   * Detect recurring payment patterns from expense history.
   * Looks for expenses with the same description appearing monthly.
   *
   * @param {Object} S
   * @returns {Array<{name: string, estimatedAmt: number, frequency: string, confidence: number, lastSeen: string}>}
   *
   * @example
   *   var detected = InsightsEngine.detectSubscriptions(S);
   *   detected.forEach(function(sub) {
   *     if (!sub.alreadyTracked) renderDetectedSubCard(sub);
   *   });
   */
  function detectSubscriptions(S) {
    var detected = [];
    var descMap = {};

    // Group expenses by normalized description
    (S.expense || []).forEach(function (e) {
      var key = (e.desc || '').toLowerCase().trim();
      if (!key || key.length < 3) return;
      if (!descMap[key]) descMap[key] = [];
      descMap[key].push(e);
    });

    // Find patterns with 2+ occurrences across different months
    Object.keys(descMap).forEach(function (key) {
      var entries = descMap[key];
      if (entries.length < 2) return;

      var months = {};
      entries.forEach(function (e) {
        var ym = e.date ? e.date.slice(0, 7) : '';
        if (ym && !months[ym]) months[ym] = [];
        if (ym) months[ym].push(e.amt);
      });

      var distinctMonths = Object.keys(months).length;
      if (distinctMonths < 2) return;

      // Calculate average amount
      var allAmts = entries.map(function (e) { return e.amt || 0; });
      var avgAmt = allAmts.reduce(function (s, v) { return s + v; }, 0) / allAmts.length;
      var amtVariance = allAmts.reduce(function (s, v) { return s + Math.pow(v - avgAmt, 2); }, 0) / allAmts.length;
      var amtConsistency = Math.sqrt(amtVariance) / (avgAmt || 1);

      // Confidence: 0–1 based on consistency and frequency
      var freqScore = Math.min(1, distinctMonths / 3);
      var consistencyScore = Math.max(0, 1 - amtConsistency);
      var confidence = (freqScore * 0.5 + consistencyScore * 0.5);

      if (confidence < 0.4) return;

      var lastEntry = entries.sort(function (a, b) { return b.date.localeCompare(a.date); })[0];

      // Check if already tracked as a subscription
      var alreadyTracked = (S.subscriptions || []).some(function (sub) {
        return (sub.name || '').toLowerCase().includes(key) || key.includes((sub.name || '').toLowerCase());
      });

      detected.push({
        name: entries[0].desc || key,
        estimatedAmt: +avgAmt.toFixed(2),
        frequency: distinctMonths >= 4 ? 'Monthly' : 'Recurring',
        confidence: +confidence.toFixed(2),
        confidencePct: Math.round(confidence * 100),
        lastSeen: lastEntry.date,
        occurrences: distinctMonths,
        alreadyTracked: alreadyTracked,
        category: entries[0].category || 'Subscription'
      });
    });

    // Sort by confidence descending
    return detected
      .sort(function (a, b) { return b.confidence - a.confidence; })
      .slice(0, 8);
  }

  // ── SAVINGS GOAL ETA ──────────────────────────────────────────────────────────

  /**
   * Calculate time-to-reach for each savings goal based on current savings rate.
   *
   * @param {Object} S
   * @returns {Array<{goalName, currentAmount, targetAmount, remaining, monthsToReach, etaDate, monthlySavings, isReached}>}
   *
   * @example
   *   var etas = InsightsEngine.getSavingsGoalETAs(S);
   *   etas.forEach(function(eta) { renderGoalETA(eta); });
   */
  function getSavingsGoalETAs(S) {
    // Get monthly savings rate from last 3 months
    var recent3 = _lastNMonths(3);
    var avgMonthlySavings = recent3.reduce(function (sum, m) {
      var inc = _sum(_filterMonth(S.income, m));
      var exp = _sum(_filterMonth(S.expense, m));
      return sum + Math.max(0, inc - exp);
    }, 0) / 3;

    // Build goal totals from savings entries
    var goalMap = {};
    (S.savings || []).forEach(function (e) {
      var key = e.goal || 'Unknown';
      if (!goalMap[key]) goalMap[key] = { name: key, deposited: 0, withdrawn: 0 };
      if (e.type === 'Deposit') goalMap[key].deposited += e.amt || 0;
      else goalMap[key].withdrawn += e.amt || 0;
    });

    return Object.values(goalMap).map(function (g) {
      var current = +(g.deposited - g.withdrawn).toFixed(2);

      // Try to match with a budget goal for target amount
      var budgetGoal = (S.goals || []).find(function (bg) {
        return bg.name === g.name || bg.category === g.name;
      });
      var target = budgetGoal ? budgetGoal.limit : null;

      var remaining = target ? Math.max(0, target - current) : null;
      var monthsToReach = (remaining && avgMonthlySavings > 0) ? Math.ceil(remaining / avgMonthlySavings) : null;

      var etaDate = null;
      if (monthsToReach !== null) {
        var eta = new Date();
        eta.setMonth(eta.getMonth() + monthsToReach);
        etaDate = eta.toISOString().slice(0, 7);
      }

      return {
        goalName: g.name,
        currentAmount: current,
        targetAmount: target,
        remaining: remaining,
        monthlySavings: +avgMonthlySavings.toFixed(2),
        monthsToReach: monthsToReach,
        etaDate: etaDate,
        isReached: target !== null && current >= target,
        hasTarget: target !== null,
        progressPct: target ? Math.min(100, (current / target) * 100) : null
      };
    }).sort(function (a, b) { return b.currentAmount - a.currentAmount; });
  }

  // ── GREETING INSIGHTS ─────────────────────────────────────────────────────────

  /**
   * Generate greeting pill strings for the dashboard header.
   * These supplement the existing setGreeting() pill array.
   *
   * @param {Object} S
   * @returns {string[]} - Array of HTML strings (g-pill spans)
   *
   * @example
   *   // Inside setGreeting(), after existing pills:
   *   InsightsEngine.getGreetingInsights(S).forEach(function(p) { pills.push(p); });
   */
  function getGreetingInsights(S) {
    var pills = [];
    var health = getHealthScore(S);

    // Health score pill
    if (health.score > 0) {
      var cls = health.score >= 85 ? 'green' : health.score >= 70 ? 'blue' : health.score >= 50 ? 'amber' : 'red';
      pills.push('<span class="g-pill ' + cls + '">💡 Health: ' + health.score + '/100</span>');
    }

    // Unusual spending pill
    var insights = getSpendingInsights(S);
    var bigChange = insights.find(function (i) { return Math.abs(i.change) >= 30; });
    if (bigChange) {
      var pillCls = bigChange.type === 'negative' ? 'red' : 'green';
      pills.push('<span class="g-pill ' + pillCls + '">' + bigChange.icon + ' ' + bigChange.text.slice(0, 40) + '…</span>');
    }

    return pills;
  }

  // ── UNUSUAL SPENDING DETECTION ────────────────────────────────────────────────

  /**
   * Detect statistically unusual spending transactions (Z-score based).
   * Flags transactions that are significantly above average for their category.
   *
   * @param {Object} S
   * @returns {Array<{id, desc, amt, category, date, zscore, description}>}
   */
  function detectUnusualSpending(S) {
    var unusual = [];
    var CATS = ['Food', 'Transport', 'Shopping', 'Entertainment', 'Utilities', 'Health', 'Subscription'];

    CATS.forEach(function (cat) {
      var catExpenses = (S.expense || []).filter(function (e) { return e.category === cat; });
      if (catExpenses.length < 3) return;

      var amounts = catExpenses.map(function (e) { return e.amt || 0; });
      var mean = amounts.reduce(function (s, v) { return s + v; }, 0) / amounts.length;
      var variance = amounts.reduce(function (s, v) { return s + Math.pow(v - mean, 2); }, 0) / amounts.length;
      var stdDev = Math.sqrt(variance);
      if (stdDev === 0) return;

      catExpenses.forEach(function (e) {
        var zscore = (e.amt - mean) / stdDev;
        if (zscore > 2.0) {
          unusual.push({
            id: e.id,
            desc: e.desc,
            amt: e.amt,
            category: e.category,
            date: e.date,
            zscore: +zscore.toFixed(2),
            meanForCategory: +mean.toFixed(2),
            description: (e.desc || 'Unknown') + ' (' + cat + ') was ' + zscore.toFixed(1) + '× higher than your average ' + cat + ' spend'
          });
        }
      });
    });

    // Sort by recency then zscore
    unusual.sort(function (a, b) {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      return b.zscore - a.zscore;
    });

    return unusual.slice(0, 6);
  }

  // ── PUBLIC API ───────────────────────────────────────────────────────────────

  return {
    getHealthScore: getHealthScore,
    renderHealthScore: renderHealthScore,
    getForecast: getForecast,
    renderForecast: renderForecast,
    getSpendingInsights: getSpendingInsights,
    detectSubscriptions: detectSubscriptions,
    getSavingsGoalETAs: getSavingsGoalETAs,
    getGreetingInsights: getGreetingInsights,
    detectUnusualSpending: detectUnusualSpending
  };
})();
