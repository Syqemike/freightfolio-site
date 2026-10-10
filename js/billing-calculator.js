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
  { id: 'starter',  name: 'Starter',  monthly: 39,  docsCap: 100,
    blurb: 'Up to 100 docs/mo (roughly 25-35 loads)' },
  { id: 'business', name: 'Business', monthly: 149, docsCap: 400,
    blurb: 'Up to 400 docs/mo (roughly 100-135 loads)' },
  { id: 'premium',  name: 'Premium',  monthly: 369, docsCap: 1000,
    note: 'Starting at',
    blurb: 'Up to 1,000 docs/mo (roughly 250-330 loads)' }
];
var PILOT_PRICE = 500;
var OVERAGE_PER_DOC = 0.40;

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

/* Human label for the active scenario, e.g. "Conservative (10%)". */
function scenarioLabel(pct, isCustom) {
  if (!isCustom) {
    for (var i = 0; i < PRESET_SCENARIOS.length; i++) {
      if (PRESET_SCENARIOS[i].pct === pct) {
        return PRESET_SCENARIOS[i].label + ' (' + pct + '%)';
      }
    }
  }
  return 'Custom (' + pct + '%)';
}

/* Cheapest eligible total: for each plan, price + overage on docs above its
   cap; pick the lowest total (ties go to the higher tier for headroom).
   Published overage policy ($0.40/doc) means no price cliffs. */
function serviceOptionFor(monthlyDocs) {
  var best = null;
  for (var i = 0; i < PLANS.length; i++) {
    var plan = PLANS[i];
    var overDocs = Math.max(0, Math.ceil(monthlyDocs - plan.docsCap));
    var total = plan.monthly + overDocs * OVERAGE_PER_DOC;
    if (!best || total < best.monthlyService - 1e-9 ||
        (Math.abs(total - best.monthlyService) <= 1e-9 && i > best.idx)) {
      best = { idx: i, plan: plan, overageDocs: overDocs, monthlyService: total };
    }
  }
  return {
    kind: best.overageDocs > 0 ? 'overage' : 'plan',
    plan: best.plan,
    overageDocs: best.overageDocs,
    overageCost: best.overageDocs * OVERAGE_PER_DOC,
    monthlyService: best.monthlyService
  };
}

/* Before / with-service / difference model for one scenario.
   difference = current monthly admin cost - total modeled monthly cost.
   Positive means the model comes out cheaper than today. */
function worthItModel(costs, hourlyCost, monthlyDocs, pct) {
  var svc = serviceOptionFor(monthlyDocs);
  var sc = scenarioModel(costs, hourlyCost, pct);
  var monthlyService = svc.kind === 'plan' ? svc.plan.monthly : svc.monthlyService;
  var totalModeled = monthlyService + sc.remainingLaborCost;
  var difference = costs.monthlyCost - totalModeled;
  var verdict = difference > 5 ? 'benefit'
    : (difference < -5 ? 'additional' : 'breakeven');
  /* Improvement % at which the monthly service cost alone is covered by admin savings. */
  var breakEvenPct = costs.monthlyCost > 0
    ? (monthlyService / costs.monthlyCost) * 100 : null;
  return {
    service: svc,
    scenario: sc,
    before: {
      monthly: costs.monthlyCost,
      hours: costs.totalHours,
      annual: costs.annualCost
    },
    withService: {
      monthlyService: monthlyService,
      overageDocs: svc.kind === 'overage' ? svc.overageDocs : 0,
      overageCost: svc.kind === 'overage' ? svc.overageCost : 0,
      remainingLabor: sc.remainingLaborCost,
      total: totalModeled
    },
    difference: difference,
    verdict: verdict,
    breakEvenPct: breakEvenPct
  };
}

/* Plain-English verdict for the modeled financial difference. */
function verdictFor(difference) {
  if (difference > 5) {
    return { cls: 'diff-pos', kind: 'benefit',
      headline: 'Modeled financial benefit',
      text: fmtUSD(difference) + '/mo less than your current cost' };
  }
  if (difference < -5) {
    return { cls: 'diff-neg', kind: 'additional',
      headline: 'Modeled additional cost',
      text: fmtUSD(-difference) + '/mo more than your current cost' };
  }
  return { cls: 'diff-even', kind: 'breakeven',
    headline: 'Approximately break-even',
    text: 'within ' + fmtUSD(5) + '/mo of your current cost' };
}

