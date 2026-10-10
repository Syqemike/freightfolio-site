'use strict';
/* ============================================================================
   Freightfolio Billing Readiness Checker
   ----------------------------------------------------------------------------
   Rules-based shipment assessment. No AI, no backend, no storage: every
   answer stays in the visitor's browser and nothing is transmitted anywhere.

   assessReadiness(answers) is pure logic (no DOM access) so it can be unit
   tested in node. All DOM wiring is below and guarded, so this file is also
   safe to load in a non-browser environment.

   answers shape:
     customer_type: 'broker' | 'forwarder' | 'carrier'
     rate_confirmation | bol | pod | carrier_invoice: 'yes' | 'no' | 'unsure'
     pod_required: 'yes' | 'no' | 'unsure' | null  (asked only when pod is 'no')
     additional_charges: 'yes' | 'no' | 'unsure'
     accessorials: string[]            (e.g. ['detention','lumper'])
     receipts: 'yes' | 'no' | 'na' | 'unsure' | null
     load_number: string, amount: string (optional, display only)
   ============================================================================ */

var DOC_LABELS = {
  rate_confirmation: 'Rate confirmation',
  bol: 'Bill of lading (BOL)',
  pod: 'Proof of delivery (POD)',
  carrier_invoice: 'Carrier invoice',
  receipts: 'Supporting receipts for accessorial charges',
  charges: 'Additional charges'
};

var TYPE_LABELS = {
  broker: 'Freight Broker',
  forwarder: 'Freight Forwarder',
  carrier: 'Carrier'
};

/* Per-document guidance shown next to findings. missingNote is used when the
   item lands in the red list. softNote is used for the one remaining
   type-specific downgrade: a carrier's missing carrier invoice is flagged for
   review instead of treated as a hard blocker, because a carrier generates
   the invoice itself. A missing POD is no longer decided by company type:
   the visitor is asked directly whether their customer requires a signed POD,
   so the classification reflects the actual billing requirement. */
var DOC_GUIDANCE = {
  rate_confirmation: {
    missingNote: 'The agreed rate should be on file before anything else moves. Confirm the rate with all parties.'
  },
  bol: {
    missingNote: 'The BOL is the contract of carriage. Get a signed copy from pickup.'
  },
  pod: {
    missingNote: 'Most customers and factors require a signed POD before the invoice can go out or be funded.'
  },
  carrier_invoice: {
    missingNote: 'Needed to verify what you owe the carrier against what you bill your customer.',
    softNote: 'You generate this document yourself, so confirm it is issued and matches the agreed rate.'
  }
};

function assessReadiness(a) {
  var missing = [];   /* red items:  { doc, note } */
  var review = [];    /* yellow:     { doc, note } */
  var available = []; /* green list: label strings */

  function classify(key, answer, softTypes) {
    var label = DOC_LABELS[key];
    var g = DOC_GUIDANCE[key] || {};
    if (answer === 'yes') {
      available.push(label);
    } else if (answer === 'no') {
      if (softTypes && softTypes.indexOf(a.customer_type) !== -1) {
        review.push({ doc: label, note: g.softNote || 'Confirm this before invoicing.' });
      } else {
        missing.push({ doc: label, note: g.missingNote || 'Confirm this before invoicing.' });
      }
    } else {
      /* 'unsure' or anything unanswered: never a hard fail, always review. */
      review.push({ doc: label, note: 'Marked "unsure". Confirm this before invoicing.' });
    }
  }

  classify('rate_confirmation', a.rate_confirmation);
  classify('bol', a.bol);
  classify('carrier_invoice', a.carrier_invoice, ['carrier']);

  /* POD: a missing POD is red only when the visitor confirms their customer
     requires a signed POD to pay. Otherwise it is a review item. This keeps
     the decision tied to the actual billing requirement instead of guessing
     from the company type. */
  (function classifyPod() {
    var label = DOC_LABELS.pod;
    if (a.pod === 'yes') {
      available.push(label);
    } else if (a.pod === 'no') {
      if (a.pod_required === 'yes') {
        missing.push({
          doc: label,
          note: 'Your customer requires a signed POD before the invoice can go out. Get delivery confirmation on file.'
        });
      } else if (a.pod_required === 'no') {
        review.push({
          doc: label,
          note: 'Your customer does not require a signed POD, but confirm their billing requirements before invoicing.'
        });
      } else {
        review.push({
          doc: label,
          note: 'It is unclear whether a signed POD is required. Confirm your customer\u2019s billing requirements.'
        });
      }
    } else {
      review.push({ doc: label, note: 'Marked "unsure". Confirm this before invoicing.' });
    }
  })();

  var receiptsApplicable = (a.additional_charges === 'yes' || a.additional_charges === 'unsure');
  if (a.additional_charges === 'yes') {
    if (a.receipts === 'yes') {
      available.push(DOC_LABELS.receipts);
    } else if (a.receipts === 'no') {
      missing.push({
        doc: DOC_LABELS.receipts,
        note: 'Accessorial charges were reported but receipts are missing. Unbilled accessorials are margin you never recover.'
      });
    } else if (a.receipts === 'na') {
      review.push({
        doc: DOC_LABELS.receipts,
        note: 'Marked "not applicable" while additional charges were reported. Double-check that nothing billable is being left out.'
      });
    } else {
      review.push({
        doc: DOC_LABELS.receipts,
        note: 'Marked "unsure". Confirm which accessorials need receipts.'
      });
    }
  } else if (a.additional_charges === 'unsure') {
    review.push({
      doc: DOC_LABELS.charges,
      note: 'Marked "unsure". Confirm whether detention, lumper, or other accessorials apply to this load.'
    });
  }
  /* additional_charges === 'no': nothing to check. */

  /* Priority: red beats yellow beats green. */
  var status = 'green';
  if (missing.length > 0) {
    status = 'red';
  } else if (review.length > 0) {
    status = 'yellow';
  }

  var applicable = 4 + (receiptsApplicable ? 1 : 0);
  var progress = applicable === 0 ? 0 : Math.round((available.length / applicable) * 100);

  var actions = [];
  missing.forEach(function (m) {
    actions.push({ text: 'Obtain the missing document: ' + m.doc + '.', note: m.note });
  });
  review.forEach(function (r) {
    actions.push({ text: 'Clarify before invoicing: ' + r.doc + '.', note: r.note });
  });
  /* Standard closers, always present. */
  actions.push({
    text: 'Confirm your customer\u2019s specific billing requirements.',
    note: 'Requirements vary by customer. Treat this assessment as a starting checklist, not a billing approval.'
  });
  actions.push({
    text: 'Organize the documents into one complete billing packet for the load.',
    note: ''
  });

  return {
    status: status,
    missing: missing,
    review: review,
    available: available,
    progress: progress,
    actions: actions,
    accessorials: a.accessorials || []
  };
}

