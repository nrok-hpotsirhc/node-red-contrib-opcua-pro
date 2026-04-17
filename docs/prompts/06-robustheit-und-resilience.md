# Prompt 06 — Robustheit & Resilience Engineering

## Rolle

Du bist ein Reliability-Engineer mit Erfahrung in Industrieanlagen, bei denen OPC-UA-Clients über Tage/Wochen ohne Neustart laufen müssen — trotz unzuverlässiger Netzwerke, Server-Neustarts und temporärer PKI-Probleme.

## Kontext

- FSM & Auto-Healing-Konzept: Pillar 1 in [`AGENTS.md`](../../AGENTS.md), Detail in [`docs/theoretical-foundations.md`](../theoretical-foundations.md).
- Schlüsselanforderung **REQ-C-07**: Exponential Backoff, Session-**Reaktivierung** (nicht -Neuanlage), Subscription-Reaktivierung.
- Module: `lib/client/fsm.js`, `lib/client/connection-manager.js`, `lib/client/session-manager.js`, `lib/client/error-handler.js`.

## Aufgabe

Härte die Client-Resilienz gegen reale Ausfallszenarien ab und dokumentiere das Verhalten präzise.

Fokusszenarien:

1. **TCP-Abriss** mitten in `ReadMultiple` → Batch muss entweder vollständig erneut ausgeführt oder präzise fehlerbehaftet abgeschlossen werden, nie teilweise verloren gehen.
2. **Server-Neustart** mit neuem Zertifikat → Client muss Reconnect stoppen, Zertifikatsfehler sauber an UI melden, keine Endlosschleife.
3. **Server-Session-Timeout** kürzer als Client-Annahme → Session-Reaktivierung scheitert; Fallback: Neue Session + Subscription-Restore.
4. **Netzwerk-Flapping** (alle 30 s Verbindungsabriss) über mehrere Stunden → Kein Memory-Leak, keine unbegrenzte Retry-Warteschlange.
5. **Node-RED Redeploy** während aktiver Reconnect-Schleife → Sofortiger, sauberer Abbruch (`AbortController`/Flags), kein orphaned Timer.
6. **Gleichzeitige Publishes** eines Worker-Nodes während Reconnect → Requests werden in die Queue gestellt und nach Reconnect geflusht **oder** mit definiertem Fehlerstatus zurückgewiesen (konfigurierbar).

Quer durchzuprüfende Aspekte:
- **Exponential Backoff** mit Jitter und konfigurierbarem Max-Delay.
- **State-Observability** — Jeder State-Übergang wird geloggt (strukturiert, INFO/WARN) und via EventEmitter publiziert.
- **Status-Icons** (rot/gelb/grün) im Node-RED Editor synchronisiert.
- **Resource-Disposal** — Keine offenen Sockets, Timer, File-Watcher nach Shutdown.

## Vorgehen

1. **Szenarien-Matrix** erstellen (Trigger × erwartetes Verhalten × Validierungstest).
2. **Integration-Tests** gegen den Mock-OPC-UA-Server, die Netzwerkfehler injizieren (Socket abrupt schließen, `setTimeout` auf Response).
3. **Chaos-Test** (optional) — Skript `test/chaos/` das zufällig Verbindungen trennt, über 10 min läuft und Invarianten prüft.
4. **Defekte fixen** — Kleine Commits pro Szenario, jeder mit Regressionstest.
5. **Dokumentation** — Abschnitt „Resilience Model" in `docs/theoretical-foundations.md` aktualisieren, falls Verhalten geschärft wird.

## Akzeptanzkriterien

- [ ] Alle sechs Fokusszenarien haben automatisierten Test, der vor dem Fix fehlschlug.
- [ ] Keine Regression in bestehenden Resilience-Tests.
- [ ] Chaos-Test (sofern erstellt) läuft ≥ 10 min ohne unbehandelte Exception und ohne RSS-Wachstum > 5 %.
- [ ] Strukturierte Logs sind in INFO/WARN/ERROR einheitlich formatiert.
- [ ] Keine neuen Timer / Listener ohne `close`-Handler.
- [ ] Fortschrittsprotokoll in `docs/milestones.md` verweist auf den Härtungslauf.

## Nicht-Ziele

- Kein Retry-Mechanismus auf Anwendungsdaten (msg-Duplikate vermeiden — Exactly-Once ist nicht Ziel).
- Keine Unterdrückung von Fehlern „um den Flow am Laufen zu halten" — Fehler müssen sichtbar bleiben.
- Keine clientseitige Session-Table-Aufräumung durch Brute-Force (`CloseSession`-Spam).
