(function () {
  'use strict';

  // ── Service Worker ─────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }

  // ── Sidebar collapse: restore persisted state before first paint ─
  (function () {
    var sidebar = document.getElementById('sidebar');
    if (sidebar && localStorage.getItem('sidebar:collapsed') === 'true') {
      sidebar.classList.add('sidebar-collapsed');
      if (window.innerWidth >= 768) {
        sidebar.classList.add('sidebar-settled'); // already settled — no animation on load
      }
    }
  })();

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

    // Open cancel-slot confirmation modal
    if (action === 'open-cancel-slot-modal') {
      var modal = document.getElementById('cancel-slot-modal');
      var confirmBtn = document.getElementById('cancel-slot-confirm-btn');
      if (modal && confirmBtn) {
        var slotId = el.dataset.slotId;
        confirmBtn.dataset.slotId = slotId;
        modal.classList.remove('hidden');
      }
    }

    // Close cancel-slot modal
    if (action === 'close-cancel-slot-modal') {
      var modal = document.getElementById('cancel-slot-modal');
      if (modal) modal.classList.add('hidden');
    }

    // Close open-house duration modal
    if (action === 'close-open-house-duration-modal') {
      var modal = document.getElementById('open-house-duration-modal');
      if (modal) modal.classList.add('hidden');
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

    // Toggle desktop sidebar collapse (icon rail)
    if (action === 'toggle-sidebar-collapse') {
      var sidebar = document.getElementById('sidebar');
      if (sidebar) {
        sidebar.classList.remove('sidebar-settled'); // restore overflow:hidden for animation
        var isCollapsed = sidebar.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebar:collapsed', isCollapsed ? 'true' : 'false');
      }
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

    if (action === 'close-tutorial-drawer') {
      var tutorialDrawer = document.getElementById('tutorial-drawer-panel');
      var tutorialBackdrop = document.getElementById('tutorial-drawer-backdrop');
      if (tutorialDrawer) {
        tutorialDrawer.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
        tutorialDrawer.setAttribute('aria-hidden', 'true');
      }
      if (tutorialBackdrop) tutorialBackdrop.classList.add('hidden');
    }

    if (action === 'open-tutorial-drawer') {
      if (e.target.closest('.no-row-click')) return;
      var url = el.dataset.tutorialUrl;
      if (url) {
        htmx.ajax('GET', url, { target: '#tutorial-drawer-content', swap: 'innerHTML' });
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

    if (action === 'open-testimonial-drawer') {
      if (e.target.closest('.no-row-click')) return;
      var url = el.dataset.testimonialUrl;
      if (url) {
        htmx.ajax('GET', url, { target: '#testimonial-drawer-content', swap: 'innerHTML' });
      }
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

    // Onboarding step 5: enable the complete button when ALL checkboxes are checked
    if (action === 'toggle-complete-btn') {
      var completeBtn = document.getElementById('complete-btn');
      if (completeBtn) {
        var allChecked = Array.from(
          document.querySelectorAll('[data-action="toggle-complete-btn"]')
        ).every(function (cb) { return cb.checked; });
        completeBtn.disabled = !allChecked;
      }
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

  // ── Photo upload area: drag-and-drop onto #drop-zone (one-time init) ──
  (function () {
    var dropZone = document.getElementById('drop-zone');
    if (dropZone) {
      var dragCounter = 0;

      dropZone.addEventListener('dragenter', function (e) {
        e.preventDefault();
        dragCounter++;
        dropZone.classList.add('border-blue-500', 'bg-blue-50');
        dropZone.classList.remove('border-gray-300');
      });

      dropZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.stopPropagation();
      });

      dropZone.addEventListener('dragleave', function () {
        dragCounter--;
        if (dragCounter <= 0) {
          dragCounter = 0;
          dropZone.classList.remove('border-blue-500', 'bg-blue-50');
          dropZone.classList.add('border-gray-300');
        }
      });

      dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        dragCounter = 0;
        dropZone.classList.remove('border-blue-500', 'bg-blue-50');
        dropZone.classList.add('border-gray-300');

        var file = e.dataTransfer.files[0];
        if (!file) return;

        var input = document.getElementById('photo-input');
        var form = document.getElementById('photo-upload-form');
        if (!input || !form) return;

        var dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        form.requestSubmit();
      });
    }
  })();

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

  // ── HTMX: tutorial drawer show/hide ────────────────────────────
  document.addEventListener('htmx:afterRequest', function (e) {
    var drawer = document.getElementById('tutorial-drawer-panel');
    if (drawer) {
      // Show drawer when form content loads into it
      if (e.detail.target && e.detail.target.id === 'tutorial-drawer-content' && e.detail.successful) {
        drawer.classList.remove('translate-x-full', 'opacity-0', 'pointer-events-none');
        drawer.removeAttribute('aria-hidden');
        var backdrop = document.getElementById('tutorial-drawer-backdrop');
        if (backdrop) backdrop.classList.remove('hidden');
      }
      // Hide drawer after successful form POST that targets #tutorial-list
      if (e.detail.elt && e.detail.elt.closest && e.detail.elt.closest('#tutorial-drawer-panel') && e.detail.successful && e.detail.target && e.detail.target.id === 'tutorial-list') {
        drawer.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
        drawer.setAttribute('aria-hidden', 'true');
        var backdrop2 = document.getElementById('tutorial-drawer-backdrop');
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

  // ── Sidebar settled: re-enable overflow after collapse transition ─
  (function () {
    var sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.addEventListener('transitionend', function (e) {
        if (e.target === sidebar && e.propertyName === 'width' && sidebar.classList.contains('sidebar-collapsed') && window.innerWidth >= 768) {
          sidebar.classList.add('sidebar-settled');
        }
      });
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

  // ── Cron Picker ────────────────────────────────────────────────
  (function () {
    var DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    function parseCron(expr) {
      var defaults = { minute: 0, hour: 8, days: [1] };
      if (!expr) return defaults;
      var parts = expr.trim().split(/\s+/);
      if (parts.length !== 5) return defaults;
      var minute = parseInt(parts[0], 10);
      var hour = parseInt(parts[1], 10);
      if (isNaN(minute) || isNaN(hour)) return defaults;
      if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return defaults;
      var dowPart = parts[4];
      var days = dowPart
        .split(',')
        .map(function (d) { return parseInt(d, 10); })
        .filter(function (d) { return !isNaN(d) && d >= 0 && d <= 6; });
      if (days.length === 0) days = [1];
      return { minute: minute, hour: hour, days: days };
    }

    function generateCron(days, hour, minute) {
      var sorted = days.slice().sort(function (a, b) { return a - b; });
      return minute + ' ' + hour + ' * * ' + sorted.join(',');
    }

    function updateSummary(container) {
      var activeBtns = container.querySelectorAll('.cron-day-btn[aria-pressed="true"]');
      var days = [];
      activeBtns.forEach(function (btn) {
        days.push(parseInt(btn.dataset.dow, 10));
      });
      if (days.length === 0) days = [1]; // fallback

      var hourEl = container.querySelector('.cron-hour');
      var minuteEl = container.querySelector('.cron-minute');
      var hour = parseInt(hourEl.value, 10);
      var minute = parseInt(minuteEl.value, 10);

      var cron = generateCron(days, hour, minute);
      container.querySelector('.cron-value').value = cron;

      var dayNames = days
        .slice()
        .sort(function (a, b) { return a - b; })
        .map(function (d) { return DAY_LABELS[d]; })
        .join(', ');
      var hh = String(hour).padStart(2, '0');
      var mm = String(minute).padStart(2, '0');
      container.querySelector('.cron-summary').innerHTML =
        '&#10003; Runs every <strong>' + dayNames + '</strong> at <strong>' + hh + ':' + mm + '</strong> SGT' +
        ' &nbsp;&middot;&nbsp; <span style="font-family:monospace;color:#9ca3af;">' + cron + '</span>';
    }

    function initCronPicker(container) {
      var existing = container.dataset.value || '';
      var parsed = parseCron(existing);

      // Set hour dropdown
      var hourEl = container.querySelector('.cron-hour');
      hourEl.value = String(parsed.hour).padStart(2, '0');

      // Set minute dropdown — snap to nearest 5-min increment
      var minuteEl = container.querySelector('.cron-minute');
      var snapped = Math.round(parsed.minute / 5) * 5;
      if (snapped >= 60) snapped = 55;
      minuteEl.value = String(snapped).padStart(2, '0');

      // Activate matching day buttons
      container.querySelectorAll('.cron-day-btn').forEach(function (btn) {
        var dow = parseInt(btn.dataset.dow, 10);
        if (parsed.days.indexOf(dow) !== -1) {
          btn.setAttribute('aria-pressed', 'true');
          btn.classList.remove('bg-gray-100', 'text-gray-500');
          btn.classList.add('bg-indigo-100', 'text-indigo-700', 'font-semibold');
        }
      });

      // Day toggle handler
      container.querySelectorAll('.cron-day-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var pressed = btn.getAttribute('aria-pressed') === 'true';
          btn.setAttribute('aria-pressed', String(!pressed));
          if (!pressed) {
            btn.classList.remove('bg-gray-100', 'text-gray-500');
            btn.classList.add('bg-indigo-100', 'text-indigo-700', 'font-semibold');
          } else {
            btn.classList.remove('bg-indigo-100', 'text-indigo-700', 'font-semibold');
            btn.classList.add('bg-gray-100', 'text-gray-500');
          }
          updateSummary(container);
        });
      });

      // Time change handlers
      hourEl.addEventListener('change', function () { updateSummary(container); });
      minuteEl.addEventListener('change', function () { updateSummary(container); });

      // Initial summary
      updateSummary(container);
    }

    document.querySelectorAll('.cron-picker').forEach(initCronPicker);
  })();

  // ── HTMX: show browser validation on failed form submit ────────
  document.addEventListener('htmx:validation:failed', function (e) {
    var form = e.detail.elt;
    if (form && form.reportValidity) {
      form.reportValidity();
    }
  });

  // ── HTMX: swap server error responses (4xx/5xx) into target ────
  document.addEventListener('htmx:beforeOnLoad', function (e) {
    if (e.detail.xhr.status >= 400) {
      e.detail.shouldSwap = true;
      e.detail.isError = false;
    }
  });

  // ── Auto-fill town + lease year from HDB data ─────────────────
  function lookupPropertyInfo() {
    var blockInput = document.getElementById('block');
    var streetInput = document.getElementById('street');
    var leaseInput = document.getElementById('leaseCommenceDate');
    var townInput = document.getElementById('town');
    if (!blockInput || !streetInput) return;

    var block = blockInput.value.trim();
    var street = streetInput.value.trim();
    if (!block || !street) return;

    fetch('/api/hdb/property-info?block=' + encodeURIComponent(block) + '&street=' + encodeURIComponent(street))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.leaseCommenceDate && leaseInput) {
          leaseInput.value = data.leaseCommenceDate;
        }
        if (data.town && townInput) {
          townInput.value = data.town;
        }
      })
      .catch(function () {});
  }

  document.body.addEventListener('blur', function (e) {
    var el = e.target;
    if (!el || (el.id !== 'block' && el.id !== 'street')) return;
    lookupPropertyInfo();
  }, true);

  // Also trigger on HTMX content load (pre-filled forms)
  document.body.addEventListener('htmx:afterSettle', function (e) {
    var blockInput = document.getElementById('block');
    var streetInput = document.getElementById('street');
    var leaseInput = document.getElementById('leaseCommenceDate');
    if (blockInput && streetInput && blockInput.value && streetInput.value && leaseInput && (!leaseInput.value || leaseInput.value === '0')) {
      lookupPropertyInfo();
    }

    // Trigger sale proceeds calculation on HTMX load (step 3 loaded with existing data)
    if (document.getElementById('sale-proceeds-form')) {
      calculateProceeds();
    }
  });

  // ── Sale Proceeds Calculator ──────────────────────────────────
  function calculateProceeds() {
    var form = document.getElementById('sale-proceeds-form');
    if (!form) return;

    var val = function (id) {
      var el = document.getElementById(id);
      return el ? (parseFloat(el.value) || 0) : 0;
    };

    var selling = val('sellingPrice');
    var loan = val('outstandingLoan');
    var cpf1 = val('cpfSeller1');
    var cpf2 = val('cpfSeller2');
    var cpf3 = val('cpfSeller3');
    var cpf4 = val('cpfSeller4');
    var levy = val('resaleLevy');
    var other = val('otherDeductions');

    var commissionEl = form.querySelector('[name="commissionTotal"]');
    var commission = commissionEl ? parseFloat(commissionEl.value) || 0 : 0;

    var net = selling - loan - cpf1 - cpf2 - cpf3 - cpf4 - levy - other - commission;
    net = Math.round(net * 100) / 100;

    var display = document.getElementById('net-proceeds-display');
    var warning = document.getElementById('negative-warning');
    if (display) {
      display.textContent = '$' + net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      display.className = 'text-2xl font-bold ' + (net >= 0 ? 'text-green-600' : 'text-red-600');
    }
    if (warning) {
      warning.classList.toggle('hidden', net >= 0);
    }
  }

  document.body.addEventListener('input', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('sale-proceeds-input')) {
      calculateProceeds();
    }
  });

  // CPF "Add contributor" button
  document.body.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'add-cpf-contributor') {
      var rows = ['cpf-row-2', 'cpf-row-3', 'cpf-row-4'];
      for (var i = 0; i < rows.length; i++) {
        var row = document.getElementById(rows[i]);
        if (row && row.classList.contains('hidden')) {
          row.classList.remove('hidden');
          if (i === rows.length - 1) {
            e.target.classList.add('hidden');
          }
          break;
        }
      }
    }
  });

  // ── Viewing Calendar ──────────────────────────────────
  var calendarEl = document.getElementById('viewing-calendar');
  if (calendarEl && window.ViewingCalendar) {
    calendarEl._viewingCalendar = new window.ViewingCalendar(calendarEl);
  }

  // ── Bulk date picker calendars ─────────────────────────
  var bulkStartEl = document.getElementById('bulk-start-calendar');
  if (bulkStartEl && window.DatePickerCalendar) {
    new window.DatePickerCalendar(bulkStartEl, { displayId: 'bulk-start-display' });
  }
  var bulkEndEl = document.getElementById('bulk-end-calendar');
  if (bulkEndEl && window.DatePickerCalendar) {
    new window.DatePickerCalendar(bulkEndEl, { displayId: 'bulk-end-display' });
  }

  // ── Open House duration auto-correct ──────────────────
  var recurringForm = document.getElementById('recurring-slots-form');
  if (recurringForm) {
    var slotTypeSelect = recurringForm.querySelector('[name="slotType"]');
    var durationInput = recurringForm.querySelector('[name="slotDurationMinutes"]');
    if (slotTypeSelect && durationInput) {
      slotTypeSelect.addEventListener('change', function () {
        if (slotTypeSelect.value === 'group') {
          durationInput.value = '60';
        } else {
          durationInput.value = '10';
        }
      });

      recurringForm.addEventListener('submit', function (e) {
        var duration = parseInt(durationInput.value, 10);
        if (slotTypeSelect.value === 'group' && (isNaN(duration) || duration < 30)) {
          e.preventDefault();
          var guardModal = document.getElementById('open-house-duration-modal');
          if (guardModal) guardModal.classList.remove('hidden');
        }
      });
    }
  }

  // ── Viewing time bounds validation (10:00–20:00) ────────
  document.body.addEventListener('change', function (e) {
    if (!e.target.classList.contains('viewing-time-input')) return;
    var val = e.target.value;
    var outOfBounds = val && (val < '10:00' || val > '20:00');
    // Find the nearest error div
    var container = e.target.closest('.space-y-2, .grid');
    var errorDiv = container ? container.querySelector('.viewing-time-error') : null;
    if (!errorDiv) return;

    // Check both time inputs in this form section
    var inputs = container.querySelectorAll('.viewing-time-input');
    var anyBad = false;
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].value && (inputs[i].value < '10:00' || inputs[i].value > '20:00')) {
        anyBad = true;
        inputs[i].classList.add('border-red-400');
        inputs[i].classList.remove('border-gray-300');
      } else {
        inputs[i].classList.remove('border-red-400');
        inputs[i].classList.add('border-gray-300');
      }
    }
    errorDiv.classList.toggle('hidden', !anyBad);
  });

  // After a slot is added, refresh the date sidebar to show updated schedule
  document.body.addEventListener('htmx:afterRequest', function (evt) {
    var form = evt.detail.elt;
    if (form.id !== 'add-slot-form') return;
    if (!evt.detail.successful) return;
    var dateInput = document.getElementById('add-slot-date');
    var propertyInput = form.querySelector('input[name="propertyId"]');
    var date = dateInput ? dateInput.value : '';
    var propertyId = propertyInput ? propertyInput.value : '';
    if (date && propertyId) {
      // Refresh the day's schedule in the sidebar
      htmx.ajax('GET',
        '/seller/viewings/slots/date-sidebar?date=' + encodeURIComponent(date)
        + '&propertyId=' + encodeURIComponent(propertyId),
        { target: '#date-sidebar', swap: 'innerHTML' }
      );
      // Refresh calendar month metadata so green backgrounds update
      var calendarEl = document.getElementById('viewing-calendar');
      if (calendarEl && calendarEl._viewingCalendar) {
        calendarEl._viewingCalendar.fetchMonthMeta();
      }
    }
  });

  // Show error message under Add Slot button when slot creation fails
  document.body.addEventListener('htmx:responseError', function (evt) {
    var form = evt.detail.elt;
    if (form.id !== 'add-slot-form') return;
    var errorDiv = document.getElementById('add-slot-error');
    if (!errorDiv) return;
    var msg = 'This time slot overlaps with an existing slot. Please choose a different time.';
    errorDiv.innerHTML = '<div class="mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">'
      + msg + '</div>';
    // Auto-clear after 5 seconds
    setTimeout(function () { errorDiv.innerHTML = ''; }, 5000);
  });

  // Clear error on successful submission
  document.body.addEventListener('htmx:afterRequest', function (evt) {
    if (evt.detail.elt.id === 'add-slot-form' && evt.detail.successful) {
      var errorDiv = document.getElementById('add-slot-error');
      if (errorDiv) errorDiv.innerHTML = '';
    }
  });

  // Cancel-slot modal: OK button fires HTMX delete then refreshes sidebar + calendar
  document.body.addEventListener('click', function (e) {
    var btn = e.target.closest('#cancel-slot-confirm-btn');
    if (!btn) return;
    var slotId = btn.dataset.slotId;
    if (!slotId) return;

    var slotRow = document.querySelector('[data-slot-id="' + slotId + '"]');
    htmx.ajax('DELETE', '/seller/viewings/slots/' + slotId, {
      target: slotRow || document.body,
      swap: slotRow ? 'outerHTML' : 'none'
    }).then(function () {
      // Refresh sidebar if a date is selected
      var dateInput = document.getElementById('add-slot-date');
      var propInput = document.querySelector('input[name="propertyId"]');
      var date = dateInput ? dateInput.value : '';
      var propertyId = propInput ? propInput.value : '';
      if (date && propertyId) {
        htmx.ajax('GET',
          '/seller/viewings/slots/date-sidebar?date=' + encodeURIComponent(date)
          + '&propertyId=' + encodeURIComponent(propertyId),
          { target: '#date-sidebar', swap: 'innerHTML' }
        );
      }
      // Refresh calendar metadata
      var calendarEl = document.getElementById('viewing-calendar');
      if (calendarEl && calendarEl._viewingCalendar) {
        calendarEl._viewingCalendar.fetchMonthMeta();
      }
    });

    // Hide modal
    var modal = document.getElementById('cancel-slot-modal');
    if (modal) modal.classList.add('hidden');
  });

  // ── Bulk slot selection & delete ───────────────────────
  function updateDeleteButtonVisibility() {
    var checked = document.querySelectorAll('.slot-checkbox:checked');
    var deleteBtn = document.getElementById('delete-selected-slots');
    if (deleteBtn) {
      deleteBtn.classList.toggle('hidden', checked.length === 0);
      deleteBtn.textContent = checked.length > 1
        ? 'Delete selected (' + checked.length + ')'
        : 'Delete selected';
    }
  }

  // Select all checkbox
  document.body.addEventListener('change', function (e) {
    if (e.target.id === 'select-all-slots') {
      var boxes = document.querySelectorAll('.slot-checkbox');
      for (var i = 0; i < boxes.length; i++) {
        boxes[i].checked = e.target.checked;
      }
      updateDeleteButtonVisibility();
    }
    if (e.target.classList.contains('slot-checkbox')) {
      // Uncheck select-all if any individual box is unchecked
      var selectAll = document.getElementById('select-all-slots');
      if (selectAll) {
        var allBoxes = document.querySelectorAll('.slot-checkbox');
        var allChecked = true;
        for (var j = 0; j < allBoxes.length; j++) {
          if (!allBoxes[j].checked) { allChecked = false; break; }
        }
        selectAll.checked = allChecked;
      }
      updateDeleteButtonVisibility();
    }
  });

  // Delete selected slots (bulk)
  document.body.addEventListener('click', function (e) {
    if (e.target.id !== 'delete-selected-slots' && !e.target.closest('#delete-selected-slots')) return;
    var checked = document.querySelectorAll('.slot-checkbox:checked');
    if (checked.length === 0) return;

    var count = checked.length;
    if (!confirm('Cancel ' + count + ' slot' + (count > 1 ? 's' : '') + '? This cannot be undone.')) return;

    var slotIds = [];
    for (var i = 0; i < checked.length; i++) {
      slotIds.push(checked[i].value);
    }

    // Get CSRF token
    var csrfMeta = document.querySelector('meta[name="csrf-token"]');
    var csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';

    fetch('/seller/viewings/slots/bulk-delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken
      },
      credentials: 'same-origin',
      body: JSON.stringify({ slotIds: slotIds })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.success) return;

      // Remove deleted rows from DOM
      for (var j = 0; j < slotIds.length; j++) {
        var rows = document.querySelectorAll('[data-slot-id="' + slotIds[j] + '"]');
        for (var k = 0; k < rows.length; k++) {
          rows[k].remove();
        }
      }

      // Uncheck select-all
      var selectAll = document.getElementById('select-all-slots');
      if (selectAll) selectAll.checked = false;
      updateDeleteButtonVisibility();

      // Refresh sidebar and calendar
      var dateInput = document.getElementById('add-slot-date');
      var propInput = document.querySelector('input[name="propertyId"]');
      var date = dateInput ? dateInput.value : '';
      var propertyId = propInput ? propInput.value : '';
      if (date && propertyId) {
        htmx.ajax('GET',
          '/seller/viewings/slots/date-sidebar?date=' + encodeURIComponent(date)
          + '&propertyId=' + encodeURIComponent(propertyId),
          { target: '#date-sidebar', swap: 'innerHTML' }
        );
      }
      var calEl = document.getElementById('viewing-calendar');
      if (calEl && calEl._viewingCalendar) calEl._viewingCalendar.fetchMonthMeta();
    });
  });

})();
