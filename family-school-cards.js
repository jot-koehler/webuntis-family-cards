/* =========================================================================
 * Family School Cards
 * Lovelace-Karten für Schul-Stundenpläne (WebUntis-Kalender in Home Assistant)
 * https://github.com/jot-koehler/family-school-cards
 *
 * Enthält drei Karten:
 *   - family-timetable-card   Zeitraster-Stundenplan (heute/morgen) fuer EIN Kind
 *   - family-overview-card    Kompakte "Wer muss wann los"-Uebersicht fuer MEHRERE Kinder
 *   - family-homework-card    Direkt lesbare Hausaufgabenliste fuer EIN Kind
 *
 * Voraussetzung: die Integration "WebUntis" (JonasJoKuJonas/homeassistant-WebUntis)
 * liefert pro Kind eine calendar.*-Entity. Siehe README.md fuer die noetige
 * WebUntis-Konfiguration (entfallene Stunden, Sonderveranstaltungen).
 * ========================================================================= */

/* ---------- Gemeinsame Hilfsfunktionen ---------- */

function fscEsc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fscHexToRgba(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (isNaN(n)) return `rgba(128,128,128,${alpha})`;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function fscSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fscMinOfDay(d) { return d.getHours() * 60 + d.getMinutes(); }

function fscDates(count, skipWeekends) {
  const out = []; let d = new Date(); d.setHours(0, 0, 0, 0); let guard = 0;
  while (out.length < count && guard < 30) {
    const dow = d.getDay();
    if (!skipWeekends || (dow !== 0 && dow !== 6)) out.push(new Date(d));
    d = new Date(d); d.setDate(d.getDate() + 1); guard++;
  }
  return out;
}

function fscFireConfigChanged(el, config) {
  el.dispatchEvent(new CustomEvent('config-changed', {
    detail: { config }, bubbles: true, composed: true,
  }));
}

/* =========================================================================
 * family-timetable-card
 * Zeitraster-Stundenplan (mehrere Tage auf gemeinsamer Zeitachse) fuer EIN Kind.
 * Klassifiziert Ereignisse aus der WebUntis-Kalender-Entity in:
 *   - normal      regulaerer Unterricht
 *   - cancelled   "Cancelled: ..." -> rot, durchgestrichen
 *   - changed     "Irregular: ..." MIT Raum-Angabe -> Vertretung/Aenderung, orange
 *   - special     "Irregular: ..." OHNE Raum-Angabe -> Sonderveranstaltung, gelb
 *                 (Einschulung, Klassenlehrerunterricht, Wandertag, ...)
 * Die special/changed-Unterscheidung ist eine Heuristik (siehe README):
 * WebUntis liefert Sonderveranstaltungen ohne Fach und damit ohne Raum,
 * markiert sie aber genau wie eine Vertretung als "Irregular:". Eine echte
 * Vertretung hat in der Praxis fast immer einen Raum - daher: kein Raum bei
 * einem Irregular-Eintrag => Sonderveranstaltung.
 * ========================================================================= */
class FamilyTimetableCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement('family-timetable-card-editor');
  }
  static getStubConfig() {
    return { title: '', entities: [], color: '#4fa8e0', days: 2 };
  }
  setConfig(config) {
    if (!config.entities || !config.entities.length) {
      throw new Error('family-timetable-card: "entities" (mind. 1 Kalender-Entity) ist erforderlich.');
    }
    this._config = Object.assign({
      days: 2, skip_weekends: true, refresh_interval: 300, pixels_per_hour: 70,
      padding_minutes: 15, fallback_day_start: '07:30', fallback_day_end: '14:00', color: '#4fa8e0',
    }, config);
    this._initialized = false;
    this._render();
  }
  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._fetchAndRender();
      this._interval = setInterval(() => this._fetchAndRender(), this._config.refresh_interval * 1000);
    }
  }
  disconnectedCallback() { if (this._interval) { clearInterval(this._interval); this._interval = null; } this._initialized = false; }
  getCardSize() { return 5; }
  _layoutColumns(items) {
    const n = items.length;
    const assigned = new Array(n);
    let colFree = [];
    let clusterEnd = -Infinity;
    let clusterIdx = [];
    const flush = () => {
      if (!clusterIdx.length) return;
      const cols = Math.max(...clusterIdx.map((i) => assigned[i].col)) + 1;
      for (const idx of clusterIdx) assigned[idx].cols = cols;
      clusterIdx = [];
    };
    for (let i = 0; i < n; i++) {
      const it = items[i];
      const startMs = it.start.getTime();
      if (startMs >= clusterEnd) { flush(); colFree = []; clusterEnd = -Infinity; }
      let col = colFree.findIndex((endMs) => endMs <= startMs);
      if (col === -1) { col = colFree.length; colFree.push(0); }
      colFree[col] = it.end.getTime();
      assigned[i] = { col, cols: 1 };
      clusterIdx.push(i);
      clusterEnd = Math.max(clusterEnd, it.end.getTime());
    }
    flush();
    return assigned;
  }
  async _fetchAndRender() {
    if (!this._hass) return;
    const dates = fscDates(this._config.days, this._config.skip_weekends); if (!dates.length) return;
    const rangeStart = new Date(dates[0]); rangeStart.setHours(-6, 0, 0, 0);
    const rangeEnd = new Date(dates[dates.length - 1]); rangeEnd.setHours(30, 0, 0, 0);
    const startISO = rangeStart.toISOString(); const endISO = rangeEnd.toISOString();
    const perEntity = await Promise.all(this._config.entities.map(async (ent) => {
      const entityId = typeof ent === 'string' ? ent : ent.entity;
      try {
        const events = await this._hass.callApi('GET', `calendars/${entityId}?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`);
        return { entityId, events: events || [] };
      } catch (e) { console.error('family-timetable-card:', entityId, e); return { entityId, events: [], error: true }; }
    }));
    const buckets = dates.map((d) => ({ date: d, items: [] }));
    const seen = new Set();
    for (const src of perEntity) {
      for (const ev of src.events) {
        if (!ev.start || !ev.start.dateTime) continue;
        const start = new Date(ev.start.dateTime);
        const end = new Date((ev.end && ev.end.dateTime) || ev.start.dateTime);
        const key = start.toISOString() + '|' + end.toISOString() + '|' + (ev.summary || '') + '|' + (ev.location || '');
        if (seen.has(key)) continue; seen.add(key);
        const bucket = buckets.find((b) => fscSameDay(b.date, start)); if (!bucket) continue;
        let title = ev.summary || ''; let changed = false; let cancelled = false;
        let m = title.match(/^Irregular:\s*/i);
        if (m) { changed = true; title = title.slice(m[0].length); }
        m = title.match(/^Cancelled:\s*/i);
        if (m) { cancelled = true; title = title.slice(m[0].length); }
        const special = changed && !ev.location;
        bucket.items.push({ start, end, title, location: ev.location || '', changed, cancelled, special });
      }
    }
    for (const b of buckets) b.items.sort((a, c) => a.start - c.start || a.end - c.end);
    let minStart = null, maxEnd = null;
    for (const b of buckets) for (const it of b.items) {
      const s = fscMinOfDay(it.start), e = fscMinOfDay(it.end);
      if (minStart === null || s < minStart) minStart = s;
      if (maxEnd === null || e > maxEnd) maxEnd = e;
    }
    const hasAnyEvents = minStart !== null;
    const [fsh, fsm] = this._config.fallback_day_start.split(':').map(Number);
    const [feh, fem] = this._config.fallback_day_end.split(':').map(Number);
    if (minStart === null) minStart = fsh * 60 + fsm;
    if (maxEnd === null) maxEnd = feh * 60 + fem;
    const pad = this._config.padding_minutes;
    minStart = Math.max(0, Math.floor((minStart - pad) / 5) * 5);
    maxEnd = Math.min(24 * 60, Math.ceil((maxEnd + pad) / 5) * 5);
    this._buckets = buckets; this._hasAnyEvents = hasAnyEvents;
    this._dayStartMin = minStart; this._dayEndMin = maxEnd;
    this._lastError = perEntity.some((p) => p.error);
    this._render();
  }
  _render() {
    if (!this._config) return;
    this.style.setProperty('--fsc-accent', this._config.color);
    this.style.setProperty('--fsc-border', fscHexToRgba(this._config.color, 0.28));
    const buckets = this._buckets || fscDates(this._config.days, this._config.skip_weekends).map((d) => ({ date: d, items: [] }));
    const showGrid = this._hasAnyEvents !== false;
    const dayStartMin = this._dayStartMin != null ? this._dayStartMin : 450;
    const dayEndMin = this._dayEndMin != null ? this._dayEndMin : 840;
    const totalMin = Math.max(30, dayEndMin - dayStartMin);
    const heightPx = Math.max(160, Math.round((totalMin / 60) * this._config.pixels_per_hour));
    const now = new Date(); const nowMin = fscMinOfDay(now);
    const weekdayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
    const dayFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric' });
    const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'short' });
    const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
    const dayCols = buckets.map((b) => {
      const isToday = fscSameDay(b.date, now);
      const bodyStyle = showGrid ? `height:${heightPx}px` : '';
      const layout = this._layoutColumns(b.items);
      const blocks = !showGrid ? '' : b.items.map((it, idx) => {
        let s = Math.max(dayStartMin, fscMinOfDay(it.start));
        let e = Math.min(dayEndMin, fscMinOfDay(it.end));
        if (e <= s) e = Math.min(dayEndMin, s + 5);
        const top = ((s - dayStartMin) / totalMin) * 100;
        const height = Math.max(3, ((e - s) / totalMin) * 100);
        const { col, cols } = layout[idx];
        const leftPct = (col / cols) * 100;
        const widthPct = 100 / cols;
        const posStyle = `top:${top}%;height:${height}%;left:calc(${leftPct}% + 1px);width:calc(${widthPct}% - 2px)`;
        const timeLabel = `${timeFmt.format(it.start)}–${timeFmt.format(it.end)}`;
        const meta = it.location ? `${timeLabel} · Raum ${it.location}` : timeLabel;
        const cls = it.cancelled ? 'event cancelled' : (it.special ? 'event special' : (it.changed ? 'event changed' : 'event'));
        const icon = it.cancelled ? '<ha-icon icon="mdi:cancel" class="cnl-icon"></ha-icon>' : (it.special ? '<ha-icon icon="mdi:calendar-star" class="spc-icon"></ha-icon>' : (it.changed ? '<ha-icon icon="mdi:sync-alert" class="chg-icon"></ha-icon>' : ''));
        const titleHtml = it.cancelled ? `<span class="strike">${fscEsc(it.title)}</span>` : fscEsc(it.title);
        return `<div class="${cls}" style="${posStyle}"><div class="event-title">${icon}${titleHtml}</div>${height > 7 && cols === 1 ? `<div class="event-time"><ha-icon icon="mdi:clock-outline"></ha-icon>${fscEsc(meta)}</div>` : ''}</div>`;
      }).join('');
      const nowLine = showGrid && isToday && nowMin >= dayStartMin && nowMin <= dayEndMin ? `<div class="now-line" style="top:${((nowMin - dayStartMin) / totalMin) * 100}%"></div>` : '';
      const empty = b.items.length === 0 ? '<div class="empty"><ha-icon icon="mdi:check"></ha-icon>Keine anstehenden Termine</div>' : '';
      return `<div class="day-col"><div class="day-header"><div class="weekday">${fscEsc(weekdayFmt.format(b.date))}</div><div class="date-row"><span class="day-num">${dayFmt.format(b.date)}</span> <span class="month">${fscEsc(monthFmt.format(b.date).toUpperCase())}</span></div></div><div class="day-body" style="${bodyStyle}">${nowLine}${blocks}${empty}</div></div>`;
    }).join('');
    const errNote = this._lastError ? '<div class="err">Kalenderdaten konnten nicht vollständig geladen werden.</div>' : '';
    this.innerHTML = `<ha-card>${this._config.title ? `<div class="title">${fscEsc(this._config.title)}</div>` : ''}<style>
      ha-card{padding:16px 16px 12px;border:2px solid var(--fsc-border,var(--divider-color))}
      .title{font-size:1.5em;font-weight:500;margin-bottom:12px;color:var(--fsc-accent,var(--primary-text-color))}
      .grid{display:flex;gap:16px}.day-col{flex:1;min-width:0}.weekday{font-size:14px;color:var(--primary-text-color)}
      .date-row{font-size:13px;color:var(--secondary-text-color);margin-bottom:6px}.day-num{font-size:20px;font-weight:600;color:var(--primary-text-color)}
      .day-header{border-bottom:1px solid var(--divider-color);padding-bottom:6px;margin-bottom:8px}.day-body{position:relative}
      .event{position:absolute;background:rgba(var(--rgb-primary-color,79,168,224),0.16);border-left:3px solid var(--fsc-accent,var(--primary-color));border-radius:6px;padding:5px 8px;box-sizing:border-box;overflow:hidden}
      .event.changed{border-left-color:#e0a84f;background:rgba(224,168,79,0.16)}
      .event.cancelled{border-left-color:#e05f4f;background:rgba(224,95,79,0.14)}
      .event.special{border-left-color:#e6c229;background:rgba(230,194,41,0.18)}
      .strike{text-decoration:line-through;opacity:.75}
      .event-title{font-size:13px;font-weight:500;color:var(--primary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px}
      .chg-icon{--mdc-icon-size:14px;color:#e0a84f;flex:none}.cnl-icon{--mdc-icon-size:14px;color:#e05f4f;flex:none}.spc-icon{--mdc-icon-size:14px;color:#e6c229;flex:none}
      .event-time{font-size:11px;color:var(--secondary-text-color);display:flex;align-items:center;gap:3px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .event-time ha-icon{--mdc-icon-size:13px}
      .now-line{position:absolute;left:-4px;right:0;height:0;border-top:2px solid var(--error-color,#db4437);opacity:.55}
      .empty{display:flex;align-items:center;gap:6px;background:rgba(var(--rgb-primary-color,79,168,224),0.16);border-left:3px solid var(--fsc-accent,var(--primary-color));border-radius:6px;padding:8px 10px;font-size:13px;color:var(--secondary-text-color)}
      .empty ha-icon{--mdc-icon-size:16px;color:var(--secondary-text-color)}.err{margin-top:8px;font-size:11px;color:var(--error-color,#db4437)}
      </style><div class="grid">${dayCols}</div>${errNote}</ha-card>`;
  }
}
customElements.define('family-timetable-card', FamilyTimetableCard);

