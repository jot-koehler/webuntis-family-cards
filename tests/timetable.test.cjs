/* =========================================================================
 * Testlauf fuer family-timetable-card (Node, ohne Abhaengigkeiten).
 *
 *   node tests/timetable.test.cjs
 *
 * Laedt die echte Karte aus family-school-cards.js in einen minimalen
 * DOM-Shim und prueft Datumslogik, Klassifizierung und gerendertes HTML.
 * Deckt bewusst die Faelle ab, die beim Umbau kaputtgehen: Wochenend-Sprung,
 * Rueckwaertskompatibilitaet der Defaults, Praefix-Pfad ohne JSON.
 * ========================================================================= */
global.HTMLElement = class {
  addEventListener() {} appendChild() {} contains() { return false; }
  querySelector() { return null; } querySelectorAll() { return []; }
  set innerHTML(v) { this._h = v; } get innerHTML() { return this._h; }
  get style() { return { setProperty() {} }; }
  // ab 1.5.0: accent_border schaltet ein Attribut am Host, nicht eine CSS-Zeile
  toggleAttribute(name, force) {
    this._attrs = this._attrs || {};
    const on = force === undefined ? !(name in this._attrs) : !!force;
    if (on) this._attrs[name] = ''; else delete this._attrs[name];
    return on;
  }
  hasAttribute(name) { return !!(this._attrs && name in this._attrs); }
};
global.customElements = { get: () => undefined, define: () => {} };
global.document = {
  createElement: () => ({ addEventListener() {}, style: {}, set innerHTML(v) {}, querySelector: () => null }),
  body: { appendChild() {} }, addEventListener() {}, visibilityState: 'visible',
};
global.window = {};
global.CustomEvent = class {};

const fs = require('fs');
eval(fs.readFileSync(require('path').join(__dirname, '..', 'family-school-cards.js'), 'utf8') + '\nglobalThis.__Card = FamilyTimetableCard;');

