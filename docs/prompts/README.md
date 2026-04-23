# Prompts — Qualitätssicherung & Weiterentwicklung

Diese Sammlung enthält sorgfältig formulierte Prompts, mit denen sich das Projekt **node-red-contrib-opcua-pro** in einzelnen Agent-Sessions systematisch auf Produktionsreife bringen lässt. Jeder Prompt ist eigenständig verwendbar und bezieht sich auf die Artefakte in [`docs/milestones.md`](../milestones.md), [`docs/work-packages.md`](../work-packages.md) und [`AGENTS.md`](../../AGENTS.md).

## Verwendung

1. Wähle einen Prompt passend zur aktuellen Aufgabe.
2. Kopiere den kompletten Inhalt (inkl. Kontext, Aufgabe, Vorgehen, Akzeptanzkriterien) in eine neue Agent-Session.
3. Lass den Agent zuerst den Umfang analysieren und einen Plan erstellen, bevor Code geändert wird.
4. Nach der Session: Ergebnisse in `docs/milestones.md` (Fortschrittsprotokoll) nachtragen.

## Prompt-Katalog

| Datei | Zweck | Empfohlener Einsatz |
|---|---|---|
| [01-milestone-code-review.md](./01-milestone-code-review.md) | Tiefgehender Code-Review je Meilenstein | Nach Abschluss eines Meilensteins |
| [02-refactoring-und-clean-code.md](./02-refactoring-und-clean-code.md) | Strukturelles Refactoring, Dead-Code-Entfernung | Wenn Module unübersichtlich werden |
| [03-security-audit.md](./03-security-audit.md) | Security-Review (PKI, Input-Validation, Secrets) | Vor jedem Release |
| [04-performance-und-batching.md](./04-performance-und-batching.md) | Performance-Analyse, Smart-Batching-Optimierung | Bei hohen Node-Zahlen / Latenz |
| [05-test-coverage-ausbau.md](./05-test-coverage-ausbau.md) | Test-Lücken schließen, Edge-Cases, Mock-OPC-UA | Wenn Coverage < 85 % oder nach Feature |
| [06-robustheit-und-resilience.md](./06-robustheit-und-resilience.md) | Reconnect, Fehlerpfade, Session-Reaktivierung | Nach Feldtests / Stabilitätsproblemen |
| [07-api-und-dx-review.md](./07-api-und-dx-review.md) | msg-Schema, Node-Editor-UX, Developer Experience | Vor API-Freeze / v1.0-Release |
| [08-dokumentation-und-hilfetexte.md](./08-dokumentation-und-hilfetexte.md) | Info-Sidebar, README, JSDoc, Beispiele | Vor Release / nach Feature-Abschluss |
| [09-dependency-und-supply-chain.md](./09-dependency-und-supply-chain.md) | Dependency-Updates, Audit, Lizenz-Compliance | Monatlich / vor Release |
| [10-release-checklist.md](./10-release-checklist.md) | Vollständiger Release-Prozess | Vor jedem npm publish |
| [11-neue-feature-entwicklung.md](./11-neue-feature-entwicklung.md) | Planung & TDD für neue Features | Bei jedem Feature-Request |
| [12-bugfix-und-regression.md](./12-bugfix-und-regression.md) | Ursachenanalyse, Regressionstest, Fix | Bei gemeldeten Bugs |

## Prompt-Design-Richtlinien

Alle Prompts in diesem Ordner folgen einer einheitlichen Struktur:

1. **Rolle** — Welche Perspektive soll der Agent einnehmen?
2. **Kontext** — Welche Dokumente / Dateien sind maßgeblich?
3. **Aufgabe** — Was ist konkret zu tun?
4. **Vorgehen** — Welche Schritte in welcher Reihenfolge?
5. **Akzeptanzkriterien** — Woran ist der Erfolg messbar?
6. **Nicht-Ziele** — Was soll bewusst nicht getan werden?
