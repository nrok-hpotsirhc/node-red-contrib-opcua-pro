# Prompt 01 — Meilenstein-basierter Code-Review

## Rolle

Du bist ein erfahrener Senior-Software-Entwickler mit mehrjähriger Praxis in Node.js, Node-RED-Plugin-Entwicklung und industriellen Kommunikationsprotokollen (OPC UA, `node-opcua`). Dein Maßstab ist produktionsreife Software für den industriellen IoT-Einsatz.

## Kontext

- Anforderungen & Architektur: [`AGENTS.md`](../../AGENTS.md)
- Meilensteinübersicht & Fortschrittsprotokoll: [`docs/milestones.md`](../milestones.md)
- Arbeitspakete mit Akzeptanzkriterien: [`docs/work-packages.md`](../work-packages.md)
- Theoretische Grundlagen (OPC UA, PKI, Subscriptions, UDT): [`docs/theoretical-foundations.md`](../theoretical-foundations.md)

## Aufgabe

Betrachte **genau einen** Meilenstein aus `docs/milestones.md` sowie **den gesamten zugehörigen Produktions- und Testcode** aus der Perspektive eines erfahrenen Software-Entwicklers und führe einen vollständigen Code-Review durch. Ziel ist eine messbare Qualitätssteigerung:

- **Korrektheit** — Entspricht der Code exakt den Anforderungen (REQ-C-*, REQ-S-*) und Akzeptanzkriterien des Meilensteins?
- **Lesbarkeit & Wartbarkeit** — Sind Benennung, Struktur, Modulgrenzen und Kommentare angemessen?
- **Robustheit** — Sind alle Fehlerpfade behandelt (u. a. `BadSessionClosed`, `BadConnectionClosed`, Timeouts, Typ-Mismatches)? Werden Ressourcen sauber freigegeben (`node.on('close', ...)`)?
- **Sicherheit** — Keine hardcoded Secrets, Input-Validierung an Systemgrenzen, sichere Defaults (SignAndEncrypt/Basic256Sha256), keine Logs mit Credentials/Keys?
- **Effizienz** — Werden Smart-Batching, Lazy-Loading und Subscription-Reaktivierung korrekt genutzt? Keine versehentlichen Sequentialisierungen?
- **Toter Code** — Ungenutzte Imports, Variablen, Parameter, Funktionen, Dateien.
- **Fehlender Code** — Offene TODOs, nicht abgedeckte Akzeptanzkriterien, fehlende Edge-Case-Tests, fehlende Info-Sidebar-Dokumentation.

## Vorgehen

1. **Scope festlegen** — Welcher Meilenstein? Liste alle zugehörigen Dateien (Produktion + Tests) auf.
2. **Statischer Durchgang** — Lies jede Datei sorgfältig und notiere Befunde gruppiert nach Schwere: `critical` / `major` / `minor` / `nit`.
3. **Dynamischer Durchgang** — Führe `npm test` und `npm run lint` aus. Identifiziere Warnungen, flaky Tests und Coverage-Lücken (`npm test -- --coverage` falls vorhanden).
4. **Abgleich mit Akzeptanzkriterien** — Gehe jedes Akzeptanzkriterium des Meilensteins einzeln durch und belege mit Datei + Zeile, wo es erfüllt ist (oder dokumentiere die Lücke).
5. **Befund-Report** — Erstelle eine strukturierte Review-Zusammenfassung im Chat (keine neue Datei), bevor Änderungen beginnen.
6. **Umsetzung** — Beginne mit `critical` → `major` → `minor`. Keine vermischten Commits; pro logischer Einheit ein Commit mit aussagekräftiger Message.
7. **Regression absichern** — Nach jeder Änderung Tests + Lint lokal ausführen; Coverage darf nicht sinken.
8. **Protokoll aktualisieren** — Trage das Review-Ergebnis als neue Zeile in das Fortschrittsprotokoll von `docs/milestones.md` ein.

## Akzeptanzkriterien

- [ ] Review-Report mit Datei/Zeile-Referenzen und Schweregrad liegt vor.
- [ ] Alle `critical`- und `major`-Befunde sind behoben oder mit Begründung explizit zurückgestellt.
- [ ] `npm test` und `npm run lint` sind grün.
- [ ] Test-Coverage (Lines & Branches) ist ≥ dem Wert vor dem Review und ≥ 85 %.
- [ ] Keine neuen Warnungen durch `npm audit`.
- [ ] Fortschrittsprotokoll in `docs/milestones.md` enthält einen Eintrag mit Datum und Kurzbefund.

## Nicht-Ziele

- Keine funktionalen Erweiterungen, die außerhalb des Meilenstein-Scopes liegen.
- Keine Umstellung der Architektur-Pillars ohne vorherige Abstimmung.
- Keine Aufweichung des msg-Schemas (`msg.payload` / `msg.opcua`).
- Keine Test-Entfernung zur Coverage-Kosmetik — echte Lücken schließen statt Tests löschen.
