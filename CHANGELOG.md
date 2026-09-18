# Changelog

Alle nennenswerten Änderungen an **Family School Cards**.
Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/); Versionierung nach [SemVer](https://semver.org/lang/de/).

## [1.2.0] – 2026-09-18

Sammel-Release: Robustheits-Bugfixes, vier neue Funktionen und ein Fix für die
„Jetzt"-Markierung. **Vollständig abwärtskompatibel** – alle bestehenden
v1.1.0-Konfigurationen bleiben unverändert gültig (Timetable/Homework weiter mit
`entities`, Overview/Exam weiter mit `people`). Keine neuen Abhängigkeiten, keine
umbenannten Custom Elements, `hacs.json` unverändert.

### Neu
- **Klick-Detail-Popup** (`family-timetable-card`): Klick auf einen Eintrag öffnet
  ein Dialog mit Datum, Uhrzeit, Raum, Status (Entfall/Vertretung/Sonder) und
  Beschreibung. Header-Titel per Feature-Detection (`headerTitle`/`heading`), damit
  der Titel auf keiner HA-Dialog-Generation doppelt erscheint.
- **Farbcodierte Hausaufgaben je Kind** (`family-homework-card`): neuer Modus
  `people` (Liste aus Name/Kalender/Farbe) mit Farbbalken und Namens-Chip pro Kind.
  Der klassische `entities`-Modus bleibt voll funktionsfähig; ein expliziter Button
  „Auf Mehr-Kind-Modus umstellen" migriert bewusst auf `people`, ohne eine
  Kalenderquelle zu verlieren.
- **Optionaler Mensa-Hinweis** (`family-timetable-card`): pro angezeigtem Tag ein
  Hinweis aus einem `binary_sensor` (an = bestellt), nur relevant bei
  Nachmittagsunterricht ab konfigurierbarer Schwelle (`afternoon_threshold`),
  optionaler Bestell-Link. Der Hinweis lebt in einem reservierten Header-Slot –
  **die Stundenpläne verschieben sich dadurch nicht**. Über die UI aktivierbar und
  mit eigenen Entitäten befüllbar.
- **Universelle Einsetzbarkeit** deutlicher herausgestellt: Die Karten arbeiten mit
  **jeder** HA-Kalender-Entity (Google Calendar, CalDAV/iServ, ICS, lokaler
  Kalender …). WebUntis bleibt die am besten unterstützte Quelle (nur dort die
  Farb-/Statuskennung für Entfall/Vertretung/Sonderveranstaltung).

### Behoben
- **„Jetzt"-Markierung veraltet** (`family-overview-card`, `family-timetable-card`):
  Die Linie wurde bisher nur beim schweren Kalender-Refresh (bis zu 300 s)
  neu berechnet und fror auf Hintergrund-Tabs / Wand-Tablets ein. Jetzt hält ein
  leichter 60-s-Ticker (nur bei sichtbarer Karte, ohne API-Aufruf) die Linie aktuell,
  und beim Zurückwechseln auf den Tab wird sie sofort neu gesetzt (bei überfälligen
  Daten inkl. Neuladen).
- **Race-/Robustheits-Fixes** (alle Karten): Request-Token gegen überholte/parallele
  Kalender-Requests; sauberes Stoppen der Timer bei `setConfig`/Disconnect;
  `refresh_interval` gegen unsinnige Werte abgesichert (Minimum 30 s); nur valide
  Hex-Farben in der Ausgabe; strikte Prüfung auf `calendar.*`-Entities; keine
  Vorauswahl eines semantisch falschen Kalenders im Editor.
- **Fehleranzeige** statt „keine Termine/Hausaufgaben/Arbeiten": Bei fehlgeschlagenem
  Laden wird der Fehler angezeigt; bei Teilfehlern werden erfolgreiche Daten gezeigt
  und separat gewarnt (konsistent über alle Karten).
- **WebUntis-Heuristik** geschärft: `Irregular:` mit Raum = Vertretung/Änderung,
  ohne Raum = Sonderveranstaltung; leere/Whitespace-Raumangaben zählen als „kein
  Raum".

### Unverändert
- Custom-Element-Namen (`family-timetable-card`, `family-overview-card`,
  `family-homework-card`, `family-exam-card`), `hacs.json`, Abhängigkeiten (keine).

## [1.1.0]
- Vorheriger veröffentlichter Stand (vier Karten in der Ausgangsfassung).

[1.2.0]: https://github.com/jot-koehler/webuntis-family-cards/releases/tag/v1.2.0
[1.1.0]: https://github.com/jot-koehler/webuntis-family-cards/releases/tag/v1.1.0