/* ------------------------- DOM wiring (browser only) ---------------------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* Fire-and-forget analytics. Never sends answers, amounts, or identifiers.
   Guarded so the checker works fully when GA is blocked. */
function trackEvent(name) {
  try {
    if (typeof gtag === 'function') {
      gtag('event', name);
    }
  } catch (e) {
    /* Analytics must never break the tool. */
  }
}

function checkedValue(form, name) {
  var el = form.querySelector('input[name="' + name + '"]:checked');
  return el ? el.value : null;
}

function checkedValues(form, name) {
  var out = [];
  var els = form.querySelectorAll('input[name="' + name + '"]:checked');
  for (var i = 0; i < els.length; i++) {
    out.push(els[i].value);
  }
  return out;
}

function updateConditional(form) {
  var charges = checkedValue(form, 'additional_charges');
  var wrap = document.getElementById('conditional-charges');
  var types = document.getElementById('accessorial-types');
  /* Receipts and accessorial types are only relevant when the visitor says
     additional charges are involved. "Unsure" hides both: the assessment
     flags the charges themselves for review instead of demanding an answer
     that would not affect the result. */
  var showCharges = (charges === 'yes');
  wrap.hidden = !showCharges;
  types.hidden = !showCharges;
  var receipts = form.querySelectorAll('input[name="receipts"]');
  for (var i = 0; i < receipts.length; i++) {
    receipts[i].required = showCharges;
    if (!showCharges && receipts[i].checked) receipts[i].checked = false;
  }
  if (!showCharges) {
    var acc = form.querySelectorAll('input[name="accessorials"]');
    for (var j = 0; j < acc.length; j++) acc[j].checked = false;
  }
  /* POD follow-up: only asked when the POD itself is marked missing. */
  var pod = checkedValue(form, 'pod');
  var podWrap = document.getElementById('conditional-pod');
  var showPod = (pod === 'no');
  podWrap.hidden = !showPod;
  var podReq = form.querySelectorAll('input[name="pod_required"]');
  for (var k = 0; k < podReq.length; k++) {
    podReq[k].required = showPod;
    if (!showPod && podReq[k].checked) podReq[k].checked = false;
  }
}

function readAnswers(form) {
  return {
    customer_type: checkedValue(form, 'customer_type'),
    rate_confirmation: checkedValue(form, 'rate_confirmation'),
    bol: checkedValue(form, 'bol'),
    pod: checkedValue(form, 'pod'),
    carrier_invoice: checkedValue(form, 'carrier_invoice'),
    additional_charges: checkedValue(form, 'additional_charges'),
    accessorials: checkedValues(form, 'accessorials'),
    receipts: checkedValue(form, 'receipts'),
    pod_required: checkedValue(form, 'pod_required'),
    load_number: form.querySelector('#load_number').value.trim(),
    amount: form.querySelector('#amount').value.trim()
  };
}

var STATUS_COPY = {
  green: {
    icon: '\u2705',
    badge: 'badge-ok',
    title: 'APPEARS COMPLETE FOR REVIEW',
    summary: 'Every applicable item was marked available. Do a final verification pass against your customer\u2019s requirements, then invoice.'
  },
  yellow: {
    icon: '\u26A0\uFE0F',
    badge: 'badge-review',
    title: 'ADDITIONAL INFORMATION NEEDED',
    summary: 'One or more answers were uncertain, or supporting documentation needs a second look. Clear the review items below before invoicing.'
  },
  red: {
    icon: '\u274C',
    badge: 'badge-missing',
    title: 'MISSING DOCUMENTATION IDENTIFIED',
    summary: 'One or more potentially required documents were marked missing. These are the items most likely to delay invoicing or funding.'
  }
};

