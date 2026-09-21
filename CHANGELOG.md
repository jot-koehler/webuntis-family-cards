# Changelog

Alle nennenswerten Änderungen an **Family School Cards**.
Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/); Versionierung nach [SemVer](https://semver.org/lang/de/).

## [1.5.0] – 2026-09-21

### Neu

- **Kartenrahmen abschaltbar** (`accent_border`, Default `true`) für
  `family-timetable-card` und `family-homework-card`. Mit `accent_border: false`
  nutzt die Karte den Rahmen des aktiven Themes
  (`--ha-card-border-width` / `--ha-card-border-color`) statt der Kalenderfarbe
  und fügt sich damit in Dashboards ein, in denen der farbige Rahmen zu stark
  wirkt — ohne `card-mod`. Titel, Stundenbalken und die Hervorhebung des
  heutigen Tages behalten die Kalenderfarbe. Die Option steht auch im visuellen
  Editor beider Karten.
  Umgesetzt als Attribut am Host plus zweiter CSS-Regel, nicht als zur Laufzeit
  zusammengesetzte Stilzeile — die Rahmenregel bleibt im Stylesheet.
  Vorgeschlagen von [@masyfil](https://github.com/masyfil) in
  [#3](https://github.com/jot-koehler/webuntis-family-cards/issues/3).

### Behoben

- Testsuite: die Prüfungen zum Ausgrauen vergangener Stunden bauten ihre
  Zeitstempel mit fest kodiertem `+02:00`, ermittelten „heute" aber aus der
  lokalen Uhr. Auf einem Runner in UTC fiel die 00:01-Stunde dadurch auf den
  Vortag und drei Prüfungen schlugen fehl. Betroffen war nur der Test, nicht die
  Karte. Die Stempel werden jetzt ohne Zonenangabe gebaut und laufen in jeder
  Zeitzone.

## [1.4.0] – 2026-09-21

Die `family-timetable-card` bekommt eine **feste Wochenansicht** mit Blättern,
eine eigene Kategorie für Raumwechsel und eine optionale Anreicherung aus den
WebUntis-Rohdaten. **Abwärtskompatibel** – bestehende Konfigurationen laufen
unverändert weiter (`range` ist per Default `rolling`), Custom-Element-Namen
und `hacs.json` unverändert, keine neuen Abhängigkeiten.

### Neu

- **Wochenansicht** (`range: week`): zeigt eine feste Kalenderwoche statt
  „heute + N Tage". Welche Wochentage erscheinen, steuert `week_days` —
  `mo_fr` (Default), `mo_sa`, `mo_so` oder eine Liste von ISO-Wochentagen wie
  `[1, 3, 5]`. Liegt der heutige Tag nicht in der Auswahl (Samstag bei Mo–Fr),
  springt die Ansicht auf die kommende Woche, statt eine vollständig vergangene
  Woche zu zeigen.
- **Vergangene Stunden ausgegraut** (`dim_past`, Default an). Sie bleiben voll
  funktional — der Klick öffnet weiterhin das Detail-Popup, dort mit dem Badge
  „Bereits vorbei". Der Zustand wird beim Rendern ausgewertet, nicht beim
  Abruf, und wandert dadurch mit dem Minutentakt mit.
- **Hervorhebung des heutigen Tages** (`highlight_today`, Default an): eine
  dezente Linie in der Kartenfarbe unter dem Spaltenkopf plus Akzentfarbe auf
  der Tagesziffer.
- **Blättern** (`show_nav`, `nav_weeks_ahead`, `nav_reset_minutes`): im
  Wochenmodus bis zu acht Wochen nach vorne. Ein „Heute"-Button springt zurück,
  nach `nav_reset_minutes` ohne Bedienung automatisch. Alle blätterbaren Wochen
  werden in einem Abruf geholt; das Umschalten läuft ohne Nachladen.
- **Raumwechsel als eigene Kategorie** (violett): `Room change:` wird nicht mehr
  als normale Stunde dargestellt und auch nicht mit einer Vertretung verwechselt.
  Im Popup steht „alter Raum → neuer Raum" bzw. „→ entfällt".
- **Optionale JSON-Anreicherung**: Steht in `description` ein JSON (WebUntis-
  Option „Kalender - Beschreibung: JSON"), nutzt die Karte `code`, `subjects`,
  `klassen` und `original_rooms` als verlässliche Quelle. `subjects: []` ersetzt
  dabei die bisherige Ersatzregel „Irregular ohne Raum" für
  Sonderveranstaltungen. Das Popup zeigt zusätzlich Klassenverbund und
  Vertretungstext. Ohne JSON bleibt alles wie bisher.
- **Horizontales Auffangnetz** (`min_column_width`, Default 132 px): Reichen
  fünf bis sieben Spalten nicht in die Breite, wird die Karte horizontal
  scrollbar statt unlesbar.
- **Editor** um Ansichtsumschalter, Tagesauswahl (inklusive „Individuell" mit
  Wochentag-Checkboxen), Navigationsoptionen und die beiden
  Darstellungsschalter erweitert.

### Geändert

- Der Mensa-Hinweis wird an **vergangenen Tagen** nicht mehr angezeigt. Die
  Bestellung ist dort erledigt, eine rote Warnung wäre nur Rauschen. Der Slot
  bleibt reserviert, damit die Spalten ausgerichtet bleiben.
- Der **Positions-Fallback** für Mensa-Sensoren ohne `date`-Attribut greift nur
  noch im Rolling-Modus. Über mehrere Wochen hinweg ist eine Sensorposition
  bedeutungslos und würde falsche Tage zuordnen.
- `mensa_entities` erlaubt jetzt bis zu 16 Einträge (vorher 10).
- Die **Zeitachse** wird nur noch über die sichtbaren Tage berechnet. Sonst
  zöge ein einzelner Abendtermin in einer anderen Woche das Raster der
  aktuellen Woche auseinander.
- Die **Deduplizierung** vergleicht jetzt den um Präfixe bereinigten Titel.
  WebUntis liefert dieselbe Sonderveranstaltung je Klassenverbund mehrfach;
  bewusst wird nicht über eine ID dedupliziert, sonst stünden zwei identische
  Kacheln nebeneinander.
- `getCardSize()` liefert im Wochenmodus 6 statt 5.

### Hinweise

- Reine **Lehrerwechsel** bleiben unsichtbar: Der Elternzugang hat in der Regel
  kein Leserecht für Lehrkräfte (`getTeachers()`), die Integration liefert dann
  keine Lehrerfelder — auch nicht im JSON.
- Die Option „Ereignisnamen ersetzen" (`calendar_replace_name`) darf **nicht**
  benutzt werden, um die Präfixe `Cancelled:`, `Irregular:` und `Room change:`
  zu übersetzen — die Karte erkennt die Status genau an diesen Zeichenketten.

## [1.3.2] – 2026-09-21

Bugfix-Release. Keine Konfigurationsänderungen nötig.

> **Hinweis zu 1.3.1:** Das Release 1.3.1 wurde versehentlich auf dem Commit von
> 1.3.0 getaggt und enthält den unten beschriebenen Fix **nicht**. Es ist inhaltlich
> mit 1.3.0 identisch. Bitte 1.3.2 verwenden.

### Behoben
- **`family-overview-card`: „Jetzt"-Markierung stand zu weit links.** Die Linie liegt
  im Container `.rows`, der die Namensspalte (44 px) samt Abstand (6 px) mit umfasst.
  Der bisherige reine Prozentwert bezog sich damit auf die gesamte Zeilenbreite statt
  auf die Zeitleiste (`.row-track`) – der Fehler war vormittags am größten und zeigte
  die Linie teils noch vor dem Beginn des ersten Balkens. Die Position wird jetzt als
  `calc()` aus festem Namensspalten-Offset plus Anteil an der verbleibenden Breite
  berechnet. Breite der Namensspalte und Abstand liegen dafür als CSS-Variablen
  (`--fsc-label`, `--fsc-gap`, `--fsc-name-w`) an einer Stelle, damit Linie und Zeilen
  nicht wieder auseinanderlaufen.

## [1.3.0] – 2026-09-19

Mensa-Hinweis von „ein Sensor pro Position" auf eine **datumsbasierte** Zuordnung
umgestellt und um ein Menü-Detail-Popup erweitert; kleinere visuelle Angleichung
der Klausurkarte. **Abwärtskompatibel** – bestehende Konfigurationen laufen weiter
(Legacy-Positions-Fallback), Custom-Element-Namen und `hacs.json` unverändert,
keine neuen Abhängigkeiten.

### Neu
- **Datumsbasierte Mensa-Zuordnung** (`family-timetable-card`): Jeder dargestellte
  Tag wählt aus `mensa_entities` den Sensor mit passendem `date`-Attribut
  (`YYYY-MM-DD`, lokal normiert – kein `toISOString()`/UTC-Versatz). Reihenfolge und
  Anzahl sind damit egal; es lassen sich z. B. 10 Forecast-Sensoren hinterlegen,
  während die Karte nur wenige Tage zeigt. Bei mehreren Entities für dasselbe Datum
  gewinnt deterministisch der erste Treffer.
- **Vollständige Statuslogik** mit vier sichtbaren Zuständen plus „keine Daten":
  neutral „nicht bestellt", orange „Essen abbestellen?", rot „Kein Essen bestellt",
  grün „Essen bestellt". Neues Attribut `available` (`false` → **kein** Hinweis,
  damit ein Datenausfall nicht wie „nichts bestellt" aussieht); fehlt das Attribut,
  gilt `true` (Legacy-kompatibel).
- **Menü-Detail-Popup:** Klick auf einen bestellten Tag öffnet ein natives
  `ha-dialog` mit Datum, `menu_text` und Positionen (`items` mit Menge/Preis) statt
  des generischen HA-More-Info. Klick auf einen nicht bestellten Tag öffnet den
  `mensa_link` (Fallback: More-Info). Tastaturbedienbar (Enter/Space). Im Popup
  bestellter Tage zusätzlich ein optionaler „Umbestellen"-Button auf den `mensa_link`.
- **Editor:** `mensa_entities` als reine Entity-Liste (bis zu 10) statt „Tag 1/2/…";
  die Tageszuordnung erfolgt über das Datum.

### Geändert
- **`family-exam-card`** visuell an `family-homework-card` angeglichen: Farbbalken
  je Kind (3px in Kindfarbe) und einheitlicher `item-head`-Abstand.
- Kartentitel von `family-homework-card` nutzt jetzt `--primary-text-color` (wie
  `family-exam-card`) statt der Akzentfarbe.

### Unverändert
- Custom-Element-Namen, `hacs.json`, Abhängigkeiten (keine). Bestehende
  `mensa_entities`-Konfigurationen ohne `date`-Attribut laufen über den
  Positions-Fallback weiter.

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

[1.3.0]: https://github.com/jot-koehler/webuntis-family-cards/releases/tag/v1.3.0
[1.2.0]: https://github.com/jot-koehler/webuntis-family-cards/releases/tag/v1.2.0
[1.1.0]: https://github.com/jot-koehler/webuntis-family-cards/releases/tag/v1.1.0
