# Prompt 02 — Refactoring & Clean Code

## Rolle

Du bist ein Senior-Entwickler mit Fokus auf Clean Code, SOLID-Prinzipien und Node.js-typische Idiome. Du respektierst bestehende Architektur-Entscheidungen (siehe [`AGENTS.md`](../../AGENTS.md) → *Architecture Overview*), verbesserst aber Struktur und Lesbarkeit innerhalb dieser Grenzen.

## Kontext

- Die drei Architektur-Pillars (Config-Node / Smart-Batching-Scheduler / Editor-UX) sind **nicht verhandelbar**.
- Das msg-Schema (`msg.payload` + `msg.opcua`) ist öffentliche API.
- Code liegt in `nodes/client/*`, `nodes/server/*`, `lib/client/*`, `lib/server/*`.

## Aufgabe

Refaktoriere ein abgegrenztes Modul oder eine Node-Familie mit dem Ziel, **Wartbarkeit und Lesbarkeit** zu erhöhen, ohne Verhalten oder API zu verändern.

Prüfe dabei systematisch:

- **Funktionslänge & zyklomatische Komplexität** — Funktionen > 40 Zeilen oder mit tief verschachtelten Bedingungen aufteilen (Guard-Clauses, Early-Return).
- **Duplikate** — Wiederkehrende Muster (z. B. Statuscode-Mapping, UDT-Dekodierung, Correlation-ID-Handling) in gemeinsame Helper in `lib/` extrahieren.
- **Benennung** — Variablen/Funktionen sollen ihre Absicht ausdrücken (`resolveNodeId` statt `doNodeId`).
- **Magische Werte** — Konstanten (Timeouts, Retry-Delays, Batching-Fenster) benennen und an einem Ort bündeln.
- **Toter Code** — Ungenutzte Branches, `console.log`-Reste, auskommentierter Code, nicht erreichte `catch`-Zweige.
- **Asynchronität** — Konsistente Nutzung von `async`/`await`; keine verlorenen Promises, kein ungenutztes `.then()`-Mix.
- **Trennung der Belange** — UI-Logik gehört nicht ins Backend und umgekehrt; Node-Definition sollte dünn bleiben, Business-Logik in `lib/`.

## Vorgehen

1. **Scope klären** — Genau ein Modul/Verzeichnis pro Session.
2. **Ist-Analyse** — Baum der betroffenen Dateien, öffentliche API-Oberfläche, aufrufende Module identifizieren.
3. **Tests absichern** — Vor Refactoring `npm test` grün und Coverage notieren. Ergänze Charakterisierungstests für jedes Verhalten, das noch nicht abgedeckt ist, **bevor** du Code bewegst.
4. **Kleine Schritte** — Jede einzelne Umbenennung / Extraktion als eigener Commit. Nach jedem Schritt Tests grün.
5. **Keine API-Änderungen** — Weder msg-Schema, noch Node-Properties, noch exportierte Funktionen ohne Ankündigung.
6. **Diff-Review** — Prüfe abschließend den Gesamtdiff: enthält er ausschließlich strukturelle Änderungen?

## Akzeptanzkriterien

- [ ] Alle Tests grün; Coverage mindestens gleich (besser: gestiegen).
- [ ] Lint ohne neue Warnungen.
- [ ] Öffentliche API (msg-Schema, Node-Properties, exportierte Helper) unverändert.
- [ ] Keine Funktion > 60 Zeilen ohne gute Begründung (`// TEST DATA`-Fixtures ausgenommen).
- [ ] Keine Duplikate der vorher identifizierten Muster mehr.
- [ ] Commit-Historie ist atomar und nachvollziehbar.

## Nicht-Ziele

- Kein „Big-Bang"-Refactoring über mehrere Module gleichzeitig.
- Keine Einführung neuer Libraries nur für Syntax-Zucker.
- Keine Umstellung zwischen CommonJS/ESM in dieser Session.
- Keine Änderung von Testdaten, die mit `// TEST DATA` markiert sind, außer zur reinen Umbenennung.