function docStatus(result, label) {
  if (result.available.indexOf(label) !== -1) return 'available';
  for (var i = 0; i < result.missing.length; i++) {
    if (result.missing[i].doc === label) return 'missing';
  }
  return 'review';
}

function renderResults(a, r) {
  var copy = STATUS_COPY[r.status];

  var banner = document.getElementById('result-banner');
  banner.setAttribute('data-status', r.status);
  document.getElementById('result-icon').textContent = copy.icon;
  document.getElementById('result-status').textContent = 'STATUS: ' + copy.title;
  document.getElementById('result-summary').textContent = copy.summary;

  var meta = [];
  if (a.load_number) meta.push('Load ' + a.load_number);
  meta.push(TYPE_LABELS[a.customer_type] || a.customer_type);
  if (a.amount && !isNaN(Number(a.amount))) {
    meta.push('Amount $' + Number(a.amount).toLocaleString('en-US'));
  }
  meta.push(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
  document.getElementById('result-meta').textContent = meta.join('  ·  ');

  var fill = document.getElementById('progress-fill');
  var bar = document.getElementById('progress-bar');
  fill.style.width = r.progress + '%';
  bar.setAttribute('aria-valuenow', String(r.progress));
  document.getElementById('progress-pct').textContent = r.progress + '% of items available';

  var order = ['rate_confirmation', 'bol', 'pod', 'carrier_invoice'];
  if (a.additional_charges === 'yes') order.push('receipts');
  if (a.additional_charges === 'unsure') order.push('charges');
  var badgeWord = { available: ['\u2705 Available', 'badge-ok'], missing: ['\u274C Missing', 'badge-missing'], review: ['\u26A0\uFE0F Review needed', 'badge-review'] };
  var html = '';
  order.forEach(function (key) {
    var label = DOC_LABELS[key];
    var st = docStatus(r, label);
    html += '<li><span class="doc-name">' + esc(label) + '</span>' +
      '<span class="badge ' + badgeWord[st][1] + '">' + esc(badgeWord[st][0]) + '</span></li>';
  });
  if (r.accessorials.length > 0) {
    html += '<li><span class="doc-name">Accessorials reported: ' + esc(r.accessorials.join(', ')) + '</span>' +
      '<span class="badge badge-review">\u2139\uFE0F Reported</span></li>';
  }
  document.getElementById('result-checklist').innerHTML = html;

  var counts = [];
  if (r.missing.length) counts.push(r.missing.length + ' missing');
  if (r.review.length) counts.push(r.review.length + ' need' + (r.review.length === 1 ? 's' : '') + ' review');
  counts.push(r.available.length + ' available');
  document.getElementById('result-counts').textContent = counts.join('  ·  ');

  var actionsHtml = '';
  r.actions.forEach(function (ac) {
    actionsHtml += '<li>' + esc(ac.text) +
      (ac.note ? '<span class="action-note">' + esc(ac.note) + '</span>' : '') + '</li>';
  });
  document.getElementById('result-actions').innerHTML = actionsHtml;

  document.getElementById('result-disclaimer').textContent =
    'Preliminary assessment based on the information you provided. It is not a billing approval, and Freightfolio has not reviewed your documents. Final billing decisions should follow your customer\u2019s requirements and your own verification.';
}

function resetChecker() {
  var form = document.getElementById('readiness-form');
  form.reset();
  updateConditional(form);
  document.getElementById('results-section').hidden = true;
  document.getElementById('checker-heading').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('load_number').focus({ preventScroll: true });
}

function initChecker() {
  var form = document.getElementById('readiness-form');
  if (!form) return;

  trackEvent('billing_checker_view');

  var started = false;
  form.addEventListener('change', function () {
    if (!started) {
      started = true;
      trackEvent('billing_checker_started');
    }
    updateConditional(form);
  });
  updateConditional(form);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    var answers = readAnswers(form);
    var result = assessReadiness(answers);
    renderResults(answers, result);
    trackEvent('billing_checker_completed');
    trackEvent('billing_checker_' + result.status + '_result');
    var sec = document.getElementById('results-section');
    sec.hidden = false;
    var title = document.getElementById('results-title');
    title.setAttribute('tabindex', '-1');
    title.focus({ preventScroll: true });
    sec.scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('btn-again').addEventListener('click', resetChecker);
  document.getElementById('btn-print').addEventListener('click', function () {
    trackEvent('billing_checker_pdf_download');
    window.print();
  });
  document.getElementById('btn-assessment').addEventListener('click', function () {
    trackEvent('billing_checker_contact_click');
  });
  document.getElementById('btn-pilot').addEventListener('click', function () {
    trackEvent('billing_checker_pilot_click');
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initChecker);
}