let fails = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'ok  ' : 'FAIL') + '  ' + l + (ok ? '' : `\n      got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
};
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const mk = (cfg) => { const c = new globalThis.__Card(); c.setConfig(cfg); return c; };

console.log('--- 1. Rückwärtskompatibilität: Konfiguration wie bisher ---');
const oldCfg = mk({ entities: ['calendar.x'], days: 3 });
eq('range fällt auf rolling', oldCfg._config.range, 'rolling');
eq('days unverändert', oldCfg._config.days, 3);
eq('skip_weekends Default true', oldCfg._config.skip_weekends, true);
eq('_isWeek false', oldCfg._isWeek(), false);
eq('keine Navigation im Rolling-Modus', oldCfg._navHtml([{date:new Date()}]), '');
eq('maxOffset 0 im Rolling-Modus', oldCfg._maxOffset(), 0);
eq('3 Tage ab heute', oldCfg._allDates().length, 3);
eq('erster Tag ist heute', iso(oldCfg._allDates()[0]), iso(new Date()));
eq('getCardSize wie bisher', oldCfg.getCardSize(), 5);

console.log('\n--- 2. Wochenmodus ---');
const wk = mk({ entities: ['calendar.x'], range: 'week', week_days: 'mo_fr', nav_weeks_ahead: 2 });
eq('3 Wochen x 5 Tage geholt', wk._allDates().length, 15);
eq('erster Tag ist ein Montag', wk._allDates()[0].getDay(), 1);
eq('sichtbar sind 5 Tage', wk._visibleRange(), { from: 0, to: 5 });
wk._weekOffset = 2;
eq('Offset 2 zeigt Tage 10-15', wk._visibleRange(), { from: 10, to: 15 });
eq('getCardSize im Wochenmodus', wk.getCardSize(), 6);
const mo_so = mk({ entities: ['calendar.x'], range: 'week', week_days: 'mo_so', nav_weeks_ahead: 0 });
eq('Mo-So = 7 Tage', mo_so._allDates().length, 7);
const custom = mk({ entities: ['calendar.x'], range: 'week', week_days: [1,3,5], nav_weeks_ahead: 0 });
eq('individuelle Auswahl Mo/Mi/Fr', custom._allDates().map(d => d.getDay()), [1,3,5]);
eq('Clamp: nav_weeks_ahead 99 -> 8', mk({entities:['calendar.x'],range:'week',nav_weeks_ahead:99})._config.nav_weeks_ahead, 8);
eq('Clamp: nav_reset_minutes Müll -> 10', mk({entities:['calendar.x'],range:'week',nav_reset_minutes:'abc'})._config.nav_reset_minutes, 10);

console.log('\n--- 3. Klassifizierung (echte Daten, Lino Mi 23.09.) ---');
const EV = [
 {start:{dateTime:"2026-09-23T07:40:00+02:00"},end:{dateTime:"2026-09-23T08:25:00+02:00"},summary:"Room change: Mathematik",location:null,
  description:'{"code":"None","subjects":[{"name":"M","long_name":"Mathematik"}],"lstext":"","substText":"Schulanfangsfeier","klassen":[{"name":"1b"}],"original_rooms":[{"name":"A005","long_name":"Klassenraum 1b"}],"teachers":[],"name":"Mathematik"}'},
 {start:{dateTime:"2026-09-23T08:25:00+02:00"},end:{dateTime:"2026-09-23T09:10:00+02:00"},summary:"Irregular: Schulanfangsfeier",location:null,
  description:'{"code":"irregular","subjects":[],"lstext":"Schulanfangsfeier","substText":"Schulanfangsfeier","rooms":[],"klassen":[{"name":"1a"},{"name":"1b"},{"name":"3a"},{"name":"3b"}],"original_rooms":[],"name":"Schulanfangsfeier"}'},
 {start:{dateTime:"2026-09-23T08:25:00+02:00"},end:{dateTime:"2026-09-23T09:10:00+02:00"},summary:"Irregular: Schulanfangsfeier",location:null,
  description:'{"code":"irregular","subjects":[],"lstext":"Schulanfangsfeier","substText":"Schulanfangsfeier","rooms":[],"klassen":[{"name":"1b"}],"original_rooms":[],"name":"Schulanfangsfeier"}'},
 {start:{dateTime:"2026-09-23T08:25:00+02:00"},end:{dateTime:"2026-09-23T09:10:00+02:00"},summary:"Cancelled: Kunst und Werken",location:"Klassenraum 1b",
  description:'{"code":"cancelled","subjects":[{"name":"KuW"}],"rooms":[{"name":"A005","long_name":"Klassenraum 1b"}],"klassen":[{"name":"1b"}],"original_rooms":[],"name":"Kunst und Werken"}'},
 {start:{dateTime:"2026-09-23T09:30:00+02:00"},end:{dateTime:"2026-09-23T10:15:00+02:00"},summary:"Deutsch Leseförderung",location:"Klassenraum 1b",
  description:'{"code":"None","subjects":[{"name":"DLe"}],"rooms":[{"name":"A005"}],"klassen":[{"name":"1b"}],"original_rooms":[],"name":"Deutsch Leseförderung"}'},
 // ohne JSON: reiner Präfix-Pfad (Google/CalDAV/ICS)
 {start:{dateTime:"2026-09-23T11:15:00+02:00"},end:{dateTime:"2026-09-23T12:00:00+02:00"},summary:"Room change: Musik",location:"B012",description:null},
 {start:{dateTime:"2026-09-23T13:00:00+02:00"},end:{dateTime:"2026-09-23T13:45:00+02:00"},summary:"Irregular: Förderstunde",location:"A001",description:null},
];

(async () => {
  const c = mk({ entities: ['calendar.lino'], range: 'week', week_days: 'mo_fr', nav_weeks_ahead: 0 });
  c._hass = { callApi: async () => EV, states: {} };
  await c._fetchAndRender();
  const items = c._buckets.flatMap(b => b.items);
  const kat = (it) => it.cancelled ? 'ausfall' : it.special ? 'sonder' : it.changed ? 'vertretung' : it.moved ? 'raumwechsel' : 'normal';
  items.forEach(it => console.log('   ', it.start.toTimeString().slice(0,5), '|', kat(it).padEnd(12), '|', it.title));
  eq('7 Rohevents -> 6 nach Dedup', items.length, 6);
  eq('Mathematik = Raumwechsel', kat(items[0]), 'raumwechsel');
  eq('Titel ohne Präfix', items[0].title, 'Mathematik');
  eq('alter Raum erkannt', items[0].originalRooms[0].long_name, 'Klassenraum 1b');
  eq('Hinweis aus substText', items[0].note, 'Schulanfangsfeier');
  eq('Schulanfangsfeier = Sonderveranstaltung', kat(items[1]), 'sonder');
  eq('Klassenverbund erhalten', items[1].klassen.map(k=>k.name), ['1a','1b','3a','3b']);
  eq('Kunst = Ausfall', kat(items[2]), 'ausfall');
  eq('Leseförderung = normal', kat(items[3]), 'normal');
  eq('Fallback ohne JSON: Raumwechsel', kat(items[4]), 'raumwechsel');
  eq('Fallback ohne JSON: Vertretung (Fach + Raum)', kat(items[5]), 'vertretung');
  eq('kein rohes JSON in description', items.every(i => !String(i.description).startsWith('{')), true);

  console.log('\n--- 4. Gerendertes HTML ---');
  const html = c.innerHTML;
  eq('Karten-Root gerendert', /<ha-card>/.test(html), true);
  eq('Raumwechsel-Klasse im HTML', /class="event moved/.test(html), true);
  eq('Ausfall-Klasse im HTML', /class="event cancelled/.test(html), true);
  eq('Sonderveranstaltung im HTML', /class="event special/.test(html), true);
  eq('heutige Spalte hervorgehoben', /day-col today/.test(html), true);

  // Ausgrauen braucht ein Ereignis, das WIRKLICH vorbei ist: heute 00:01.
  // week_days wird auf den heutigen Wochentag gesetzt, damit der Tag sichtbar
  // ist und kein Wochenend-Sprung greift - der Test läuft so an jedem Tag.
  // Zeitstempel bewusst OHNE feste Zonenangabe: mit hart kodiertem "+02:00" fiel
  // 00:01 auf einem UTC-Runner auf den Vortag, der Tag war leer und drei Pruefungen
  // schlugen fehl - ein Fehler des Tests, nicht der Karte. Ohne Offset parst JS lokal,
  // passend zu der Zeitzone, in der oben "heute" bestimmt wurde.
  const t = new Date();
  const todayIso = t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0');
  const todayDow = t.getDay() === 0 ? 7 : t.getDay();
  const cPast = mk({ entities: ['calendar.x'], range: 'week', week_days: [todayDow], nav_weeks_ahead: 0 });
  cPast._hass = { callApi: async () => ([
    { start: { dateTime: todayIso + 'T00:01:00' }, end: { dateTime: todayIso + 'T00:02:00' }, summary: 'Vorbei', location: 'R1', description: null },
    { start: { dateTime: todayIso + 'T23:58:00' }, end: { dateTime: todayIso + 'T23:59:00' }, summary: 'Kommt noch', location: 'R2', description: null },
  ]), states: {} };
  await cPast._fetchAndRender();
  const pastHtml = cPast.innerHTML;
  if (t.getHours() === 0 && t.getMinutes() < 2) {
    // Zwei-Minuten-Fenster nach Mitternacht: 00:01 ist noch nicht vorbei.
    console.log('skip  Ausgrau-Block (kurz nach Mitternacht)');
  } else {
    eq('vergangene Stunde trägt past', /class="event past"/.test(pastHtml), true);
    eq('künftige Stunde trägt kein past', (pastHtml.match(/class="event past"/g) || []).length, 1);
    eq('beide Stunden gerendert', (pastHtml.match(/class="event[ "]/g) || []).length, 2);
  }
  eq('keine Navigation bei nav_weeks_ahead 0 ohne Offset-Ziel', /data-nav="next" disabled/.test(html), true);
  eq('globaler Bucket-Index am Event', /data-bi="/.test(html), true);

  const c2 = mk({ entities: ['calendar.lino'], range: 'week', week_days: 'mo_fr', nav_weeks_ahead: 2 });
  c2._hass = { callApi: async () => EV, states: {} };
  await c2._fetchAndRender();
  eq('Navigation vorhanden', /class="nav"/.test(c2.innerHTML), true);
  eq('Heute-Button bei Offset 0 unsichtbar statt entfernt', /nav-today is-hidden/.test(c2.innerHTML), true);
  eq('Zurück-Pfeil bei Offset 0 deaktiviert', /data-nav="prev" disabled/.test(c2.innerHTML), true);

  const c3 = mk({ entities: ['calendar.lino'], days: 3 });
  c3._hass = { callApi: async () => EV, states: {} };
  await c3._fetchAndRender();
  eq('Rolling-Modus rendert ohne Navigation', /class="nav"/.test(c3.innerHTML), false);

  console.log('\n--- 5. accent_border (Issue #3) ---');
  eq('Default true', mk({ entities: ['calendar.x'] })._config.accent_border, true);
  const accOn = mk({ entities: ['calendar.x'] });
  eq('Default: kein plain-border am Host', accOn.hasAttribute('plain-border'), false);
  eq('Default: Akzentregel im CSS', /family-timetable-card ha-card\{[^}]*--fsc-border/.test(accOn.innerHTML), true);
  const accOff = mk({ entities: ['calendar.x'], accent_border: false });
  eq('accent_border false setzt plain-border', accOff.hasAttribute('plain-border'), true);
  eq('Theme-Regel im CSS vorhanden', /family-timetable-card\[plain-border\] ha-card\{border:var\(--ha-card-border-width,1px\)/.test(accOff.innerHTML), true);
  eq('Akzentregel bleibt im CSS (Reihenfolge entscheidet)', /family-timetable-card ha-card\{[^}]*--fsc-border/.test(accOff.innerHTML), true);
  // Umschalten zur Laufzeit muss das Attribut wieder entfernen, nicht nur setzen.
  accOff.setConfig({ entities: ['calendar.x'], accent_border: true });
  eq('zurueck auf true entfernt plain-border', accOff.hasAttribute('plain-border'), false);
  eq('Titel behaelt die Akzentfarbe', /\.title\{[^}]*--fsc-accent/.test(accOff.innerHTML), true);

  console.log(fails ? `\n${fails} FEHLER` : '\nAlle Prüfungen bestanden');
  process.exit(fails ? 1 : 0);
})();
