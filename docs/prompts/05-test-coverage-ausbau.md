# Prompt 05 — Test-Coverage & Edge-Cases

## Rolle

Du bist ein Test-Engineer mit TDD-Erfahrung, der Mocha/Jest, Sinon/Mocks und Integration mit einem eingebetteten `node-opcua`-Mock-Server beherrscht.

## Kontext

- Test-Konventionen & Mock-Setup: [`docs/testing.md`](../testing.md) und [`AGENTS.md`](../../AGENTS.md) → *Testing Conventions*
- Mindest-Coverage: **85 % Lines & Branches**; Ziel ≥ 90 %.
- Alle Testdaten werden mit `// TEST DATA` markiert (grep-bar, entfernbar).
- Tests liegen neben dem Code (`*.test.js`) oder unter `test/`.

## Aufgabe

Identifiziere und schließe Test-Lücken im ausgewählten Modul/Meilenstein und härte bestehende Tests gegen Flakiness.

Prüfe:

### Coverage-Lücken
- Welche Branches / Funktionen sind gemäß `npm test -- --coverage` unter 85 %?
- Welche Fehlerpfade (`catch`-Blöcke, Timeouts, `BadTypeMismatch`, `BadSessionClosed`, `BadConnectionClosed`) sind nicht abgedeckt?
- Sind UDT-Dekodierung (verschachtelte ExtensionObjects) und NodeSet2-Import mit malformed XML getestet?

### Edge-Cases (Pflicht)
- Unerwartete Verbindungsabbrüche mitten in einem Batch.
- Gleichzeitige Redeploys (Stresstest: 10× `on('close')` in schneller Folge).
- Server mit ungewöhnlichen Max-Paket-Größen (Fragmentierung).
- Große Address Spaces (> 10 k Nodes) beim Lazy-Browse.
- Session-Reaktivierung ohne Server-seitigen Session-Table-Wuchs (Integration-Test).
- Timeouts bei Method-Calls → Correlation-ID-Tabelle muss aufgeräumt werden.
- Zertifikats-Trust/Reject während laufender Verbindung.

### Qualität der Tests
- Keine Abhängigkeit von Timing (`setTimeout` in Tests → besser `sinon.useFakeTimers()`).
- Kein geteilter Zustand zwischen Tests (jeder `describe` isoliert).
- Mock-Server wird in `before(Each)`/`after(All)` sauber hoch- und runtergefahren.
- Assertions sind aussagekräftig (nicht nur `assert(result)`).

## Vorgehen

1. **Coverage-Report** erzeugen und Lücken priorisieren (nach Risiko × Auftretenshäufigkeit).
2. **Edge-Case-Liste** pro Modul anlegen (aus der Pflichtliste + eigenen Ideen).
3. **Red-Green-Refactor** — Zuerst Test schreiben, der fehlschlägt; dann Code ergänzen/fixen; dann refaktorieren.
4. **Flaky Tests entflackern** — Fake-Timer, deterministische Seeds, keine echten Netzwerkports (Mock-Server auf Port 0 / random).
5. **Performance der Suite beobachten** — Suite soll weiterhin in < 60 s durchlaufen.

## Akzeptanzkriterien

- [ ] Coverage (Lines & Branches) ≥ 85 % gesamt und ≥ 80 % pro Datei.
- [ ] Alle Pflicht-Edge-Cases haben mindestens einen Test.
- [ ] Keine `this.skip()` / `.only` / `.skip` im Commit.
- [ ] Alle Testdaten mit `// TEST DATA` markiert.
- [ ] Suite-Laufzeit ≤ 60 s auf CI.
- [ ] Keine neuen flaky Tests (dreimaliger CI-Lauf stabil).

## Nicht-Ziele

- Keine Tests auf private Implementierungsdetails (Refactoring-fest bleiben).
- Keine Snapshot-Tests ohne semantische Assertion.
- Keine gegenseitigen Mocks zwischen Modulen, die das Verhalten nur oberflächlich nachstellen.
- Kein Coverage-Kosmetik durch `/* istanbul ignore */` ohne Begründungskommentar.
