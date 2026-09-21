/* =========================================================================
 * Family School Cards
 * Version: 1.4.0 (2026-09-21) - Aenderungen siehe CHANGELOG.md
 * Kompakte Lovelace-Karten fuer Stundenplaene, Hausaufgaben und Klausuren von
 * Kindern in Home Assistant.
 * https://github.com/jot-koehler/webuntis-family-cards
 *
 * Universell: die Karten arbeiten mit JEDER HA-Kalender-Entity (Google Calendar,
 * CalDAV/iServ, ICS, lokaler Kalender ...). Entstanden fuer WebUntis
 * (JonasJoKuJonas/homeassistant-WebUntis) - daher ist WebUntis die am besten
 * unterstuetzte Quelle: nur dort liefert die Timetable-Karte zusaetzlich die
 * Farb-/Statuskennung fuer entfallene Stunden, Vertretungen und
 * Sonderveranstaltungen (Heuristik ueber die "Cancelled:"/"Irregular:"-Praefixe
 * im summary-Feld). Mit anderen Kalendern werden Eintraege schlicht als normale
 * Bloecke gezeigt - voll funktionsfaehig, nur ohne diese Hervorhebung.
 *
 * Enthaelt vier Karten:
 *   - family-timetable-card   Zeitraster-Stundenplan (heute/folgende Tage) fuer EIN Kind,
 *                             optional mit Klick-Detail-Popup und Mensa-Bestellhinweis
 *   - family-overview-card    Kompakte "Wer muss wann los"-Uebersicht fuer MEHRERE Kinder
 *   - family-homework-card    Hausaufgabenliste, farbcodiert je Kind (people) oder klassisch (entities)
 *   - family-exam-card        Farbcodierte Klausurenliste fuer EIN oder MEHRERE Kinder
 *
 * Siehe README.md fuer die (fuer WebUntis) noetige Integrations-Konfiguration.
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

/* Lokales ISO-Datum YYYY-MM-DD OHNE UTC-Verschiebung. Bewusst KEIN toISOString(),
 * das in UTC rechnet und an Tages-/Monats-/Jahresgrenzen (Zeitzone, Sommerzeit) um
 * einen Tag springen kann. Nutzt ausschliesslich die lokalen Datumsfelder - passend
 * zu den Buckets, die ebenfalls lokal (new Date(), setHours) erzeugt werden. */
function fscLocalISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* Mensa-Attribut "available" robust interpretieren (nicht nur JS-Truthiness):
 * - Attribut fehlt        -> Legacy-kompatibel als true (alte Sensoren ohne dieses Feld).
 * - false / 0             -> false
 * - "false" / "0"         -> false (case-insensitive, getrimmt)
 * - alles andere          -> true
 * Zweck: ein vom Scraper nicht erreichter Tag (available=false) darf NICHT wie ein
 * bestaetigtes "nichts bestellt" aussehen. */
function fscMensaAvailable(st) {
  if (!st || !st.attributes || !('available' in st.attributes)) return true;
  const v = st.attributes.available;
  if (v === false || v === 0) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'false' || s === '0') return false;
  }
  return true;
}

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

/* Punkt 6: refresh_interval robust normalisieren.
 * Nicht-numerische Werte, NaN, Infinity, negative Werte oder Werte < 30 s
 * fallen auf den Default 300 zurueck, damit niemals ein extrem schnelles
 * Interval an setInterval() gelangt. */
function fscRefreshInterval(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 30 ? n : 300;
}

/* Punkt 10: nur valide Hex-Farben (#rgb oder #rrggbb) in HTML-/Style-Ausgaben
 * zulassen; alles andere faellt auf die uebergebene Default-Farbe zurueck. */
function fscSafeColor(color, fallback) {
  const fb = fallback || '#4fa8e0';
  const c = String(color || '').trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : fb;
}

/* Punkt 8: prueft, ob eine Entity-ID wie eine Kalender-Entity aussieht.
 * Kanonisches HA-Schema calendar.<slug> (slug: a-z, 0-9, _); interne Leerzeichen
 * o. ae. werden abgelehnt, umschliessender Whitespace toleriert. */
function fscIsCalendarEntity(id) {
  return typeof id === 'string' && /^calendar\.[a-z0-9_]+$/i.test(id.trim());
}

/* Punkt 9: eine vorhandene calendar.*-Entity als Stub-Vorauswahl finden.
 * opts.prefer  -> RegExp, es wird NUR eine fachlich passende Entity gewaehlt
 *                 (Homework: Hausaufgaben, Exam: Pruefungen/Klausuren); passt keine,
 *                 gibt es bewusst keine Vorauswahl (null) statt eines falschen Kalenders.
 * opts.avoid   -> RegExp, es wird die erste Entity gewaehlt, die NICHT nach
 *                 Hausaufgaben/Pruefungen/Klausuren aussieht; sind alle ausgeschlossen,
 *                 gibt es keine Vorauswahl (null).
 * Kein generischer ids[0]-Fallback mehr, der einen semantisch falschen Kalender liefert. */
function fscPickCalendar(hass, opts) {
  opts = opts || {};
  if (!hass || !hass.states) return null;
  const ids = Object.keys(hass.states).filter((id) => id.indexOf('calendar.') === 0);
  if (!ids.length) return null;
  if (opts.prefer) { return ids.find((id) => opts.prefer.test(id)) || null; }
  if (opts.avoid) { return ids.find((id) => !opts.avoid.test(id)) || null; }
  return ids[0];
}

/* Punkt 9: neutraler Platzhalter, wenn (noch) keine Kalender-Quelle konfiguriert
 * ist. Bewusst mit Inline-Styles, damit kein zusaetzlicher Klassenname noetig ist. */
function fscSourcePlaceholder() {
  return '<ha-card style="padding:16px"><div style="font-size:13px;color:var(--secondary-text-color)">Bitte eine Kalender-Entity auswählen.</div></ha-card>';
}

/* ---------- Wochenansicht: Datums- und Formathilfen ---------- */

/* ISO-Wochentag: 1 = Montag ... 7 = Sonntag (getDay() liefert 0 fuer Sonntag). */
function fscIsoDow(d) { const g = d.getDay(); return g === 0 ? 7 : g; }

/* Montag 00:00 der Woche, in der d liegt. */
function fscMondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - (fscIsoDow(x) - 1));
  return x;
}

function fscAddDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/* week_days normalisieren: Preset-Kuerzel oder Array von ISO-Wochentagen.
 * Nicht zusammenhaengende Auswahlen (z.B. [1,3,5]) sind zulaessig - die
 * Tagesspalten werden ohnehin unabhaengig voneinander gerendert. */
function fscWeekDayList(value) {
  const presets = {
    mo_fr: [1, 2, 3, 4, 5],
    mo_sa: [1, 2, 3, 4, 5, 6],
    mo_so: [1, 2, 3, 4, 5, 6, 7],
  };
  if (Array.isArray(value)) {
    const nums = value.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
    const uniq = Array.from(new Set(nums)).sort((a, b) => a - b);
    return uniq.length ? uniq : presets.mo_fr;
  }
  const key = String(value == null ? '' : value).trim().toLowerCase();
  return presets[key] || presets.mo_fr;
}

/* Tage einer Woche (Montag als Anker), gefiltert auf die gewaehlten Wochentage. */
function fscWeekDates(monday, weekdays) {
  return weekdays.map((n) => fscAddDays(monday, n - 1));
}

/* Ganzzahl mit Ober- und Untergrenze; ungueltige Werte fallen auf fallback. */
function fscClampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/* Raumliste aus dem WebUntis-JSON lesbar machen (long_name bevorzugt). */
function fscRoomLabel(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return list
    .map((r) => String((r && (r.long_name || r.name)) || '').trim())
    .filter(Boolean)
    .join(', ');
}

