# Family School Cards

Vier kompakte Lovelace-Karten für Home Assistant, die **Stundenpläne,
Hausaufgaben und Klausuren von Kindern** lesbar auf dem Dashboard darstellen.

**Funktioniert mit jeder HA-Kalender-Entity** — Google Calendar, CalDAV
(z. B. iServ), ICS/Remote-Kalender, lokaler HA-Kalender. Entstanden ist das
Kartenset aus dem Bedarf rund um **WebUntis** (über die Integration
[`JonasJoKuJonas/homeassistant-WebUntis`](https://github.com/JonasJoKuJonas/homeassistant-WebUntis)),
und WebUntis bleibt die am besten unterstützte Quelle: **nur dort** blendet die
Stundenplan-Karte zusätzlich Farb-/Statuskennungen für **entfallene Stunden,
Vertretungen und Sonderveranstaltungen** ein (Heuristik über die
`Cancelled:`/`Irregular:`-Präfixe im `summary`). Mit anderen Kalendern werden
Einträge schlicht als normale Blöcke gezeigt — voll funktionsfähig, nur ohne
diese Hervorhebung.

Reines Frontend-Plugin (Lovelace-Karten), **keine** Home-Assistant-Integration:
kein Python, kein Neustart bei Updates, Installation und Updates laufen über
HACS wie bei jeder anderen Custom Card.

## Enthaltene Karten

| Karte | Zweck | Für |
|---|---|---|
| `family-timetable-card` | Zeitraster-Stundenplan — wahlweise rollend (heute + folgende Tage) oder als feste Kalenderwoche mit Blättern, Klick-Detail-Popup, optionaler Mensa-Hinweis | ein Kind |
| `family-overview-card` | Kompakte "Wer muss wann los"-Balkenübersicht | mehrere Kinder |
| `family-homework-card` | Hausaufgabenliste, farbcodiert je Kind, mit klickbaren Links | ein oder mehrere Kinder |
| `family-exam-card` | Farbcodierte Klassenarbeiten-/Prüfungsliste, chronologisch gemischt | ein oder mehrere Kinder |

Für mehrere Kinder: `family-timetable-card` je einmal pro Kind auf dem Dashboard
platzieren. `family-overview-card`, `family-homework-card` und `family-exam-card`
sind je eine einzelne Karte, in der Kinder über "+ Kind hinzufügen" ergänzt und
farblich unterschieden werden.

Alle vier Karten haben einen visuellen Editor (Entity-Picker, Farbwähler,
Textfelder) — YAML-Bearbeitung bleibt über "Als YAML bearbeiten" im
Karten-Dialog weiterhin möglich.


## Screenshots

### Stundenplan
![Family Timetable Card](docs/images/timetable.png)

### Familienübersicht
![Family Overview Card](docs/images/overview.png)

### Hausaufgaben
![Family Homework Card](docs/images/homework.png)

### Klassenarbeiten
![Family Exam Card](docs/images/exam.png)


## Universell nutzbar (jede Kalender-Entity)

`overview`, `homework` und `exam` sind vollständig kalender-agnostisch: sie lesen
nur die Standard-Kalenderfelder (`start`, `end`, `summary`, `description`,
`location`) über die HA-Kalender-API. Jede Kalender-Entity funktioniert. Die
`timetable`-Karte funktioniert ebenfalls mit jedem Kalender; die
WebUntis-Statusfarben (Entfall/Vertretung/Sonderveranstaltung) sind das einzige
WebUntis-spezifische Extra und entfallen bei Fremdkalendern kommentarlos.

## Neue Funktionen

- **Wochenansicht (Stundenplan):** `range: week` zeigt statt „heute + N Tage"
  eine feste Kalenderwoche. Vergangene Stunden werden ausgegraut, bleiben aber
  voll anklickbar; der heutige Tag bekommt eine dezente Linie in der
  Kartenfarbe. Welche Wochentage erscheinen, ist frei wählbar (Mo–Fr, Mo–Sa,
  Mo–So oder einzeln). Liegt der heutige Tag nicht in der Auswahl — etwa
  Samstag bei Mo–Fr — zeigt die Karte automatisch die kommende Woche.
- **Blättern (Stundenplan):** Im Wochenmodus lässt sich über Pfeile um bis zu
  `nav_weeks_ahead` Wochen nach vorne blättern. Ein „Heute"-Button springt
  zurück; nach `nav_reset_minutes` ohne Bedienung passiert das automatisch,
  damit auf einem Wandtablet nicht dauerhaft eine fremde Woche stehenbleibt.
  Alle blätterbaren Wochen werden in **einem** Abruf geholt, das Umschalten
  läuft ohne Nachladen.
- **Raumwechsel als eigene Kategorie (Stundenplan):** Ein `Room change:`-Eintrag
  wird nicht mehr wie eine Vertretung behandelt, sondern violett markiert — die
  Stunde findet statt, nur woanders.
- **Optionale Anreicherung aus dem WebUntis-JSON:** Steht in der Beschreibung
  ein JSON (Integrationsoption „Kalender - Beschreibung: JSON"), nutzt die Karte
  `code`, `subjects`, `klassen` und `original_rooms` als verlässliche Quelle
  statt der Präfix-Heuristik und zeigt im Detail-Popup zusätzlich den
  Klassenverbund, den Raumwechsel (alt → neu) und den Vertretungstext.
- **Klick-Detail-Popup (Stundenplan):** Klick auf einen Eintrag öffnet ein
  natives `ha-dialog` mit Titel, Status (Änderung/Entfallen/Sonderveranstaltung),
  Datum, Zeit, Raum und Beschreibung.
- **Hausaufgaben farbcodiert je Kind:** `family-homework-card` unterstützt jetzt
  eine `people`-Liste (Farbbalken + Namens-Chip pro Kind, analog zur
  Klausurkarte). Bestehende `entities`-Konfigurationen laufen unverändert weiter
  (siehe Abwärtskompatibilität unten).
- **Optionaler Mensa-Hinweis (Stundenplan):** pro Tag ein Status aus eigenen
  `binary_sensor`-Entities („Essen bestellt" / „Essen abbestellen?" / „Kein Essen
  bestellt" / „nicht bestellt"). Zuordnung **datumsbasiert** über das Attribut
  `date`, dadurch unabhängig von der Anzahl sichtbarer Tage (bis zu 10
  Forecast-Sensoren). Klick auf einen bestellten Tag öffnet ein Menü-Popup
  (`menu_text`/`items`), Klick auf einen nicht bestellten Tag den `mensa_link`.
  Im Editor an-/abschaltbar, standardmäßig aus, verschiebungsfrei im Header.

## family-exam-card

Farbcodierte Klassenarbeiten-/Prüfungsliste für ein oder mehrere Kinder. Analog zu `family-homework-card`, aber mit einer `people`-Liste (wie bei `family-overview-card`) statt einer einzelnen Kalender-Entity: alle ausgewählten Kalender werden chronologisch zu **einer** Liste gemischt und farblich nach Kind gekennzeichnet. `max_items` begrenzt die Gesamtliste, nicht pro Kind — wer nur ein Kind einträgt, bekommt dessen nächste Arbeiten; wer mehrere einträgt, bekommt eine gemeinsame Übersicht.

Als Quelle dient ein beliebiger HA-Kalender mit den Klassenarbeiten/Prüfungen. Bei Nutzung von WebUntis für Prüfungen liefert die Integration dafür eine eigene `calendar.*_pruefungen`-Entity pro Kind (parallel zur Stundenplan- und Hausaufgaben-Entity); grundsätzlich funktioniert die Karte aber mit jeder passenden Kalender-Entity.

### Konfiguration

```yaml
type: custom:family-exam-card
title: Klassenarbeiten
days: 60          # Vorschau-Zeitraum in Tagen (Default: 60)
max_items: 5      # maximale Anzahl Einträge in der Gesamtliste (Default: 5)
people:
  - name: Anna
    entity: calendar.anna_pruefungen
    color: "#4fa8e0"
  - name: Ben
    entity: calendar.ben_pruefungen
    color: "#ff9800"
```

Für die Ansicht eines einzelnen Kindes einfach nur einen Eintrag in `people` angeben.

Wie bei den anderen Karten gibt es einen visuellen Card-Editor (Name, Kalender-Entity, Farbe pro Kind, plus Zeitraum und Max-Einträge), kein manuelles YAML nötig.

### Optionen

| Option | Typ | Default | Beschreibung |
|---|---|---|---|
| `title` | string | – | Kartentitel |
| `people` | list | – (erforderlich) | Liste aus `{name, entity, color}` |
| `days` | number | `60` | Wie viele Tage im Voraus abgefragt werden |
| `max_items` | number | `5` | Maximale Anzahl Einträge in der zusammengeführten Liste |
| `refresh_interval` | number | `300` | Aktualisierungsintervall in Sekunden |


---

## Nutzung mit WebUntis

Die Karten funktionieren mit jeder HA-Kalender-Entity (siehe oben). Dieser
Abschnitt beschreibt den WebUntis-Weg, für den das Kartenset ursprünglich
entstanden ist.

Bei Nutzung von WebUntis braucht jedes Kind eine eigene Kalender-Entity aus der
Integration
[`JonasJoKuJonas/homeassistant-WebUntis`](https://github.com/JonasJoKuJonas/homeassistant-WebUntis)
(über HACS installierbar, Kategorie "Integration").

Pro Kind ein eigener Config-Entry: Einstellungen → Geräte & Dienste →
Integration hinzufügen → "WebUntis" → Zugangsdaten des Kindes eingeben.
Die resultierende Kalender-Entity heißt je nach Login-Schema z. B.
`calendar.webuntis_<name>` oder `calendar.<benutzername>` — Entity-ID nach dem
Einrichten in Entwicklerwerkzeuge → Zustände prüfen.

### WebUntis-Konfiguration für die Edge Cases (wichtig)

Ohne die folgenden zwei Optionen fehlen zwei Dinge in der Karte: entfallene
Stunden werden komplett unterdrückt, und Sonderveranstaltungen ohne Fach
(Einschulung, Klassenlehrerunterricht, Wandertag, Ausflüge, …) erscheinen gar
nicht erst im Kalender.

Pro Kind, im Options-Flow der jeweiligen Integration (⋮-Menü am Config-Entry
→ **Konfigurieren**):

1. **Schritt "Calendar"** → `calendar_show_cancelled_lessons` aktivieren.
   Ohne diese Option liefert die Integration entfallene Stunden gar nicht
   erst an den Kalender — sie fehlen komplett, statt markiert zu erscheinen.
2. **Schritt "Filter"** → `invalid_subjects` aktivieren ("Allow lessons
   without subjects"). Sonderveranstaltungen wie eine Einschulungsfeier haben
   in WebUntis kein zugeordnetes Fach. Ohne diese Option filtert die
   Integration jede Stunde ohne Fach kommentarlos heraus — das ist der
   Standardgrund, warum solche Termine "einfach fehlen".

3. **Schritt "Calendar"** → `calendar_show_room_change` aktivieren. Erst damit
   liefert die Integration das Präfix `Room change:`, aus dem die Karte den
   Raumwechsel erkennt.
4. **Schritt "Calendar"** → `calendar_description` auf **JSON** stellen
   (empfohlen). Damit stehen der Karte `code`, `subjects`, `klassen` und
   `original_rooms` zur Verfügung; sie muss den Status dann nicht mehr aus den
   Präfixen erraten und zeigt im Detail-Popup zusätzlich Klassenverbund,
   Raumwechsel und Vertretungstext. Ohne diese Option funktioniert alles
   weiterhin, nur eben über die Heuristik.

Nach dem Ändern: Integration neu laden (⋮ → Neu laden) reicht meist; falls
der Effekt ausbleibt, Home Assistant einmal neu starten.

**Nebenwirkung von `invalid_subjects`:** Es werden *alle* fachlosen Einträge
angezeigt, nicht nur die gewünschten Sonderveranstaltungen. In der Praxis war
das bisher unproblematisch, aber bei ungewöhnlichen Stundenplänen lohnt sich
ein kurzer Blick, ob unerwünschte Einträge auftauchen.

### Wie die Karte cancelled/changed/moved/special erkennt

Die Karte hat zwei Wege. Der erste funktioniert mit **jedem** Kalender, der
zweite ist eine optionale Anreicherung für WebUntis.

**Weg 1 — Präfixe im `summary` (immer aktiv):**

- `Cancelled: <Fach>` → **entfallen** — rot, durchgestrichen.
- `Irregular: <Fach>` **mit** Raum-Angabe (`location`) → **Vertretung/Änderung**
  — orange.
- `Irregular: <Fach>` **ohne** Raum-Angabe → **Sonderveranstaltung** — gelb.
- `Room change: <Fach>` → **Raumwechsel** — violett. Die Stunde findet statt,
  nur in einem anderen Raum (oder ganz ohne, wenn der Raum ersatzlos entfällt).

Die Integration setzt diese Präfixe in sequentiellen `if`-Blöcken, nicht als
`elif`: `Cancelled` und `Irregular` **überschreiben** ein `Room change`. Ein
Eintrag trägt deshalb nie zwei Marker gleichzeitig.

Die Unterscheidung Sonderveranstaltung/Vertretung ist auf diesem Weg eine
**Heuristik**: WebUntis markiert Sonderveranstaltungen genauso als „Irregular"
wie eine normale Vertretung, liefert für sie aber praktisch nie einen Raum
(weil kein Fach zugeordnet ist). **Bekannte Grenze:** Sollte eine Schule eine
raumlose Vertretung eintragen, erschiene sie fälschlich gelb statt orange.

**Weg 2 — JSON in der Beschreibung (empfohlen, siehe Option 4 oben):**

Liegt in `description` ein JSON, liest die Karte die echten Felder und die
Heuristik entfällt:

- `code` (`cancelled` / `irregular` / sonst nichts) bestimmt den Status.
  **Achtung beim Nachbauen:** Unbesetzt kommt `code` als String `"None"`
  (Python-`str(None)`) — ein naiver Truthy-Test wertet jede normale Stunde
  als Statusstunde.
- `subjects: []` kennzeichnet die Sonderveranstaltung — eine Stunde ohne Fach
  ist keine Vertretung.
- `original_rooms` nicht leer und kein Status-Code → Raumwechsel; das Popup
  zeigt dann „alter Raum → neuer Raum" bzw. „→ entfällt".
- `klassen` erscheint im Popup, `info`/`lstext`/`substText` als Hinweistext.

Rohes JSON wird nie angezeigt — wenn es sich parsen lässt, ersetzt die Karte
es durch die aufbereiteten Felder.

> **Nicht** die Option „Ereignisnamen ersetzen" (`calendar_replace_name`)
> benutzen, um die englischen Präfixe zu übersetzen. Die Karte erkennt Ausfall,
> Vertretung und Raumwechsel genau an diesen Zeichenketten — wer sie ersetzt,
> schaltet die Farbcodierung ab.

---

## Installation über HACS

1. HACS → Menü (⋮) → Benutzerdefinierte Repositories.
2. Repository-URL: `https://github.com/jot-koehler/webuntis-family-cards`
   Kategorie: **Dashboard** (Lovelace-Plugin).
3. "Family School Cards" installieren.
4. HACS registriert die Ressource automatisch im Dashboard (`hacs.json` mit
   `content_in_root`). Browser-Cache leeren / hart neu laden, damit die
   Karten im Karten-Auswahldialog erscheinen.

Updates erscheinen danach wie gewohnt als HACS-Update-Badge.

## Karten hinzufügen

Im Dashboard: "Karte hinzufügen" → nach "Family Timetable", "Family
Overview", "Family Homework" bzw. "Family Exam" suchen → Entity und Farbe
im Editor auswählen.

Beispiel-YAML (falls lieber manuell konfiguriert):

```yaml
type: custom:family-timetable-card
title: Kind A
entities:
  - calendar.webuntis_kind_a
color: "#ff9800"
days: 2

---
# Dieselbe Karte als feste Wochenansicht mit Blättern
type: custom:family-timetable-card
title: Kind A
entities:
  - calendar.webuntis_kind_a
color: "#ff9800"
range: week
week_days: mo_fr      # oder mo_sa, mo_so, oder z. B. [1, 3, 5]
nav_weeks_ahead: 2
grid_options:
  columns: full       # fünf Spalten brauchen die volle Breite

---
type: custom:family-overview-card
days: 2
people:
  - name: Kind A
    entity: calendar.webuntis_kind_a
    color: "#ff9800"
  - name: Kind B
    entity: calendar.webuntis_kind_b
    color: "#4caf50"
  - name: Kind C
    entity: calendar.webuntis_kind_c
    color: "#4fa8e0"

---
type: custom:family-homework-card
title: Hausaufgaben
days: 14
people:
  - name: Kind A
    entity: calendar.webuntis_kind_a_hausaufgaben
    color: "#ff9800"
  - name: Kind B
    entity: calendar.webuntis_kind_b_hausaufgaben
    color: "#4caf50"

---
type: custom:family-exam-card
title: Klassenarbeiten
days: 60
max_items: 5
people:
  - name: Kind A
    entity: calendar.webuntis_kind_a_pruefungen
    color: "#ff9800"
  - name: Kind B
    entity: calendar.webuntis_kind_b_pruefungen
    color: "#4caf50"
```

### Konfigurationsoptionen

| Option | Karte | Bedeutung | Default |
|---|---|---|---|
| `title` | timetable, homework, exam | Überschrift der Karte | — |
| `people` | overview, homework, exam | Liste `{name, entity, color}` — ein Eintrag pro Kind (farbcodiert) | erforderlich |
| `entities` | timetable, homework (Legacy) | Liste von Kalender-Entities (bei homework: klassischer Einzel-Kind-Modus ohne Farbcodierung) | erforderlich |
| `color` | timetable, homework/overview/exam (pro Kind) | Akzentfarbe (Hex) | `#4fa8e0` |
| `range` | timetable | `rolling` = heute + folgende Tage, `week` = feste Kalenderwoche | `rolling` |
| `week_days` | timetable | Nur im Wochenmodus: `mo_fr`, `mo_sa`, `mo_so` oder Liste von ISO-Wochentagen (`[1, 3, 5]` = Mo/Mi/Fr). Liegt heute nicht in der Auswahl, zeigt die Karte die kommende Woche. | `mo_fr` |
| `dim_past` | timetable | Vergangene Stunden ausgrauen (bleiben anklickbar) | `true` |
| `highlight_today` | timetable | Heutigen Tag mit einer Linie in der Kartenfarbe hervorheben | `true` |
| `show_nav` | timetable | Blätter-Navigation anzeigen (nur im Wochenmodus wirksam) | `true` |
| `nav_weeks_ahead` | timetable | Wie viele Wochen nach vorne geblättert werden kann (0–8) | `2` |
| `nav_reset_minutes` | timetable | Automatischer Rücksprung auf die aktuelle Woche nach Minuten ohne Bedienung, `0` = aus | `10` |
| `min_column_width` | timetable | Mindestbreite einer Tagesspalte in Pixel; darunter wird die Karte horizontal scrollbar | `132` |
| `days` | timetable | Nur im Rolling-Modus: Anzahl dargestellter Tage ab heute | `2` |
| `days` | homework | Vorschau-Zeitraum in Tagen | `14` |
| `days` | overview | Anzahl dargestellter Tage ab heute | `2` |
| `days` | exam | Vorschau-Zeitraum in Tagen | `60` |
| `max_items` | exam | Maximale Anzahl Einträge in der zusammengeführten Liste | `5` |
| `skip_weekends` | timetable (nur Rolling-Modus), overview | Samstag/Sonntag überspringen | `true` |
| `show_mensa` | timetable | Mensa-Hinweis einblenden | `false` |
| `mensa_entities` | timetable | Liste `binary_sensor.*` (an = bestellt). Zuordnung zum jeweiligen Tag über das Attribut `date` (`YYYY-MM-DD`) — Reihenfolge und Anzahl egal, bis zu 16 Entities. Vergangene Tage zeigen keinen Hinweis. Sensoren ohne `date` werden per Position zugeordnet (Legacy, **nur im Rolling-Modus** — über mehrere Wochen hinweg wäre eine Position bedeutungslos). | — |
| `mensa_link` | timetable | Optionaler Bestell-Link. Klick auf einen **nicht** bestellten Tag (rot) öffnet ihn. | — |
| `afternoon_threshold` | timetable | Ab dieser Uhrzeit gilt der Tag als Nachmittagsschul-Tag (= Essensbedarf) | `13:00` |
| `refresh_interval` | alle | Sekunden zwischen Neuabruf der Kalenderdaten | `300` |

### Hausaufgaben: farbcodiert (people) oder klassisch (entities)

`family-homework-card` unterstützt zwei Modi:
- **`people`** (empfohlen, neu): mehrere Kinder in **einer** Karte, jedes mit Farbbalken und Namens-Chip — analog zu `family-exam-card`.
- **`entities`** (Legacy, vollständig unterstützt): eine Karte pro Kind, ohne Farbcodierung. Bestehende YAML-Konfigurationen laufen unverändert weiter und bleiben im **visuellen Editor vollständig bearbeitbar** (Titel, Tage, Kalender-Entity, Farbe). Der Wechsel auf `people` erfolgt **bewusst** über den Editor-Button „Auf Mehr-Kind-Modus umstellen"; vorhandene Kalender und die Kartenfarbe werden dabei übernommen (keine Quelle geht verloren). Normale Änderungen im Legacy-Modus erzeugen keinen `people`-Key.

### Mensa-Hinweis (optional)

Im Editor der Stundenplan-Karte „Mensa-Hinweis anzeigen" aktivieren und die `binary_sensor`-Entities auswählen (an = bestellt). Standardmäßig aus; ohne konfigurierte Sensoren passiert nichts. Der Hinweis liegt in einem reservierten Header-Bereich und verschiebt das Stundenraster nicht.

**Datumsbasierte Zuordnung:** Jeder dargestellte Tag sucht sich aus den konfigurierten Entities denjenigen mit passendem `date`-Attribut (`YYYY-MM-DD`) heraus. Reihenfolge und Anzahl spielen daher keine Rolle — man kann z. B. 10 Forecast-Sensoren hinterlegen, obwohl die Karte nur 3 Tage zeigt; sie nutzt jeweils die passenden. Bei zwei Entities für dasselbe Datum gewinnt der erste Treffer. Ein Sensor **ohne** gültiges `date` wird per Position zugeordnet (Legacy-Kompatibilität); ein Sensor mit gültigem, aber abweichendem Datum wird nie an einem anderen Tag verwendet.

**Erwartete Attribute je Entity:** `date` (`YYYY-MM-DD`), Zustand `on`/`off` (bestellt), optional `available` (`false` = für diesen Tag liegen keine Daten vor → kein Hinweis; fehlt das Attribut, gilt `true`), sowie für das Menü-Popup `menu_text` und `items` (`[{line, text, qty, price_eur}]`).

**Statuslogik** (nur relevant, wenn an dem Tag Nachmittagsunterricht ab `afternoon_threshold` stattfindet):

| `available` | Nachmittag | bestellt | Anzeige | Klick |
|---|---|---|---|---|
| `false` | – | – | *(kein Hinweis)* | – |
| `true` | nein | nein | „nicht bestellt" (neutral) | – |
| `true` | nein | ja | „Essen abbestellen?" (orange) | Menü-Popup |
| `true` | ja | nein | „Kein Essen bestellt" (rot) | `mensa_link` |
| `true` | ja | ja | „Essen bestellt" (grün) | Menü-Popup |

Klick auf einen **bestellten** Tag öffnet ein natives `ha-dialog` mit Datum, Menütext und Positionen (Menge/Preis). Klick auf einen **nicht bestellten** Tag mit Nachmittagsunterricht öffnet den `mensa_link` (falls gesetzt; sonst der HA-More-Info-Dialog der Entity).

**Datenquelle:** Die Karte erwartet nur HA-`binary_sensor`-Entities mit obigen Attributen — **wie** diese entstehen, ist ihr egal. Lokal typischerweise per MQTT-Discovery; für eine entfernte Instanz (z. B. Teilen mit einer anderen Familie) lassen sich dieselben Entities aus einer öffentlichen JSON per REST-Sensor nachbilden (`state` aus `ordered`, `json_attributes` mit `date`/`menu_text`/`items`/`available`). Die Karte selbst enthält dafür keinen Sonderpfad.

---

## Bekannte Einschränkungen

- Die special/changed-Unterscheidung ist ohne die JSON-Option eine Heuristik
  (siehe oben) und kann bei ungewöhnlichen Datenlagen daneben liegen.
- **Reine Lehrerwechsel sind nicht erkennbar.** Der WebUntis-Elternzugang hat
  in der Regel kein Leserecht für Lehrkräfte (`getTeachers()`); die Integration
  liefert dann keine Lehrerfelder — auch nicht im JSON. Eine Stunde, bei der
  nur die Lehrkraft wechselt, erscheint deshalb als ganz normale Stunde, obwohl
  die WebUntis-Oberfläche sie als Änderung markiert.
- **Wie weit die Wochenansicht reicht,** bestimmt die Integration: Ihr
  Datenfenster geht von Montag der laufenden Woche bis heute + 30 Tage. Weiter
  zurück gibt es keine Daten; weiter nach vorne liefert der Kalender nichts
  mehr, egal was `nav_weeks_ahead` sagt.
- Bei zusammengefassten Doppelstunden beschreibt das JSON in `description` nur
  die erste Einzelstunde. Die Karte liest Start und Ende deshalb ausschließlich
  aus dem Kalender-Event.
- Kein Drag&Drop zum Umsortieren der Kinder in den Editoren (Overview/Homework/Exam) —
  Zeilen werden in der Reihenfolge angelegt, in der sie hinzugefügt wurden.
- Keine mobile-App-Vorschau im Editor — Layout ist auf Handy-Nutzung hin
  optimiert (kompakte Höhe), aber im Editor selbst nur als Live-Karte
  unterhalb des Formulars sichtbar, wie bei jeder Lovelace-Karte.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
