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

  // ── Country code picker (lead form) ─────────────────────────────
  (function () {
    var COUNTRIES = [
      { name: 'Singapore', code: '+65', flag: '\u{1F1F8}\u{1F1EC}', pattern: '[89]\\d{7}', placeholder: '91234567' },
      { name: 'Malaysia', code: '+60', flag: '\u{1F1F2}\u{1F1FE}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Indonesia', code: '+62', flag: '\u{1F1EE}\u{1F1E9}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Thailand', code: '+66', flag: '\u{1F1F9}\u{1F1ED}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Philippines', code: '+63', flag: '\u{1F1F5}\u{1F1ED}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Vietnam', code: '+84', flag: '\u{1F1FB}\u{1F1F3}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Myanmar', code: '+95', flag: '\u{1F1F2}\u{1F1F2}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Cambodia', code: '+855', flag: '\u{1F1F0}\u{1F1ED}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Laos', code: '+856', flag: '\u{1F1F1}\u{1F1E6}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Brunei', code: '+673', flag: '\u{1F1E7}\u{1F1F3}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
    ];

    var btn = document.getElementById('country-picker-btn');
    var dropdown = document.getElementById('country-picker-dropdown');
    var searchInput = document.getElementById('country-picker-search');
    var list = document.getElementById('country-picker-list');
    var hiddenInput = document.getElementById('countryCode');
    var flagEl = document.getElementById('country-picker-flag');
    var codeEl = document.getElementById('country-picker-code');
    var phoneInput = document.getElementById('nationalNumber');

    if (!btn || !dropdown || !list || !hiddenInput) return;

    function renderList(filter) {
      var lc = (filter || '').toLowerCase();
      list.innerHTML = '';
      COUNTRIES.forEach(function (c) {
        if (lc && c.name.toLowerCase().indexOf(lc) === -1 && c.code.indexOf(lc) === -1) return;
        var li = document.createElement('li');
        li.className = 'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-100';
        li.setAttribute('role', 'option');
        li.dataset.code = c.code;
        li.innerHTML = '<span>' + c.flag + '</span><span class="flex-1">' + c.name + '</span><span class="text-gray-400">' + c.code + '</span>';
        li.addEventListener('click', function () {
          selectCountry(c);
        });
        list.appendChild(li);
      });
    }

    function selectCountry(c) {
      hiddenInput.value = c.code;
      flagEl.textContent = c.flag;
      codeEl.textContent = c.code;
      if (phoneInput) {
        phoneInput.setAttribute('pattern', c.pattern);
        phoneInput.setAttribute('placeholder', c.placeholder);
      }
      closeDropdown();
    }

    function openDropdown() {
      dropdown.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      searchInput.value = '';
      renderList('');
      searchInput.focus();
    }

    function closeDropdown() {
      dropdown.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (dropdown.classList.contains('hidden')) {
        openDropdown();
      } else {
        closeDropdown();
      }
    });

    searchInput.addEventListener('input', function () {
      renderList(searchInput.value);
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!dropdown.classList.contains('hidden') && !btn.contains(e.target) && !dropdown.contains(e.target)) {
        closeDropdown();
      }
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !dropdown.classList.contains('hidden')) {
        closeDropdown();
      }
    });

    // Initial render
    renderList('');
  })();

  // ── Dark mode: system preference live listener ─────────────────
  (function () {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      if (!localStorage.getItem('theme')) {
        document.documentElement.classList.toggle('dark', e.matches);
      }
    });
  })();

  // ── Click event delegation (public) ──────────────────────────────
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

    // Toggle dark mode
    if (action === 'toggle-dark-mode') {
      var isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    }
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

  // ── Change event delegation (public) ─────────────────────────────
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el.matches('[data-action]')) return;
    var action = el.dataset.action;

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

  // ── HTMX: show browser validation on failed form submit ────────
  document.addEventListener('htmx:validation:failed', function (e) {
    var form = e.detail.elt;
    if (form && form.reportValidity) {
      form.reportValidity();
    }
  });

  // ── HTMX: swap server error responses (4xx/5xx) into target ────
  // Excluded: add-slot-form uses htmx:afterRequest to show its error in
  // #add-slot-error instead of appending to #slots-list.
  document.addEventListener('htmx:beforeOnLoad', function (e) {
    if (e.detail.xhr.status >= 400) {
      if (e.detail.elt && e.detail.elt.id === 'add-slot-form') return;
      e.detail.shouldSwap = true;
      e.detail.isError = false;
    }
  });

})();