/* Klassenliste als Kurznamen. */
function fscKlassenLabel(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return list
    .map((k) => String((k && (k.name || k.long_name)) || '').trim())
    .filter(Boolean)
    .join(', ');
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
  static getStubConfig(hass) {
    // Bewusst der bisherige Default: neue Karten starten im Rolling-Modus,
    // damit sich fuer Bestandsnutzer nichts aendert.
    const entity = fscPickCalendar(hass, { avoid: /(hausaufgab|pruef|pruf|klausur|exam)/i });
    return { title: '', entities: entity ? [entity] : [], color: '#4fa8e0', days: 2 };
  }
  _resolveEntities() {
    return (this._config.entities || [])
      .map((e) => (typeof e === 'string' ? e : (e && e.entity)))
      .filter((e) => typeof e === 'string' && e.trim());
  }
  setConfig(config) {
    this._stopRefreshTimer();
    this._reqSeq = (this._reqSeq || 0) + 1;
    this._config = Object.assign({
      // Bestand: unveraendert
      days: 2, skip_weekends: true, refresh_interval: 300, pixels_per_hour: 70,
      padding_minutes: 15, fallback_day_start: '07:30', fallback_day_end: '14:00', color: '#4fa8e0',
      afternoon_threshold: '13:00', // Feature Mensa: ab wann Nachmittagsunterricht = Essensbedarf
      // Neu ab 1.4.0 - Defaults so gewaehlt, dass bestehende Konfigurationen
      // sich exakt wie bisher verhalten (range: rolling).
      range: 'rolling', week_days: 'mo_fr', dim_past: true, highlight_today: true,
      show_nav: true, nav_weeks_ahead: 2, nav_reset_minutes: 10, min_column_width: 132,
    }, config);
    this._config.refresh_interval = fscRefreshInterval(this._config.refresh_interval);
    this._config.nav_weeks_ahead = fscClampInt(this._config.nav_weeks_ahead, 0, 8, 2);
    this._config.nav_reset_minutes = fscClampInt(this._config.nav_reset_minutes, 0, 240, 10);
    this._weekOffset = 0;
    this._noSource = this._resolveEntities().length === 0;
    this._initialized = false;
    this._render();
  }
  _isWeek() { return String(this._config.range || 'rolling').toLowerCase() === 'week'; }
  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._fetchAndRender();
      this._interval = setInterval(() => this._fetchAndRender(), this._config.refresh_interval * 1000);
      this._startNowTicker();
      return;
    }
    // Punkt 3: bei Aenderung eines konfigurierten Mensa-Sensors NUR neu rendern (kein neuer
    // Kalender-Request, kein Timer-Neustart, kein Render bei irrelevanten State-Aenderungen).
    if (this._config && this._config.show_mensa && Array.isArray(this._config.mensa_entities)) {
      const changed = this._config.mensa_entities.some((entityId) => {
        if (!entityId) return false;
        const oldSt = oldHass && oldHass.states ? oldHass.states[entityId] : undefined;
        const newSt = hass && hass.states ? hass.states[entityId] : undefined;
        return (oldSt && oldSt.state) !== (newSt && newSt.state);
      });
      if (changed) this._render();
    }
  }
  _stopRefreshTimer() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    if (this._nowTimer) { clearInterval(this._nowTimer); this._nowTimer = null; }
    if (this._navResetTimer) { clearTimeout(this._navResetTimer); this._navResetTimer = null; }
  }
  _startNowTicker() {
    // "Jetzt"-Linie UND das Ausgrauen vergangener Stunden unabhaengig vom (schweren)
    // Kalender-Refresh aktuell halten: leichtes Neu-Rendern aus dem Cache (kein
    // API-Aufruf), nur wenn die Karte sichtbar ist.
    if (!this._nowTimer) {
      this._nowTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && this._initialized) this._render();
      }, 60000);
    }
  }
  connectedCallback() {
    if (!this._onVisible) {
      // Sofortiges Update, sobald die Karte wieder sichtbar wird (Tablet/Tab aus dem
      // Hintergrund) - dort drosseln/pausieren Browser die Timer, sonst bleibt die
      // "Jetzt"-Linie eingefroren. Bei ueberfaelligen Daten neu laden, sonst nur rendern.
      this._onVisible = () => {
        if (document.visibilityState !== 'visible' || !this._hass || !this._initialized) return;
        const age = Date.now() - (this._lastFetch || 0);
        if (age >= this._config.refresh_interval * 1000) this._fetchAndRender();
        else this._render();
      };
      document.addEventListener('visibilitychange', this._onVisible);
    }
    if (this._clickBound) return;
    this._clickBound = true;
    // Klick auf einen Eintrag -> Detail-Popup. Delegation am Host, damit der Listener
    // ueber die innerHTML-Neuaufbauten hinweg bestehen bleibt (einmalig gebunden).
    this.addEventListener('click', (ev) => {
      const t = ev.target;
      if (!t || !t.closest) return;
      const navEl = t.closest('[data-nav]');
      if (navEl && this.contains(navEl)) { this._onNav(navEl.getAttribute('data-nav')); return; }
      // Mensa-Hinweis mit aufgeloestem Entity -> aktionsabhaengiger Klick (siehe _mensaClick).
      // Der Bestell-Link fuer nicht bestellte Tage (<a href=mensa_link>) traegt KEIN
      // data-entity und wird hier nicht abgefangen, sondern regulaer vom Browser geoeffnet.
      const hintEl = t.closest('.mensa-hint[data-entity]');
      if (hintEl && this.contains(hintEl)) {
        const entityId = hintEl.getAttribute('data-entity');
        if (entityId) this._mensaClick(entityId);
        return;
      }
      const el = t.closest('.event');
      if (!el || !this.contains(el)) return;
      const bi = Number(el.getAttribute('data-bi'));
      const ii = Number(el.getAttribute('data-ii'));
      const bucket = this._buckets && this._buckets[bi];
      const item = bucket && bucket.items && bucket.items[ii];
      if (item) this._openDetail(item);
    });
    // Tastaturbedienung fuer Navigation und den klickbaren Mensa-Hinweis.
    this.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
      const t = ev.target;
      if (!t || !t.closest) return;
      const navEl = t.closest('[data-nav]');
      if (navEl && this.contains(navEl)) { ev.preventDefault(); this._onNav(navEl.getAttribute('data-nav')); return; }
      const hintEl = t.closest('.mensa-hint[data-entity]');
      if (!hintEl || !this.contains(hintEl)) return;
      ev.preventDefault();
      const entityId = hintEl.getAttribute('data-entity');
      if (entityId) this._mensaClick(entityId);
    });
  }
  disconnectedCallback() {
    this._stopRefreshTimer();
    if (this._onVisible) { document.removeEventListener('visibilitychange', this._onVisible); this._onVisible = null; }
    this._reqSeq = (this._reqSeq || 0) + 1;
    this._initialized = false;
    if (this._dialog) { this._dialog.open = false; this._dialog.remove(); this._dialog = null; }
    if (this._mensaDialog) { this._mensaDialog.open = false; this._mensaDialog.remove(); this._mensaDialog = null; }
  }
  getCardSize() { return this._isWeek() ? 6 : 5; }

  /* ---------- Wochen-Navigation ---------- */

  _maxOffset() { return this._isWeek() && this._config.show_nav ? this._config.nav_weeks_ahead : 0; }
  _onNav(action) {
    const max = this._maxOffset();
    if (action === 'prev') this._weekOffset = Math.max(0, this._weekOffset - 1);
    else if (action === 'next') this._weekOffset = Math.min(max, this._weekOffset + 1);
    else if (action === 'today') this._weekOffset = 0;
    this._armNavReset();
    this._render();
  }
  // Auto-Rücksprung auf die aktuelle Woche: auf einem Wandtablet soll nach dem
  // Blaettern nicht dauerhaft eine fremde Woche stehenbleiben.
  _armNavReset() {
    if (this._navResetTimer) { clearTimeout(this._navResetTimer); this._navResetTimer = null; }
    const mins = this._config.nav_reset_minutes;
    if (!mins || this._weekOffset === 0) return;
    this._navResetTimer = setTimeout(() => {
      this._weekOffset = 0;
      this._navResetTimer = null;
      this._render();
    }, mins * 60000);
  }

  /* ---------- Welche Tage werden angezeigt ---------- */

  // Montag der Woche, die Offset 0 entspricht. Liegt heute nicht in der gewaehlten
  // Tagesmenge (z.B. Samstag bei Mo-Fr), wird auf die kommende Woche gesprungen,
  // statt eine vollstaendig vergangene Woche komplett ausgegraut zu zeigen.
  _baseMonday() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekdays = fscWeekDayList(this._config.week_days);
    let monday = fscMondayOf(today);
    if (weekdays.indexOf(fscIsoDow(today)) === -1) monday = fscAddDays(monday, 7);
    return monday;
  }
  // Im Wochenmodus werden ALLE blaetterbaren Wochen auf einmal geholt (Prefetch).
  // Das Umschalten laeuft dann rein clientseitig - und vor allem koennen
  // Refresh-Timer und Visibility-Handler den Offset nicht zuruecksetzen.
  _allDates() {
    if (!this._isWeek()) return fscDates(this._config.days, this._config.skip_weekends);
    const weekdays = fscWeekDayList(this._config.week_days);
    const base = this._baseMonday();
    const out = [];
    for (let w = 0; w <= this._maxOffset(); w++) {
      out.push(...fscWeekDates(fscAddDays(base, w * 7), weekdays));
    }
    return out;
  }
  // Indizes der aktuell sichtbaren Buckets innerhalb von this._buckets.
  _visibleRange() {
    if (!this._isWeek()) return { from: 0, to: (this._buckets || []).length };
    const per = fscWeekDayList(this._config.week_days).length;
    const from = this._weekOffset * per;
    return { from, to: from + per };
  }

  /* ---------- Mensa ---------- */

  // Zuordnung eines Mensa-binary_sensor zu einem dargestellten Tag: datumsgesteuert
  // ueber attributes.date (YYYY-MM-DD, lokal normiert - kein toISOString()/UTC-Versatz).
  // Der Legacy-Positions-Fallback greift bewusst NUR im Rolling-Modus: im Wochenmodus
  // ist die Position eines Sensors ueber mehrere Wochen hinweg bedeutungslos und
  // wuerde falsche Tage zuordnen.
  // Rueckgabe: { entityId, st, source: 'date'|'legacy' } oder null.
  _resolveMensaEntity(bucket, localIdx) {
    const entities = this._config.mensa_entities;
    if (!Array.isArray(entities) || !this._hass || !this._hass.states || !bucket) return null;
    const wantIso = fscLocalISODate(bucket.date);
    // 1. Datums-Match. Bei mehreren Entities mit demselben date gilt deterministisch
    // "first match wins" (Reihenfolge in mensa_entities).
    for (const id of entities) {
      if (!id) continue;
      const st = this._hass.states[id];
      if (!st || !st.attributes) continue;
      const dattr = st.attributes.date;
      if (typeof dattr === 'string' && dattr.trim() === wantIso) {
        return { entityId: id, st, source: 'date' };
      }
    }
    if (this._isWeek()) return null;
    // 2. Legacy-Positions-Fallback: nur fuer ein Entity OHNE verwertbares date-Attribut.
    // Ein Entity mit gueltigem, aber abweichendem Datum wird niemals positionsbasiert genutzt.
    const legacyId = entities[localIdx];
    if (legacyId) {
      const st = this._hass.states[legacyId];
      if (st && st.attributes) {
        const dattr = st.attributes.date;
        const hasValidDate = typeof dattr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dattr.trim());
        if (!hasValidDate) return { entityId: legacyId, st, source: 'legacy' };
      }
    }
    return null;
  }
  // Hinweis-Objekt pro dargestelltem Tag. Liefert null = kein Hinweis rendern.
  // available=false -> kein Hinweis (Datenluecke, nicht "nichts bestellt"); sonst
  // vier Zustaende aus (Nachmittagsunterricht ja/nein) x (bestellt ja/nein).
  _mensaHint(bucket, localIdx) {
    if (!this._config.show_mensa) return null;
    if (!bucket) return null;
    const resolved = this._resolveMensaEntity(bucket, localIdx);
    if (!resolved) return null; // kein aufloesbares Entity -> kein Hinweis (auch kein Link-Fallback)
    const st = resolved.st;
    if (!fscMensaAvailable(st)) return null;
    // Nur belastbarer Zustand (on/off) - unknown/unavailable = kein Hinweis.
    if (st.state !== 'on' && st.state !== 'off') return null;
    const ordered = st.state === 'on';
    // afternoon_threshold als HH:MM validieren, sonst Default 13:00 (kein 00:00-Fehlwert).
    const tm = /^(\d{1,2}):(\d{2})$/.exec(String(this._config.afternoon_threshold || '').trim());
    let thresholdMin = 13 * 60;
    if (tm) {
      const ah = Number(tm[1]); const am = Number(tm[2]);
      if (ah >= 0 && ah <= 23 && am >= 0 && am <= 59) thresholdMin = ah * 60 + am;
    }
    const hasAfternoon = bucket.items.some((it) => !it.cancelled && fscMinOfDay(it.start) >= thresholdMin);
    let text; let cls; let clickable;
    if (!hasAfternoon && !ordered) { text = 'nicht bestellt'; cls = 'neutral'; clickable = false; }
    else if (!hasAfternoon && ordered) { text = 'Essen abbestellen?'; cls = 'info'; clickable = true; }
    else if (hasAfternoon && !ordered) { text = 'Kein Essen bestellt'; cls = 'warn'; clickable = true; }
    else { text = 'Essen bestellt'; cls = 'ok'; clickable = true; }
    return { text, cls, clickable, ordered, entityId: resolved.entityId, source: resolved.source };
  }
  // Aktionsabhaengiger Klick auf einen Mensa-Hinweis:
  // - bestellt (state on)  -> eigenes Detail-Popup mit Menuetext/Positionen
  //                           (das native HA-More-Info zeigt fuer einen binary_sensor
  //                            nur Verlauf/Logbook, nicht brauchbar das Menue).
  // - nicht bestellt        -> hier landet nur der Fall OHNE mensa_link (mit Link
  //                           rendert die Karte stattdessen ein <a>); Fallback = More-Info.
  _mensaClick(entityId) {
    const st = this._hass && this._hass.states ? this._hass.states[entityId] : null;
    if (st && st.state === 'on') this._openMensaDetail(st);
    else this._openMensaMoreInfo(entityId);
  }
  _openMensaMoreInfo(entityId) {
    // Standard-HA-Event: oeffnet den regulaeren More-Info-Dialog fuer die Entity.
    // composed:true, damit das Event die Card-Grenze zum Dashboard hin passiert.
    this.dispatchEvent(new CustomEvent('hass-more-info', {
      detail: { entityId }, bubbles: true, composed: true,
    }));
  }

  /* ---------- Dialoge ---------- */

  // Titel NUR ueber die vom Dialog tatsaechlich unterstuetzte Header-API setzen, damit er
  // nicht doppelt (nativer Header + Body) erscheint. headerTitle ab HA 2026.3
  // (Web-Awesome-Dialog), heading in aelteren Generationen. Body-Titel nur als Fallback.
  _dialogTitle(dlg, title) {
    if ('headerTitle' in dlg) { dlg.headerTitle = title; return ''; }
    if ('heading' in dlg) { dlg.heading = title; return ''; }
    return `<div class="fsc-dlg-title">${fscEsc(title)}</div>`;
  }
  _dialogStyle() {
    return `<style>
        .fsc-dlg-title{font-size:18px;font-weight:600;color:var(--primary-text-color);margin-bottom:12px}
        .fsc-dlg-row{display:flex;align-items:center;gap:6px;font-size:14px;color:var(--primary-text-color);margin-bottom:8px}
        .fsc-dlg-row ha-icon{--mdc-icon-size:18px;color:var(--secondary-text-color)}
        .fsc-dlg-badge{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;padding:3px 8px;border-radius:10px;margin-bottom:10px}
        .fsc-dlg-badge.changed{background:rgba(224,168,79,0.18);color:#e0a84f}
        .fsc-dlg-badge.cancelled{background:rgba(224,95,79,0.16);color:#e05f4f}
        .fsc-dlg-badge.special{background:rgba(230,194,41,0.20);color:#c9a415}
        .fsc-dlg-badge.moved{background:rgba(155,127,212,0.20);color:#9b7fd4}
        .fsc-dlg-badge.past{background:rgba(128,128,128,0.18);color:var(--secondary-text-color)}
        .fsc-dlg-desc{font-size:13px;line-height:1.5;color:var(--primary-text-color);white-space:pre-wrap;margin-top:4px;padding-top:8px;border-top:1px solid var(--divider-color)}
        .fsc-dlg-actions{display:flex;align-items:center;gap:12px;margin-top:16px}
        .fsc-dlg-close{font:inherit;font-weight:600;color:var(--primary-color);background:none;border:none;padding:8px 12px;border-radius:6px;cursor:pointer;margin-left:auto}
        .fsc-dlg-close:hover{background:rgba(var(--rgb-primary-color,79,168,224),0.12)}
        .fsc-mensa-badge{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;padding:3px 8px;border-radius:10px;margin-bottom:12px;background:rgba(79,176,106,0.18);color:var(--success-color,#4fb06a)}
        .fsc-mensa-items{display:flex;flex-direction:column;gap:10px}
        .fsc-mensa-item{border-left:3px solid var(--success-color,#4fb06a);padding-left:10px}
        .fsc-mensa-line{font-size:12px;color:var(--secondary-text-color);margin-bottom:2px}
        .fsc-mensa-text{font-size:14px;color:var(--primary-text-color);line-height:1.4}
        .fsc-mensa-reorder{display:inline-block;font:inherit;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;text-decoration:none;padding:8px 14px;border-radius:8px;background:rgba(224,168,79,0.18);color:var(--warning-color,#e0a84f);border:1px solid rgba(224,168,79,0.45);cursor:pointer}
        .fsc-mensa-reorder:hover{background:rgba(224,168,79,0.30)}
      </style>`;
  }
  _openDetail(item) {
    if (!this._dialog) {
      this._dialog = document.createElement('ha-dialog');
      this._dialog.addEventListener('closed', () => { if (this._dialog) this._dialog.open = false; });
      document.body.appendChild(this._dialog);
    }
    const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
    const isPast = item.end < new Date();
    const title = item.title || 'Termin';
    let statusLabel = ''; let statusCls = '';
    if (item.cancelled) { statusLabel = 'Entfallen'; statusCls = 'cancelled'; }
    else if (item.special) { statusLabel = 'Sonderveranstaltung'; statusCls = 'special'; }
    else if (item.changed) { statusLabel = 'Änderung / Vertretung'; statusCls = 'changed'; }
    else if (item.moved) { statusLabel = 'Raumwechsel'; statusCls = 'moved'; }
    else if (isPast) { statusLabel = 'Bereits vorbei'; statusCls = 'past'; }
    const statusHtml = statusLabel ? `<div class="fsc-dlg-badge ${statusCls}">${fscEsc(statusLabel)}</div>` : '';
    // Raumzeile: bei einem Wechsel alt -> neu, bei ersatzlosem Wegfall "entfällt".
    const oldRoom = fscRoomLabel(item.originalRooms);
    const newRoom = fscRoomLabel(item.rooms) || item.location;
    const roomHtml = oldRoom
      ? `<div class="fsc-dlg-row"><ha-icon icon="mdi:map-marker-right"></ha-icon>${fscEsc(oldRoom)} → ${fscEsc(newRoom || 'entfällt')}</div>`
      : (item.location ? `<div class="fsc-dlg-row"><ha-icon icon="mdi:map-marker-outline"></ha-icon>${fscEsc(item.location)}</div>` : '');
    const klassenLabel = fscKlassenLabel(item.klassen);
    const klassenHtml = klassenLabel
      ? `<div class="fsc-dlg-row"><ha-icon icon="mdi:account-group-outline"></ha-icon>${fscEsc(klassenLabel)}</div>`
      : '';
    // Hinweistext bevorzugt aus dem JSON (info/lstext/substText), sonst die rohe
    // Beschreibung. Rohes JSON landet hier nie - es wird beim Parsen geleert.
    const noteText = item.note || item.description || '';
    const descHtml = noteText ? `<div class="fsc-dlg-desc">${fscEsc(noteText).replace(/\n/g, '<br>')}</div>` : '';
    const fallbackTitleHtml = this._dialogTitle(this._dialog, title);
    // Schliessen ueber einen eigenen Button mit explizitem open=false statt ueber einen
    // HA-internen Action-Slot (primaryAction/dialogAction), der sich zwischen den
    // Dialog-Generationen unterscheidet - so bleibt die Kernfunktion API-unabhaengig.
    this._dialog.innerHTML = `${this._dialogStyle()}
      <div style="padding:4px 4px 8px;min-width:240px;">
        ${fallbackTitleHtml}
        ${statusHtml}
        <div class="fsc-dlg-row"><ha-icon icon="mdi:calendar-outline"></ha-icon>${fscEsc(dateFmt.format(item.start))}</div>
        <div class="fsc-dlg-row"><ha-icon icon="mdi:clock-outline"></ha-icon>${timeFmt.format(item.start)}–${timeFmt.format(item.end)}</div>
        ${roomHtml}
        ${klassenHtml}
        ${descHtml}
        <div class="fsc-dlg-actions"><button type="button" class="fsc-dlg-close">Schließen</button></div>
      </div>
    `;
    const closeBtn = this._dialog.querySelector('.fsc-dlg-close');
    if (closeBtn) closeBtn.addEventListener('click', () => { this._dialog.open = false; });
    this._dialog.open = true;
  }
  _openMensaDetail(st) {
    // Eigenes Mensa-Detail im gleichen ha-dialog-Stil wie _openDetail (Termine),
    // aber eigener Dialog (this._mensaDialog), damit sich beide nicht ins Gehege kommen.
    const a = (st && st.attributes) || {};
    if (!this._mensaDialog) {
      this._mensaDialog = document.createElement('ha-dialog');
      this._mensaDialog.addEventListener('closed', () => { if (this._mensaDialog) this._mensaDialog.open = false; });
      document.body.appendChild(this._mensaDialog);
    }
    // Datum menschenlesbar; bei fehlendem/ungueltigem date-Attribut neutraler Titel.
    let dateLabel = '';
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(a.date || '').trim());
    if (dm) {
      const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
      dateLabel = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
    }
    const fallbackTitleHtml = this._dialogTitle(this._mensaDialog, dateLabel ? `Mensa – ${dateLabel}` : 'Mensa');
    // Positionen (items) bevorzugt als Liste mit Linie/Text/Menge/Preis; sonst menu_text;
    // sonst neutraler Hinweis. Preise nur zeigen, wenn vorhanden.
    const items = Array.isArray(a.items) ? a.items : [];
    let bodyHtml;
    if (items.length) {
      bodyHtml = '<div class="fsc-mensa-items">' + items.map((it) => {
        const line = it && it.line ? `<div class="fsc-mensa-line">${fscEsc(it.line)}</div>` : '';
        const qty = (it && (it.qty || it.qty === 0)) ? `${it.qty}× ` : '';
        const priceNum = it && (typeof it.price_eur === 'number') ? it.price_eur : null;
        const price = priceNum != null ? ` · ${priceNum.toFixed(2).replace('.', ',')} €` : '';
        const text = it && it.text ? fscEsc(it.text) : '';
        return `<div class="fsc-mensa-item">${line}<div class="fsc-mensa-text">${fscEsc(qty)}${text}${fscEsc(price)}</div></div>`;
      }).join('') + '</div>';
    } else if (a.menu_text && String(a.menu_text).trim() && String(a.menu_text).trim() !== '—') {
      bodyHtml = `<div class="fsc-mensa-text">${fscEsc(a.menu_text)}</div>`;
    } else {
      bodyHtml = '<div class="fsc-mensa-text" style="color:var(--secondary-text-color)">Bestellt – kein Menütext hinterlegt.</div>';
    }
    // Optionaler "Umbestellen"-Button -> oeffnet den Bestell-Link (nur wenn gesetzt).
    const orderLink = (this._config && this._config.mensa_link) ? String(this._config.mensa_link) : '';
    const reorderHtml = orderLink
      ? `<a class="fsc-mensa-reorder" href="${fscEsc(orderLink)}" target="_blank" rel="noopener noreferrer">Umbestellen</a>`
      : '';
    this._mensaDialog.innerHTML = `${this._dialogStyle()}
      <div style="padding:4px 4px 8px;min-width:240px;">
        ${fallbackTitleHtml}
        <div class="fsc-mensa-badge">Essen bestellt</div>
        ${bodyHtml}
        <div class="fsc-dlg-actions">${reorderHtml}<button type="button" class="fsc-dlg-close">Schließen</button></div>
      </div>
    `;
    const closeBtn = this._mensaDialog.querySelector('.fsc-dlg-close');
    if (closeBtn) closeBtn.addEventListener('click', () => { this._mensaDialog.open = false; });
    this._mensaDialog.open = true;
  }

  /* ---------- Layout ---------- */

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
  // Zeitachse NUR ueber die sichtbaren Tage berechnen - sonst zieht ein einzelner
  // Abendtermin in einer anderen Woche das Raster der aktuellen Woche auseinander.
  _axisFor(visible) {
    let minStart = null, maxEnd = null;
    for (const b of visible) for (const it of b.items) {
      const s = fscMinOfDay(it.start), e = fscMinOfDay(it.end);
      if (minStart === null || s < minStart) minStart = s;
      if (maxEnd === null || e > maxEnd) maxEnd = e;
    }
    const hasAny = minStart !== null;
    const [fsh, fsm] = String(this._config.fallback_day_start || '07:30').split(':').map(Number);
    const [feh, fem] = String(this._config.fallback_day_end || '14:00').split(':').map(Number);
    if (minStart === null) minStart = (fsh || 7) * 60 + (fsm || 30);
    if (maxEnd === null) maxEnd = (feh || 14) * 60 + (fem || 0);
    const pad = Number(this._config.padding_minutes) || 0;
    minStart = Math.max(0, Math.floor((minStart - pad) / 5) * 5);
    maxEnd = Math.min(24 * 60, Math.ceil((maxEnd + pad) / 5) * 5);
    return { minStart, maxEnd, hasAny };
  }

  /* ---------- Daten holen ---------- */

  async _fetchAndRender() {
    if (!this._hass) return;
    const myReq = ++this._reqSeq;
    const entities = this._resolveEntities();
    if (!entities.length) {
      this._noSource = true; this._buckets = null; this._lastError = false; this._partialError = false;
      this._lastFetch = Date.now();
      this._render();
      return;
    }
    this._noSource = false;
    const dates = this._allDates(); if (!dates.length) return;
    const rangeStart = new Date(dates[0]); rangeStart.setHours(-6, 0, 0, 0);
    const rangeEnd = new Date(dates[dates.length - 1]); rangeEnd.setHours(30, 0, 0, 0);
    const startISO = rangeStart.toISOString(); const endISO = rangeEnd.toISOString();
    const perEntity = await Promise.all(entities.map(async (entityId) => {
      try {
        const events = await this._hass.callApi('GET', `calendars/${entityId}?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`);
        return { entityId, events: events || [] };
      } catch (e) { console.error('family-timetable-card:', entityId, e); return { entityId, events: [], error: true }; }
    }));
    if (myReq !== this._reqSeq) return; // veralteter Request (Config-Wechsel, Disconnect, ueberholter Refresh)
    const buckets = dates.map((d) => ({ date: d, items: [] }));
    const seen = new Set();
    for (const src of perEntity) {
      for (const ev of src.events) {
        if (!ev.start || !ev.start.dateTime) continue;
        const start = new Date(ev.start.dateTime);
        const end = new Date((ev.end && ev.end.dateTime) || ev.start.dateTime);
        const bucket = buckets.find((b) => fscSameDay(b.date, start));
        if (!bucket) continue;

        // Praefix-Heuristik als Basis: sie funktioniert mit JEDEM Kalender (Google,
        // CalDAV, ICS). Reihenfolge wie in der WebUntis-Integration: "Cancelled:" und
        // "Irregular:" ueberschreiben ein "Room change:" - ein Eintrag traegt daher
        // nie zwei Marker gleichzeitig.
        let title = ev.summary || '';
        let changed = false; let cancelled = false; let moved = false;
        let m = title.match(/^Room change:\s*/i);
        if (m) { moved = true; title = title.slice(m[0].length); }
        m = title.match(/^Irregular:\s*/i);
        if (m) { changed = true; moved = false; title = title.slice(m[0].length); }
        m = title.match(/^Cancelled:\s*/i);
        if (m) { cancelled = true; changed = false; moved = false; title = title.slice(m[0].length); }
        // Punkt 11: leere und reine Whitespace-Raumangaben gelten als "kein Raum".
        const location = String(ev.location || '').trim();
        let special = changed && !location;

        // Anreicherung (optional): Steht in der Beschreibung ein JSON, ist das die
        // verlaessliche Quelle. WebUntis liefert es mit der Integrationsoption
        // "Kalender - Beschreibung: JSON".
        // ACHTUNG: meta.start/meta.end NICHT verwenden - bei zusammengefassten
        // Doppelstunden beschreiben sie nur die erste Einzelstunde.
        const rawDesc = String(ev.description || '').trim();
        let meta = null;
        if (rawDesc.charAt(0) === '{') {
          try { meta = JSON.parse(rawDesc); } catch (err) { meta = null; }
        }
        let rooms = []; let originalRooms = []; let klassen = []; let note = '';
        if (meta) {
          // code kommt als String; unbesetzt ist woertlich "None" (Python str(None)) -
          // ein naiver Truthy-Test wuerde jede normale Stunde als Status werten.
          const code = String(meta.code == null ? '' : meta.code).trim().toLowerCase();
          const hasCode = code !== '' && code !== 'none' && code !== 'null';
          cancelled = hasCode && code === 'cancelled';
          changed = hasCode && code === 'irregular';
          rooms = Array.isArray(meta.rooms) ? meta.rooms : [];
          originalRooms = Array.isArray(meta.original_rooms) ? meta.original_rooms : [];
          klassen = Array.isArray(meta.klassen) ? meta.klassen : [];
          moved = !cancelled && !changed && originalRooms.length > 0;
          // Ohne Fach ist es keine Vertretung, sondern eine Sonderveranstaltung -
          // belastbarer als die Ersatzregel "Irregular ohne Raum".
          special = changed && Array.isArray(meta.subjects) && meta.subjects.length === 0;
          if (typeof meta.name === 'string' && meta.name.trim()) title = meta.name.trim();
          const notes = [meta.info, meta.lstext, meta.substText]
            .map((x) => String(x == null ? '' : x).trim())
            .filter((x) => x && x.toLowerCase() !== 'none');
          note = Array.from(new Set(notes)).join(' · ');
        }

        // Deduplizieren ueber den normierten Titel: WebUntis liefert dieselbe
        // Sonderveranstaltung je Klassenverbund mehrfach. Bewusst NICHT ueber eine id -
        // sonst staenden zwei identische Kacheln nebeneinander.
        const key = start.toISOString() + '|' + end.toISOString() + '|' + title + '|' + location;
        if (seen.has(key)) continue; seen.add(key);

        bucket.items.push({
          start, end, title, location, changed, cancelled, special, moved,
          rooms, originalRooms, klassen, note,
          description: meta ? '' : rawDesc,
        });
      }
    }
    for (const b of buckets) b.items.sort((a, c) => a.start - c.start || a.end - c.end);
    this._buckets = buckets;
    // Punkt 7/3: nur bei ALLEN fehlgeschlagenen Quellen ein Vollfehler; bei Teilfehler
    // erfolgreiche Daten anzeigen und separat warnen (analog family-exam-card).
    const errCount = perEntity.filter((p) => p.error).length;
    this._lastError = errCount > 0 && errCount === perEntity.length;
    this._partialError = errCount > 0 && errCount < perEntity.length;
    this._lastFetch = Date.now();
    this._render();
  }

  /* ---------- Rendern ---------- */

  _weekLabel(visible) {
    if (!visible.length) return '';
    const first = visible[0].date; const last = visible[visible.length - 1].date;
    const d = (x) => String(x.getDate()).padStart(2, '0');
    const m = (x) => String(x.getMonth() + 1).padStart(2, '0');
    if (first.getMonth() === last.getMonth()) return `${d(first)}.–${d(last)}.${m(last)}.`;
    return `${d(first)}.${m(first)}.–${d(last)}.${m(last)}.`;
  }
  _navHtml(visible) {
    if (!this._isWeek() || !this._config.show_nav) return '';
    const prevDis = this._weekOffset <= 0;
    const nextDis = this._weekOffset >= this._maxOffset();
    // "Heute" steht links vom Zurueck-Pfeil und wird bei Offset 0 nur unsichtbar
    // geschaltet statt entfernt: so bleibt die Breite konstant und die Navigation
    // springt beim Blaettern nicht.
    const showToday = this._weekOffset > 0;
    const todayBtn = `<button type="button" class="nav-today${showToday ? '' : ' is-hidden'}" data-nav="today"${showToday ? '' : ' tabindex="-1" aria-hidden="true"'}>Heute</button>`;
    return `<div class="nav">
      ${todayBtn}
      <button type="button" class="nav-btn" data-nav="prev" ${prevDis ? 'disabled' : ''} title="Woche zurück" aria-label="Woche zurück"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
      <span class="nav-label">${fscEsc(this._weekLabel(visible))}</span>
      <button type="button" class="nav-btn" data-nav="next" ${nextDis ? 'disabled' : ''} title="Woche vor" aria-label="Woche vor"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
    </div>`;
  }
  _render() {
    if (!this._config) return;
    if (this._noSource) { this.innerHTML = fscSourcePlaceholder(); return; }
    const safeColor = fscSafeColor(this._config.color);
    this.style.setProperty('--fsc-accent', safeColor);
    this.style.setProperty('--fsc-border', fscHexToRgba(safeColor, 0.28));
    this.style.setProperty('--fsc-soft', fscHexToRgba(safeColor, 0.16));
    const minCol = fscClampInt(this._config.min_column_width, 80, 400, 132);
    const titleHtml = this._config.title ? `<div class="title">${fscEsc(this._config.title)}</div>` : '';
    const style = `<style>
      family-timetable-card ha-card{padding:16px 16px 12px;border:2px solid var(--fsc-border,var(--divider-color))}
      family-timetable-card .head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}
      family-timetable-card .title{font-size:1.5em;font-weight:500;color:var(--fsc-accent,var(--primary-text-color))}
      family-timetable-card .nav{display:flex;align-items:center;gap:4px;margin-left:auto}
      family-timetable-card .nav-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:none;border-radius:16px;background:transparent;color:var(--primary-text-color);cursor:pointer}
      family-timetable-card .nav-btn:hover:not([disabled]){background:rgba(128,128,128,0.16)}
      family-timetable-card .nav-btn[disabled]{opacity:.3;cursor:default}
      family-timetable-card .nav-btn ha-icon{--mdc-icon-size:20px}
      family-timetable-card .nav-label{font-size:13px;font-weight:600;color:var(--secondary-text-color);min-width:104px;text-align:center;white-space:nowrap}
      family-timetable-card .nav-today{font:inherit;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;padding:6px 10px;margin-right:4px;border:none;border-radius:8px;cursor:pointer;background:var(--fsc-soft,rgba(128,128,128,0.16));color:var(--fsc-accent,var(--primary-color))}
      family-timetable-card .nav-today.is-hidden{visibility:hidden;pointer-events:none}
      family-timetable-card .grid{display:flex;gap:16px;overflow-x:auto;scrollbar-width:thin;padding-bottom:2px}
      family-timetable-card .day-col{flex:1 1 0;min-width:${minCol}px}
      family-timetable-card .weekday{font-size:14px;color:var(--primary-text-color)}
      family-timetable-card .date-row{font-size:13px;color:var(--secondary-text-color);margin-bottom:6px}
      family-timetable-card .day-num{font-size:20px;font-weight:600;color:var(--primary-text-color)}
      family-timetable-card .day-header{border-bottom:1px solid var(--divider-color);padding-bottom:6px;margin-bottom:8px}
      family-timetable-card .day-col.today .day-header{border-bottom:2px solid var(--fsc-accent,var(--primary-color))}
      family-timetable-card .day-col.today .day-num{color:var(--fsc-accent,var(--primary-color))}
      family-timetable-card .day-col.past-day .day-header{opacity:.45}
      family-timetable-card .mensa-slot{min-height:18px;margin-top:4px}
      family-timetable-card .mensa-hint{display:block;font-size:11px;font-weight:700;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      family-timetable-card .mensa-hint.warn{color:#e05f4f}
      family-timetable-card .mensa-hint.info{color:#e0a84f}
      family-timetable-card .mensa-hint.ok{color:var(--success-color,#4fb06a)}
      family-timetable-card .mensa-hint.neutral{color:var(--secondary-text-color);font-weight:400;background:transparent;border:0}
      family-timetable-card .mensa-hint.clickable{cursor:pointer}
      family-timetable-card .mensa-hint.clickable:focus-visible{outline:2px solid var(--fsc-accent,var(--primary-color));outline-offset:2px;border-radius:3px}
      family-timetable-card .day-body{position:relative}
      family-timetable-card .event{position:absolute;background:var(--fsc-soft,rgba(79,168,224,0.16));border-left:3px solid var(--fsc-accent,var(--primary-color));border-radius:6px;padding:5px 8px;box-sizing:border-box;overflow:hidden;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:opacity .2s}
      family-timetable-card .event:active{filter:brightness(0.92)}
      family-timetable-card .event.changed{border-left-color:#e0a84f;background:rgba(224,168,79,0.16)}
      family-timetable-card .event.cancelled{border-left-color:#e05f4f;background:rgba(224,95,79,0.14)}
      family-timetable-card .event.special{border-left-color:#e6c229;background:rgba(230,194,41,0.18)}
      family-timetable-card .event.moved{border-left-color:#9b7fd4;background:rgba(155,127,212,0.16)}
      family-timetable-card .event.past{opacity:.38}
      family-timetable-card .event.past:hover{opacity:.72}
      family-timetable-card .strike{text-decoration:line-through;opacity:.75}
      family-timetable-card .event-title{font-size:13px;font-weight:500;color:var(--primary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px}
      family-timetable-card .chg-icon{--mdc-icon-size:14px;color:#e0a84f;flex:none}
      family-timetable-card .cnl-icon{--mdc-icon-size:14px;color:#e05f4f;flex:none}
      family-timetable-card .spc-icon{--mdc-icon-size:14px;color:#e6c229;flex:none}
      family-timetable-card .mov-icon{--mdc-icon-size:14px;color:#9b7fd4;flex:none}
      family-timetable-card .event-time{font-size:11px;color:var(--secondary-text-color);display:flex;align-items:center;gap:3px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      family-timetable-card .event-time ha-icon{--mdc-icon-size:13px}
      family-timetable-card .now-line{position:absolute;left:-4px;right:0;height:0;border-top:2px solid var(--error-color,#db4437);opacity:.55;z-index:2}
      family-timetable-card .empty{display:flex;align-items:center;gap:6px;background:var(--fsc-soft,rgba(128,128,128,0.12));border-left:3px solid var(--fsc-accent,var(--primary-color));border-radius:6px;padding:8px 10px;font-size:13px;color:var(--secondary-text-color)}
      family-timetable-card .empty ha-icon{--mdc-icon-size:16px;color:var(--secondary-text-color)}
      family-timetable-card .err{margin-top:0;font-size:13px;color:var(--error-color,#db4437)}
      </style>`;
    // Punkt 7: bei einem fehlgeschlagenen Request keinen "keine Termine"-Zustand vortaeuschen.
    if (this._lastError) {
      this.innerHTML = `<ha-card>${style}<div class="head">${titleHtml}</div><div class="err">Stundenplan konnte nicht geladen werden.</div></ha-card>`;
      return;
    }
    const all = this._buckets || this._allDates().map((d) => ({ date: d, items: [] }));
    const { from, to } = this._visibleRange();
    const visible = all.slice(from, to);
    if (!visible.length) {
      this.innerHTML = `<ha-card>${style}<div class="head">${titleHtml}</div><div class="err">Keine Tage zur Anzeige konfiguriert.</div></ha-card>`;
      return;
    }
    const axis = this._axisFor(visible);
    const dayStartMin = axis.minStart;
    const dayEndMin = axis.maxEnd;
    const totalMin = Math.max(30, dayEndMin - dayStartMin);
    const showGrid = axis.hasAny;
    const heightPx = Math.max(160, Math.round((totalMin / 60) * (Number(this._config.pixels_per_hour) || 70)));
    const now = new Date(); const nowMin = fscMinOfDay(now);
    const dimPast = this._config.dim_past !== false;
    const hlToday = this._config.highlight_today !== false;
    const weekdayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
    const dayFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric' });
    const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'short' });
    const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
    // Feature Mensa: verschiebungsfrei - der Hinweis lebt in einem in JEDER Spalte
    // reservierten Header-Slot (leer, wenn kein Hinweis), damit das Raster ausgerichtet bleibt.
    const mensaActive = this._config.show_mensa && Array.isArray(this._config.mensa_entities);
    const dayCols = visible.map((b, li) => {
      const globalIdx = from + li;
      const isToday = fscSameDay(b.date, now);
      const dayIsPast = b.date < new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const colCls = ['day-col'];
      if (hlToday && isToday) colCls.push('today');
      if (dimPast && dayIsPast) colCls.push('past-day');
      // Mensa-Hinweis nur fuer heute und kommende Tage: an einem vergangenen Tag ist
      // die Bestellung erledigt, eine Warnung waere dort nur Rauschen. Der Slot bleibt
      // reserviert, damit die Spalten ausgerichtet bleiben.
      const hint = (mensaActive && !dayIsPast) ? this._mensaHint(b, li) : null;
      let hintInner = '';
      if (hint) {
        if (hint.clickable && hint.ordered && hint.entityId) {
          // Bestellt -> eigenes Menue-Detail-Popup. data-entity markiert den Hinweis als klickbar.
          hintInner = `<span class="mensa-hint ${hint.cls} clickable" role="button" tabindex="0" data-entity="${fscEsc(hint.entityId)}">${fscEsc(hint.text)}</span>`;
        } else if (hint.clickable && !hint.ordered && this._config.mensa_link) {
          // Nicht bestellt + Bestell-Link gesetzt -> externer Link zur Mensa (Bestellen).
          hintInner = `<a class="mensa-hint ${hint.cls} clickable" href="${fscEsc(this._config.mensa_link)}" target="_blank" rel="noopener noreferrer">${fscEsc(hint.text)}</a>`;
        } else if (hint.clickable && hint.entityId) {
          // Nicht bestellt, aber kein mensa_link -> Fallback natives More-Info (besser als tot).
          hintInner = `<span class="mensa-hint ${hint.cls} clickable" role="button" tabindex="0" data-entity="${fscEsc(hint.entityId)}">${fscEsc(hint.text)}</span>`;
        } else {
          // Neutral bzw. nicht klickbar (z.B. "nicht bestellt").
          hintInner = `<span class="mensa-hint ${hint.cls}">${fscEsc(hint.text)}</span>`;
        }
      }
      const mensaSlot = mensaActive ? `<div class="mensa-slot">${hintInner}</div>` : '';
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
        let metaLabel = timeLabel;
        if (it.location) metaLabel = `${timeLabel} · Raum ${it.location}`;
        else if (it.moved) metaLabel = `${timeLabel} · Raum entfällt`;
        const cls = ['event'];
        if (it.cancelled) cls.push('cancelled');
        else if (it.special) cls.push('special');
        else if (it.changed) cls.push('changed');
        else if (it.moved) cls.push('moved');
        // Ausgrauen im Render ausgewertet, damit der Minutenticker es mitzieht.
        if (dimPast && it.end < now) cls.push('past');
        let icon = '';
        if (it.cancelled) icon = '<ha-icon icon="mdi:cancel" class="cnl-icon"></ha-icon>';
        else if (it.special) icon = '<ha-icon icon="mdi:calendar-star" class="spc-icon"></ha-icon>';
        else if (it.changed) icon = '<ha-icon icon="mdi:sync-alert" class="chg-icon"></ha-icon>';
        else if (it.moved) icon = '<ha-icon icon="mdi:map-marker-right" class="mov-icon"></ha-icon>';
        const evTitle = it.cancelled ? `<span class="strike">${fscEsc(it.title)}</span>` : fscEsc(it.title);
        const metaHtml = (height > 7 && cols === 1)
          ? `<div class="event-time"><ha-icon icon="mdi:clock-outline"></ha-icon>${fscEsc(metaLabel)}</div>` : '';
        return `<div class="${cls.join(' ')}" style="${posStyle}" data-bi="${globalIdx}" data-ii="${idx}"><div class="event-title">${icon}${evTitle}</div>${metaHtml}</div>`;
      }).join('');
      const nowLine = showGrid && isToday && nowMin >= dayStartMin && nowMin <= dayEndMin
        ? `<div class="now-line" style="top:${((nowMin - dayStartMin) / totalMin) * 100}%"></div>` : '';
      const empty = b.items.length === 0 ? '<div class="empty"><ha-icon icon="mdi:check"></ha-icon>Keine anstehenden Termine</div>' : '';
      return `<div class="${colCls.join(' ')}"><div class="day-header"><div class="weekday">${fscEsc(weekdayFmt.format(b.date))}</div><div class="date-row"><span class="day-num">${dayFmt.format(b.date)}</span> <span class="month">${fscEsc(monthFmt.format(b.date).toUpperCase())}</span></div>${mensaSlot}</div><div class="day-body" style="${bodyStyle}">${nowLine}${blocks}${empty}</div></div>`;
    }).join('');
    const partialErr = this._partialError ? '<div class="err">Einige Kalender konnten nicht geladen werden.</div>' : '';
    const head = `<div class="head">${titleHtml}${this._navHtml(visible)}</div>`;
    this.innerHTML = `<ha-card>${style}${head}<div class="grid">${dayCols}</div>${partialErr}</ha-card>`;
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
  // Mehrere Picker (Kalender + Mensa-Sensoren) mit hass versorgen.
  set hass(hass) {
    this._hass = hass;
    this.querySelectorAll('ha-entity-picker').forEach((p) => { p.hass = hass; });
    if (!this._rendered && this._config) this._render();
  }
  _renderExtra() {
    const slot = this.querySelector('#extra-slot');
    const inp = 'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font:inherit;';
    const lbl = 'font-size:12px;color:var(--secondary-text-color);';
    const chk = 'display:flex;align-items:center;gap:8px;font-size:13px;color:var(--primary-text-color);cursor:pointer;';
    slot.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--divider-color);padding-top:12px;">
        <label for="range" style="${lbl}">Ansicht</label>
        <select id="range" style="${inp}">
          <option value="rolling">Rollende Tage (heute + folgende)</option>
          <option value="week">Feste Woche</option>
        </select>
      </div>

      <div id="rolling-cfg" style="display:none;flex-direction:column;gap:12px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="days" style="${lbl}">Anzahl Tage (heute + folgende)</label>
          <input id="days" type="number" min="1" max="7" style="${inp}">
        </div>
        <label style="${chk}"><input id="skip_weekends" type="checkbox"> Wochenende überspringen</label>
      </div>

      <div id="week-cfg" style="display:none;flex-direction:column;gap:12px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="week_days" style="${lbl}">Angezeigte Tage</label>
          <select id="week_days" style="${inp}">
            <option value="mo_fr">Montag bis Freitag</option>
            <option value="mo_sa">Montag bis Samstag</option>
            <option value="mo_so">Montag bis Sonntag</option>
            <option value="custom">Individuell</option>
          </select>
        </div>
        <div id="week-days-custom" style="display:none;flex-wrap:wrap;gap:10px;"></div>
        <div style="font-size:11px;color:var(--secondary-text-color);">Liegt der heutige Tag nicht in der Auswahl (z.&nbsp;B. Samstag bei Mo–Fr), zeigt die Karte automatisch die kommende Woche.</div>
        <label style="${chk}"><input id="show_nav" type="checkbox"> Blättern erlauben</label>
        <div id="nav-cfg" style="display:none;flex-direction:column;gap:12px;">
          <div style="display:flex;flex-direction:column;gap:4px;">
            <label for="nav_weeks_ahead" style="${lbl}">Wochen voraus</label>
            <input id="nav_weeks_ahead" type="number" min="0" max="8" style="${inp}">
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            <label for="nav_reset_minutes" style="${lbl}">Auto-Rücksprung auf die aktuelle Woche nach Minuten (0 = aus)</label>
            <input id="nav_reset_minutes" type="number" min="0" max="240" style="${inp}">
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--divider-color);padding-top:12px;">
        <label style="${chk}"><input id="dim_past" type="checkbox"> Vergangene Stunden ausgrauen</label>
        <label style="${chk}"><input id="highlight_today" type="checkbox"> Heutigen Tag hervorheben</label>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--divider-color);padding-top:12px;">
        <label style="${chk}"><input id="show_mensa" type="checkbox"> Mensa-Hinweis anzeigen</label>
        <div id="mensa-cfg" style="display:none;flex-direction:column;gap:10px;">
          <div style="font-size:11px;color:var(--secondary-text-color);">Mensa-Entities (binary_sensor, an = bestellt). Die Zuordnung zum jeweiligen Tag erfolgt automatisch über das Datum (Attribut <code>date</code>); die Reihenfolge spielt keine Rolle. Vergangene Tage zeigen keinen Hinweis. Bis zu 16 Entities.</div>
          <div id="mensa-rows" style="display:flex;flex-direction:column;gap:6px;"></div>
          <mwc-button id="mensa-add" dense>+ Mensa-Entity</mwc-button>
          <div style="display:flex;flex-direction:column;gap:4px;">
            <label for="mensa_link" style="${lbl}">Bestell-Link (optional)</label>
            <input id="mensa_link" type="text" style="${inp}">
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            <label for="afternoon_threshold" style="${lbl}">Nachmittagsschwelle (ab dieser Uhrzeit gilt Essensbedarf)</label>
            <input id="afternoon_threshold" type="time" style="width:150px;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font:inherit;">
          </div>
        </div>
      </div>`;

    const bindNum = (id, key, dflt) => {
      const el = slot.querySelector('#' + id);
      el.addEventListener('input', () => {
        const v = parseInt(el.value, 10);
        this._config[key] = isNaN(v) ? dflt : v;
        this._fireChanged();
      });
    };
    const bindCheck = (id, key) => {
      const el = slot.querySelector('#' + id);
      el.addEventListener('change', () => {
        this._config[key] = el.checked;
        this._syncFields();
        this._fireChanged();
      });
    };

    slot.querySelector('#range').addEventListener('change', (ev) => {
      this._config.range = ev.target.value;
      this._syncFields();
      this._fireChanged();
    });
    bindNum('days', 'days', 2);
    bindCheck('skip_weekends', 'skip_weekends');
    slot.querySelector('#week_days').addEventListener('change', (ev) => {
      // "Individuell" uebernimmt die aktuell wirksame Auswahl als Startwert,
      // damit die Checkboxen nicht leer beginnen.
      if (ev.target.value === 'custom') {
        if (!Array.isArray(this._config.week_days)) this._config.week_days = fscWeekDayList(this._config.week_days);
      } else {
        this._config.week_days = ev.target.value;
      }
      this._syncFields();
      this._fireChanged();
    });
    bindCheck('show_nav', 'show_nav');
    bindNum('nav_weeks_ahead', 'nav_weeks_ahead', 2);
    bindNum('nav_reset_minutes', 'nav_reset_minutes', 10);
    bindCheck('dim_past', 'dim_past');
    bindCheck('highlight_today', 'highlight_today');
    bindCheck('show_mensa', 'show_mensa');
    const linkEl = slot.querySelector('#mensa_link');
    linkEl.addEventListener('input', () => { this._config.mensa_link = linkEl.value; this._fireChanged(); });
    const thrEl = slot.querySelector('#afternoon_threshold');
    thrEl.addEventListener('input', () => { this._config.afternoon_threshold = thrEl.value || '13:00'; this._fireChanged(); });
    slot.querySelector('#mensa-add').addEventListener('click', () => {
      const cur = this._config.mensa_entities || [];
      if (cur.length >= 16) return; // bis zu 16 Mensa-Entities (Forecast-Tiefe)
      this._config.mensa_entities = [...cur, ''];
      this._renderMensaRows();
      this._fireChanged();
    });

    this._renderWeekDayBoxes();
    this._renderMensaRows();
  }
  _renderWeekDayBoxes() {
    const box = this.querySelector('#week-days-custom');
    if (!box) return;
    const names = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    box.innerHTML = '';
    names.forEach((name, i) => {
      const iso = i + 1;
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:13px;color:var(--primary-text-color);cursor:pointer;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.iso = String(iso);
      cb.addEventListener('change', () => {
        const cur = fscWeekDayList(this._config.week_days);
        const next = cb.checked
          ? Array.from(new Set([...cur, iso])).sort((a, b) => a - b)
          : cur.filter((n) => n !== iso);
        // Mindestens ein Tag muss uebrig bleiben, sonst waere die Karte leer.
        this._config.week_days = next.length ? next : cur;
        this._syncFields();
        this._fireChanged();
      });
      wrap.append(cb, document.createTextNode(name));
      box.appendChild(wrap);
    });
  }
  _renderMensaRows() {
    const container = this.querySelector('#mensa-rows');
    if (!container) return;
    container.innerHTML = '';
    (this._config.mensa_entities || []).forEach((entId, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;';
      const picker = document.createElement('ha-entity-picker');
      picker.includeDomains = ['binary_sensor'];
      picker.label = `Mensa-Entity ${idx + 1}`;
      picker.hass = this._hass;
      picker.value = entId || '';
      picker.style.flex = '1';
      picker.addEventListener('value-changed', (ev) => {
        ev.stopPropagation();
        this._config.mensa_entities[idx] = ev.detail.value || '';
        this._fireChanged();
      });
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '✕';
      removeBtn.title = 'Tag entfernen';
      removeBtn.style.cssText = 'border:none;background:none;color:var(--error-color,#db4437);font-size:16px;cursor:pointer;padding:4px 8px;flex:none;';
      removeBtn.addEventListener('click', () => {
        this._config.mensa_entities.splice(idx, 1);
        this._renderMensaRows();
        this._fireChanged();
      });
      row.append(picker, removeBtn);
      container.appendChild(row);
    });
  }
  _syncFields() {
    super._syncFields();
    const c = this._config;
    const set = (id, value) => {
      const el = this.querySelector('#' + id);
      if (el && document.activeElement !== el) el.value = value;
    };
    const check = (id, value) => {
      const el = this.querySelector('#' + id);
      if (el) el.checked = !!value;
    };
    const show = (id, visible) => {
      const el = this.querySelector('#' + id);
      if (el) el.style.display = visible ? 'flex' : 'none';
    };

    const isWeek = String(c.range || 'rolling').toLowerCase() === 'week';
    set('range', isWeek ? 'week' : 'rolling');
    show('rolling-cfg', !isWeek);
    show('week-cfg', isWeek);

    set('days', c.days != null ? c.days : 2);
    check('skip_weekends', c.skip_weekends !== false);

    const isCustom = Array.isArray(c.week_days);
    set('week_days', isCustom ? 'custom' : (typeof c.week_days === 'string' && c.week_days ? c.week_days : 'mo_fr'));
    show('week-days-custom', isCustom);
    const active = fscWeekDayList(c.week_days);
    this.querySelectorAll('#week-days-custom input[type=checkbox]').forEach((cb) => {
      cb.checked = active.indexOf(Number(cb.dataset.iso)) !== -1;
    });

    check('show_nav', c.show_nav !== false);
    show('nav-cfg', c.show_nav !== false);
    set('nav_weeks_ahead', c.nav_weeks_ahead != null ? c.nav_weeks_ahead : 2);
    set('nav_reset_minutes', c.nav_reset_minutes != null ? c.nav_reset_minutes : 10);

    check('dim_past', c.dim_past !== false);
    check('highlight_today', c.highlight_today !== false);

    check('show_mensa', !!c.show_mensa);
    show('mensa-cfg', !!c.show_mensa);
    set('mensa_link', c.mensa_link || '');
    set('afternoon_threshold', c.afternoon_threshold || '13:00');
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
  static getStubConfig(hass) {
    const entity = fscPickCalendar(hass, { avoid: /(hausaufgab|pruef|pruf|klausur|exam)/i });
    return { days: 2, people: entity ? [{ name: '', entity, color: '#4fa8e0' }] : [] };
  }
  _resolvePeople() {
    return (this._config.people || []).filter((p) => p && fscIsCalendarEntity(p.entity));
  }
  setConfig(config) {
    this._stopRefreshTimer();
    this._reqSeq = (this._reqSeq || 0) + 1;
    this._config = Object.assign({
      days: 2, skip_weekends: true, refresh_interval: 300,
      padding_minutes: 15, fallback_day_start: '07:30', fallback_day_end: '14:00',
    }, config);
    this._config.refresh_interval = fscRefreshInterval(this._config.refresh_interval);
    this._noSource = this._resolvePeople().length === 0;
    this._initialized = false;
    this._render();
  }
  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._fetchAndRender();
      this._interval = setInterval(() => this._fetchAndRender(), this._config.refresh_interval * 1000);
      this._startNowTicker();
    }
  }
  _stopRefreshTimer() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    if (this._nowTimer) { clearInterval(this._nowTimer); this._nowTimer = null; }
  }
  _startNowTicker() {
    // "Jetzt"-Markierung unabhaengig vom (schweren) Kalender-Refresh aktuell halten: leichtes
    // Neu-Rendern aus dem Cache (kein API-Aufruf), nur wenn die Karte sichtbar ist.
    if (!this._nowTimer) {
      this._nowTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && this._initialized) this._render();
      }, 60000);
    }
  }
  connectedCallback() {
    if (!this._onVisible) {
      // Sofortiges Update, sobald die Karte wieder sichtbar wird (Tablet/Tab aus dem
      // Hintergrund) - dort drosseln/pausieren Browser die Timer, sonst bleibt die
      // "Jetzt"-Markierung eingefroren. Bei ueberfaelligen Daten neu laden, sonst nur rendern.
      this._onVisible = () => {
        if (document.visibilityState !== 'visible' || !this._hass || !this._initialized) return;
        const age = Date.now() - (this._lastFetch || 0);
        if (age >= this._config.refresh_interval * 1000) this._fetchAndRender();
        else this._render();
      };
      document.addEventListener('visibilitychange', this._onVisible);
    }
  }
  disconnectedCallback() {
    this._stopRefreshTimer();
    if (this._onVisible) { document.removeEventListener('visibilitychange', this._onVisible); this._onVisible = null; }
    this._reqSeq = (this._reqSeq || 0) + 1; this._initialized = false;
  }
  getCardSize() { return 3; }
  async _fetchAndRender() {
    if (!this._hass) return;
    const myReq = ++this._reqSeq;
    const people = this._resolvePeople(); // Punkt 8: leere/ungueltige Entities nicht abfragen
    if (!people.length) {
      this._noSource = true; this._perPersonDays = []; this._hasAny = false; this._lastError = false;
      this._dates_cache = fscDates(this._config.days, this._config.skip_weekends);
      this._lastFetch = Date.now();
      this._render();
      return;
    }
    this._noSource = false;
    const dates = fscDates(this._config.days, this._config.skip_weekends); if (!dates.length) return;
    const rangeStart = new Date(dates[0]); rangeStart.setHours(-6, 0, 0, 0);
    const rangeEnd = new Date(dates[dates.length - 1]); rangeEnd.setHours(30, 0, 0, 0);
    const startISO = rangeStart.toISOString(); const endISO = rangeEnd.toISOString();
    const perPerson = await Promise.all(people.map(async (p) => {
      try {
        const events = await this._hass.callApi('GET', `calendars/${p.entity}?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`);
        return Object.assign({}, p, { events: events || [] });
      } catch (e) { console.error('family-overview-card:', p.entity, e); return Object.assign({}, p, { events: [], error: true }); }
    }));
    if (myReq !== this._reqSeq) return; // Punkt 2
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
      return Object.assign({}, p, { days }); // behaelt p.error (Punkt 7: Fehler pro Person)
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
    this._lastFetch = Date.now();
    this._render();
  }
  _render() {
    if (!this._config) return;
    if (this._noSource) { this.innerHTML = fscSourcePlaceholder(); return; }
    const validPeople = this._resolvePeople();
    const dates = this._dates_cache || fscDates(this._config.days, this._config.skip_weekends);
    const perPersonDays = this._perPersonDays || validPeople.map((p) => Object.assign({}, p, { days: dates.map((d) => ({ date: d, start: null, end: null })) }));
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
      // Die "Jetzt"-Markierung liegt in .rows und damit ueber Namensspalte UND Zeitleiste.
      // Ein reiner Prozentwert wuerde sich deshalb auf die gesamte Zeilenbreite beziehen und
      // die Linie (vor allem vormittags) zu weit links zeichnen. Daher: Namensspalte + Gap
      // als festen Offset abziehen und den Anteil nur auf den verbleibenden Track anwenden.
      const nowFrac = (nowMin - dayStartMin) / totalMin;
      const nowMark = showGrid && isToday && nowMin >= dayStartMin && nowMin <= dayEndMin
        ? `<div class="now-mark" style="left:calc(var(--fsc-name-w) + (100% - var(--fsc-name-w)) * ${nowFrac})"></div>` : '';
      const rows = perPersonDays.map((p) => {
        const col = fscSafeColor(p.color);
        // Punkt 7: fehlerhafter Kalender einer Person darf nicht als "schulfrei" erscheinen.
        if (p.error) {
          return `<div class="row"><div class="row-name" style="color:${col}">${fscEsc(p.name)}</div><div class="row-track"><div class="row-empty">Fehler beim Laden</div></div></div>`;
        }
        const d = p.days[di];
        if (!showGrid || !d || !d.start || !d.end) {
          return `<div class="row"><div class="row-name" style="color:${col}">${fscEsc(p.name)}</div><div class="row-track"><div class="row-empty">schulfrei</div></div></div>`;
        }
        const s = Math.max(dayStartMin, fscMinOfDay(d.start));
        const e = Math.min(dayEndMin, fscMinOfDay(d.end));
        const left = ((s - dayStartMin) / totalMin) * 100;
        const width = Math.max(8, ((e - s) / totalMin) * 100);
        const label = `${timeFmt.format(d.start)}–${timeFmt.format(d.end)}`;
        const fill = fscHexToRgba(col, 0.28);
        return `<div class="row"><div class="row-name" style="color:${col}">${fscEsc(p.name)}</div><div class="row-track"><div class="bar" style="left:${left}%;width:${width}%;background:${fill};border-left:2px solid ${col}">${fscEsc(label)}</div></div></div>`;
      }).join('');
      return `<div class="day-block"><div class="day-label${isToday ? ' today' : ''}">${fscEsc(dateLabel)}</div><div class="rows">${nowMark}${rows}</div></div>`;
    }).join('');
    const errNote = this._lastError ? '<div class="err">Kalenderdaten konnten nicht vollständig geladen werden.</div>' : '';
    this.innerHTML = `<ha-card>${this._config.title ? `<div class="title">${fscEsc(this._config.title)}</div>` : ''}<style>
      family-overview-card ha-card{padding:14px 16px 12px}
      family-overview-card .title{font-size:1.3em;font-weight:400;margin-bottom:10px;color:var(--primary-text-color)}
      family-overview-card .day-block{margin-bottom:10px}
      family-overview-card .day-block:last-child{margin-bottom:0}
      family-overview-card .day-label{font-size:11px;font-weight:600;color:var(--secondary-text-color);text-transform:uppercase;letter-spacing:.02em;margin-bottom:5px}
      family-overview-card .day-label.today{color:var(--primary-text-color)}
      family-overview-card .rows{position:relative;display:flex;flex-direction:column;gap:4px;--fsc-label:44px;--fsc-gap:6px;--fsc-name-w:calc(var(--fsc-label) + var(--fsc-gap))}
      family-overview-card .row{display:flex;align-items:center;gap:var(--fsc-gap)}
      family-overview-card .row-name{width:var(--fsc-label);flex:none;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      family-overview-card .row-track{position:relative;flex:1;height:22px;border-radius:5px;background:rgba(128,128,128,0.12)}
      family-overview-card .bar{position:absolute;top:0;bottom:0;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;color:var(--primary-text-color);padding:0 4px;box-sizing:border-box;overflow:hidden;white-space:nowrap}
      family-overview-card .row-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--secondary-text-color)}
      family-overview-card .now-mark{position:absolute;top:-3px;bottom:-3px;width:0;border-left:2px dashed var(--error-color,#db4437);opacity:.6;z-index:2}
      family-overview-card .err{margin-top:8px;font-size:11px;color:var(--error-color,#db4437)}
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
  static getStubConfig(hass) {
    const entity = fscPickCalendar(hass, { prefer: /hausaufgab/i });
    return { title: '', people: entity ? [{ name: '', entity, color: '#4fa8e0' }] : [], days: 14 };
  }
  // Feature: vereinheitlicht people (neu, farbcodiert je Kind) und entities (Legacy)
  // zu einer Quellenliste {name, entity, color}. people hat Vorrang; sonst wird jede
  // entity als namenloses Kind mit der Kartenfarbe behandelt (unveraenderte Legacy-Darstellung).
  _resolveSources() {
    if (Array.isArray(this._config.people)) {
      return this._config.people.filter((p) => p && fscIsCalendarEntity(p.entity));
    }
    return (this._config.entities || [])
      .map((e) => (typeof e === 'string' ? e : (e && e.entity)))
      .filter((e) => typeof e === 'string' && e.trim())
      .map((entity) => ({ name: '', entity, color: this._config.color }));
  }
  setConfig(config) {
    this._stopRefreshTimer();
    this._reqSeq = (this._reqSeq || 0) + 1;
    this._config = Object.assign({ days: 14, refresh_interval: 300, color: '#4fa8e0' }, config);
    this._config.refresh_interval = fscRefreshInterval(this._config.refresh_interval);
    this._peopleMode = Array.isArray(this._config.people); // farbcodierte Mehr-Kind-Darstellung
    this._noSource = this._resolveSources().length === 0;
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
  _stopRefreshTimer() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  }
  disconnectedCallback() { this._stopRefreshTimer(); this._reqSeq = (this._reqSeq || 0) + 1; this._initialized = false; }
  getCardSize() { return 4; }
  async _fetchAndRender() {
    if (!this._hass) return;
    const myReq = ++this._reqSeq;
    const sources = this._resolveSources();
    if (!sources.length) {
      this._noSource = true; this._items = []; this._lastError = false; this._partialError = false;
      this._render();
      return;
    }
    this._noSource = false;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + this._config.days);
    const startISO = start.toISOString(); const endISO = end.toISOString();
    let errCount = 0;
    const perSource = await Promise.all(sources.map(async (p) => {
      try {
        const events = await this._hass.callApi('GET', `calendars/${p.entity}?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`);
        return { person: p, events: events || [] };
      } catch (e) { console.error('family-homework-card:', p.entity, e); errCount += 1; return { person: p, events: [] }; }
    }));
    if (myReq !== this._reqSeq) return; // Punkt 2
    const items = [];
    const seen = new Set();
    for (const { person, events } of perSource) {
      for (const ev of events) {
        const startStr = ev.start && (ev.start.date || ev.start.dateTime);
        const endStr = ev.end && (ev.end.date || ev.end.dateTime);
        if (!startStr) continue;
        // people-Modus: Entity im Schluessel (gleiche Aufgabe darf bei zwei Kindern zweimal
        // erscheinen). Legacy-entities-Modus: OHNE Entity - erhaelt die alte Deduplizierung.
        const baseKey = startStr + '|' + endStr + '|' + (ev.summary || '') + '|' + (ev.description || '');
        const key = this._peopleMode ? (person.entity || '') + '|' + baseKey : baseKey;
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
        items.push({ person, summary: ev.summary || '', description: ev.description || '', given, due });
      }
    }
    items.sort((a, b) => a.due - b.due);
    this._items = items;
    // Punkt 7/3: Vollfehler nur, wenn ALLE Quellen fehlgeschlagen sind; sonst Teilfehler
    // mit erhaltenen Daten + Warnung (analog family-exam-card).
    this._lastError = errCount > 0 && errCount === sources.length;
    this._partialError = errCount > 0 && errCount < sources.length;
    this._render();
  }
  _linkify(text) {
    const esc = fscEsc(text);
    return esc.replace(/(https?:\/\/[^\s]+)/gi, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);
  }
  _render() {
    if (!this._config) return;
    if (this._noSource) { this.innerHTML = fscSourcePlaceholder(); return; }
    const safeColor = fscSafeColor(this._config.color);
    this.style.setProperty('--fsc-accent', safeColor);
    this.style.setProperty('--fsc-border', fscHexToRgba(safeColor, 0.28));
    const items = this._items || [];
    const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    // Punkt 7: bei Fehler nicht "Keine Hausaufgaben" vortaeuschen.
    const listHtml = this._lastError
      ? '<div class="err">Hausaufgaben konnten nicht geladen werden.</div>'
      : (items.length === 0
        ? '<div class="empty"><ha-icon icon="mdi:check"></ha-icon>Keine Hausaufgaben</div>'
        : items.map((it) => {
          const range = fscSameDay(it.given, it.due)
            ? fscEsc(dateFmt.format(it.due))
            : `${fscEsc(dateFmt.format(it.given))} – ${fscEsc(dateFmt.format(it.due))}`;
          const desc = it.description
            ? `<div class="desc">${this._linkify(it.description).replace(/\n/g, '<br>')}</div>`
            : '<div class="desc empty-desc">Keine weiteren Details</div>';
          // Feature: Farbbalken + Namens-Chip je Kind (people-Modus); Legacy (entities) bleibt unveraendert.
          const p = it.person || {};
          const chipColor = fscSafeColor(p.color, safeColor);
          const itemStyle = this._peopleMode ? ` style="border-left:3px solid ${chipColor};padding-left:9px"` : '';
          const chip = (this._peopleMode && p.name)
            ? `<span class="person" style="background:${fscHexToRgba(chipColor, 0.18)};color:${chipColor}">${fscEsc(p.name)}</span>` : '';
          return `<div class="item"${itemStyle}>
                    <div class="item-head">
                      <span class="range">${range}</span>${chip}<span class="subj">${fscEsc(it.summary)}</span>
                    </div>
                    ${desc}
                  </div>`;
        }).join(''));
    const partialErr = this._partialError ? '<div class="err">Einige Kalender konnten nicht geladen werden.</div>' : '';
    this.innerHTML = `<ha-card>${this._config.title ? `<div class="title">${fscEsc(this._config.title)}</div>` : ''}<style>
      family-homework-card ha-card{padding:12px 16px;border:2px solid var(--fsc-border,var(--divider-color))}
      family-homework-card .title{font-size:1.2em;font-weight:500;margin-bottom:8px;color:var(--primary-text-color)}
      family-homework-card .item{border-top:1px solid var(--divider-color);padding:9px 2px}
      family-homework-card .item:first-child{border-top:none;padding-top:0}
      family-homework-card .item-head{display:flex;align-items:baseline;gap:10px;margin-bottom:4px;flex-wrap:wrap}
      family-homework-card .range{font-size:14px;font-weight:500;color:var(--primary-text-color)}
      family-homework-card .person{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;padding:2px 7px;border-radius:10px}
      family-homework-card .subj{font-size:14px;font-weight:500;color:var(--primary-text-color)}
      family-homework-card .desc{font-size:13px;line-height:1.45;color:var(--primary-text-color);white-space:pre-wrap;user-select:text;-webkit-user-select:text}
      family-homework-card .desc a{color:var(--fsc-accent,var(--primary-color))}
      family-homework-card .empty-desc{color:var(--secondary-text-color);font-style:italic}
      family-homework-card .empty{display:flex;align-items:center;gap:6px;padding:6px 2px;font-size:13px;color:var(--secondary-text-color)}
      family-homework-card .err{margin-top:0;font-size:13px;color:var(--error-color,#db4437)}
      </style><div class="list">${listHtml}${partialErr}</div></ha-card>`;
  }
}
customElements.define('family-homework-card', FamilyHomeworkCard);

/* ---------- Editor: family-homework-card (zwei Modi) ----------
 * Legacy-Modus (config.people ist KEIN Array): Titel, Tage, Kalender-Entity und Farbe sind voll
 *   editierbar; ein expliziter Button "Auf Mehr-Kind-Modus umstellen" migriert bewusst auf people.
 *   Normale Aenderungen erzeugen KEINEN people-Key - die Konfiguration bleibt Legacy.
 * People-Modus (config.people ist ein Array): farbcodierte Kind-Zeilen (Name/Kalender/Farbe,
 *   hinzufuegen/entfernen). Neue Karten starten hier (getStubConfig liefert people). */
class FamilyHomeworkCardEditor extends HTMLElement {
  constructor() { super(); this._rendered = false; this._rowRefs = []; }
  _isPeopleMode() { return Array.isArray(this._config && this._config.people); }
  setConfig(config) {
    // Legacy-Config (ohne people) NICHT mit people:[] anreichern - sonst wuerde die Karte die
    // entities-Quelle verlieren (people hat Vorrang, sobald es ein Array ist).
    const hasPeople = Array.isArray(config.people);
    this._config = Object.assign({}, config);
    if (hasPeople) this._config.people = config.people.map((p) => Object.assign({}, p));
    const newMode = hasPeople ? 'people' : 'legacy';
    if (!this._rendered) { if (this._hass) this._render(); return; }
    if (newMode !== this._renderedMode) { this._render(); return; }
    if (newMode === 'people') {
      const newLen = this._config.people.length;
      if (newLen !== this._peopleLen) this._renderRows();
      else this._syncRows();
    } else {
      this._syncLegacy();
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
    if (this._isPeopleMode()) this._renderPeople();
    else this._renderLegacy();
  }
  // ---- Legacy-Modus (entities) ----
  _legacyFirstEntity() {
    const e = (this._config.entities || [])[0];
    return (typeof e === 'string' ? e : (e && e.entity)) || '';
  }
  _renderLegacy() {
    this._renderedMode = 'legacy';
    this.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;padding:8px 2px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="title" style="font-size:12px;color:var(--secondary-text-color);">Titel (z.B. Name des Kindes)</label>
          <input id="title" type="text" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font:inherit;">
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="days" style="font-size:12px;color:var(--secondary-text-color);">Vorschau-Zeitraum (Tage)</label>
          <input id="days" type="number" min="1" max="60" style="width:220px;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font:inherit;">
        </div>
        <div id="entity-slot"></div>
        <div style="display:flex;gap:12px;align-items:center;">
          <label style="font-size:14px;color:var(--secondary-text-color);min-width:70px;">Farbe</label>
          <input id="color" type="color" style="width:48px;height:32px;border:none;background:none;cursor:pointer">
        </div>
        <mwc-button id="to-people" outlined>Auf Mehr-Kind-Modus umstellen</mwc-button>
      </div>`;
    const titleEl = this.querySelector('#title');
    titleEl.value = this._config.title || '';
    titleEl.addEventListener('input', () => { this._config.title = titleEl.value; this._fireChanged(); });
    const daysEl = this.querySelector('#days');
    daysEl.value = this._config.days != null ? this._config.days : 14;
    daysEl.addEventListener('input', () => {
      const v = parseInt(daysEl.value, 10);
      this._config.days = isNaN(v) ? 14 : v;
      this._fireChanged();
    });
    const picker = document.createElement('ha-entity-picker');
    picker.includeDomains = ['calendar'];
    picker.label = 'Kalender-Entity';
    picker.hass = this._hass;
    picker.value = this._legacyFirstEntity();
    picker.addEventListener('value-changed', (ev) => {
      ev.stopPropagation();
      this._config.entities = ev.detail.value ? [ev.detail.value] : [];
      this._fireChanged();
    });
    this.querySelector('#entity-slot').appendChild(picker);
    const colorEl = this.querySelector('#color');
    colorEl.value = this._config.color || '#4fa8e0';
    colorEl.addEventListener('input', () => { this._config.color = colorEl.value; this._fireChanged(); });
    this.querySelector('#to-people').addEventListener('click', () => this._migrate());
  }
  _syncLegacy() {
    const titleEl = this.querySelector('#title');
    if (titleEl && document.activeElement !== titleEl) titleEl.value = this._config.title || '';
    const daysEl = this.querySelector('#days');
    if (daysEl && document.activeElement !== daysEl) daysEl.value = this._config.days != null ? this._config.days : 14;
    const picker = this.querySelector('ha-entity-picker');
    if (picker) picker.value = this._legacyFirstEntity();
    const colorEl = this.querySelector('#color');
    if (colorEl && document.activeElement !== colorEl) colorEl.value = this._config.color || '#4fa8e0';
  }
  _migrate() {
    // Bewusste Migration Legacy -> people (nur auf expliziten Klick): vorhandene Kalender + die
    // Kartenfarbe uebernehmen, Namen leer lassen, danach entities entfernen. Keine Quelle verlieren.
    const color = this._config.color || '#4fa8e0';
    const entities = (this._config.entities || [])
      .map((e) => (typeof e === 'string' ? e : (e && e.entity)))
      .filter((e) => typeof e === 'string' && e.trim());
    const people = entities.length
      ? entities.map((entity) => ({ name: '', entity, color }))
      : [{ name: '', entity: '', color }];
    this._config = Object.assign({}, this._config, { people });
    delete this._config.entities;
    this._render();
    this._fireChanged();
  }
  // ---- People-Modus ----
  _renderPeople() {
    this._renderedMode = 'people';
    this.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;padding:8px 2px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="title" style="font-size:12px;color:var(--secondary-text-color);">Titel</label>
          <input id="title" type="text" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font:inherit;">
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="days" style="font-size:12px;color:var(--secondary-text-color);">Vorschau-Zeitraum (Tage)</label>
          <input id="days" type="number" min="1" max="60" style="width:220px;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font:inherit;">
        </div>
        <div id="rows" style="display:flex;flex-direction:column;gap:8px;"></div>
        <mwc-button id="add-row" raised>+ Kind hinzufügen</mwc-button>
      </div>`;
    const titleEl = this.querySelector('#title');
    titleEl.value = this._config.title || '';
    titleEl.addEventListener('input', () => { this._config.title = titleEl.value; this._fireChanged(); });
    const daysEl = this.querySelector('#days');
    daysEl.value = this._config.days != null ? this._config.days : 14;
    daysEl.addEventListener('input', () => {
      const v = parseInt(daysEl.value, 10);
      this._config.days = isNaN(v) ? 14 : v;
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
    if (!container) return;
    this._peopleLen = (this._config.people || []).length;
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
customElements.define('family-homework-card-editor', FamilyHomeworkCardEditor);

/* =========================================================================
 * family-exam-card
 * Direkt lesbare Klassenarbeitenliste fuer EIN oder MEHRERE Kinder, farbcodiert
 * pro Kind (wie family-overview-card: eine "people"-Liste aus Name/Kalender/
 * Farbe statt einer einzelnen Kalender-Entity). Alle gewaehlten Kalender werden
 * chronologisch zu einer gemeinsamen Liste gemischt; "max_items" begrenzt die
 * GESAMTliste (nicht pro Kind) - so entscheidet die Auswahl der Kalender, ob die
 * Karte eine uebersichtliche Familienliste oder die Arbeiten eines einzelnen
 * Kindes zeigt.
 * ========================================================================= */
class FamilyExamCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement('family-exam-card-editor');
  }
  static getStubConfig(hass) {
    const entity = fscPickCalendar(hass, { prefer: /(pruef|pruf|klausur|exam)/i });
    return { title: 'Klassenarbeiten', people: entity ? [{ name: '', entity, color: '#4fa8e0' }] : [], days: 60, max_items: 5 };
  }
  _resolvePeople() {
    return (this._config.people || []).filter((p) => p && fscIsCalendarEntity(p.entity));
  }
  setConfig(config) {
    this._stopRefreshTimer();
    this._reqSeq = (this._reqSeq || 0) + 1;
    this._config = Object.assign({ days: 60, max_items: 5, refresh_interval: 300 }, config);
    this._config.refresh_interval = fscRefreshInterval(this._config.refresh_interval);
    this._noSource = this._resolvePeople().length === 0;
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
  _stopRefreshTimer() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  }
  disconnectedCallback() { this._stopRefreshTimer(); this._reqSeq = (this._reqSeq || 0) + 1; this._initialized = false; }
  getCardSize() { return 4; }
  async _fetchAndRender() {
    if (!this._hass) return;
    const myReq = ++this._reqSeq;
    const people = this._resolvePeople(); // Punkt 8
    if (!people.length) {
      this._noSource = true; this._items = []; this._lastError = false; this._partialError = false;
      this._render();
      return;
    }
    this._noSource = false;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + this._config.days);
    const startISO = start.toISOString(); const endISO = end.toISOString();
    let errCount = 0;
    const perPerson = await Promise.all(people.map(async (p) => {
      try {
        const events = await this._hass.callApi('GET', `calendars/${p.entity}?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`);
        return { person: p, events: events || [] };
      } catch (e) { console.error('family-exam-card:', p.entity, e); errCount += 1; return { person: p, events: [] }; }
    }));
    if (myReq !== this._reqSeq) return; // Punkt 2
    const items = [];
    const seen = new Set();
    for (const { person, events } of perPerson) {
      for (const ev of events) {
        const startStr = ev.start && (ev.start.date || ev.start.dateTime);
        const endStr = ev.end && (ev.end.date || ev.end.dateTime);
        if (!startStr) continue;
        const key = person.entity + '|' + startStr + '|' + endStr + '|' + (ev.summary || '');
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
        items.push({ person, summary: ev.summary || '', description: ev.description || '', given, due });
      }
    }
    items.sort((a, b) => a.due - b.due);
    this._items = items.slice(0, this._config.max_items);
    // Punkt 7/3: konsistent zu Timetable/Homework - Vollfehler nur bei ALLEN fehlgeschlagenen
    // Personen; sonst Teilfehler (erfolgreiche/leere Daten + Warnung).
    this._lastError = errCount > 0 && errCount === people.length;
    this._partialError = errCount > 0 && errCount < people.length;
    this._render();
  }
  _linkify(text) {
    const esc = fscEsc(text);
    return esc.replace(/(https?:\/\/[^\s]+)/gi, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);
  }
  _render() {
    if (!this._config) return;
    if (this._noSource) { this.innerHTML = fscSourcePlaceholder(); return; }
    const items = this._items || [];
    const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    // Punkt 7: geladene Eintraege behalten, aber bei leerer Liste + Fehler nicht
    // "Keine Klassenarbeiten" vortaeuschen; Teilfehler separat kennzeichnen.
    let listHtml;
    if (items.length > 0) {
      listHtml = items.map((it) => {
        const range = fscSameDay(it.given, it.due)
          ? fscEsc(dateFmt.format(it.due))
          : `${fscEsc(dateFmt.format(it.given))} – ${fscEsc(dateFmt.format(it.due))}`;
        const desc = it.description
          ? `<div class="desc">${this._linkify(it.description).replace(/\n/g, '<br>')}</div>`
          : '';
        const chipColor = fscSafeColor(it.person.color);
        const chipBg = fscHexToRgba(chipColor, 0.18);
        // Farbbalken je Kind analog family-homework-card (people-Modus): 3px linke Kante
        // in der Kind-Farbe + Einrueckung, damit beide Karten visuell konsistent sind.
        return `<div class="item" style="border-left:3px solid ${chipColor};padding-left:9px">
                    <div class="item-head">
                      <span class="range">${range}</span>
                      <span class="person" style="background:${chipBg};color:${chipColor}">${fscEsc(it.person.name)}</span>
                      <span class="subj">${fscEsc(it.summary)}</span>
                    </div>
                    ${desc}
                  </div>`;
      }).join('');
    } else if (this._lastError) {
      listHtml = '<div class="err">Klassenarbeiten konnten nicht geladen werden.</div>';
    } else {
      listHtml = '<div class="empty"><ha-icon icon="mdi:check"></ha-icon>Keine Klassenarbeiten</div>';
    }
    const partialErr = this._partialError
      ? '<div class="err">Einige Kalender konnten nicht geladen werden.</div>' : '';
    this.innerHTML = `<ha-card>${this._config.title ? `<div class="title">${fscEsc(this._config.title)}</div>` : ''}<style>
      family-exam-card ha-card{padding:12px 16px;border:2px solid var(--divider-color)}
      family-exam-card .title{font-size:1.2em;font-weight:500;margin-bottom:8px;color:var(--primary-text-color)}
      family-exam-card .item{border-top:1px solid var(--divider-color);padding:9px 2px}
      family-exam-card .item:first-child{border-top:none;padding-top:0}
      family-exam-card .item-head{display:flex;align-items:baseline;gap:10px;margin-bottom:4px;flex-wrap:wrap}
      family-exam-card .range{font-size:14px;font-weight:500;color:var(--primary-text-color)}
      family-exam-card .person{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;padding:2px 7px;border-radius:10px}
      family-exam-card .subj{font-size:14px;font-weight:500;color:var(--primary-text-color)}
      family-exam-card .desc{font-size:13px;line-height:1.45;color:var(--primary-text-color);white-space:pre-wrap;user-select:text;-webkit-user-select:text}
      family-exam-card .desc a{color:var(--primary-color)}
      family-exam-card .empty{display:flex;align-items:center;gap:6px;padding:6px 2px;font-size:13px;color:var(--secondary-text-color)}
      family-exam-card .err{margin-top:8px;font-size:13px;color:var(--error-color,#db4437)}
      </style><div class="list">${listHtml}</div>${partialErr}</ha-card>`;
  }
}
customElements.define('family-exam-card', FamilyExamCard);

/* ---------- Editor: family-exam-card (repeating Kind-Zeilen, wie family-overview-card-editor) ---------- */
class FamilyExamCardEditor extends HTMLElement {
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
          <label for="title" style="font-size:12px;color:var(--secondary-text-color);">Titel</label>
          <input id="title" type="text" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font:inherit;">
        </div>
        <div style="display:flex;gap:16px;">
          <div style="display:flex;flex-direction:column;gap:4px;flex:1;">
            <label for="days" style="font-size:12px;color:var(--secondary-text-color);">Vorschau-Zeitraum (Tage)</label>
            <input id="days" type="number" min="1" max="180" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font:inherit;">
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex:1;">
            <label for="max_items" style="font-size:12px;color:var(--secondary-text-color);">Max. Eintraege</label>
            <input id="max_items" type="number" min="1" max="50" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font:inherit;">
          </div>
        </div>
        <div id="rows" style="display:flex;flex-direction:column;gap:8px;"></div>
        <mwc-button id="add-row" raised>+ Kind hinzufügen</mwc-button>
      </div>`;
    const titleEl = this.querySelector('#title');
    titleEl.value = this._config.title || '';
    titleEl.addEventListener('input', () => { this._config.title = titleEl.value; this._fireChanged(); });
    const daysEl = this.querySelector('#days');
    daysEl.value = this._config.days != null ? this._config.days : 60;
    daysEl.addEventListener('input', () => {
      const v = parseInt(daysEl.value, 10);
      this._config.days = isNaN(v) ? 60 : v;
      this._fireChanged();
    });
    const maxEl = this.querySelector('#max_items');
    maxEl.value = this._config.max_items != null ? this._config.max_items : 5;
    maxEl.addEventListener('input', () => {
      const v = parseInt(maxEl.value, 10);
      this._config.max_items = isNaN(v) ? 5 : v;
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
customElements.define('family-exam-card-editor', FamilyExamCardEditor);

/* ---------- HACS / Lovelace Card-Picker Registrierung ---------- */
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'family-timetable-card',
  name: 'Family Timetable Card',
  description: 'Stundenplan (heute/folgende Tage) auf gemeinsamer Zeitachse, fuer ein Kind. Klick-Detail-Popup, optionaler Mensa-Hinweis. Jede HA-Kalender-Entity; WebUntis zusaetzlich mit Entfall-/Vertretungsfarben.',
});
window.customCards.push({
  type: 'family-overview-card',
  name: 'Family Overview Card',
  description: 'Kompakte "Wer muss wann los"-Uebersicht fuer mehrere Kinder. Beliebige HA-Kalender-Entities.',
});
window.customCards.push({
  type: 'family-homework-card',
  name: 'Family Homework Card',
  description: 'Hausaufgabenliste, farbcodiert je Kind (people) oder klassisch (entities). Beliebige HA-Kalender-Entities.',
});
window.customCards.push({
  type: 'family-exam-card',
  name: 'Family Exam Card',
  description: 'Farbcodierte Klausurenliste fuer ein oder mehrere Kinder, max. N Eintraege waehlbar. Beliebige HA-Kalender-Entities (z. B. iServ per CalDAV).',
});
