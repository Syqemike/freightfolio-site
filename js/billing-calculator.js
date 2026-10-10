'use strict';

/* ============================================================
   Freightfolio - Freight Billing Cost & ROI Calculator
   Calculation engine (pure functions, no DOM access) is kept
   separate from the DOM wiring below so the math can be
   unit-tested independently (node).
   All money is USD. Internal precision is full float; rounding
   happens only at display time.
   ============================================================ */

/* Published Freightfolio packages - verified against
   https://freightfolio.net/ (#packages) on 2026-10-09. */
var PLANS = [
  { id: 'starter',  name: 'Starter',  monthly: 299, setup: 750,  docsCap: 100,
    blurb: 'Up to 100 docs/mo (roughly 25-35 loads)' },
  { id: 'business', name: 'Business', monthly: 599, setup: 1500, docsCap: 400,
    blurb: 'Up to 400 docs/mo (roughly 100-135 loads)' },
  { id: 'premium',  name: 'Premium',  monthly: 999, setup: 2500, docsCap: 1000,
    note: 'Starting at',
    blurb: 'Up to 1,000 docs/mo (roughly 250-330 loads)' }
];
var PILOT_PRICE = 500;
var OVERAGE_PER_DOC = 1.50;

var PRESET_SCENARIOS = [
  { id: 'conservative', label: 'Conservative', pct: 10 },
  { id: 'moderate',     label: 'Moderate',     pct: 25 },
  { id: 'optimistic',   label: 'Optimistic',   pct: 40 }
];

/* Reasonable input limits. */
var LIMITS = {
  loads:         { min: 0,      max: 100000, label: 'Monthly shipment volume', integer: true },
  docsPerLoad:   { min: 1,      max: 50,     label: 'Documents per load', integer: true },
  minutesPerLoad:{ min: 0,      max: 480,    label: 'Minutes per load' },
  hourlyCost:    { min: 0,      max: 1000,   label: 'Hourly labor cost' },
  reworkPct:     { min: 0,      max: 100,    label: 'Rework percentage' },
  reworkMinutes: { min: 0,      max: 480,    label: 'Rework minutes' },
  customPct:     { min: 1,      max: 90,     label: 'Custom improvement percentage', integer: true },
  scenarioPct:   { min: 1,      max: 90,     label: 'Improvement percentage' }
};

function toNumber(raw) {
  if (raw === null || raw === undefined) return NaN;
  var s = String(raw).trim().replace(/[$,%\s]/g, '');
  if (s === '') return NaN;
  return Number(s);
}

/* Validate one numeric field. Returns { ok, value, error }. */
function validateField(raw, key) {
  var lim = LIMITS[key];
  var n = toNumber(raw);
  if (!isFinite(n)) {
    return { ok: false, value: NaN, error: lim.label + ' must be a number.' };
  }
  if (n < lim.min || n > lim.max) {
    return { ok: false, value: NaN,
      error: lim.label + ' must be between ' + lim.min + ' and ' + lim.max + '.' };
  }
  if (lim.integer && !Number.isInteger(n)) {
    return { ok: false, value: NaN,
      error: lim.label + ' must be a whole number.' };
  }
  return { ok: true, value: n, error: null };
}

/* Validate the full input set. raw = { loads, docsPerLoad, minutesPerLoad,
   hourlyCost, reworkPct, reworkMinutes, scenarioPct }. */
function validateInputs(raw) {
  var errors = {};
  var values = {};
  var keys = ['loads', 'docsPerLoad', 'minutesPerLoad', 'hourlyCost',
              'reworkPct', 'reworkMinutes', 'scenarioPct'];
  var allOk = true;
  for (var i = 0; i < keys.length; i++) {
    var r = validateField(raw[keys[i]], keys[i]);
    values[keys[i]] = r.value;
    if (!r.ok) { errors[keys[i]] = r.error; allOk = false; }
  }
  return { valid: allOk, errors: errors, values: values };
}

