/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FELIX FINANCE TRACKER — INTEGRATION GUIDE                          ║
 * ║  How to wire the 5 engine modules into the existing HTML app        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * STEP 1: ADD SCRIPT TAGS
 * ════════════════════════
 * Place these 5 tags immediately BEFORE the closing </body> tag,
 * just BEFORE the existing large <script> block.
 *
 * The load order matters: finance-engine first (others depend on it).
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  <script src="storage-engine.js"></script>                       │
 * │  <script src="finance-engine.js"></script>                       │
 * │  <script src="budget-engine.js"></script>                        │
 * │  <script src="insights-engine.js"></script>                      │
 * │  <script src="charts-engine.js"></script>                        │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * NOTE: If you prefer to keep everything in one file (no external .js),
 * paste each module's content into <script> tags in the same order,
 * BEFORE the existing main script block.
 *
 * ────────────────────────────────────────────────────────────────────
 *
 * STEP 2: WIRE THE BOOT SEQUENCE
 * ══════════════════════════════
 * In the existing boot section (at the bottom of the main <script>),
 * find these lines:
 *
 *   updateDateBadge();
 *   processSubscriptions();
 *   ...
 *   renderDash();
 *
 * ADD these two lines right before renderDash():
 */

// ── ADD TO BOOT (after S=loadState()) ────────────────────────────────
ChartsEngine.init();        // Set up IntersectionObserver for lazy charts

// Optional: patch save() to use debounced version + cache invalidation:
var _originalSave = save;
save = function() {
  StorageEngine.save(S);
  ChartsEngine.invalidateAll();
};

/*
 * ────────────────────────────────────────────────────────────────────
 *
 * STEP 3: UPGRADE renderInsightCards()
 * ═════════════════════════════════════
 * Find the existing renderInsightCards() function (around line 3966).
 * It currently has inline health score and forecast logic.
 *
 * REPLACE the entire function body with:
 */

function renderInsightCards() {
  InsightsEngine.renderHealthScore(S);
  InsightsEngine.renderForecast(S);
}

/*
 * ────────────────────────────────────────────────────────────────────
 *
 * STEP 4: UPGRADE renderAlerts() BUDGET SECTION
 * ══════════════════════════════════════════════
 * Find the existing renderAlerts() function.
 * The first block inside it creates budget alerts manually:
 *
 *   S.goals.forEach(function(g) {
 *     var spent = S.expense.filter(...)...
 *     if (pct >= 1) alerts.push({...});
 *     else if (pct >= 0.8) alerts.push({...});
 *   });
 *
 * REPLACE just that forEach block with:
 */

// Inside renderAlerts(), replace the S.goals.forEach block:
BudgetEngine.getAlerts(S).forEach(function(a) {
  alerts.push(a);
});

/*
 * ────────────────────────────────────────────────────────────────────
 *
 * STEP 5: UPGRADE renderDash() CHART SECTION
 * ═══════════════════════════════════════════
 * Find this block inside renderDash() (around the setTimeout near line 3981):
 *
 *   setTimeout(function() {
 *     var iC = ...
 *     if (hasBarData) { drawBar('c-dash-bar', ...) }
 *     ...
 *     drawDonut('c-dash-pie', ...)
 *   }, 80);
 *
 * REPLACE the entire setTimeout block with:
 */

// Inside renderDash(), replace the setTimeout chart block:
setTimeout(function() {
  ChartsEngine.renderDashCharts(S);
}, 80);

/*
 * ────────────────────────────────────────────────────────────────────
 *
 * STEP 6: UPGRADE setGreeting() SMART PILLS
 * ═══════════════════════════════════════════
 * Find setGreeting(). After the existing pills array is built,
 * add engine-generated pills. Find this line near the end:
 *
 *   var ins = ge('g-insights');
 *   if (ins) ins.innerHTML = pills.join('');
 *
 * INSERT before that line:
 */

// Inside setGreeting(), before rendering pills:
InsightsEngine.getGreetingInsights(S).forEach(function(p) {
  pills.push(p);
});

/*
 * ────────────────────────────────────────────────────────────────────
 *
 * STEP 7: ADD NET WORTH HISTORY CHART (New Canvas)
 * ══════════════════════════════════════════════════
 * In the HTML, find the Net Worth panel (id="panel-networth").
 * After the existing <canvas id="c-nw-bar" ...> element, add:
 *
 *   <div class="card wid" style="margin-top:10px">
 *     <div class="wtitle">Net Worth History</div>
 *     <canvas id="c-nw-history" class="chart-canvas" style="height:160px"></canvas>
 *   </div>
 *
 * Then in the existing renderNetWorth() function, add at the end:
 */

// Inside renderNetWorth(), at the end:
setTimeout(function() {
  ChartsEngine.renderNetWorthHistory(S, 'c-nw-history');
}, 80);

/*
 * ────────────────────────────────────────────────────────────────────
 *
 * STEP 8: ADD SUBSCRIPTION DETECTION BUTTON (Optional)
 * ══════════════════════════════════════════════════════
 * In the Subscriptions panel, you can add a "Detect" button that
 * surfaces recurring expense patterns. Add this HTML to the panel header:
 *
 *   <button class="btn-ghost" id="btn-detect-subs">🔍 Auto-detect</button>
 *
 * Then wire it:
 */