/* Plain-English summary paragraph for the results hero and the PDF. */
function summaryText(costs, hourlyCost, pct, label) {
  var s = scenarioModel(costs, hourlyCost, pct);
  return 'Your team currently spends approximately ' + fmtHours(costs.totalHours) +
    ' hours per month on freight billing paperwork, costing an estimated ' +
    fmtUSD(costs.monthlyCost) + '. Under the selected ' + label +
    ' improvement scenario, ' + fmtHours(s.hoursReleased) +
    ' hours could potentially be redirected to other work each month. ' +
    'This is a hypothetical illustration, not a guaranteed outcome.';
}

/* Plain-English conclusion for the PDF executive summary. */
function buildConclusion(costs, v, wm, verdict, label) {
  var svc = wm.service;
  var svcDesc = svc.kind === 'plan'
    ? 'the ' + svc.plan.name + ' plan at ' + fmtUSD(wm.withService.monthlyService) + '/mo'
    : 'the ' + svc.plan.name + ' plan at ' + fmtUSD(wm.withService.monthlyService) + '/mo' +
      ' (' + fmtUSD(svc.plan.monthly) + ' base + ' + fmtInt(svc.overageDocs) +
      ' overage documents at ' + fmtUSD(OVERAGE_PER_DOC) + ' each, the cheapest eligible total)';
  return 'At about ' + fmtInt(costs.monthlyDocs) + ' documents per month, ' + svcDesc +
    '. Under the ' + label +
    ' scenario, the modeled total is ' + fmtUSD(wm.withService.total) + '/mo, which is ' +
    verdict.text + '. ' + fmtHours(wm.scenario.hoursReleased) +
    ' hours per month of labor capacity could be redirected to other work. ' +
    'That is not the same as cash savings: cash is saved only when payroll, overtime, or contractor spend actually goes down.';
}

/* Plain-English break-even explanation. */
function breakEvenText(wm, label) {
  var svcCost = wm.withService.monthlyService;
  if (wm.breakEvenPct === null) {
    return 'Break-even cannot be calculated because your current modeled administrative cost is $0. Enter your typical volumes to see this analysis.';
  }
  var pctTxt = wm.breakEvenPct > 100
    ? 'more than 100%'
    : 'approximately ' + Math.round(wm.breakEvenPct) + '%';
  var text = 'To offset the modeled monthly service cost of ' + fmtUSD(svcCost) +
    ' through reduced administrative labor expenses alone, your business would need to eliminate ' +
    pctTxt + ' of its current billing administration cost.';
  if (wm.breakEvenPct > 100) {
    text += ' In other words, administrative labor savings alone could not cover the modeled service cost at your current volumes.';
  }
  text += ' This is about actual cost reduction (lower payroll, overtime, or contractor spend), not merely freeing employee time.';
  return text;
}