/* Core cost model. Never divides by zero. */
function calculateCosts(v) {
  var baseHours   = v.loads * v.minutesPerLoad / 60;
  var reworkHours = v.loads * (v.reworkPct / 100) * v.reworkMinutes / 60;
  var totalHours  = baseHours + reworkHours;
  var monthlyCost = totalHours * v.hourlyCost;
  var annualCost  = monthlyCost * 12;
  var costPerLoad = v.loads > 0 ? monthlyCost / v.loads : 0;
  var monthlyDocs = v.loads * v.docsPerLoad;
  return {
    baseHours: baseHours,
    reworkHours: reworkHours,
    totalHours: totalHours,
    monthlyCost: monthlyCost,
    annualCost: annualCost,
    costPerLoad: costPerLoad,
    monthlyDocs: monthlyDocs,
    baseCost: baseHours * v.hourlyCost,
    reworkCost: reworkHours * v.hourlyCost
  };
}

/* Improvement scenario model for one percentage. */
function scenarioModel(costs, hourlyCost, pct) {
  var p = pct / 100;
  var hoursReleased = costs.totalHours * p;
  var capacityValue = hoursReleased * hourlyCost;
  var remainingHours = costs.totalHours - hoursReleased;
  var remainingLaborCost = remainingHours * hourlyCost;
  return {
    pct: pct,
    hoursReleased: hoursReleased,
    annualHoursReleased: hoursReleased * 12,
    capacityValue: capacityValue,
    annualCapacityValue: capacityValue * 12,
    remainingHours: remainingHours,
    remainingLaborCost: remainingLaborCost
  };
}

/* Smallest plan whose documented capacity covers the volume.
   Returns the plan object, or null when every plan is exceeded. */
function recommendPlan(monthlyDocs) {
  for (var i = 0; i < PLANS.length; i++) {
    if (monthlyDocs <= PLANS[i].docsCap) return PLANS[i];
  }
  return null;
}

/* Financial comparison for every plan that fits the volume. */
function planComparisons(costs, hourlyCost, monthlyDocs, scenarioPct) {
  var sc = scenarioModel(costs, hourlyCost, scenarioPct);
  var out = [];
  for (var i = 0; i < PLANS.length; i++) {
    var plan = PLANS[i];
    if (monthlyDocs > plan.docsCap) continue;
    var setupAmortized = plan.setup / 12;
    var totalModeled = plan.monthly + setupAmortized + sc.remainingLaborCost;
    out.push({
      plan: plan,
      monthlySub: plan.monthly,
      setup: plan.setup,
      setupAmortized: setupAmortized,
      remainingLaborCost: sc.remainingLaborCost,
      totalModeled: totalModeled,
      /* Positive = modeled monthly cost below current admin cost. */
      difference: costs.monthlyCost - totalModeled
    });
  }
  return out;
}

/* Rules-based recommendations from the visitor's inputs. */
function buildRecommendations(costs, v, plan) {
  var recs = [];
  if (v.loads === 0 || costs.totalHours === 0) {
    recs.push('Enter your typical monthly load volume and processing time to see a meaningful estimate.');
    return recs;
  }
  var reworkShare = costs.totalHours > 0
    ? (costs.reworkHours / costs.totalHours) * 100 : 0;
  if (v.reworkPct >= 25 || reworkShare >= 30) {
    recs.push('Rework is a large share of your billing workload (' +
      Math.round(reworkShare) + '% of admin hours). Missing documents and exceptions are usually the fastest win: a daily exception list keeps loads from stalling.');
  } else if (v.reworkPct >= 10) {
    recs.push('About ' + Math.round(reworkShare) + '% of your billing hours go to rework. Tightening document collection up front typically cuts this faster than adding staff.');
  }
  if (plan) {
    recs.push('Your estimated volume of about ' + Math.round(costs.monthlyDocs) +
      ' documents per month fits the ' + plan.name + ' plan (' + plan.blurb + ').');
    if (costs.monthlyDocs > plan.docsCap * 0.85) {
      recs.push('You are near the top of the ' + plan.name + ' document range. Documents over the plan volume are billed at $' +
        OVERAGE_PER_DOC.toFixed(2) + ' each, and Freightfolio moves you to the next tier when that is cheaper.');
    }
  } else {
    recs.push('Your estimated volume of about ' + Math.round(costs.monthlyDocs) +
      ' documents per month is above the published plan capacities. Request a free billing assessment for custom pricing.');
  }
  if (costs.costPerLoad >= 15) {
    recs.push('At ' + fmtUSD(costs.costPerLoad) + ' of admin cost per load, paperwork is a meaningful line item. The $' +
      PILOT_PRICE + ' pilot runs on your actual loads and measures the real before-and-after.');
  } else {
    recs.push('Even at a modest cost per load, the hours add up across a year. The free billing readiness checker shows where documentation breaks down today.');
  }
  return recs;
}

