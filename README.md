# Family School Cards

Drei Lovelace-Karten für Home Assistant, die WebUntis-Stundenpläne (über die
Integration [`JonasJoKuJonas/homeassistant-WebUntis`](https://github.com/JonasJoKuJonas/homeassistant-WebUntis))
lesbar auf dem Dashboard darstellen — inklusive entfallener Stunden und
Sonderveranstaltungen (Einschulung, Klassenlehrerunterricht, Wandertag, …).

Reines Frontend-Plugin (Lovelace-Karten), **keine** Home-Assistant-Integration:
kein Python, kein Neustart bei Updates, Installation und Updates laufen über
HACS wie bei jeder anderen Custom Card.

## Enthaltene Karten

| Karte | Zweck | Für |
|---|---|---|
| `family-timetable-card` | Zeitraster-Stundenplan (heute + folgende Tage auf gemeinsamer Zeitachse) | ein Kind |
| `family-overview-card` | Kompakte "Wer muss wann los"-Balkenübersicht | mehrere Kinder |
| `family-homework-card` | Direkt lesbare Hausaufgabenliste mit klickbaren Links | ein Kind |

Für mehrere Kinder: `family-timetable-card` und `family-homework-card` je
einmal pro Kind auf dem Dashboard platzieren (über den visuellen Editor, kein
YAML nötig). `family-overview-card` ist eine einzelne Karte, in der Kinder
über "+ Kind hinzufügen" ergänzt werden.

Alle drei Karten haben einen visuellen Editor (Entity-Picker, Farbwähler,
Textfelder) — YAML-Bearbeitung bleibt über "Als YAML bearbeiten" im
Karten-Dialog weiterhin möglich.

## family-exam-card

Farbcodierte Klassenarbeiten-/Prüfungsliste für ein oder mehrere Kinder. Analog zu `family-homework-card`, aber mit einer `people`-Liste (wie bei `family-overview-card`) statt einer einzelnen Kalender-Entity: alle ausgewählten Kalender werden chronologisch zu **einer** Liste gemischt und farblich nach Kind gekennzeichnet. `max_items` begrenzt die Gesamtliste, nicht pro Kind — wer nur ein Kind einträgt, bekommt dessen nächste Arbeiten; wer mehrere einträgt, bekommt eine gemeinsame Übersicht.

Voraussetzung: Die WebUntis-Integration muss für Prüfungen/Klassenarbeiten konfiguriert sein und liefert dafür eine eigene `calendar.*_pruefungen`-Entity pro Kind (parallel zur Stundenplan- und Hausaufgaben-Entity).

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

## Voraussetzung: WebUntis-Integration

Jedes Kind braucht eine eigene Kalender-Entity aus der Integration
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

Nach dem Ändern: Integration neu laden (⋮ → Neu laden) reicht meist; falls
der Effekt ausbleibt, Home Assistant einmal neu starten.

**Nebenwirkung von `invalid_subjects`:** Es werden *alle* fachlosen Einträge
angezeigt, nicht nur die gewünschten Sonderveranstaltungen. In der Praxis war
das bisher unproblematisch, aber bei ungewöhnlichen Stundenplänen lohnt sich
ein kurzer Blick, ob unerwünschte Einträge auftauchen.

### Wie die Karte cancelled/changed/special erkennt

Die Integration liefert Kalender-Events mit einem Präfix im `summary`-Feld:

- `Cancelled: <Fach>` → **entfallen** — rot, durchgestrichen.
- `Irregular: <Fach>` **mit** Raum-Angabe (`location`) → **Vertretung/Änderung**
  (Fachwechsel, Raumwechsel, Lehrerwechsel) — orange.
- `Irregular: <Fach>` **ohne** Raum-Angabe → **Sonderveranstaltung** — gelb.

Der letzte Punkt ist eine **Heuristik**, keine echte Kategorie aus den
Rohdaten: WebUntis markiert Sonderveranstaltungen genauso als "Irregular"
wie eine normale Vertretung, liefert für sie aber praktisch nie einen Raum
(weil kein Fach zugeordnet ist). Eine echte Vertretung hatte in unseren
Tests immer einen Raum. **Bekannte Grenze:** Sollte eine Schule eine
raumlose Vertretung eintragen, würde sie fälschlich gelb statt orange
erscheinen. Bisher nicht beobachtet, aber gut zu wissen.

---

## Installation über HACS

1. HACS → Menü (⋮) → Benutzerdefinierte Repositories.
2. Repository-URL: `https://github.com/jot-koehler/family-school-cards`
   Kategorie: **Dashboard** (Lovelace-Plugin).
3. "Family School Cards" installieren.
4. HACS registriert die Ressource automatisch im Dashboard (`hacs.json` mit
   `content_in_root`). Browser-Cache leeren / hart neu laden, damit die
   Karten im Karten-Auswahldialog erscheinen.

Updates erscheinen danach wie gewohnt als HACS-Update-Badge.

## Karten hinzufügen

Im Dashboard: "Karte hinzufügen" → nach "Family Timetable", "Family
Overview" bzw. "Family Homework" suchen → Entity und Farbe im Editor
auswählen.

Beispiel-YAML (falls lieber manuell konfiguriert):

```yaml
type: custom:family-timetable-card
title: Kind A
entities:
  - calendar.webuntis_kind_a
color: "#ff9800"
days: 2

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
title: Kind A
entities:
  - calendar.webuntis_kind_a_hausaufgaben
color: "#ff9800"
days: 14
```

### Konfigurationsoptionen

| Option | Karte | Bedeutung | Default |
|---|---|---|---|
| `title` | timetable, homework | Überschrift der Karte | — |
| `entities` | timetable, homework | Liste von Kalender-Entities (i. d. R. eine) | erforderlich |
| `color` | timetable, homework, overview (pro Kind) | Akzentfarbe (Hex) | `#4fa8e0` |
| `days` | timetable | Anzahl dargestellter Tage ab heute (Wochenenden werden übersprungen) | `2` |
| `days` | homework | Vorschau-Zeitraum in Tagen | `14` |
| `days` | overview | Anzahl dargestellter Tage ab heute | `2` |
| `people` | overview | Liste `{name, entity, color}` — ein Eintrag pro Kind | erforderlich |
| `skip_weekends` | timetable, overview | Samstag/Sonntag überspringen | `true` |
| `refresh_interval` | alle | Sekunden zwischen Neuabruf der Kalenderdaten | `300` |

---

## Bekannte Einschränkungen

- Die special/changed-Unterscheidung ist eine Heuristik (siehe oben) und
  kann bei ungewöhnlichen Datenlagen daneben liegen.
- Kein Drag&Drop zum Umsortieren der Kinder im Overview-Editor — Zeilen
  werden in der Reihenfolge angelegt, in der sie hinzugefügt wurden.
- Keine mobile-App-Vorschau im Editor — Layout ist auf Handy-Nutzung hin
  optimiert (kompakte Höhe), aber im Editor selbst nur als Live-Karte
  unterhalb des Formulars sichtbar, wie bei jeder Lovelace-Karte.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
