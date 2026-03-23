/* global htmx */

/**
 * ViewingCalendar — renders a monthly calendar grid with slot indicators.
 *
 * Usage:
 *   <div id="viewing-calendar"
 *        data-property-id="uuid"
 *        data-slots-by-date='{"2026-03-17":{"available":1,"full":2}}'
 *        data-sidebar-target="#date-sidebar"
 *   ></div>
 *
 *   new ViewingCalendar(document.getElementById('viewing-calendar'));
 */
(function () {
  'use strict';

  var DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  var MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  function ViewingCalendar(el) {
    this.el = el;
    this.propertyId = el.dataset.propertyId;
    this.sidebarTarget = el.dataset.sidebarTarget;
    this.slotsByDate = {};
    this.selectedDate = null;

    try {
      this.slotsByDate = JSON.parse(el.dataset.slotsByDate || '{}');
    } catch (_) {
      this.slotsByDate = {};
    }

    var now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth(); // 0-indexed

    this.render();
  }

  ViewingCalendar.prototype.render = function () {
    this.el.innerHTML = '';
    this.el.appendChild(this.buildHeader());
    this.el.appendChild(this.buildDayLabels());
    this.el.appendChild(this.buildGrid());
  };

  ViewingCalendar.prototype.buildHeader = function () {
    var self = this;
    var header = document.createElement('div');
    header.className = 'flex items-center justify-between mb-3';

    var prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'p-1.5 rounded hover:bg-gray-100 text-gray-600';
    prevBtn.innerHTML = '&#9664;';
    prevBtn.setAttribute('aria-label', 'Previous month');
    prevBtn.addEventListener('click', function () { self.changeMonth(-1); });

    var title = document.createElement('span');
    title.className = 'text-sm font-semibold text-gray-900';
    title.textContent = MONTHS[this.month] + ' ' + this.year;

    var todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50';
    todayBtn.textContent = 'Today';
    todayBtn.addEventListener('click', function () { self.goToToday(); });

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'p-1.5 rounded hover:bg-gray-100 text-gray-600';
    nextBtn.innerHTML = '&#9654;';
    nextBtn.setAttribute('aria-label', 'Next month');
    nextBtn.addEventListener('click', function () { self.changeMonth(1); });

    var navLeft = document.createElement('div');
    navLeft.className = 'flex items-center gap-1';
    navLeft.appendChild(prevBtn);
    navLeft.appendChild(title);
    navLeft.appendChild(nextBtn);

    header.appendChild(navLeft);
    header.appendChild(todayBtn);

    return header;
  };

  ViewingCalendar.prototype.buildDayLabels = function () {
    var row = document.createElement('div');
    row.className = 'grid grid-cols-7 mb-1';
    for (var i = 0; i < 7; i++) {
      var cell = document.createElement('div');
      cell.className = 'text-center text-xs font-medium text-gray-400 py-1';
      cell.textContent = DAYS[i];
      row.appendChild(cell);
    }
    return row;
  };

  ViewingCalendar.prototype.buildGrid = function () {
    var self = this;
    var grid = document.createElement('div');
    grid.className = 'grid grid-cols-7';

    var firstDay = new Date(this.year, this.month, 1).getDay();
    var daysInMonth = new Date(this.year, this.month + 1, 0).getDate();
    var today = new Date();
    var todayStr = formatDate(today);

    // Empty cells before first day
    for (var e = 0; e < firstDay; e++) {
      var empty = document.createElement('div');
      empty.className = 'p-1';
      grid.appendChild(empty);
    }

    for (var d = 1; d <= daysInMonth; d++) {
      var dateObj = new Date(this.year, this.month, d);
      var dateStr = formatDate(dateObj);
      var isPast = dateObj < new Date(today.getFullYear(), today.getMonth(), today.getDate());
      var isToday = dateStr === todayStr;
      var isSelected = dateStr === this.selectedDate;
      var meta = this.slotsByDate[dateStr];

      var cell = document.createElement('button');
      cell.type = 'button';
      cell.dataset.date = dateStr;
      cell.className = 'relative flex flex-col items-center justify-center p-1.5 rounded-lg text-sm transition '
        + (isPast ? 'text-gray-300 ' : 'text-gray-700 hover:bg-blue-50 cursor-pointer ')
        + (isToday ? 'font-bold ' : '')
        + (isSelected ? 'ring-2 ring-blue-500 bg-blue-50 ' : '');

      var dayNum = document.createElement('span');
      dayNum.textContent = d;
      cell.appendChild(dayNum);

      // Dot indicators
      if (meta) {
        var dots = document.createElement('div');
        dots.className = 'flex gap-0.5 mt-0.5';
        if (meta.available > 0) {
          var greenDot = document.createElement('span');
          greenDot.className = 'w-1.5 h-1.5 rounded-full bg-green-500';
          dots.appendChild(greenDot);
        }
        if (meta.full > 0) {
          var redDot = document.createElement('span');
          redDot.className = 'w-1.5 h-1.5 rounded-full bg-red-500';
          dots.appendChild(redDot);
        }
        cell.appendChild(dots);
      }

      cell.addEventListener('click', function () {
        self.selectDate(this.dataset.date);
      });

      grid.appendChild(cell);
    }

    return grid;
  };

  ViewingCalendar.prototype.selectDate = function (dateStr) {
    this.selectedDate = dateStr;
    this.render();

    // Trigger HTMX fetch for sidebar
    var sidebar = document.querySelector(this.sidebarTarget);
    if (sidebar && typeof htmx !== 'undefined') {
      htmx.ajax('GET',
        '/seller/viewings/slots/date-sidebar?date=' + encodeURIComponent(dateStr)
        + '&propertyId=' + encodeURIComponent(this.propertyId),
        { target: this.sidebarTarget, swap: 'innerHTML' }
      );
    }
  };

  ViewingCalendar.prototype.changeMonth = function (delta) {
    this.month += delta;
    if (this.month > 11) { this.month = 0; this.year++; }
    if (this.month < 0) { this.month = 11; this.year--; }
    this.fetchMonthMeta();
    this.render();
  };

  ViewingCalendar.prototype.goToToday = function () {
    var now = new Date();
    var changed = this.year !== now.getFullYear() || this.month !== now.getMonth();
    this.year = now.getFullYear();
    this.month = now.getMonth();
    if (changed) this.fetchMonthMeta();
    this.render();
  };

  ViewingCalendar.prototype.fetchMonthMeta = function () {
    var self = this;
    var monthStr = this.year + '-' + String(this.month + 1).padStart(2, '0');
    var url = '/seller/viewings/slots/month-meta?month=' + monthStr
      + '&propertyId=' + encodeURIComponent(this.propertyId);

    fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        // Merge new month data
        Object.keys(data).forEach(function (k) { self.slotsByDate[k] = data[k]; });
        self.render();
      })
      .catch(function () { /* ignore fetch errors, dots just won't show */ });
  };

  function formatDate(d) {
    return d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
  }

  // Expose globally
  window.ViewingCalendar = ViewingCalendar;
})();