/* ---------- Editor: family-timetable-card ---------- */
class FamilySingleEntityEditorBase extends HTMLElement {
  constructor() { super(); this._rendered = false; }
  setConfig(config) {
    this._config = Object.assign({}, config);
    if (this._rendered) this._syncFields();
    else if (this._hass) this._render();
  }
  set hass(hass) {
    this._hass = hass;
    const picker = this.querySelector('ha-entity-picker');
    if (picker) picker.hass = hass;
    if (!this._rendered && this._config) this._render();
  }
  _render() {
    if (!this._config) return;
    this._rendered = true;
    this.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;padding:8px 2px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="title" style="font-size:12px;color:var(--secondary-text-color);">Titel (z.B. Name des Kindes)</label>
          <input id="title" type="text" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font:inherit;">
        </div>
        <div id="entity-slot"></div>
        <div style="display:flex;gap:12px;align-items:center;">
          <label style="font-size:14px;color:var(--secondary-text-color);min-width:70px;">Farbe</label>
          <input id="color" type="color" style="width:48px;height:32px;border:none;background:none;cursor:pointer">
        </div>
        <div id="extra-slot" style="display:flex;flex-direction:column;gap:16px;"></div>
      </div>`;
    const picker = document.createElement('ha-entity-picker');
    picker.includeDomains = ['calendar'];
    picker.label = 'Kalender-Entity';
    picker.hass = this._hass;
    picker.addEventListener('value-changed', (ev) => {
      ev.stopPropagation();
      this._config.entities = ev.detail.value ? [ev.detail.value] : [];
      this._fireChanged();
    });
    this.querySelector('#entity-slot').appendChild(picker);

    const titleEl = this.querySelector('#title');
    titleEl.addEventListener('input', () => {
      this._config.title = titleEl.value;
      this._fireChanged();
    });

    const colorEl = this.querySelector('#color');
    colorEl.addEventListener('input', () => {
      this._config.color = colorEl.value;
      this._fireChanged();
    });

    this._renderExtra();
    this._syncFields();
  }
  _renderExtra() {}
  _syncFields() {
    if (!this._rendered || !this._config) return;
    const titleEl = this.querySelector('#title');
    if (titleEl && document.activeElement !== titleEl) titleEl.value = this._config.title || '';
    const picker = this.querySelector('ha-entity-picker');
    if (picker) picker.value = (this._config.entities && this._config.entities[0]) || '';
    const colorEl = this.querySelector('#color');
    if (colorEl && document.activeElement !== colorEl) colorEl.value = this._config.color || '#4fa8e0';
  }
  _fireChanged() { fscFireConfigChanged(this, this._config); }
}

class FamilyTimetableCardEditor extends FamilySingleEntityEditorBase {
  _renderExtra() {
    const slot = this.querySelector('#extra-slot');
    slot.innerHTML = `<div style="display:flex;flex-direction:column;gap:4px;">
      <label for="days" style="font-size:12px;color:var(--secondary-text-color);">Anzahl Tage (heute + folgende)</label>
      <input id="days" type="number" min="1" max="5" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font:inherit;">
    </div>`;
    const daysEl = slot.querySelector('#days');
    daysEl.addEventListener('input', () => {
      const v = parseInt(daysEl.value, 10);
      this._config.days = isNaN(v) ? 2 : v;
      this._fireChanged();
    });
  }
  _syncFields() {
    super._syncFields();
    const daysEl = this.querySelector('#days');
    if (daysEl && document.activeElement !== daysEl) daysEl.value = this._config.days != null ? this._config.days : 2;
  }
}
customElements.define('family-timetable-card-editor', FamilyTimetableCardEditor);

/* =========================================================================
 * family-overview-card
 * Kompakte horizontale "Wer muss wann los"-Balkenuebersicht fuer mehrere Kinder.
 * ========================================================================= */
class FamilyOverviewCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement('family-overview-card-editor');
  }
  static getStubConfig() {
    return { days: 2, people: [] };
  }
  setConfig(config) {
    if (!config.people || !config.people.length) {
      throw new Error('family-overview-card: "people" (mind. 1 Kind) ist erforderlich.');
    }
    this._config = Object.assign({
      days: 2, skip_weekends: true, refresh_interval: 300,
      padding_minutes: 15, fallback_day_start: '07:30', fallback_day_end: '14:00',
    }, config);
    this._initialized = false;
    this._render();
  }
  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._fetchAndRender();
      this._interval = setInterval(() => this._fetchAndRender(), this._config.refresh_interval * 1000);
    }
  }
  disconnectedCallback() { if (this._interval) { clearInterval(this._interval); this._interval = null; } this._initialized = false; }
  getCardSize() { return 3; }
  async _fetchAndRender() {
    if (!this._hass) return;
    const dates = fscDates(this._config.days, this._config.skip_weekends); if (!dates.length) return;
    const rangeStart = new Date(dates[0]); rangeStart.setHours(-6, 0, 0, 0);
    const rangeEnd = new Date(dates[dates.length - 1]); rangeEnd.setHours(30, 0, 0, 0);
    const startISO = rangeStart.toISOString(); const endISO = rangeEnd.toISOString();
    const perPerson = await Promise.all(this._config.people.map(async (p) => {
      try {
        const events = await this._hass.callApi('GET', `calendars/${p.entity}?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`);
        return Object.assign({}, p, { events: events || [] });
      } catch (e) { console.error('family-overview-card:', p.entity, e); return Object.assign({}, p, { events: [], error: true }); }
    }));
    const perPersonDays = perPerson.map((p) => {
      const days = dates.map((d) => ({ date: d, start: null, end: null }));
      const seen = new Set();
      for (const ev of p.events) {
        if (!ev.start || !ev.start.dateTime) continue;
        const s = new Date(ev.start.dateTime);
        const e = new Date((ev.end && ev.end.dateTime) || ev.start.dateTime);
        const key = s.toISOString() + '|' + e.toISOString() + '|' + (ev.summary || '');
        if (seen.has(key)) continue; seen.add(key);
        if (/^Cancelled:\s*/i.test(ev.summary || '')) continue;
        const day = days.find((dd) => fscSameDay(dd.date, s)); if (!day) continue;
        if (day.start === null || s < day.start) day.start = s;
        if (day.end === null || e > day.end) day.end = e;
      }
      return Object.assign({}, p, { days });
    });
    let minStart = null, maxEnd = null;
    for (const p of perPersonDays) for (const d of p.days) {
      if (d.start) { const m = fscMinOfDay(d.start); if (minStart === null || m < minStart) minStart = m; }
      if (d.end) { const m = fscMinOfDay(d.end); if (maxEnd === null || m > maxEnd) maxEnd = m; }
    }
    const hasAny = minStart !== null;
    const [fsh, fsm] = this._config.fallback_day_start.split(':').map(Number);
    const [feh, fem] = this._config.fallback_day_end.split(':').map(Number);
    if (minStart === null) minStart = fsh * 60 + fsm;
    if (maxEnd === null) maxEnd = feh * 60 + fem;
    const pad = this._config.padding_minutes;
    minStart = Math.max(0, Math.floor((minStart - pad) / 5) * 5);
    maxEnd = Math.min(24 * 60, Math.ceil((maxEnd + pad) / 5) * 5);
    this._dates_cache = dates; this._perPersonDays = perPersonDays; this._hasAny = hasAny;
    this._dayStartMin = minStart; this._dayEndMin = maxEnd;
    this._lastError = perPerson.some((p) => p.error);
    this._render();
  }
  _render() {
    if (!this._config) return;
    const dates = this._dates_cache || fscDates(this._config.days, this._config.skip_weekends);
    const perPersonDays = this._perPersonDays || this._config.people.map((p) => Object.assign({}, p, { days: dates.map((d) => ({ date: d, start: null, end: null })) }));
    const showGrid = this._hasAny !== false;
    const dayStartMin = this._dayStartMin != null ? this._dayStartMin : 450;
    const dayEndMin = this._dayEndMin != null ? this._dayEndMin : 840;
    const totalMin = Math.max(30, dayEndMin - dayStartMin);
    const now = new Date(); const nowMin = fscMinOfDay(now);
    const weekdayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
    const dayFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric' });
    const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'short' });
    const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
    const dayBlocks = dates.map((date, di) => {
      const isToday = fscSameDay(date, now);
      const dateLabel = `${weekdayFmt.format(date)} · ${dayFmt.format(date)}. ${monthFmt.format(date)}`;
      const nowMark = showGrid && isToday && nowMin >= dayStartMin && nowMin <= dayEndMin
        ? `<div class="now-mark" style="left:${((nowMin - dayStartMin) / totalMin) * 100}%"></div>` : '';
      const rows = perPersonDays.map((p) => {
        const d = p.days[di];
        if (!showGrid || !d || !d.start || !d.end) {
          return `<div class="row"><div class="row-name" style="color:${p.color}">${fscEsc(p.name)}</div><div class="row-track"><div class="row-empty">schulfrei</div></div></div>`;
        }
        const s = Math.max(dayStartMin, fscMinOfDay(d.start));
        const e = Math.min(dayEndMin, fscMinOfDay(d.end));
        const left = ((s - dayStartMin) / totalMin) * 100;
        const width = Math.max(8, ((e - s) / totalMin) * 100);
        const label = `${timeFmt.format(d.start)}–${timeFmt.format(d.end)}`;
        const fill = fscHexToRgba(p.color, 0.28);
        return `<div class="row"><div class="row-name" style="color:${p.color}">${fscEsc(p.name)}</div><div class="row-track"><div class="bar" style="left:${left}%;width:${width}%;background:${fill};border-left:2px solid ${p.color}">${fscEsc(label)}</div></div></div>`;
      }).join('');
      return `<div class="day-block"><div class="day-label${isToday ? ' today' : ''}">${fscEsc(dateLabel)}</div><div class="rows">${nowMark}${rows}</div></div>`;
    }).join('');
    const errNote = this._lastError ? '<div class="err">Kalenderdaten konnten nicht vollständig geladen werden.</div>' : '';
    this.innerHTML = `<ha-card>${this._config.title ? `<div class="title">${fscEsc(this._config.title)}</div>` : ''}<style>
      ha-card{padding:14px 16px 12px}.title{font-size:1.3em;font-weight:400;margin-bottom:10px;color:var(--primary-text-color)}
      .day-block{margin-bottom:10px}.day-block:last-child{margin-bottom:0}
      .day-label{font-size:11px;font-weight:600;color:var(--secondary-text-color);text-transform:uppercase;letter-spacing:.02em;margin-bottom:5px}
      .day-label.today{color:var(--primary-text-color)}
      .rows{position:relative;display:flex;flex-direction:column;gap:4px}
      .row{display:flex;align-items:center;gap:6px}
      .row-name{width:44px;flex:none;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .row-track{position:relative;flex:1;height:22px;border-radius:5px;background:rgba(128,128,128,0.12)}
      .bar{position:absolute;top:0;bottom:0;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;color:var(--primary-text-color);padding:0 4px;box-sizing:border-box;overflow:hidden;white-space:nowrap}
      .row-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--secondary-text-color)}
      .now-mark{position:absolute;top:-3px;bottom:-3px;width:0;border-left:2px dashed var(--error-color,#db4437);opacity:.6;z-index:2}
      .err{margin-top:8px;font-size:11px;color:var(--error-color,#db4437)}
      </style><div class="blocks">${dayBlocks}</div>${errNote}</ha-card>`;
  }
}
customElements.define('family-overview-card', FamilyOverviewCard);

/* ---------- Editor: family-overview-card (repeating Kind-Zeilen) ---------- */
class FamilyOverviewCardEditor extends HTMLElement {
  constructor() { super(); this._rendered = false; this._rowRefs = []; }
  setConfig(config) {
    const newPeople = (config.people || []).map((p) => Object.assign({}, p));
    const oldLen = this._config && this._config.people ? this._config.people.length : -1;
    this._config = Object.assign({}, config, { people: newPeople });
    if (this._rendered) {
      if (newPeople.length !== oldLen) this._renderRows();
      else this._syncRows();
    } else if (this._hass) {
      this._render();
    }
  }
  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) { if (this._config) this._render(); return; }
    this.querySelectorAll('ha-entity-picker').forEach((p) => { p.hass = hass; });
  }
  _render() {
    if (!this._config) return;
    this._rendered = true;
    this.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;padding:8px 2px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="days" style="font-size:12px;color:var(--secondary-text-color);">Anzahl Tage (heute + folgende)</label>
          <input id="days" type="number" min="1" max="5" style="width:220px;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font:inherit;">
        </div>
        <div id="rows" style="display:flex;flex-direction:column;gap:8px;"></div>
        <mwc-button id="add-row" raised>+ Kind hinzufügen</mwc-button>
      </div>`;
    const daysEl = this.querySelector('#days');
    daysEl.value = this._config.days != null ? this._config.days : 2;
    daysEl.addEventListener('input', () => {
      const v = parseInt(daysEl.value, 10);
      this._config.days = isNaN(v) ? 2 : v;
      this._fireChanged();
    });
    this.querySelector('#add-row').addEventListener('click', () => {
      this._config.people = [...(this._config.people || []), { name: '', entity: '', color: '#4fa8e0' }];
      this._renderRows();
      this._fireChanged();
    });
    this._renderRows();
  }
  _syncRows() {
    (this._config.people || []).forEach((person, idx) => {
      const refs = this._rowRefs[idx];
      if (!refs) return;
      if (document.activeElement !== refs.nameEl) refs.nameEl.value = person.name || '';
      if (refs.picker.value !== (person.entity || '')) refs.picker.value = person.entity || '';
      if (document.activeElement !== refs.colorEl) refs.colorEl.value = person.color || '#4fa8e0';
    });
  }
  _renderRows() {
    const container = this.querySelector('#rows');
    container.innerHTML = '';
    this._rowRefs = [];
    (this._config.people || []).forEach((person, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;border:1px solid var(--divider-color);border-radius:8px;padding:8px;';

      const nameEl = document.createElement('input');
      nameEl.type = 'text';
      nameEl.placeholder = 'Name';
      nameEl.style.cssText = 'width:110px;box-sizing:border-box;padding:6px 8px;border-radius:4px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font:inherit;';
      nameEl.value = person.name || '';
      nameEl.addEventListener('input', () => {
        this._config.people[idx].name = nameEl.value;
        this._fireChanged();
      });

      const picker = document.createElement('ha-entity-picker');
      picker.includeDomains = ['calendar'];
      picker.label = 'Kalender';
      picker.hass = this._hass;
      picker.value = person.entity || '';
      picker.style.flex = '1';
      picker.addEventListener('value-changed', (ev) => {
        ev.stopPropagation();
        this._config.people[idx].entity = ev.detail.value || '';
        this._fireChanged();
      });

      const colorEl = document.createElement('input');
      colorEl.type = 'color';
      colorEl.value = person.color || '#4fa8e0';
      colorEl.style.cssText = 'width:40px;height:32px;border:none;background:none;cursor:pointer;flex:none;';
      colorEl.addEventListener('input', () => {
        this._config.people[idx].color = colorEl.value;
        this._fireChanged();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '✕';
      removeBtn.title = 'Kind entfernen';
      removeBtn.style.cssText = 'border:none;background:none;color:var(--error-color,#db4437);font-size:16px;cursor:pointer;padding:4px 8px;flex:none;';
      removeBtn.addEventListener('click', () => {
        this._config.people.splice(idx, 1);
        this._renderRows();
        this._fireChanged();
      });

      row.append(nameEl, picker, colorEl, removeBtn);
      container.appendChild(row);
      this._rowRefs.push({ nameEl, picker, colorEl });
    });
  }
  _fireChanged() { fscFireConfigChanged(this, this._config); }
}
customElements.define('family-overview-card-editor', FamilyOverviewCardEditor);

/* =========================================================================
 * family-homework-card
 * Direkt lesbare Hausaufgabenliste (kein Akkordeon) fuer EIN Kind, mit
 * klickbaren Links in der Beschreibung.
 * ========================================================================= */
class FamilyHomeworkCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement('family-homework-card-editor');
  }
  static getStubConfig() {
    return { title: '', entities: [], color: '#4fa8e0', days: 14 };
  }
  setConfig(config) {
    if (!config.entities || !config.entities.length) {
      throw new Error('family-homework-card: "entities" (mind. 1 Kalender-Entity) ist erforderlich.');
    }
    this._config = Object.assign({ days: 14, refresh_interval: 300, color: '#4fa8e0' }, config);
    this._initialized = false;
    this._render();
  }
  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._fetchAndRender();
      this._interval = setInterval(() => this._fetchAndRender(), this._config.refresh_interval * 1000);
    }
  }
  disconnectedCallback() { if (this._interval) { clearInterval(this._interval); this._interval = null; } this._initialized = false; }
  getCardSize() { return 4; }
  async _fetchAndRender() {
    if (!this._hass) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + this._config.days);
    const startISO = start.toISOString(); const endISO = end.toISOString();
    let hadError = false;
    const perEntity = await Promise.all(this._config.entities.map(async (ent) => {
      const entityId = typeof ent === 'string' ? ent : ent.entity;
      try {
        const events = await this._hass.callApi('GET', `calendars/${entityId}?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`);
        return events || [];
      } catch (e) { console.error('family-homework-card:', entityId, e); hadError = true; return []; }
    }));
    const items = [];
    const seen = new Set();
    for (const events of perEntity) {
      for (const ev of events) {
        const startStr = ev.start && (ev.start.date || ev.start.dateTime);
        const endStr = ev.end && (ev.end.date || ev.end.dateTime);
        if (!startStr) continue;
        const key = startStr + '|' + endStr + '|' + (ev.summary || '') + '|' + (ev.description || '');
        if (seen.has(key)) continue; seen.add(key);
        const given = ev.start.date ? new Date(ev.start.date + 'T00:00:00') : new Date(startStr);
        let due;
        if (ev.end && ev.end.date) {
          due = new Date(ev.end.date + 'T00:00:00');
          due.setDate(due.getDate() - 1);
        } else if (endStr) {
          due = new Date(endStr);
        } else {
          due = new Date(startStr);
        }
        items.push({ id: key, summary: ev.summary || '', description: ev.description || '', given, due });
      }
    }
    items.sort((a, b) => a.due - b.due);
    this._items = items;
    this._lastError = hadError;
    this._render();
  }
  _linkify(text) {
    const esc = fscEsc(text);
    return esc.replace(/(https?:\/\/[^\s]+)/gi, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);
  }
  _render() {
    if (!this._config) return;
    this.style.setProperty('--fsc-accent', this._config.color);
    this.style.setProperty('--fsc-border', fscHexToRgba(this._config.color, 0.28));
    const items = this._items || [];
    const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    const rows = items.length === 0
      ? '<div class="empty"><ha-icon icon="mdi:check"></ha-icon>Keine Hausaufgaben</div>'
      : items.map((it) => {
          const range = fscSameDay(it.given, it.due)
            ? fscEsc(dateFmt.format(it.due))
            : `${fscEsc(dateFmt.format(it.given))} – ${fscEsc(dateFmt.format(it.due))}`;
          const desc = it.description
            ? `<div class="desc">${this._linkify(it.description).replace(/\n/g, '<br>')}</div>`
            : '<div class="desc empty-desc">Keine weiteren Details</div>';
          return `<div class="item">
                    <div class="item-head">
                      <span class="range">${range}</span><span class="subj">${fscEsc(it.summary)}</span>
                    </div>
                    ${desc}
                  </div>`;
        }).join('');
    this.innerHTML = `<ha-card>${this._config.title ? `<div class="title">${fscEsc(this._config.title)}</div>` : ''}<style>
      ha-card{padding:12px 16px;border:2px solid var(--fsc-border,var(--divider-color))}
      .title{font-size:1.2em;font-weight:500;margin-bottom:8px;color:var(--fsc-accent,var(--primary-text-color))}
      .item{border-top:1px solid var(--divider-color);padding:9px 2px}
      .item:first-child{border-top:none;padding-top:0}
      .item-head{display:flex;align-items:baseline;gap:10px;margin-bottom:4px;flex-wrap:wrap}
      .range{font-size:14px;font-weight:500;color:var(--primary-text-color)}
      .subj{font-size:14px;font-weight:500;color:var(--primary-text-color)}
      .desc{font-size:13px;line-height:1.45;color:var(--primary-text-color);white-space:pre-wrap;user-select:text;-webkit-user-select:text}
      .desc a{color:var(--fsc-accent,var(--primary-color))}
      .empty-desc{color:var(--secondary-text-color);font-style:italic}
      .empty{display:flex;align-items:center;gap:6px;padding:6px 2px;font-size:13px;color:var(--secondary-text-color)}
      .err{margin-top:8px;font-size:11px;color:var(--error-color,#db4437)}
      </style><div class="list">${rows}</div>${this._lastError ? '<div class="err">Kalenderdaten konnten nicht vollständig geladen werden.</div>' : ''}</ha-card>`;
  }
}
customElements.define('family-homework-card', FamilyHomeworkCard);

