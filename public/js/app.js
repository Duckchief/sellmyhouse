(function () {
  'use strict';

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

  // ── Click event delegation ─────────────────────────────────────
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;

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

        var input = document.getElementById('photo-input');
        var form = document.getElementById('photo-upload-form');
        if (!input || !form) return;

        var uploadQueue = Array.from(e.dataTransfer.files);
        if (uploadQueue.length === 0) return;

        function processNextUpload() {
          var next = uploadQueue.shift();
          if (!next) return;
          var dt = new DataTransfer();
          dt.items.add(next);
          input.files = dt.files;
          form.requestSubmit();
        }

        function onAfterRequest(e) {
          if (uploadQueue.length === 0 || !e.detail.successful) {
            form.removeEventListener('htmx:afterRequest', onAfterRequest);
            return;
          }
          processNextUpload();
        }

        form.addEventListener('htmx:afterRequest', onAfterRequest);
        processNextUpload();
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

  // ── Photo grid: drag-and-drop reorder ────────────────────────
  /* global Sortable */
  function initSortable() {
    var grid = document.getElementById('photo-grid');
    if (!grid || typeof Sortable === 'undefined') return;

    Sortable.create(grid, {
      animation: 150,
      ghostClass: 'opacity-40',
      onEnd: function () {
        var cards = grid.querySelectorAll('[data-photo-id]');
        var photoIds = Array.from(cards).map(function (el) {
          return el.getAttribute('data-photo-id');
        });

        var csrfToken = '';
        var hxHeaders = document.querySelector('body').getAttribute('hx-headers');
        if (hxHeaders) {
          try { csrfToken = JSON.parse(hxHeaders)['x-csrf-token'] || ''; } catch (e) {}
        }

        fetch('/seller/photos/reorder', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({ photoIds: photoIds }),
        })
          .then(function (r) {
            if (!r.ok) throw new Error('reorder failed: ' + r.status);
            return r.text();
          })
          .then(function (html) {
            var container = document.getElementById('photo-grid-container');
            if (!container) return;
            container.innerHTML = html;
            htmx.process(container);
            initSortable();
          })
          .catch(function () {
            // On failure restore server order by reloading the grid.
            // htmx.ajax sets HX-Request: true, which the router requires to return
            // the partial instead of the full page.
            htmx.ajax('GET', '/seller/photos', { target: '#photo-grid-container', swap: 'innerHTML' });
          });
      },
    });
  }

  document.addEventListener('DOMContentLoaded', initSortable);

  // ── Photo grid: auto-dismiss error and refresh after 2s ─────────
  document.addEventListener('htmx:afterSwap', function (e) {
    if (!e.detail.target || e.detail.target.id !== 'photo-grid-container') return;
    initSortable();
    var alertEl = e.detail.target.querySelector('[role="alert"]');
    if (!alertEl) return;

    setTimeout(function () {
      alertEl.style.transition = 'opacity 0.3s';
      alertEl.style.opacity = '0';
      setTimeout(function () {
        htmx.ajax('GET', '/seller/photos', { target: '#photo-grid-container', swap: 'innerHTML' });
      }, 300);
    }, 1700);
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

  // ── Recurring Slots: toggle day rows ─────────────────────
  document.body.addEventListener('click', function (e) {
    var btn = e.target.closest('.recurring-day-toggle');
    if (!btn) return;
    var dayRow = btn.closest('.recurring-day-row');
    if (!dayRow) return;
    var isOn = btn.getAttribute('aria-pressed') === 'true';
    var turnOn = !isOn;

    btn.setAttribute('aria-pressed', String(turnOn));
    if (turnOn) {
      btn.classList.remove('bg-gray-300');
      btn.classList.add('bg-blue-500');
      btn.querySelector('span').style.transform = '';
    } else {
      btn.classList.remove('bg-blue-500');
      btn.classList.add('bg-gray-300');
      btn.querySelector('span').style.transform = 'translateX(-16px)';
    }

    dayRow.querySelectorAll('.recurring-time-select, .recurring-type-select').forEach(function (el) {
      el.disabled = !turnOn;
    });
    dayRow.querySelectorAll('.recurring-timeslot').forEach(function (row) {
      row.style.opacity = turnOn ? '' : '0.45';
    });
  });

  // ── Recurring Slots: add timeslot row ────────────────────
  document.body.addEventListener('click', function (e) {
    var addBtn = e.target.closest('.recurring-add-btn');
    if (!addBtn) return;
    var dayRow = addBtn.closest('.recurring-day-row');
    if (!dayRow) return;

    var timeslots = dayRow.querySelectorAll('.recurring-timeslot');
    if (timeslots.length >= 3) return;

    // Clone the last timeslot row
    var lastSlot = timeslots[timeslots.length - 1];
    var clone = lastSlot.cloneNode(true);

    // Reset selects to day defaults
    var dayDefaultStart = dayRow.dataset.defaultStart;
    var dayDefaultEnd = dayRow.dataset.defaultEnd;
    var startSel = clone.querySelectorAll('.recurring-time-select')[0];
    var endSel = clone.querySelectorAll('.recurring-time-select')[1];
    if (startSel && dayDefaultStart) startSel.value = dayDefaultStart;
    if (endSel && dayDefaultEnd) endSel.value = dayDefaultEnd;

    // Remove toggle from cloned row (only first row has it)
    var toggleInClone = clone.querySelector('.recurring-day-toggle');
    if (toggleInClone) toggleInClone.closest('div').innerHTML = '';

    // Remove day label from cloned row
    var labelInClone = clone.querySelector('.recurring-day-label');
    if (labelInClone) labelInClone.textContent = '';

    // Show remove (x) button; hide add (+) on previous last row
    addBtn.classList.add('hidden');
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'recurring-remove-btn flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 text-gray-400 text-sm font-bold flex items-center justify-center hover:bg-gray-200 transition';
    removeBtn.textContent = '\u00d7';
    addBtn.parentNode.insertBefore(removeBtn, addBtn.nextSibling);

    // On clone: add button only if < 3 total
    var cloneAddBtn = clone.querySelector('.recurring-add-btn');
    if (cloneAddBtn) cloneAddBtn.classList.remove('hidden');

    dayRow.appendChild(clone);

    // Update add button visibility
    var newTimeslots = dayRow.querySelectorAll('.recurring-timeslot');
    if (newTimeslots.length >= 3) {
      var lastAddBtn = dayRow.querySelector('.recurring-timeslot:last-child .recurring-add-btn');
      if (lastAddBtn) lastAddBtn.classList.add('hidden');
    }
  });

  // ── Recurring Slots: remove timeslot row ─────────────────
  document.body.addEventListener('click', function (e) {
    var removeBtn = e.target.closest('.recurring-remove-btn');
    if (!removeBtn) return;
    var timeslotRow = removeBtn.closest('.recurring-timeslot');
    var dayRow = timeslotRow && timeslotRow.closest('.recurring-day-row');
    if (!timeslotRow || !dayRow) return;

    timeslotRow.remove();

    // Show add button on new last timeslot
    var remaining = dayRow.querySelectorAll('.recurring-timeslot');
    if (remaining.length < 3) {
      var lastSlot = remaining[remaining.length - 1];
      var addBtn = lastSlot && lastSlot.querySelector('.recurring-add-btn');
      if (addBtn) addBtn.classList.remove('hidden');
    }
  });

  // ── Recurring Slots: JSON submit ─────────────────────────
  var recurringForm = document.getElementById('recurring-slots-form-new');
  if (recurringForm) {
    recurringForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var propertyId = recurringForm.dataset.propertyId;
      var days = [];

      recurringForm.querySelectorAll('.recurring-day-row').forEach(function (dayRow) {
        var toggle = dayRow.querySelector('.recurring-day-toggle');
        if (!toggle || toggle.getAttribute('aria-pressed') !== 'true') return;

        var dow = parseInt(dayRow.dataset.dow, 10);
        var timeslots = [];

        dayRow.querySelectorAll('.recurring-timeslot').forEach(function (tsRow) {
          var selects = tsRow.querySelectorAll('.recurring-time-select');
          var typeSel = tsRow.querySelector('.recurring-type-select');
          var startTime = selects[0] ? selects[0].value : '';
          var endTime = selects[1] ? selects[1].value : '';
          var slotType = typeSel ? typeSel.value : 'single';
          if (startTime && endTime) {
            timeslots.push({ startTime: startTime, endTime: endTime, slotType: slotType });
          }
        });

        if (timeslots.length > 0) {
          days.push({ dayOfWeek: dow, timeslots: timeslots });
        }
      });

      if (days.length === 0) return;

      var resultDiv = document.getElementById('recurring-result');
      if (resultDiv) resultDiv.innerHTML = '<p class="text-sm text-gray-400">Saving schedule…</p>';

      fetch('/seller/viewings/schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ propertyId: propertyId, days: days }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          var p = document.createElement('p');
          p.className = result.ok && result.data && result.data.success
            ? 'text-sm text-green-600'
            : 'text-sm text-red-600';
          p.textContent = result.ok && result.data && result.data.success
            ? 'Schedule saved.'
            : 'Something went wrong. Please try again.';
          if (resultDiv) resultDiv.replaceChildren(p);
        })
        .catch(function () {
          var p = document.createElement('p');
          p.className = 'text-sm text-red-600';
          p.textContent = 'Something went wrong. Please try again.';
          if (resultDiv) resultDiv.replaceChildren(p);
        });
    });

    // Pre-populate form from saved schedule
    var savedScheduleRaw = recurringForm.dataset.savedSchedule;
    if (savedScheduleRaw && savedScheduleRaw !== '[]') {
      try {
        var savedDays = JSON.parse(savedScheduleRaw);
        savedDays.forEach(function (dayConfig) {
          var dayRow = recurringForm.querySelector('[data-dow="' + dayConfig.dayOfWeek + '"]');
          if (!dayRow || !dayConfig.timeslots || dayConfig.timeslots.length === 0) return;

          // Enable the toggle
          var toggle = dayRow.querySelector('.recurring-day-toggle');
          if (toggle) {
            toggle.setAttribute('aria-pressed', 'true');
            toggle.classList.remove('bg-gray-300');
            toggle.classList.add('bg-blue-500');
          }

          // Set first timeslot values
          var firstTs = dayRow.querySelector('.recurring-timeslot');
          if (firstTs && dayConfig.timeslots[0]) {
            var ts = dayConfig.timeslots[0];
            var selects = firstTs.querySelectorAll('.recurring-time-select');
            if (selects[0]) selects[0].value = ts.startTime;
            if (selects[1]) selects[1].value = ts.endTime;
            var typeSel = firstTs.querySelector('.recurring-type-select');
            if (typeSel) typeSel.value = ts.slotType;
          }

          // Add additional timeslot rows if schedule has > 1
          for (var i = 1; i < dayConfig.timeslots.length; i++) {
            var addBtn = dayRow.querySelector('.recurring-add-btn');
            if (addBtn) addBtn.click();
            var allTs = dayRow.querySelectorAll('.recurring-timeslot');
            var newTs = allTs[i];
            if (newTs && dayConfig.timeslots[i]) {
              var ts2 = dayConfig.timeslots[i];
              var sels2 = newTs.querySelectorAll('.recurring-time-select');
              if (sels2[0]) sels2[0].value = ts2.startTime;
              if (sels2[1]) sels2[1].value = ts2.endTime;
              var typeSel2 = newTs.querySelector('.recurring-type-select');
              if (typeSel2) typeSel2.value = ts2.slotType;
            }
          }
        });
      } catch (e) {
        console.warn('Failed to pre-populate recurring schedule form:', e);
      }
    }
  }

  // Show server error under Add Slot button on failure; clear on success
  var addSlotErrorTimer = null;
  document.body.addEventListener('htmx:afterRequest', function (evt) {
    if (evt.detail.elt.id !== 'add-slot-form') return;
    if (addSlotErrorTimer) { clearTimeout(addSlotErrorTimer); addSlotErrorTimer = null; }
    var errorDiv = document.getElementById('add-slot-error');
    if (!errorDiv) return;
    if (evt.detail.successful) {
      errorDiv.innerHTML = '';
      errorDiv.classList.remove('slot-error-enter', 'slot-error-leave');
    } else {
      errorDiv.innerHTML = evt.detail.xhr ? (evt.detail.xhr.response || '') : '';
      // Bounce in
      errorDiv.classList.remove('slot-error-leave');
      errorDiv.classList.add('slot-error-enter');
      // After 4s start fade-out, clear after fade completes
      addSlotErrorTimer = setTimeout(function () {
        var el = document.getElementById('add-slot-error');
        if (!el) { addSlotErrorTimer = null; return; }
        el.classList.remove('slot-error-enter');
        el.classList.add('slot-error-leave');
        addSlotErrorTimer = setTimeout(function () {
          var el2 = document.getElementById('add-slot-error');
          if (el2) { el2.innerHTML = ''; el2.classList.remove('slot-error-leave'); }
          addSlotErrorTimer = null;
        }, 450);
      }, 4000);
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
