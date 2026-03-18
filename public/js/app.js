(function () {
  'use strict';

  // ── Service Worker ─────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }

  // ── Cookie consent banner ──────────────────────────────────────
  (function () {
    if (localStorage.getItem('cookieConsent')) {
      var banner = document.getElementById('cookie-banner');
      if (banner) banner.remove();
    }
  })();

  // ── Form loaded timestamp (bot-detection honeypot) ─────────────
  (function () {
    var el = document.getElementById('formLoadedAt');
    if (el) el.value = Date.now().toString();
  })();

  // ── Dark mode: system preference live listener ─────────────────
  (function () {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      if (!localStorage.getItem('theme')) {
        document.documentElement.classList.toggle('dark', e.matches);
      }
    });
  })();

  // ── Click event delegation ─────────────────────────────────────
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;

    // Toggle backup-code section on 2FA verify page
    if (action === 'toggle-backup') {
      var section = document.getElementById('backup-section');
      if (section) section.classList.toggle('hidden');
    }

    // Login page: switch between seller and agent tabs
    if (action === 'switch-tab') {
      var tab = el.dataset.tab;
      var sellerForm = document.getElementById('seller-form');
      var agentForm = document.getElementById('agent-form');
      var tabSeller = document.getElementById('tab-seller');
      var tabAgent = document.getElementById('tab-agent');
      if (tab === 'seller') {
        sellerForm.classList.remove('hidden');
        agentForm.classList.add('hidden');
        tabSeller.classList.add('text-indigo-600', 'border-b-2', 'border-indigo-600');
        tabSeller.classList.remove('text-gray-500');
        tabAgent.classList.remove('text-indigo-600', 'border-b-2', 'border-indigo-600');
        tabAgent.classList.add('text-gray-500');
      } else {
        agentForm.classList.remove('hidden');
        sellerForm.classList.add('hidden');
        tabAgent.classList.add('text-indigo-600', 'border-b-2', 'border-indigo-600');
        tabAgent.classList.remove('text-gray-500');
        tabSeller.classList.remove('text-indigo-600', 'border-b-2', 'border-indigo-600');
        tabSeller.classList.add('text-gray-500');
      }
    }

    // Viewings dashboard: switch between single-slot and bulk tabs
    if (action === 'show-viewing-tab') {
      var vTab = el.dataset.tab;
      document.getElementById('panel-single').classList.toggle('hidden', vTab !== 'single');
      document.getElementById('panel-bulk').classList.toggle('hidden', vTab !== 'bulk');
      document.getElementById('tab-single').classList.toggle('border-blue-600', vTab === 'single');
      document.getElementById('tab-single').classList.toggle('text-blue-600', vTab === 'single');
      document.getElementById('tab-single').classList.toggle('border-transparent', vTab !== 'single');
      document.getElementById('tab-single').classList.toggle('text-gray-500', vTab !== 'single');
      document.getElementById('tab-bulk').classList.toggle('border-blue-600', vTab === 'bulk');
      document.getElementById('tab-bulk').classList.toggle('text-blue-600', vTab === 'bulk');
      document.getElementById('tab-bulk').classList.toggle('border-transparent', vTab !== 'bulk');
      document.getElementById('tab-bulk').classList.toggle('text-gray-500', vTab !== 'bulk');
    }

    // Seller detail page: switch active tab highlight
    if (action === 'switch-detail-tab') {
      var tabs = document.querySelectorAll('#seller-tabs .tab-btn');
      tabs.forEach(function (btn) {
        btn.classList.remove('border-blue-600', 'text-blue-600');
        btn.classList.add('border-transparent', 'text-gray-500');
      });
      el.classList.add('border-blue-600', 'text-blue-600');
      el.classList.remove('border-transparent', 'text-gray-500');
    }

    // Remove a named element from the DOM (modal dismiss)
    if (action === 'remove-element') {
      var target = document.getElementById(el.dataset.target);
      if (target) target.remove();
    }

    // Dismiss cookie consent banner and persist the preference
    if (action === 'dismiss-cookie-banner') {
      var banner = document.getElementById('cookie-banner');
      if (banner) banner.remove();
      localStorage.setItem('cookieConsent', 'ok');
    }

    // Copy an input/element's value by ID
    if (action === 'copy-value') {
      var sourceEl = document.getElementById(el.dataset.source);
      if (sourceEl) {
        navigator.clipboard.writeText(sourceEl.value || sourceEl.textContent || '');
      }
    }

    // Copy the text content of the button's previous sibling element
    if (action === 'copy-prev-text') {
      var prev = el.previousElementSibling;
      if (prev) {
        navigator.clipboard.writeText(prev.textContent.trim());
      }
    }

    // Financial form: reveal joint owner CPF fields
    if (action === 'show-joint-fields') {
      var fields = document.getElementById('joint-owner-fields');
      if (fields) fields.classList.remove('hidden');
      el.classList.add('hidden');
    }

    // Navigate to a URL stored in data-url (table row click)
    if (action === 'navigate') {
      window.location.href = el.dataset.url;
    }

    // Toggle mobile sidebar open/closed
    if (action === 'toggle-sidebar') {
      var sidebar = document.getElementById('sidebar');
      var backdrop = document.getElementById('sidebar-backdrop');
      if (sidebar && backdrop) {
        var isOpen = !sidebar.classList.contains('hidden') && window.innerWidth < 768;
        if (isOpen) {
          sidebar.classList.add('hidden');
          backdrop.classList.add('hidden');
        } else {
          sidebar.classList.remove('hidden');
          backdrop.classList.remove('hidden');
        }
      }
    }

    // Toggle user menu dropdown open/closed
    if (action === 'toggle-user-menu') {
      var dropdown = document.getElementById('user-menu-dropdown');
      var btn = document.getElementById('user-menu-btn');
      if (dropdown) {
        var isOpen = !dropdown.classList.contains('hidden');
        dropdown.classList.toggle('hidden', isOpen);
        if (btn) btn.setAttribute('aria-expanded', String(!isOpen));
      }
    }

    // Review detail panel: close and slide out to the right
    if (action === 'close-review-panel') {
      var reviewPanel = document.getElementById('review-detail-panel');
      var reviewBackdrop = document.getElementById('review-detail-backdrop');
      if (reviewPanel) {
        reviewPanel.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
        reviewPanel.setAttribute('aria-hidden', 'true');
      }
      if (reviewBackdrop) {
        reviewBackdrop.classList.add('hidden');
      }
    }

    if (action === 'close-testimonial-drawer') {
      var testimonialDrawer = document.getElementById('testimonial-drawer-panel');
      var testimonialBackdrop = document.getElementById('testimonial-drawer-backdrop');
      if (testimonialDrawer) {
        testimonialDrawer.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
        testimonialDrawer.setAttribute('aria-hidden', 'true');
      }
      if (testimonialBackdrop) testimonialBackdrop.classList.add('hidden');
    }

    if (action === 'close-market-content-panel') {
      var mcPanel = document.getElementById('market-content-panel');
      var mcBackdrop = document.getElementById('market-content-backdrop');
      if (mcPanel) {
        mcPanel.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
        mcPanel.setAttribute('aria-hidden', 'true');
      }
      if (mcBackdrop) mcBackdrop.classList.add('hidden');
    }

    // Referral table: toggle the pre-composed message expansion row
    if (action === 'toggle-referral-message') {
      var msgRow = document.getElementById(el.dataset.target);
      if (msgRow) {
        var isHidden = msgRow.classList.toggle('hidden');
        el.textContent = isHidden ? (el.dataset.labelShow || 'View Message') : (el.dataset.labelHide || 'Hide');
      }
    }

    // Toggle dark mode
    if (action === 'toggle-dark-mode') {
      var isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    }
  });

  // ── Close user menu on outside click ──────────────────────────
  document.addEventListener('click', function (e) {
    var dropdown = document.getElementById('user-menu-dropdown');
    var btn = document.getElementById('user-menu-btn');
    if (!dropdown || dropdown.classList.contains('hidden')) return;
    if (btn && (btn === e.target || btn.contains(e.target))) return;
    dropdown.classList.add('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });

  // ── Months slider (market report date range) ──────────────────
  var MONTHS_STEPS = [
    { value: '6',   label: '6 Months' },
    { value: '12',  label: '1 Year'   },
    { value: '24',  label: '2 Years'  },
    { value: '60',  label: '5 Years'  },
    { value: '120', label: '10 Years' },
    { value: '240', label: '20 Years' },
    { value: '0',   label: 'All Time' },
  ];

  // ── Change event delegation ────────────────────────────────────
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el.matches('[data-action]')) return;
    var action = el.dataset.action;

    // Download confirm modal: enable submit only when both checkboxes are checked
    if (action === 'check-both-boxes') {
      var a = document.getElementById('confirm-offline');
      var b = document.getElementById('confirm-produce');
      var btn = document.getElementById('download-submit-btn');
      if (btn) btn.disabled = !(a && a.checked && b && b.checked);
    }

    // Onboarding step 5: enable the complete button when checkbox is checked
    if (action === 'toggle-complete-btn') {
      var completeBtn = document.getElementById('complete-btn');
      if (completeBtn) completeBtn.disabled = !el.checked;
    }

    // Market report: sync hidden months value + label from slider position
    if (action === 'update-months-label') {
      var step = MONTHS_STEPS[parseInt(el.value, 10)];
      if (step) {
        var hidden = document.getElementById('months-value');
        var lbl = document.getElementById('months-label');
        if (hidden) hidden.value = step.value;
        if (lbl) lbl.textContent = step.label;
      }
    }

    // Photo upload area: auto-submit the enclosing form on file selection
    if (action === 'auto-submit') {
      var form = el.closest('form');
      if (form) form.requestSubmit();
    }

    // Viewing booking: show/hide agent-only fields based on viewer type selection
    if (action === 'toggle-agent-fields') {
      var agentFields = document.getElementById('agent-fields');
      if (!agentFields) return;
      if (el.dataset.show === 'true') {
        agentFields.classList.remove('hidden');
      } else {
        agentFields.classList.add('hidden');
      }
    }
  });

  // ── Submit event delegation ────────────────────────────────────
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.matches('[data-action]')) return;
    var action = form.dataset.action;

    // Reset password: block submit if passwords don't match
    if (action === 'check-passwords') {
      var pw = document.getElementById('password');
      var confirmPw = document.getElementById('confirmPassword');
      var msg = document.getElementById('password-mismatch');
      if (pw && confirmPw && pw.value !== confirmPw.value) {
        e.preventDefault();
        if (msg) msg.classList.remove('hidden');
      } else if (msg) {
        msg.classList.add('hidden');
      }
    }

    // Admin: require confirmation dialog before destructive form submission
    if (action === 'confirm-submit') {
      if (!confirm(form.dataset.message || 'Are you sure?')) {
        e.preventDefault();
      }
    }
  });

  // ── HTMX: review panel show/hide ──────────────────────────────
  document.addEventListener('htmx:afterRequest', function (e) {
    var panel = document.getElementById('review-detail-panel');
    if (panel) {
      // Show panel when detail content loads into it
      if (e.detail.target && e.detail.target.id === 'review-detail-content' && e.detail.successful) {
        panel.classList.remove('translate-x-full', 'opacity-0', 'pointer-events-none');
        panel.removeAttribute('aria-hidden');
        var backdrop = document.getElementById('review-detail-backdrop');
        if (backdrop) backdrop.classList.remove('hidden');
      }
      // Hide panel after approve/reject (form inside the panel fires the request)
      if (e.detail.elt && e.detail.elt.closest && e.detail.elt.closest('#review-detail-panel') && e.detail.successful) {
        panel.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
        panel.setAttribute('aria-hidden', 'true');
        var backdrop2 = document.getElementById('review-detail-backdrop');
        if (backdrop2) backdrop2.classList.add('hidden');
      }
    }
  });

  // ── HTMX: testimonial drawer show/hide ──────────────────────
  document.addEventListener('htmx:afterRequest', function (e) {
    var drawer = document.getElementById('testimonial-drawer-panel');
    if (drawer) {
      // Show drawer when form content loads into it
      if (e.detail.target && e.detail.target.id === 'testimonial-drawer-content' && e.detail.successful) {
        drawer.classList.remove('translate-x-full', 'opacity-0', 'pointer-events-none');
        drawer.removeAttribute('aria-hidden');
        var backdrop = document.getElementById('testimonial-drawer-backdrop');
        if (backdrop) backdrop.classList.remove('hidden');
      }
      // Hide drawer and refresh list after successful form POST
      if (e.detail.elt && e.detail.elt.closest && e.detail.elt.closest('#testimonial-drawer-panel') && e.detail.successful && e.detail.target && e.detail.target.id === 'testimonial-list') {
        drawer.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
        drawer.setAttribute('aria-hidden', 'true');
        var backdrop2 = document.getElementById('testimonial-drawer-backdrop');
        if (backdrop2) backdrop2.classList.add('hidden');
      }
    }
  });

  // ── HTMX: market content panel show/hide ──────────────────────
  document.addEventListener('htmx:afterRequest', function (e) {
    var panel = document.getElementById('market-content-panel');
    if (panel) {
      // Show panel when detail content loads into it
      if (e.detail.target && e.detail.target.id === 'market-content-detail-content' && e.detail.successful) {
        panel.classList.remove('translate-x-full', 'opacity-0', 'pointer-events-none');
        panel.removeAttribute('aria-hidden');
        var backdrop = document.getElementById('market-content-backdrop');
        if (backdrop) backdrop.classList.remove('hidden');
      }
      // Hide panel after approve/reject (form inside the panel fires the request)
      if (e.detail.elt && e.detail.elt.closest && e.detail.elt.closest('#market-content-panel') && e.detail.successful) {
        panel.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
        panel.setAttribute('aria-hidden', 'true');
        var backdrop2 = document.getElementById('market-content-backdrop');
        if (backdrop2) backdrop2.classList.add('hidden');
      }
    }
  });

  // ── HTMX: reset form / remove element after successful request ─
  document.addEventListener('htmx:afterRequest', function (e) {
    var el = e.detail.elt;

    if (e.detail.successful) {
      // data-reset-on-success: reset the form after a successful HTMX POST
      if (el.matches('[data-reset-on-success]')) {
        el.reset();
      }

      // data-remove-on-success: remove a named element after a successful HTMX request
      if (el.dataset.removeOnSuccess) {
        var target = document.getElementById(el.dataset.removeOnSuccess);
        if (target) target.remove();
      }
    } else if (e.detail.failed) {
      // data-error-target: show an error message in the named element on failure
      if (el.dataset.errorTarget) {
        var errEl = document.getElementById(el.dataset.errorTarget);
        if (errEl) {
          errEl.textContent = el.dataset.errorMessage || 'An error occurred. Please try again.';
          errEl.classList.remove('hidden');
        }
      }
    }
  });

  // ── Market report: persist form selections across HTMX swaps ──
  var _mrParams = null;

  // Save form field values just before the HTMX request fires
  document.addEventListener('htmx:beforeRequest', function (e) {
    var form = document.getElementById('market-report-form');
    if (!form || e.detail.elt !== form) return;
    _mrParams = {};
    var fields = form.querySelectorAll('select, input[name]');
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].name) _mrParams[fields[i].name] = fields[i].value;
    }
  });

  // After the results swap, restore selections and update the URL
  document.addEventListener('htmx:afterSwap', function (e) {
    if (!e.detail.target || e.detail.target.id !== 'report-results') return;
    if (!_mrParams) return;

    var form = document.getElementById('market-report-form');
    if (form) {
      var keys = Object.keys(_mrParams);
      for (var i = 0; i < keys.length; i++) {
        var el = form.querySelector('[name="' + keys[i] + '"]');
        if (el) el.value = _mrParams[keys[i]];
      }
      // Sync the slider position from the saved months value
      var months = _mrParams['months'];
      if (months) {
        for (var j = 0; j < MONTHS_STEPS.length; j++) {
          if (MONTHS_STEPS[j].value === months) {
            var slider = document.getElementById('months-slider');
            var lbl = document.getElementById('months-label');
            if (slider) slider.value = String(j);
            if (lbl) lbl.textContent = MONTHS_STEPS[j].label;
            break;
          }
        }
      }
    }

    // Update the URL so the search is bookmarkable / survives page reload
    var qs = Object.keys(_mrParams).filter(function (k) { return _mrParams[k]; }).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(_mrParams[k]);
    }).join('&');
    history.replaceState(null, '', '/market-report?' + qs);

    _mrParams = null;
  });

  // On page load, restore form from URL params (e.g. after a reload or shared link)
  (function () {
    var form = document.getElementById('market-report-form');
    if (!form) return;
    var params = new URLSearchParams(window.location.search);
    ['town', 'flatType', 'storeyRange'].forEach(function (name) {
      var val = params.get(name);
      if (val) {
        var el = form.querySelector('[name="' + name + '"]');
        if (el) el.value = val;
      }
    });
    var months = params.get('months');
    if (months) {
      var monthsEl = document.getElementById('months-value');
      if (monthsEl) monthsEl.value = months;
      for (var i = 0; i < MONTHS_STEPS.length; i++) {
        if (MONTHS_STEPS[i].value === months) {
          var slider = document.getElementById('months-slider');
          var lbl = document.getElementById('months-label');
          if (slider) slider.value = String(i);
          if (lbl) lbl.textContent = MONTHS_STEPS[i].label;
          break;
        }
      }
    }
  })();

  // ── Close sidebar on nav link click (mobile) ───────────────────
  document.querySelectorAll('#sidebar a').forEach(function (link) {
    link.addEventListener('click', function () {
      if (window.innerWidth < 768) {
        var sidebar = document.getElementById('sidebar');
        var backdrop = document.getElementById('sidebar-backdrop');
        if (sidebar) sidebar.classList.add('hidden');
        if (backdrop) backdrop.classList.add('hidden');
      }
    });
  });
})();