/* ------------------------- formatting ------------------------- */

function fmtUSD(n) {
  return Number(n).toLocaleString('en-US',
    { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtUSD0(n) {
  return Number(n).toLocaleString('en-US',
    { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtHours(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}
function fmtInt(n) {
  return Math.round(Number(n)).toLocaleString('en-US');
}
function fmtPct(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
}
function todayStamp() {
  return new Date().toLocaleDateString('en-US',
    { year: 'numeric', month: 'long', day: 'numeric' });
}

/* ------------------------- DOM wiring ------------------------- */

var els = {};
var state = {
  started: false,
  completed: false,
  scenarioId: 'moderate',
  customPct: 25,
  lastValid: null
};

function $(id) { return document.getElementById(id); }

function trackEvent(name) {
  try {
    if (typeof window.gtag === 'function') window.gtag('event', name);
  } catch (e) { /* analytics must never break the calculator */ }
}

function readRaw() {
  return {
    loads: els.loads.value,
    docsPerLoad: els.docsPerLoad.value,
    minutesPerLoad: els.minutesPerLoad.value,
    hourlyCost: els.hourlyCost.value,
    reworkPct: els.reworkPct.value,
    reworkMinutes: els.reworkMinutes.value,
    scenarioPct: state.scenarioId === 'custom' ? els.customPct.value
      : String(PRESET_SCENARIOS.filter(function (s) { return s.id === state.scenarioId; })[0].pct)
  };
}

function showErrors(errors) {
  var keys = ['loads', 'docsPerLoad', 'minutesPerLoad', 'hourlyCost',
              'reworkPct', 'reworkMinutes', 'customPct'];
  for (var i = 0; i < keys.length; i++) {
    var msg = $('err-' + keys[i]);
    var input = els[keys[i]] || $(keys[i]);
    if (!msg) continue;
    if (errors[keys[i]]) {
      msg.textContent = errors[keys[i]];
      msg.hidden = false;
      if (input) input.setAttribute('aria-invalid', 'true');
    } else {
      msg.textContent = '';
      msg.hidden = true;
      if (input) input.removeAttribute('aria-invalid');
    }
  }
}

/* HTML/CSS stacked bar: base prep cost vs rework cost.
   (Div-based: immune to SVG aspect-ratio distortion on narrow screens.) */
function costBarHTML(costs) {
  var total = costs.monthlyCost;
  var baseW = total > 0 ? (costs.baseCost / total) * 100 : 0;
  var reworkW = total > 0 ? (costs.reworkCost / total) * 100 : 0;
  return '' +
    '<div class="cost-bar" role="img" aria-label="Monthly cost breakdown: ' +
    fmtUSD(costs.baseCost) + ' standard preparation, ' + fmtUSD(costs.reworkCost) + ' rework.">' +
    '<div class="seg-base" style="width:' + baseW.toFixed(1) + '%"></div>' +
    '<div class="seg-rework" style="width:' + reworkW.toFixed(1) + '%"></div>' +
    '</div>';
}

/* SVG donut: released vs remaining hours. */
function scenarioDonutSVG(sc) {
  var total = sc.hoursReleased + sc.remainingHours;
  var frac = total > 0 ? sc.hoursReleased / total : 0;
  var r = 15.9155; /* circumference = 100 */
  var released = (frac * 100).toFixed(1);
  var remaining = (100 - frac * 100).toFixed(1);
  return '' +
    '<svg viewBox="0 0 42 42" class="donut" role="img" aria-label="Scenario split: ' +
    fmtHours(sc.hoursReleased) + ' hours potentially released, ' +
    fmtHours(sc.remainingHours) + ' hours remaining.">' +
    '<circle cx="21" cy="21" r="' + r + '" fill="none" stroke="#E3DED4" stroke-width="6"/>' +
    '<circle cx="21" cy="21" r="' + r + '" fill="none" stroke="#F5A623" stroke-width="6" ' +
    'stroke-dasharray="' + released + ' ' + remaining + '" stroke-dashoffset="25" stroke-linecap="round"/>' +
    '<text x="21" y="24" text-anchor="middle" class="donut-label">' + sc.pct + '%</text>' +
    '</svg>';
}

function renderDashboard(costs, v) {
  $('m-hours').textContent = fmtHours(costs.totalHours);
  $('m-monthly').textContent = fmtUSD(costs.monthlyCost);
  $('m-annual').textContent = fmtUSD(costs.annualCost);
  $('m-perload').textContent = fmtUSD(costs.costPerLoad);
  $('cost-split').innerHTML =
    '<div class="split-legend">' +
    '<span><i class="sw sw-navy"></i>Standard prep: ' + fmtUSD(costs.baseCost) + ' (' + fmtHours(costs.baseHours) + ' hrs)</span>' +
    '<span><i class="sw sw-amber"></i>Rework and exceptions: ' + fmtUSD(costs.reworkCost) + ' (' + fmtHours(costs.reworkHours) + ' hrs)</span>' +
    '</div>' + costBarHTML(costs);
}

function renderScenario(costs, v, pct) {
  var sc = scenarioModel(costs, v.hourlyCost, pct);
  $('s-released').textContent = fmtHours(sc.hoursReleased);
  $('s-released-annual').textContent = fmtHours(sc.annualHoursReleased);
  $('s-value').textContent = fmtUSD(sc.capacityValue);
  $('s-remaining').textContent = fmtHours(sc.remainingHours);
  $('s-donut').innerHTML = scenarioDonutSVG(sc);
  $('scenario-note').textContent =
    'Illustrative model at ' + pct + '%: figures are estimates from your inputs, not verified Freightfolio results or promised savings.';
  return sc;
}

function renderComparison(costs, v, pct, sc) {
  var rows = planComparisons(costs, v.hourlyCost, costs.monthlyDocs, pct);
  var wrap = $('plan-rows');
  if (!rows.length) {
    wrap.innerHTML =
      '<div class="plan-card plan-custom">' +
      '<h3>Custom assessment</h3>' +
      '<p>Your estimated volume of about <strong>' + fmtInt(costs.monthlyDocs) + ' documents per month</strong> ' +
      'is above the published plan capacities (Starter up to 100, Business up to 400, Premium up to 1,000 docs/mo). ' +
      'Request a free billing assessment and we will scope custom pricing for your operation.</p>' +
      '<a class="btn btn-amber" href="/#contact" data-ga="billing_calculator_contact_click">Request a free billing assessment</a>' +
      '</div>';
    return null;
  }
  var html = '';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var plan = r.plan;
    var diffClass = r.difference >= 0 ? 'diff-pos' : 'diff-neg';
    var diffText = (r.difference >= 0 ? '' : '-') + fmtUSD(Math.abs(r.difference));
    html +=
      '<div class="plan-card' + (i === 0 ? ' plan-best' : '') + '">' +
      (i === 0 ? '<p class="plan-fit">Best fit for your volume</p>' : '') +
      '<h3>' + plan.name + '</h3>' +
      '<p class="plan-cap">' + plan.blurb + '</p>' +
      '<dl class="plan-figs">' +
      '<div><dt>Monthly subscription</dt><dd>' + fmtUSD(plan.monthly) + '/mo' + (plan.note ? ' <span class="plan-note">(' + plan.note + ')</span>' : '') + '</dd></div>' +
      '<div><dt>One-time setup</dt><dd>' + fmtUSD0(plan.setup) + '</dd></div>' +
      '<div><dt>Setup amortized (12 mo)</dt><dd>' + fmtUSD(r.setupAmortized) + '/mo</dd></div>' +
      '<div><dt>Modeled remaining admin labor</dt><dd>' + fmtUSD(r.remainingLaborCost) + '/mo</dd></div>' +
      '<div class="plan-total"><dt>Total modeled monthly cost</dt><dd>' + fmtUSD(r.totalModeled) + '/mo</dd></div>' +
      '<div class="plan-diff"><dt>Modeled monthly difference vs today</dt><dd class="' + diffClass + '">' + diffText + '</dd></div>' +
      '</dl>' +
      '<p class="plan-fine">Modeled difference compares your current estimated admin cost (' + fmtUSD(costs.monthlyCost) +
      '/mo) with the plan cost plus modeled remaining labor. It is an illustration from your inputs, not a savings guarantee.</p>' +
      '</div>';
  }
  wrap.innerHTML = html;
  bindCtaTracking(wrap);
  return rows[0];
}

function renderReport(costs, v, sc, bestPlan) {
  var date = todayStamp();
  function row(k, val) { return '<tr><th scope="row">' + k + '</th><td>' + val + '</td></tr>'; }
  var scenRows = '';
  var all = PRESET_SCENARIOS.slice();
  if (state.scenarioId === 'custom') all.push({ id: 'custom', label: 'Custom', pct: state.customPct });
  for (var i = 0; i < all.length; i++) {
    var m = scenarioModel(costs, v.hourlyCost, all[i].pct);
    scenRows += '<tr><td>' + all[i].label + ' (' + all[i].pct + '%)</td><td>' +
      fmtHours(m.hoursReleased) + '</td><td>' + fmtUSD(m.capacityValue) + '</td><td>' +
      fmtHours(m.remainingHours) + '</td></tr>';
  }
  var recs = buildRecommendations(costs, v, bestPlan ? bestPlan.plan : null);
  var recItems = '';
  for (var j = 0; j < recs.length; j++) recItems += '<li>' + recs[j] + '</li>';

  var compareRows;
  if (bestPlan) {
    var p = bestPlan.plan;
    compareRows =
      row('Potentially applicable package', p.name + ' (' + p.blurb + ')') +
      row('Monthly subscription', fmtUSD(p.monthly) + '/mo' + (p.note ? ' (' + p.note + ')' : '')) +
      row('One-time setup fee', fmtUSD0(p.setup)) +
      row('Modeled remaining admin labor', fmtUSD(bestPlan.remainingLaborCost) + '/mo') +
      row('Total modeled monthly cost', fmtUSD(bestPlan.totalModeled) + '/mo') +
      row('Modeled monthly difference vs today', (bestPlan.difference >= 0 ? '' : '-') + fmtUSD(Math.abs(bestPlan.difference)));
  } else {
    compareRows = row('Potentially applicable package',
      'None: estimated volume exceeds published plan capacities. Request a free billing assessment for custom pricing.');
  }

  $('calc-report').innerHTML =
    '<div class="print-brand">' +
    '<span class="brand-word">Freight<span class="brand-light">folio</span><span class="brand-dot">.</span></span>' +
    '<p><strong>Freight Billing Cost Assessment</strong></p>' +
    '<p class="report-date">Generated ' + date + ' &middot; freightfolio.net/freight-billing-calculator</p>' +
    '</div>' +
    '<h2>1. Business operating assumptions</h2>' +
    '<table class="report-table"><tbody>' +
    row('Monthly load volume', fmtInt(v.loads) + ' loads') +
    row('Estimated documents per load', fmtInt(v.docsPerLoad)) +
    row('Estimated monthly document volume', fmtInt(costs.monthlyDocs) + ' documents') +
    row('Average processing time', fmtInt(v.minutesPerLoad) + ' minutes per load') +
    row('Loads requiring rework', fmtPct(v.reworkPct)) +
    row('Additional time per rework load', fmtInt(v.reworkMinutes) + ' minutes') +
    row('Hourly administrative labor cost', fmtUSD(v.hourlyCost)) +
    '</tbody></table>' +
    '<h2>2. Current cost assessment</h2>' +
    '<table class="report-table"><tbody>' +
    row('Monthly processing hours', fmtHours(costs.baseHours)) +
    row('Monthly rework hours', fmtHours(costs.reworkHours)) +
    row('Total monthly administrative hours', fmtHours(costs.totalHours)) +
    row('Estimated monthly labor cost', fmtUSD(costs.monthlyCost)) +
    row('Estimated annual labor cost', fmtUSD(costs.annualCost)) +
    row('Estimated cost per load', fmtUSD(costs.costPerLoad)) +
    '</tbody></table>' +
    '<h2>3. Improvement scenarios</h2>' +
    '<p class="report-note">Illustrative modeling assumptions, not verified Freightfolio performance results or promised savings.</p>' +
    '<table class="report-table"><thead><tr><th>Scenario</th><th>Hours released/mo</th><th>Labor capacity value/mo</th><th>Remaining hours/mo</th></tr></thead><tbody>' +
    scenRows + '</tbody></table>' +
    '<h2>4. Freightfolio service comparison</h2>' +
    '<p class="report-note">Compared at the ' + sc.pct + '% scenario. Setup fee amortized over 12 months for modeling.</p>' +
    '<table class="report-table"><tbody>' + compareRows + '</tbody></table>' +
    '<h2>5. Recommendations</h2><ul class="report-recs">' + recItems + '</ul>' +
    '<h2>6. Disclaimer</h2>' +
    '<p class="report-note">These calculations are estimates based on the inputs you provided and hypothetical improvement assumptions. ' +
    'They do not guarantee cost reductions, revenue improvements, or payment acceleration. Freightfolio does not eliminate all administrative labor, ' +
    'and released hours represent labor capacity value (time that could be redirected), not automatic payroll savings. ' +
    'Cash savings occur only when actual expenses are reduced. Verify any decision with your own financial review.</p>';
}

function recalc() {
  var raw = readRaw();
  var checked = validateInputs(raw);
  showErrors(checked.errors);
  var results = $('calc-results');
  var empty = $('calc-empty');
  if (!checked.valid) {
    results.hidden = true;
    empty.hidden = false;
    state.lastValid = null;
    return;
  }
  var v = checked.values;
  var costs = calculateCosts(v);
  var pct = state.scenarioId === 'custom' ? v.scenarioPct :
    PRESET_SCENARIOS.filter(function (s) { return s.id === state.scenarioId; })[0].pct;
  state.customPct = pct;

  renderDashboard(costs, v);
  var sc = renderScenario(costs, v, pct);
  var best = renderComparison(costs, v, pct, sc);
  renderReport(costs, v, sc, best);

  results.hidden = false;
  empty.hidden = true;
  state.lastValid = { v: v, costs: costs, pct: pct };
  /* A completion counts only after the visitor has actually interacted
     with the calculator. The initial default render on page load must
     not inflate completion statistics. */
  if (!state.completed && state.started) {
    state.completed = true;
    trackEvent('billing_calculator_completed');
  }
}

function setScenario(id) {
  state.scenarioId = id;
  var pills = document.querySelectorAll('.scenario-pill');
  for (var i = 0; i < pills.length; i++) {
    var active = pills[i].getAttribute('data-scenario') === id;
    pills[i].classList.toggle('active', active);
    pills[i].setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  var customWrap = $('custom-pct-wrap');
  customWrap.hidden = (id !== 'custom');
  els.customPct.required = (id === 'custom');
  trackEvent('billing_calculator_scenario_changed');
  recalc();
}

function bindCtaTracking(scope) {
  var links = scope.querySelectorAll('[data-ga]');
  for (var i = 0; i < links.length; i++) {
    (function (el) {
      if (el.getAttribute('data-ga-bound')) return;
      el.setAttribute('data-ga-bound', '1');
      el.addEventListener('click', function () {
        trackEvent(el.getAttribute('data-ga'));
      });
    })(links[i]);
  }
}

function init() {
  var ids = ['loads', 'docsPerLoad', 'minutesPerLoad', 'hourlyCost',
             'reworkPct', 'reworkMinutes', 'customPct'];
  for (var i = 0; i < ids.length; i++) els[ids[i]] = $(ids[i]);
  els.form = $('calc-form');

  /* Prevent any native submission (privacy: nothing leaves the browser). */
  els.form.addEventListener('submit', function (e) { e.preventDefault(); });

  var deb = null;
  function queueRecalc() {
    if (!state.started) {
      state.started = true;
      trackEvent('billing_calculator_started');
    }
    clearTimeout(deb);
    deb = setTimeout(recalc, 250);
  }
  var inputs = els.form.querySelectorAll('input');
  for (var j = 0; j < inputs.length; j++) {
    inputs[j].addEventListener('input', queueRecalc);
    inputs[j].addEventListener('change', queueRecalc);
  }

  var pills = document.querySelectorAll('.scenario-pill');
  for (var k = 0; k < pills.length; k++) {
    pills[k].addEventListener('click', function () {
      setScenario(this.getAttribute('data-scenario'));
    });
  }

  $('reset-btn').addEventListener('click', function () {
    /* Explicit defaults (not form.reset()) so the reset cannot fail silently. */
    var defaults = { loads: 200, docsPerLoad: 3, minutesPerLoad: 15,
                     hourlyCost: 25, reworkPct: 15, reworkMinutes: 20, customPct: 25 };
    for (var k in defaults) { if (els[k]) els[k].value = defaults[k]; }
    showErrors({});
    setScenario('moderate'); /* also re-runs the calculation */
  });

  $('print-btn').addEventListener('click', function () {
    trackEvent('billing_calculator_report_download');
    window.print();
  });

  bindCtaTracking(document);
  setScenario('moderate');
  trackEvent('billing_calculator_view');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