var detectBtn = document.getElementById('btn-detect-subs');
if (detectBtn) {
  detectBtn.addEventListener('click', function() {
    var detected = InsightsEngine.detectSubscriptions(S);
    var untracked = detected.filter(function(d) { return !d.alreadyTracked; });
    if (!untracked.length) {
      toast('No new subscription patterns detected.', 'success');
      return;
    }
    var html = '<div style="font-size:12.5px;color:var(--t2);margin-bottom:14px">Found ' + untracked.length + ' recurring payment pattern' + (untracked.length > 1 ? 's' : '') + ':</div>'
      + '<div style="display:flex;flex-direction:column;gap:8px">'
      + untracked.slice(0, 5).map(function(d) {
          return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg);border-radius:var(--r);border:1px solid var(--border)">'
            + '<div><div style="font-size:13px;font-weight:500;color:var(--t1)">' + d.name + '</div>'
            + '<div style="font-size:11px;color:var(--t3);margin-top:2px">' + d.occurrences + ' months · ' + d.confidencePct + '% confidence</div></div>'
            + '<div style="font-family:DM Mono,monospace;font-size:13px;color:var(--red)">' + fmt(d.estimatedAmt) + '/mo</div>'
            + '</div>';
        }).join('')
      + '</div>'
      + '<div class="fa" style="margin-top:16px"><button class="btn-ghost modal-close-btn" onclick="closeModal()">Close</button></div>';
    openModal('Detected Subscriptions', html, null);
  });
}

/*
 * ────────────────────────────────────────────────────────────────────
 *
 * STEP 9: UPGRADE IMPORT/EXPORT BUTTONS (Optional)
 * ═════════════════════════════════════════════════
 * Replace the existing export/import handlers with StorageEngine versions:
 */

// Replace existing btn-export handler:
document.getElementById('btn-export').addEventListener('click', function() {
  StorageEngine.save(S, true);
  StorageEngine.exportJSON(S);
});

// Replace existing btn-export-csv handler:
document.getElementById('btn-export-csv').addEventListener('click', function() {
  StorageEngine.exportCSV(S);
});

// Replace existing import-file handler:
document.getElementById('import-file').addEventListener('change', function() {
  var file = this.files[0];
  if (!file) return;
  StorageEngine.importJSON(file,
    function(newState) {
      S = newState;
      save();
      renderDash();
      renderAccounts();
      renderAlerts();
      toast('Data imported successfully ✓', 'success');
    },
    function(err) { toast(err, 'error'); }
  );
  this.value = '';
});

/*
 * ════════════════════════════════════════════════════════════════════
 *
 * QUICK-REFERENCE: Function Call Map
 * ════════════════════════════════════
 *
 * ENGINE              FUNCTION                              REPLACES / ENHANCES
 * ─────────────────────────────────────────────────────────────────────────────
 * FinanceEngine       .getNetWorth(S)                       Inline NW calc in renderDash
 * FinanceEngine       .getCashFlow(S)                       Inline cash flow in renderDash
 * FinanceEngine       .getSavingsRate(S)                    Health score input
 * FinanceEngine       .getMonthlyTrend(S, 6)                Dashboard bar chart data
 * FinanceEngine       .getSpendingByCategory(S)             Donut chart + breakdown
 * FinanceEngine       .getNetWorthHistory(S, 12)            NW history chart data
 * FinanceEngine       .getDebtAnalysis(S)                   CC utilization display
 *
 * BudgetEngine        .getBudgetProgress(S)                 renderBudget() data
 * BudgetEngine        .getAlerts(S)                         renderAlerts() budget block
 * BudgetEngine        .analyze5030(S)                       New 50/30/20 widget
 * BudgetEngine        .getRecommendations(S)                Tips panel
 *
 * InsightsEngine      .getHealthScore(S)                    renderInsightCards() health
 * InsightsEngine      .renderHealthScore(S)                 Direct DOM update (health card)
 * InsightsEngine      .getForecast(S)                       renderInsightCards() forecast
 * InsightsEngine      .renderForecast(S)                    Direct DOM update (forecast card)
 * InsightsEngine      .getSpendingInsights(S)               Insight pills / tips
 * InsightsEngine      .detectSubscriptions(S)               Auto-detect subs button
 * InsightsEngine      .getSavingsGoalETAs(S)                Goal ETA display
 * InsightsEngine      .getGreetingInsights(S)               setGreeting() extra pills
 * InsightsEngine      .detectUnusualSpending(S)             Unusual spend alerts
 *
 * StorageEngine       .load()                               loadState()
 * StorageEngine       .save(S)                              save() — debounced
 * StorageEngine       .exportJSON(S)                        btn-export handler
 * StorageEngine       .exportCSV(S)                         btn-export-csv handler
 * StorageEngine       .importJSON(file, onOk, onErr)        import-file handler
 * StorageEngine       .getNetWorthHistory(S)                NW snapshot data
 * StorageEngine       .getActiveAccounts(S)                 Account list with enrichment
 *
 * ChartsEngine        .init()                               Boot — sets up observers
 * ChartsEngine        .lazy(id, drawFn, args, signal)       Wraps any drawFn lazily
 * ChartsEngine        .renderDashCharts(S)                  setTimeout chart block in renderDash
 * ChartsEngine        .renderNetWorthHistory(S)             NW history chart render
 * ChartsEngine        .renderSpendingHeatmap(S, id)         New calendar heatmap
 * ChartsEngine        .renderCategoryComparison(S, id)      New MoM category chart
 * ChartsEngine        .renderSavingsGrowth(S)               Savings cumulative line
 * ChartsEngine        .invalidateAll()                      Clear chart dirty cache
 */
