# Prompt 04 — Performance & Smart-Batching-Optimierung

## Rolle

Du bist ein Performance-Engineer mit Erfahrung in Event-Loop-Optimierung, Hochdurchsatz-RPC und OPC-UA-spezifischen Muster (`ReadMultiple`, `WriteMultiple`, `MonitoredItems`, `PublishingInterval`).

## Kontext

- Smart-Batching-Scheduler ist Pillar 2 der Architektur (siehe [`AGENTS.md`](../../AGENTS.md)).
- Batching-Fenster: 5–10 ms; Fragmentierung bei Überschreitung der Server-Max-Packet-Size.
- Relevant: `lib/client/batch-scheduler.js`, `lib/client/session-manager.js`, `nodes/client/opcua-read/*`, `nodes/client/opcua-write/*`, `nodes/client/opcua-subscribe/*`.

## Aufgabe

Analysiere und verbessere die Laufzeitperformance in realistischen Szenarien (50–500 gleichzeitige Worker-Nodes, 10k Variablen, 100 msg/s).

Prüfe insbesondere:

### Batching
- Werden alle konkurrierenden Reads/Writes tatsächlich in **einen** OPC-UA-RPC verpackt?
- Ist das Zeitfenster konfigurierbar und dokumentiert?
- Greift die Fragmentierung bei `BadRequestTooLarge`/`BadResponseTooLarge`?
- Gibt es Head-of-Line-Blocking zwischen langsamen und schnellen Requests?

### Subscriptions
- Werden `MonitoredItems` bei Topologie-Änderungen inkrementell aktualisiert oder jedes Mal neu angelegt?
- Publishing-Interval + Queue-Size sind pro Abonnement konfigurierbar?
- Werden Events und DataChanges im selben Subscription-Kanal korrekt disjunkt gehandhabt?

### Event-Loop
- Keine synchronen `for`-Schleifen über > 10 k Elemente ohne `setImmediate`-Yield.
- Keine blockierenden `JSON.stringify`/`parse` auf großen Payloads ohne Stream-Alternative.
- Keine unbeabsichtigten Promise-Ketten, die zu Mikrotask-Stau führen.

### Memory
- Keine Closures halten OPC-UA-Sessions / große Payloads länger als nötig.
- `MonitoredItem`-Handler werden bei Node-Redeploy sauber entfernt (`removeListener`).
- Keine wachsenden Maps / Sets ohne TTL (z. B. Correlation-ID-Tabelle für Methoden).

## Vorgehen

1. **Benchmark-Baseline** — Erstelle (falls nicht vorhanden) ein reproduzierbares Benchmark-Skript unter `test/benchmark/` mit Mock-OPC-UA-Server. Markiere Testdaten mit `// TEST DATA`.
2. **Messen** — Latenz (p50/p95/p99), Durchsatz (ops/s), RSS-Memory, Event-Loop-Lag (`perf_hooks.monitorEventLoopDelay`).
3. **Profilieren** — `node --prof` oder `clinic.js` gegen das Benchmark; Top-10-Hotspots identifizieren.
4. **Hypothese formulieren** — Welche konkrete Änderung adressiert welchen Hotspot?
5. **Implementieren** — Eine Optimierung pro Commit.
6. **Re-Benchmark** — Verbesserung in absoluten und relativen Zahlen dokumentieren. Keine Regression bei nicht-optimierten Szenarien.

## Akzeptanzkriterien

- [ ] Benchmark-Skript reproduzierbar und in CI optional aufrufbar.
- [ ] p95-Latenz oder Durchsatz nachweislich um ≥ X % verbessert (Zielwert im Report festlegen).
- [ ] Kein Memory-Leak über 60 min Dauerlauf (RSS steigt < 5 % nach Warm-up).
- [ ] Alle bestehenden Tests grün, Coverage nicht gesunken.
- [ ] Ergebnisreport mit Vorher/Nachher-Zahlen und Erklärung der Änderungen.

## Nicht-Ziele

- Keine Mikro-Optimierungen auf Kosten der Lesbarkeit ohne Benchmark-Nachweis.
- Keine Umstellung auf Worker-Threads ohne vorherige Architektur-Entscheidung.
- Kein Caching, das OPC-UA-Datenaktualität verletzt (Consistency > Performance für Prozessdaten).