/* Rules-based recommendations from the visitor's inputs. */
function buildRecommendations(costs, v, svc) {
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
  if (svc.kind === 'plan') {
    var plan = svc.plan;
    recs.push('Your estimated volume of about ' + Math.round(costs.monthlyDocs) +
      ' documents per month fits the ' + plan.name + ' plan (up to ' + fmtInt(plan.docsCap) + ' docs/mo).');
    if (costs.monthlyDocs > plan.docsCap * 0.85) {
      recs.push('You are near the top of the ' + plan.name + ' document range. Documents over the plan volume are billed at $' +
        OVERAGE_PER_DOC.toFixed(2) + ' each, and Freightfolio moves you to the next tier when that is cheaper.');
    }
  } else {
    recs.push('At about ' + Math.round(costs.monthlyDocs) +
      ' documents per month, the cheapest eligible total is the ' + svc.plan.name +
      ' plan with overage: ' + fmtUSD(svc.plan.monthly) + '/mo base + ' +
      fmtInt(svc.overageDocs) + ' documents at ' + fmtUSD(OVERAGE_PER_DOC) +
      ' each. If your volume keeps growing, ask about managed volume pricing.');
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

function renderSummary(costs, v, pct, label) {
  var sc = scenarioModel(costs, v.hourlyCost, pct);
  $('m-sum-cost').textContent = fmtUSD(costs.monthlyCost);
  $('m-sum-hours').textContent = fmtHours(costs.totalHours);
  $('m-sum-released').textContent = fmtHours(sc.hoursReleased);
  $('m-sum-value').textContent = fmtUSD(sc.capacityValue);
  $('summary-text').textContent = summaryText(costs, v.hourlyCost, pct, label);
}

function kv(k, val, cls) {
  return '<div' + (cls ? ' class="' + cls + '"' : '') + '><dt>' + k + '</dt><dd>' + val + '</dd></div>';
}

/* "Is Freightfolio worth the cost?" before / with / verdict. */
function renderWorthIt(costs, v, pct, label) {
  var wm = worthItModel(costs, v.hourlyCost, costs.monthlyDocs, pct);
  var svc = wm.service;
  var plan = svc.plan;
  var w = wm.withService;

  $('w-before').innerHTML =
    kv('Monthly admin cost', fmtUSD(wm.before.monthly)) +
    kv('Monthly admin hours', fmtHours(wm.before.hours)) +
    kv('Annual admin cost', fmtUSD(wm.before.annual));

  var withHtml;
  var svcName = svc.kind === 'plan' ? plan.name : plan.name + ' + overage';
  var svcDetail;
  if (svc.kind === 'plan') {
    svcDetail = fmtUSD(w.monthlyService) + '/mo' + (plan.note ? ' <span class="plan-note">(' + plan.note + ')</span>' : '');
  } else {
    svcDetail = fmtUSD(w.monthlyService) + '/mo <span class="plan-note">(' +
      fmtUSD(plan.monthly) + ' base + ' + fmtInt(svc.overageDocs) + ' docs &times; ' +
      fmtUSD(OVERAGE_PER_DOC) + ' overage)</span>';
  }
  var utilTxt = svc.kind === 'plan'
    ? fmtInt(costs.monthlyDocs) + ' of ' + fmtInt(plan.docsCap) + ' included docs'
    : fmtInt(costs.monthlyDocs) + ' docs (' + fmtInt(plan.docsCap) + ' included + ' +
      fmtInt(svc.overageDocs) + ' overage)';
  withHtml =
    kv('Service', svcName) +
    kv('Monthly service', svcDetail) +
    kv('Plan utilization', utilTxt) +
    kv('Remaining admin labor', fmtUSD(w.remainingLabor) + '/mo <span class="plan-note">(at the ' + label + ' scenario)</span>') +
    kv('Total modeled monthly cost', fmtUSD(w.total) + '/mo', 'kv-total');
  $('w-with').innerHTML = withHtml;

  var note = $('w-note');
  if (svc.kind === 'overage') {
    note.hidden = false;
    note.textContent = 'Overage is ' + fmtUSD(OVERAGE_PER_DOC) + ' per document above the included volume. ' +
      'This is the cheapest eligible total at your volume; if your volume keeps growing, ask about managed volume pricing.';
  } else {
    note.hidden = true;
    note.textContent = '';
  }

  var verdict = verdictFor(wm.difference);
  var banner = $('w-verdict');
  banner.className = 'verdict-banner verdict-' + verdict.kind;
  banner.innerHTML =
    '<p class="verdict-kicker">The financial difference</p>' +
    '<p class="verdict-headline ' + verdict.cls + '">' + verdict.headline + '</p>' +
    '<p class="verdict-text">' + verdict.text + '.</p>' +
    '<p class="fine-note">Illustrative model using the ' + label +
    ' scenario. Released hours are labor capacity value (time your team could redirect), not automatic cash savings. ' +
    'Cash savings happen only when actual expenses are reduced.</p>' +
    '<p class="fine-note">Need document chasing, manual exception resolution, or custom procedures? ' +
    'That is our managed service, quoted separately from $' + fmtInt(MANAGED_FROM) + '/mo. ' +
    '<a href="/#contact">Ask about managed billing</a>.</p>';
  return wm;
}

function renderBreakEven(costs, v, pct, label) {
  var wm = worthItModel(costs, v.hourlyCost, costs.monthlyDocs, pct);
  var el = $('breakeven-block');
  if (wm.breakEvenPct === null) {
    el.innerHTML = '<div class="breakeven-card"><p>Break-even cannot be calculated because your current modeled administrative cost is $0. Enter your typical volumes to see this analysis.</p></div>';
    return wm;
  }
  var pctDisplay = wm.breakEvenPct > 100 ? '100%+' : Math.round(wm.breakEvenPct) + '%';
  el.innerHTML =
    '<div class="breakeven-card">' +
    '<p class="breakeven-pct">' + pctDisplay + '</p>' +
    '<p>' + breakEvenText(wm, label) + '</p>' +
    '</div>';
  return wm;
}

function renderReport(costs, v, pct, label) {
  var wm = worthItModel(costs, v.hourlyCost, costs.monthlyDocs, pct);
  var svc = wm.service;
  var plan = svc.plan;
  var w = wm.withService;
  var sc = wm.scenario;
  var verdict = verdictFor(wm.difference);
  var date = todayStamp();
  function row(k, val) { return '<tr><th scope="row">' + k + '</th><td>' + val + '</td></tr>'; }

  /* Service description lines shared by both pages. */
  var svcName = svc.kind === 'plan' ? plan.name : plan.name + ' + overage*';
  var svcCostLine = svc.kind === 'plan'
    ? fmtUSD(w.monthlyService) + '/mo' + (plan.note ? ' (' + plan.note + ')' : '')
    : fmtUSD(w.monthlyService) + '/mo* (' + fmtUSD(plan.monthly) + ' base + ' +
      fmtInt(svc.overageDocs) + ' docs x ' + fmtUSD(OVERAGE_PER_DOC) + ')';
  var overageNote = svc.kind === 'overage'
    ? '<p class="report-note">*Overage is ' + fmtUSD(OVERAGE_PER_DOC) + ' per document above the included volume; shown is the cheapest eligible total at your volume.</p>'
    : '';

  /* ---------- PAGE 1: executive summary ---------- */
  var exec =
    '<section class="rpt-exec">' +
    '<div class="rpt-brand"><span class="brand-word">Freight<span class="brand-light">folio</span><span class="brand-dot">.</span></span>' +
    '<p class="rpt-title"><strong>Freight Billing Cost &amp; ROI Assessment</strong></p>' +
    '<p class="report-date">Generated ' + date + ' &middot; freightfolio.net/freight-billing-calculator</p></div>' +
    '<div class="rpt-verdict rpt-' + verdict.kind + '">' +
    '<p class="rpt-verdict-kicker">Financial verdict &middot; ' + label + ' scenario</p>' +
    '<p class="rpt-verdict-headline">' + verdict.headline + '</p>' +
    '<p class="rpt-verdict-text">' + verdict.text + '.</p></div>' +
    '<table class="report-table"><tbody>' +
    row('Monthly load volume', fmtInt(v.loads) + ' loads') +
    row('Monthly document volume', fmtInt(costs.monthlyDocs) + ' documents') +
    row('Current monthly cost', fmtUSD(costs.monthlyCost) + ' (' + fmtHours(costs.totalHours) + ' hrs)') +
    row('Hours potentially released', fmtHours(sc.hoursReleased) + '/mo') +
    row('Freightfolio service', svcName + ': ' + svcCostLine) +
    row('Total modeled monthly cost', fmtUSD(w.total) + '/mo') +
    '</tbody></table>' +
    '<p class="rpt-conclusion">' + buildConclusion(costs, v, wm, verdict, label) + '</p>' +
    overageNote +
    '</section>';

  /* ---------- PAGE 2: detailed breakdown ---------- */
  var scenRows = '';
  for (var i = 0; i < PRESET_SCENARIOS.length; i++) {
    var m = scenarioModel(costs, v.hourlyCost, PRESET_SCENARIOS[i].pct);
    scenRows += '<tr><td>' + PRESET_SCENARIOS[i].label + ' (' + PRESET_SCENARIOS[i].pct + '%)</td><td>' +
      fmtHours(m.hoursReleased) + '</td><td>' + fmtUSD(m.capacityValue) + '</td><td>' +
      fmtHours(m.remainingHours) + '</td></tr>';
  }
  if (state.scenarioId === 'custom') {
    var mc = scenarioModel(costs, v.hourlyCost, state.customPct);
    scenRows += '<tr><td>Custom (' + state.customPct + '%)</td><td>' + fmtHours(mc.hoursReleased) +
      '</td><td>' + fmtUSD(mc.capacityValue) + '</td><td>' + fmtHours(mc.remainingHours) + '</td></tr>';
  }
  var recs = buildRecommendations(costs, v, svc);
  var recItems = '';
  for (var j = 0; j < recs.length; j++) recItems += '<li>' + recs[j] + '</li>';

  var details =
    '<section class="rpt-details">' +
    '<h2>Operating assumptions</h2>' +
    '<table class="report-table"><tbody>' +
    row('Monthly load volume', fmtInt(v.loads) + ' loads') +
    row('Documents per load', fmtInt(v.docsPerLoad)) +
    row('Monthly document volume', fmtInt(costs.monthlyDocs) + ' documents') +
    row('Processing time', fmtInt(v.minutesPerLoad) + ' minutes per load') +
    row('Loads requiring rework', fmtPct(v.reworkPct)) +
    row('Rework time per affected load', fmtInt(v.reworkMinutes) + ' minutes') +
    row('Hourly administrative labor cost', fmtUSD(v.hourlyCost)) +
    '</tbody></table>' +
    '<h2>Current cost breakdown</h2>' +
    '<table class="report-table"><tbody>' +
    row('Standard preparation', fmtHours(costs.baseHours) + ' hrs &middot; ' + fmtUSD(costs.baseCost)) +
    row('Rework and exceptions', fmtHours(costs.reworkHours) + ' hrs &middot; ' + fmtUSD(costs.reworkCost)) +
    row('Total monthly hours', fmtHours(costs.totalHours)) +
    row('Monthly labor cost', fmtUSD(costs.monthlyCost)) +
    row('Annual labor cost', fmtUSD(costs.annualCost)) +
    row('Cost per load', fmtUSD(costs.costPerLoad)) +
    '</tbody></table>' +
    '<h2>Improvement scenarios</h2>' +
    '<p class="report-note">Illustrative modeling assumptions, not verified Freightfolio performance results or promised savings.</p>' +
    '<table class="report-table"><thead><tr><th>Scenario</th><th>Hours released/mo</th><th>Labor capacity value/mo</th><th>Remaining hours/mo</th></tr></thead><tbody>' +
    scenRows + '</tbody></table>' +
    '<h2>Freightfolio pricing comparison</h2>' +
    '<p class="report-note">Compared using the ' + label + ' scenario. All figures are illustrative estimates, not guaranteed savings.</p>' +
    '<table class="report-table"><tbody>' +
    row('Current monthly admin cost', fmtUSD(wm.before.monthly)) +
    row('Service', svcName + ': ' + svcCostLine) +
    row('Remaining admin labor', fmtUSD(w.remainingLabor) + '/mo') +
    row('Total modeled monthly cost', fmtUSD(w.total) + '/mo') +
    row('Bottom line', verdict.headline + ': ' + verdict.text) +
    '</tbody></table>' +
    overageNote +
    '<h2>Break-even analysis</h2>' +
    '<p>' + breakEvenText(wm, label) + '</p>' +
    '<h2>Recommendations</h2><ul class="report-recs">' + recItems + '</ul>' +
    '<h2>Disclaimer</h2>' +
    '<p class="report-note">These calculations are estimates based on the inputs you provided and hypothetical improvement assumptions. ' +
    'They do not guarantee cost reductions, revenue improvements, or payment acceleration. Freightfolio does not eliminate all administrative labor, ' +
    'and released hours represent labor capacity value (time that could be redirected), not automatic payroll savings. ' +
    'Cash savings occur only when actual expenses are reduced. Verify any decision with your own financial review.</p>' +
    '</section>';

  $('calc-report').innerHTML = exec + details;
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
  var label = scenarioLabel(pct, state.scenarioId === 'custom');

  renderDashboard(costs, v);
  renderSummary(costs, v, pct, label);
  renderScenario(costs, v, pct);
  renderWorthIt(costs, v, pct, label);
  renderBreakEven(costs, v, pct, label);
  renderReport(costs, v, pct, label);

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
