/* ScaleStartup GA4 event helpers (no PII) */
(function () {
  'use strict';

  // Singleton guard: prevent double-binding if script is included twice
  if (window.__ss_ga4_events_initialized) { return; }
  window.__ss_ga4_events_initialized = true;

  // Guard: gtag must exist (it will if the GA4 base tag is installed)
  function hasGtag() {
    return typeof window.gtag === 'function';
  }

  function safeEvent(name, params) {
    try {
      if (!hasGtag()) return;
      window.gtag('event', name, params || {});
    } catch (e) {
      // silent
    }
  }

  // ---------- Page active time (ms) ----------
  var pageName = (document.body && document.body.dataset && document.body.dataset.page) ? document.body.dataset.page : 'unknown';
  var startTs = Date.now();
  var lastVisibleTs = document.visibilityState === 'visible' ? Date.now() : null;
  var activeMs = 0;
  var timeSent = false;

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      if (lastVisibleTs) {
        activeMs += Date.now() - lastVisibleTs;
        lastVisibleTs = null;
      }
    } else if (document.visibilityState === 'visible') {
      lastVisibleTs = Date.now();
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });

  function sendPageTime() {
    if (timeSent) return;
    timeSent = true;

    // final flush
    if (document.visibilityState === 'visible' && lastVisibleTs) {
      activeMs += Date.now() - lastVisibleTs;
      lastVisibleTs = null;
    }

    // Only send if there's meaningful time (avoid noise)
    if (activeMs < 250) return;

    safeEvent('page_time', {
      page_name: pageName,
      time_ms: Math.round(activeMs),
      page_path: location.pathname
    });
  }

  // pagehide is better than unload for modern browsers
  window.addEventListener('pagehide', sendPageTime, { capture: true });

  // ---------- CTA tracking ----------
  function slugify(txt) {
    try {
      return String(txt || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
    } catch (e) {
      return 'cta';
    }
  }

  function inferCtaPosition(el) {
    try {
      if (!el || !el.closest) return 'unknown';
      if (el.closest('header') || el.closest('.header') || el.closest('.top')) return 'top';
      if (el.closest('.hero') || el.closest('#hero')) return 'hero';
      if (el.closest('.bottom-floating') || el.closest('.floating') || el.closest('.sticky')) return 'floating';
      if (el.closest('footer') || el.closest('.footer')) return 'footer';
      return 'body';
    } catch (e) {
      return 'unknown';
    }
  }

  document.addEventListener('click', function (e) {
    // Primary: explicitly tagged CTAs
    // Fallback: any link/button that looks like a CTA (class "cta" or links to the form page)
    var el = e.target && e.target.closest ? e.target.closest('[data-cta], a.cta, a[href*="founders_tech_clarity_form.html"], a[href*="tech.scalestartup.in/web/lite/events/692fa0b130ae78be301a0ec7"], button.cta') : null;
    if (!el) return;

    var cta = el.getAttribute('data-cta');
    var ctaPos = el.getAttribute('data-cta_position') || el.getAttribute('data-cta-position');
    var ctaIndex = el.getAttribute('data-cta_index') || el.getAttribute('data-cta-index') || '';

    // Auto-fill missing labels so we never miss tracking (future-proof)
    if (!cta) {
      var txt = (el.innerText || el.textContent || '').trim();
      cta = 'auto_' + (txt ? slugify(txt) : 'cta');
    }
    if (!ctaPos) {
      ctaPos = inferCtaPosition(el);
    }

    // store for later attribution (form + thank-you)
    try {
      sessionStorage.setItem('ss_last_cta', cta);
      sessionStorage.setItem('ss_last_cta_pos', ctaPos);
      if (ctaIndex) sessionStorage.setItem('ss_last_cta_index', ctaIndex);
    } catch (err) {}

    safeEvent('cta_click', {
      cta: cta,
      cta_position: ctaPos,
      cta_index: ctaIndex,
      page_name: pageName,
      page_path: location.pathname
    });
  }, { capture: true });

  // ---------- Form tracking ----------
  function isFormPage() { return pageName === 'form'; }
  function isThankYou() { return pageName === 'thankyou'; }

  function getForm() {
    return document.getElementById('leadForm') || document.querySelector('form');
  }

  if (isFormPage()) {
    document.addEventListener('DOMContentLoaded', function () {
      safeEvent('form_view', {
        form_id: 'founders_tech_clarity',
        page_path: location.pathname
      });
    });

    var form = getForm();
    var started = false;
    var maxQ = 0;

    // restore progress if any
    try {
      var storedQ = parseInt(sessionStorage.getItem('ss_max_q') || '0', 10);
      if (!isNaN(storedQ)) maxQ = storedQ;
    } catch (err) {}

    function maybeStart() {
      if (started) return;
      started = true;
      safeEvent('form_start', {
        form_id: 'founders_tech_clarity',
        page_path: location.pathname
      });
    }

    function bumpQ(el) {
      if (!el) return;
      var q = parseInt(el.getAttribute('data-q') || '0', 10);
      if (!q || isNaN(q)) return;
      if (q > maxQ) {
        maxQ = q;
        try { sessionStorage.setItem('ss_max_q', String(maxQ)); } catch (err) {}
        // fire only when they reach a NEW max question (low noise)
        safeEvent('form_progress', {
          form_id: 'founders_tech_clarity',
          last_q: maxQ,
          page_path: location.pathname
        });
      }
    }

    function onFieldInteract(e) {
      var el = e.target;
      if (!el) return;
      if (!el.matches('input, select, textarea')) return;
      maybeStart();
      bumpQ(el);
    }

    document.addEventListener('focusin', onFieldInteract, { passive: true });
    document.addEventListener('change', onFieldInteract, { passive: true });
    document.addEventListener('input', onFieldInteract, { passive: true });

    // Track abandon (leaving without successful redirect)
    function shouldSendAbandon() {
      try {
        return sessionStorage.getItem('ss_form_submitted') !== '1';
      } catch (err) {
        return true;
      }
    }

    window.addEventListener('pagehide', function () {
      if (!shouldSendAbandon()) return;
      if (!started && maxQ === 0) return;

      var lastCta = '';
      var lastCtaPos = '';
      try {
        lastCta = sessionStorage.getItem('ss_last_cta') || '';
        lastCtaPos = sessionStorage.getItem('ss_last_cta_pos') || '';
      } catch (err) {}

      safeEvent('form_abandon', {
        form_id: 'founders_tech_clarity',
        last_q: maxQ || 0,
        started: started ? 1 : 0,
        last_cta: lastCta,
        last_cta_position: lastCtaPos,
        page_path: location.pathname
      });
    }, { capture: true });

    // If there's a native submit, mark submitted early (backup).
    if (form) {
      form.addEventListener('submit', function () {
        try { sessionStorage.setItem('ss_form_submitted', '1'); } catch (err) {}
      }, { capture: true });
    }
  }

  // ---------- Thank-you conversion ----------
  if (isThankYou()) {
    document.addEventListener('DOMContentLoaded', function () {
      var lastCta = '';
      var lastCtaPos = '';
      var maxQ = 0;

      try {
        lastCta = sessionStorage.getItem('ss_last_cta') || '';
        lastCtaPos = sessionStorage.getItem('ss_last_cta_pos') || '';
        maxQ = parseInt(sessionStorage.getItem('ss_max_q') || '0', 10) || 0;
      } catch (err) {}

      safeEvent('generate_lead', {
        form_id: 'founders_tech_clarity',
        last_cta: lastCta,
        last_cta_position: lastCtaPos,
        last_q: maxQ,
        page_path: location.pathname
      });

      // cleanup
      try {
        sessionStorage.removeItem('ss_form_submitted');
        sessionStorage.removeItem('ss_max_q');
        // keep last_cta for possible future attribution? clear to avoid stale
        sessionStorage.removeItem('ss_last_cta');
        sessionStorage.removeItem('ss_last_cta_pos');
        sessionStorage.removeItem('ss_last_cta_index');
      } catch (err) {}
    });
  }

})();