/* ---------- Editor: family-homework-card ---------- */
class FamilyHomeworkCardEditor extends FamilySingleEntityEditorBase {
  _renderExtra() {
    const slot = this.querySelector('#extra-slot');
    slot.innerHTML = `<div style="display:flex;flex-direction:column;gap:4px;">
      <label for="days" style="font-size:12px;color:var(--secondary-text-color);">Vorschau-Zeitraum (Tage)</label>
      <input id="days" type="number" min="1" max="60" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font:inherit;">
    </div>`;
    const daysEl = slot.querySelector('#days');
    daysEl.addEventListener('input', () => {
      const v = parseInt(daysEl.value, 10);
      this._config.days = isNaN(v) ? 14 : v;
      this._fireChanged();
    });
  }
  _syncFields() {
    super._syncFields();
    const daysEl = this.querySelector('#days');
    if (daysEl && document.activeElement !== daysEl) daysEl.value = this._config.days != null ? this._config.days : 14;
  }
}
customElements.define('family-homework-card-editor', FamilyHomeworkCardEditor);

/* ---------- HACS / Lovelace Card-Picker Registrierung ---------- */
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'family-timetable-card',
  name: 'Family Timetable Card',
  description: 'WebUntis-Stundenplan (heute/morgen) auf gemeinsamer Zeitachse, fuer ein Kind.',
});
window.customCards.push({
  type: 'family-overview-card',
  name: 'Family Overview Card',
  description: 'Kompakte "Wer muss wann los"-Uebersicht fuer mehrere Kinder.',
});
window.customCards.push({
  type: 'family-homework-card',
  name: 'Family Homework Card',
  description: 'Direkt lesbare WebUntis-Hausaufgabenliste, fuer ein Kind.',
});
