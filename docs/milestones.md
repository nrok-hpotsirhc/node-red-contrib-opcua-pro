# Meilensteine — OPC UA Node-RED Open-Source Node

Dieses Dokument gruppiert alle Arbeitspakete in Meilensteine, die jeweils innerhalb einer Agent-Session vollständig implementierbar sind. Jeder Meilenstein ist in sich abgeschlossen und liefert lauffähige, getestete Software.

**Basis:** [docs/work-packages.md](./work-packages.md)  
**Anforderungen:** [AGENTS.md](../AGENTS.md#requirements-catalog)

---

## Übersicht

| Meilenstein | Inhalt | WPs | Status |
|---|---|---|---|
| [M1 — Foundation](#m1--foundation) | Node-RED Package, FSM, Config Nodes (Client + Server) | WP-C-1, WP-S-1 | ✅ Abgeschlossen |
| [M2 — Resilience & Core Data](#m2--resilience--core-data) | Reconnect, Batching, Read/Write/Subscribe | WP-C-2, WP-C-3 | ✅ Abgeschlossen |
| [M3 — Server Address Space](#m3--server-address-space) | Folder/Variable Nodes, Context Bridge | WP-S-2, WP-S-3 | ✅ Abgeschlossen |
| [M4 — RPC & Methods](#m4--rpc--methods) | Client Method-Call, Server-seitige Methoden mit Correlation-ID | WP-C-3 (Method), WP-S-4 | ✅ Abgeschlossen |
| [M5 — Visual UX & Security](#m5--visual-ux--security) | Address Space Browser, PKI Dashboard, Server-Zertifikate | WP-C-4, WP-C-5, WP-S-5 | ✅ Abgeschlossen |
| [M6 — Quality & Release](#m6--quality--release) | CI/CD, Coverage ≥ 85%, Dokumentation, npm publish | WP-C-6 | ✅ Abgeschlossen |
| [M7 — Server Configuration Comfort](#m7--server-configuration-comfort) | Security-/Auth-UI, Server-Identität, Ressourcen-Limits, erweiterte Variablen-Attribute | WP-S-6, WP-S-7 | ✅ Erledigt |
| [M8 — Visual Server Modeling](#m8--visual-server-modeling) | Inline Address-Space-Editor, CSV/JSON-Bulk-Import, Variablen-Templates | WP-S-8 | ⬜ Offen |
| [M9 — Server Runtime Dashboard](#m9--server-runtime-dashboard) | Live-Sessions/Subscriptions, Uptime, Event-Log, manueller Neustart | WP-S-9 | ⬜ Offen |
| [M10 — Advanced OPC UA (Historian, A&C)](#m10--advanced-opc-ua-historian-ac) | Historical Access, Events & Alarms, Auditing | WP-S-10, WP-S-11 | ⬜ Offen |

---

## Fortschrittsprotokoll

| Meilenstein | Session-Datum | Ergebnis |
|---|---|---|
| M1 | 2026-04-15 | HTML-Dialoge, Session-Manager Skeleton erstellt |
| M1 | 2026-07-15 | FSM in `lib/client/fsm.js` extrahiert, 21 Unit-Tests grün, hexy-Override, Commit `73dfbea` |
| M2 | 2026-04-15 | Error Handler, Connection Manager, Session Manager mit Subscription-Reactivation, opcua-read/write/subscribe vollständig implementiert, 186 Tests grün |
| M3 | 2026-04-15 | `opcua-folder`/`opcua-variable` vervollständigt, Context-Bridge Typprüfung (`BadTypeMismatch`), NodeSet-Import im Server-Config, Sample-NodeSet ergänzt, 189 Tests grün |
| M4 | 2026-04-16 | opcua-method (Client), opcua-server-method, opcua-method-response vollständig implementiert, Correlation-ID Pattern, Timeout-Cleanup, Integration-Tests, 325 Tests grün |
| M5 | 2026-04-16 | Browse-Route, PKI-Manager (Client+Server), Security Dashboard UI, Auto-Zertifikatsgenerierung, Address Space Browser mit Lazy Loading, Server PKI Routes, 363 Tests grün |
| M6 | 2026-04-16 | ESLint-Konfiguration, 423 Tests grün, 90%+ Coverage (Lines/Branches), CHANGELOG.md, .npmignore, npm audit 0 Vulnerabilities, alle Lint-Errors behoben |
| M6 | 2026-04-16 | GitHub Actions CI vollständig, Coverage 87% Lines/85% Branches/95% Functions, alle Info-Sidebar-Hilfetexte, CHANGELOG.md, .npmignore, npm pack validiert, 386 Tests grün |

---

## M1 — Foundation

**Ziel:** Das Node-RED Package ist installierbar. Client-Config-Node und Server-Config-Node funktionieren mit vollständigem Lifecycle (connect, disconnect, redeploy). FSM ist vollständig getestet.

**WPs:** WP-C-1, WP-S-1  
**Status:** ✅ Abgeschlossen (2026-04-15)

### Enthaltene Deliverables

| Deliverable | Datei | Status |
|---|---|---|
| npm-Paketstruktur | `package.json` | ✅ |
| Apache 2.0 Lizenz | `LICENSE` | ✅ |
| FSM Backend | `nodes/client/opcua-client-config/opcua-client-config.js` | ✅ |
| Config-Node HTML-Dialog | `nodes/client/opcua-client-config/opcua-client-config.html` | ✅ |
| FSM Unit-Tests | `nodes/client/opcua-client-config/opcua-client-config.test.js` | ✅ |
| Server-Config Backend | `nodes/server/opcua-server-config/opcua-server-config.js` | ✅ |
| Server-Config HTML-Dialog | `nodes/server/opcua-server-config/opcua-server-config.html` | ✅ |
| Server Lifecycle Tests | `nodes/server/opcua-server-config/opcua-server-config.test.js` | ✅ |
| Session-Manager Skeleton | `lib/client/session-manager.js` | ✅ |

### Akzeptanzkriterien M1

- [x] `npm install` ohne Fehler
- [x] Node-RED erkennt alle registrierten Nodes (kein `Error: Cannot find module`)
- [x] Alle 6 FSM-Zustände per Unit-Test erreichbar
- [x] Ungültige FSM-Übergänge werfen Exception
- [x] Server startet und stoppt ohne Port-Konflikt (doppelter Deploy)
- [x] Credentials werden verschlüsselt gespeichert

---

## M2 — Resilience & Core Data

**Ziel:** Vollständige Reconnect-Logik mit Session Re-Establishment. Alle lesenden/schreibenden Worker-Nodes mit Smart Batching. UDT-Deserialisierung. End-to-End-Datenfluss gegen Mock-Server nachgewiesen.

**WPs:** WP-C-2, WP-C-3 (Read, Write, Subscribe)  
**Status:** ✅ Abgeschlossen (2026-04-15)

### Enthaltene Deliverables

| Deliverable | Datei | Status |
|---|---|---|
| Connection Manager (Backoff) | `lib/client/connection-manager.js` | ✅ |
| Session Manager (Re-Establishment) | `lib/client/session-manager.js` | ✅ |
| Error Handler (OPC UA Codes) | `lib/client/error-handler.js` | ✅ |
| Batch Scheduler (vollständig) | `lib/client/batch-scheduler.js` | ✅ |
| UDT Deserializer (vollständig) | `lib/client/udt-deserializer.js` | ✅ |
| opcua-read (vollständig) | `nodes/client/opcua-read/opcua-read.js` | ✅ |
| opcua-read HTML | `nodes/client/opcua-read/opcua-read.html` | ✅ |
| opcua-write (vollständig) | `nodes/client/opcua-write/opcua-write.js` | ✅ |
| opcua-write HTML | `nodes/client/opcua-write/opcua-write.html` | ✅ |
| opcua-subscribe (vollständig) | `nodes/client/opcua-subscribe/opcua-subscribe.js` | ✅ |
| opcua-subscribe HTML | `nodes/client/opcua-subscribe/opcua-subscribe.html` | ✅ |
| Reconnect Integration-Test | `test/integration/client-reconnect.test.js` | ✅ |

### Akzeptanzkriterien M2

- [ ] 100 gleichzeitige Read-Inputs erzeugen genau 1 ReadMultipleRequest (Unit-Test)
- [ ] `msg.payload` enthält direkten Wert, kein OPC UA Wrapper-Objekt
- [ ] `msg.opcua.statusCode` ist `"Good"` / `"Bad"` / `"Uncertain"` als String
- [ ] Float32Array / Int32Array → normales JS-Array
- [ ] Netzwerkabbruch < Session-Lifetime → Session-Tabelle wächst nicht (Integration-Test)
- [ ] Subscriptions liefern nach Reconnect weiterhin Daten
- [ ] `BadTooManySessions` wird als ERROR geloggt, kein silent-fail

---

## M3 — Server Address Space

**Ziel:** Node-RED kann einen OPC UA Server mit programmatisch aufgebautem Adressraum hosten. Variablen sind bidirektional mit dem Node-RED Flow/Global-Context verknüpft. NodeSet2.xml-Import funktioniert.

**WPs:** WP-S-2, WP-S-3  
**Status:** ✅ Abgeschlossen (2026-04-15)

### Enthaltene Deliverables

| Deliverable | Datei | Status |
|---|---|---|
| opcua-folder (vollständig) | `nodes/server/opcua-folder/opcua-folder.js` + `.html` | ✅ |
| opcua-variable (vollständig) | `nodes/server/opcua-variable/opcua-variable.js` + `.html` | ✅ |
| Context Bridge (vollständig) | `lib/server/context-bridge.js` | ✅ |
| NodeSet Importer (vollständig) | `lib/server/nodeset-importer.js` | ✅ |
| Context Bridge Unit-Tests | `lib/server/context-bridge.test.js` | ✅ |
| NodeSet Importer Tests | `lib/server/nodeset-importer.test.js` | ✅ |
| Beispiel NodeSet2.xml | `test/fixtures/sample.NodeSet2.xml` | ✅ |
| Server Lifecycle Integration-Test | `test/integration/server-lifecycle.test.js` | ✅ |

### Akzeptanzkriterien M3

- [x] OPC UA Client kann Variable lesen, die per `flow.set()` gesetzt wurde
- [x] OPC UA Client schreibt Variable → `flow.get()` gibt neuen Wert zurück
- [x] Gültige NodeSet2.xml wird ohne Fehler eingelesen
- [x] Fehlerhafte NodeSet2.xml wirft Exception, Node-RED bleibt stabil
- [x] Path-Traversal-Eingaben in NodeSet-Pfad werden abgelehnt

---

## M4 — RPC & Methods

**Ziel:** Client kann OPC UA Methods aufrufen. Server kann Methoden registrieren und deren Aufruf via Correlation-ID durch den Node-RED Flow routen und beantworten.

**WPs:** WP-C-3 (opcua-method), WP-S-4  
**Status:** ✅ Abgeschlossen (2026-04-16)

### Enthaltene Deliverables

| Deliverable | Datei | Status |
|---|---|---|
| opcua-method Client (vollständig) | `nodes/client/opcua-method/opcua-method.js` + `.html` | ✅ |
| opcua-server-method (vollständig) | `nodes/server/opcua-server-method/opcua-server-method.js` + `.html` | ✅ |
| opcua-method-response (vollständig) | `nodes/server/opcua-method-response/opcua-method-response.js` + `.html` | ✅ |
| Method Call Integration-Test | `test/integration/method-call.test.js` | ✅ |

### Akzeptanzkriterien M4

- [x] OPC UA Method-Call → `msg._opcua_method_id` + `msg.payload` (Input-Args) erscheint im Flow
- [x] `opcua-method-response` liefert Ergebnis korrekt zurück
- [x] Gleichzeitige Calls werden per UUID korrekt korreliert
- [x] Timeout-Einträge werden aus der Correlation-Tabelle entfernt (kein Memory-Leak)

---

## M5 — Visual UX & Security

**Ziel:** Nutzer können NodeIds per Klick aus dem OPC UA-Baum entnehmen. PKI-Zertifikate werden über das Browser-UI verwaltet. Server validiert Client-Zertifikate und persistiert abgelehnte Certs.

**WPs:** WP-C-4, WP-C-5, WP-S-5  
**Status:** ✅ Abgeschlossen (2026-04-16)

### Enthaltene Deliverables

| Deliverable | Datei | Status |
|---|---|---|
| HTTP Browse-Route | `nodes/client/opcua-client-config/opcua-client-config.js` (Erweiterung) | ✅ |
| RED.treeList Browser UI | `nodes/client/opcua-client-config/opcua-client-config.html` (Erweiterung) | ✅ |
| Auto-Zertifikatsgenerator | `lib/client/pki-manager.js` (vollständig) | ✅ |
| PKI HTTP-Routen (list/trust) | `nodes/client/opcua-client-config/opcua-client-config.js` (Erweiterung) | ✅ |
| Security Dashboard HTML | `nodes/client/opcua-client-config/opcua-client-config.html` (Erweiterung) | ✅ |
| Server PKI Manager | `lib/server/pki-manager.js` | ✅ |
| Browse-Route Unit-Tests | `nodes/client/opcua-client-config/browse-route.test.js` | ✅ |
| PKI Unit-Tests (Client) | `lib/client/pki-manager.test.js` (erweitert) | ✅ |
| PKI Unit-Tests (Server) | `lib/server/pki-manager.test.js` | ✅ |
| Browse-Buttons in Worker-Nodes | `opcua-read/write/subscribe/method .html` | ✅ |
| Server PKI Dashboard | `nodes/server/opcua-server-config/opcua-server-config.html` (Erweiterung) | ✅ |
| Server PKI HTTP-Routen | `nodes/server/opcua-server-config/opcua-server-config.js` (Erweiterung) | ✅ |

### Akzeptanzkriterien M5

- [x] Browse-Route antwortet < 2 s für Server mit 10.000 Knoten
- [x] Klick auf Variable trägt NodeId in Eingabefeld ein
- [x] Lazy Loading: Kinder erst bei Aufklappen geladen
- [x] Path-Traversal in Browse-NodeId abgelehnt
- [x] `fs.renameSync` (atomar) für Trust-Operation — kein copyFile+unlink
- [x] Dateiname-Validierung in Trust-Route verhindert Path-Traversal

---

## M6 — Quality & Release

**Ziel:** Alle Tests grün, Coverage ≥ 85%, Dokumentation vollständig. Paket ist bereit für `npm publish`.

**WPs:** WP-C-6  
**Status:** ✅ Abgeschlossen (2026-04-16)

### Enthaltene Deliverables

| Deliverable | Datei | Status |
|---|---|---|
| GitHub Actions CI vollständig | `.github/workflows/ci.yml` | ✅ |
| Coverage ≥ 85% nachgewiesen | `coverage/` Report | ✅ (90%+ Lines, 90%+ Branches) |
| Node-RED Info Sidebar für alle Nodes | Alle `.html`-Dateien | ✅ |
| CHANGELOG.md | `CHANGELOG.md` | ✅ |
| ESLint-Konfiguration | `.eslintrc.json` | ✅ |
| Coverage ≥ 85% nachgewiesen | `coverage/` Report | ✅ |
| Node-RED Info Sidebar für alle Nodes | Alle `.html`-Dateien | ✅ |
| CHANGELOG.md | `CHANGELOG.md` | ✅ |
| npm Publish-Vorbereitung | `package.json`, `.npmignore` | ✅ |

### Akzeptanzkriterien M6

- [x] `npm test` läuft ohne externen OPC UA Server
- [x] Coverage ≥ 85% Lines, Functions; ≥ 80% Branches
- [x] `npm audit` meldet keine High/Critical Vulnerabilities
- [x] Jeder Node hat Info-Sidebar Hilfetext
- [x] `npm pack` erzeugt valides `.tgz` ohne `node_modules`

---

## M7 — Server Configuration Comfort

**Ziel:** Der `opcua-server-config` Node kann produktionsnahe Server komplett über die UI konfigurieren — Security-Policies, Authentifizierungsmodi, Server-Identität, Ressourcen-Limits und erweiterte Variablen-Attribute. Kein Editieren von Code oder `settings.js` mehr nötig.

**WPs:** WP-S-6, WP-S-7  
**Status:** ⬜ Offen

### Enthaltene Deliverables

| Deliverable | Datei | Status |
|---|---|---|
| Security-Policy-Multi-Select (None/Basic128Rsa15/Basic256/Basic256Sha256/Aes128_Sha256_RsaOaep/Aes256_Sha256_RsaPss) | `nodes/server/opcua-server-config/opcua-server-config.html` | ⬜ |
| Security-Mode-Multi-Select (None/Sign/SignAndEncrypt) | idem | ⬜ |
| Auth-Modi (Anonymous, Username, X509) + `allowAnonymous`-Toggle | idem | ⬜ |
| User-Manager mit editierbarer Liste (Username/Passwort, optional Rolle) | `lib/server/user-manager.js` + UI | ⬜ |
| Server-Identität: `applicationUri`, `manufacturerName`, `softwareVersion`, `buildNumber` | Server-Config | ⬜ |
| Ressourcen-Limits: `maxSessions`, `maxSubscriptions`, `maxMonitoredItems`, `sessionTimeout` | Server-Config | ⬜ |
| Endpoint-URL-Preview + Copy-to-Clipboard | Server-Config HTML | ⬜ |
| Server-Zertifikat-Download-Button (`.der`) | Server-Config HTML + Route | ⬜ |
| Erweiterte Variablen-Attribute: `accessLevel`, `userAccessLevel`, `historizing`, `valueRank`, EURange, EngineeringUnits | `nodes/server/opcua-variable/` | ⬜ |
| Unit-Tests für User-Manager und erweiterte Variablen-Attribute | `lib/server/user-manager.test.js`, `opcua-variable.test.js` | ⬜ |

### Akzeptanzkriterien M7

- [ ] Mindestens zwei Endpoint-Security-Kombinationen gleichzeitig aktivierbar
- [ ] `allowAnonymous=false` → anonymer Client wird abgewiesen (Integration-Test)
- [ ] Username/Passwort-Login funktioniert Ende-zu-Ende (Integration-Test)
- [ ] `sessionTimeout`, `maxSessions` werden an `OPCUAServer`-Options durchgereicht
- [ ] Passwörter werden als Node-RED Credentials verschlüsselt gespeichert, nicht in `flows.json` im Klartext
- [ ] Variable mit `accessLevel=CurrentRead` lehnt Schreibzugriff mit `BadUserAccessDenied` ab
- [ ] Variable mit `historizing=true` wird im Server-Metadaten-Attribut `AccessLevelEx` korrekt gekennzeichnet
- [ ] Server-Zertifikat-Download liefert exakt die Datei aus `PKI/own/certs/`

---

## M8 — Visual Server Modeling

**Ziel:** Nutzer können Adressräume mit Dutzenden bis Hunderten Variablen bequem modellieren — per Inline-Tree-Editor im Server-Config-Dialog und per CSV/JSON-Bulk-Import. Variablen-Templates reduzieren Wiederholungen.

**WPs:** WP-S-8  
**Status:** ⬜ Offen

### Enthaltene Deliverables

| Deliverable | Datei | Status |
|---|---|---|
| Inline Address-Space-Editor (`RED.treeList` basiert, editierbar) | `nodes/server/opcua-server-config/opcua-server-config.html` | ⬜ |
| Persistenz des Tree-Models in Server-Config-Node-Properties | Server-Config Backend | ⬜ |
| CSV-Import (Spalten: path, browseName, dataType, defaultValue, contextKey, accessLevel) | `lib/server/bulk-import.js` | ⬜ |
| JSON-Import (gleicher Schema-Vorrat) | idem | ⬜ |
| Variablen-Template-System (wiederverwendbare Struktur-Definition) | `lib/server/variable-template.js` | ⬜ |
| Export der aktuellen Laufzeit-Struktur als JSON | HTTP-Route + UI-Button | ⬜ |
| Unit-Tests für Bulk-Import und Template-Expansion | `lib/server/bulk-import.test.js`, `variable-template.test.js` | ⬜ |

### Akzeptanzkriterien M8

- [ ] Import einer CSV mit 1000 Tags erzeugt 1000 Variablen ohne manuelles Wiring
- [ ] Ungültige Zeilen werden mit Zeilennummer und Fehlergrund gemeldet, Import bricht nicht ab
- [ ] Tree-Editor speichert Änderungen in den Node-RED-Flow (persistent über Redeploy)
- [ ] Template-basierte Variable wird bei Template-Änderung automatisch aktualisiert
- [ ] Export-JSON kann wieder importiert werden (Round-Trip verlustfrei)
- [ ] Doppelter `browseName` innerhalb desselben Parents wird beim Import abgewiesen

---

## M9 — Server Runtime Dashboard

**Ziel:** Betreiber sehen jederzeit den Zustand des laufenden Servers — aktive Sessions, Subscriptions, Uptime, Event-Log — direkt im Node-RED Editor. Manueller Server-Neustart ohne Redeploy möglich.

**WPs:** WP-S-9  
**Status:** ⬜ Offen

### Enthaltene Deliverables

| Deliverable | Datei | Status |
|---|---|---|
| Server-Diagnostics-Collector (Uptime, Session-/Subscription-Count, Read/Write/Call-Counter) | `lib/server/diagnostics.js` | ⬜ |
| HTTP-Routen `GET /opcua-admin/server-status`, `GET /opcua-admin/server-sessions` | Server-Config | ⬜ |
| Live-Status-Panel im Server-Config-Dialog mit Auto-Refresh | Server-Config HTML | ⬜ |
| Event-Log-Ring-Buffer (letzte 200 Server-Events, clientseitig abrufbar) | `lib/server/event-log.js` | ⬜ |
| Manueller Restart-Button (`POST /opcua-admin/server-restart`) | Server-Config | ⬜ |
| `opcua-server-diagnostics` Node (emittiert msg auf Session-Connect/Disconnect/Fehler) | `nodes/server/opcua-server-diagnostics/` | ⬜ |
| Unit-Tests für Diagnostics + Event-Log | `lib/server/diagnostics.test.js`, `event-log.test.js` | ⬜ |

### Akzeptanzkriterien M9

- [ ] Status-Panel zeigt Uptime und aktive Session-Anzahl mit ≤ 2 s Latenz
- [ ] Restart-Button stoppt und startet den Server sauber (kein EADDRINUSE)
- [ ] `opcua-server-diagnostics` emittiert `msg.payload.event = "sessionCreated"` bei Client-Connect
- [ ] Event-Log enthält keine sensiblen Daten (keine Credentials, keine Zertifikat-Inhalte)
- [ ] Diagnostics-Routen sind durch `RED.auth.needsPermission('opcua-server-config.read')` geschützt

---

## M10 — Advanced OPC UA (Historian, A&C)

**Ziel:** Server unterstützt die OPC UA Services Historical Access (HA) und Alarms & Conditions (A&C). Für Industrie-Projekte mit Audit-Pflicht und Alarmmanagement relevant.

**WPs:** WP-S-10, WP-S-11  
**Status:** ⬜ Offen

### Enthaltene Deliverables

| Deliverable | Datei | Status |
|---|---|---|
| Historian-Backend (in-memory Ring-Buffer, pluggable Storage-Interface) | `lib/server/historian.js` | ⬜ |
| `opcua-variable` mit `historizing=true` schreibt automatisch in den Historian | `opcua-variable.js` | ⬜ |
| `HistoryRead`-Service-Unterstützung (Raw, Processed) | Server-Config Integration | ⬜ |
| Disk-persistenter Historian-Storage (optional, JSON-Line-Files pro Tag) | `lib/server/historian-disk.js` | ⬜ |
| `opcua-event` Node (Event-Emitter-Node für A&C) | `nodes/server/opcua-event/` | ⬜ |
| A&C: `ConditionType`, `AlarmConditionType`, `acknowledge`/`confirm` | `lib/server/alarm-manager.js` | ⬜ |
| Auditing: Session- und Write-Events als OPC UA Events | `lib/server/audit.js` | ⬜ |
| Integration-Tests für HA-Read und Alarm-Generierung | `test/integration/historian.test.js`, `alarms.test.js` | ⬜ |

### Akzeptanzkriterien M10

- [ ] Historizing-Variable liefert bei `HistoryRead` die letzten N Werte mit korrekten Timestamps
- [ ] Ring-Buffer respektiert konfigurierbares Limit (Default 10 000 Samples pro Variable)
- [ ] Alarm mit `Severity > 500` erzeugt OPC UA Event, das von einem OPC UA Client empfangbar ist
- [ ] `Acknowledge` auf Condition ändert State korrekt (`Acked=true`)
- [ ] Audit-Events enthalten keine Credentials, aber Username und Session-Id des Auslösers

---

## Session-Leitfaden für Agents

**Vor jeder Session:**
1. Lies dieses Dokument — finde den ersten Meilenstein mit Status `⬜ Offen`
2. Lies [docs/work-packages.md](./work-packages.md) für die vollständige technische Ausarbeitung des Meilensteins
3. Lies [docs/theoretical-foundations.md](./theoretical-foundations.md) für relevante Protokoll-Grundlagen (Kapitel-Referenzen stehen in den WPs)
4. Prüfe den aktuellen Code-Stand der betroffenen Dateien

**Während der Session:**
- Implementiere alle Deliverables des Meilensteins
- Schreibe Tests parallel zur Implementierung (TDD)
- Führe nach jeder Datei `npm test` aus und prüfe auf Fehler

**Nach der Session:**
1. Alle Akzeptanzkriterien des Meilensteins abhaken
2. Status in der Übersichtstabelle auf `✅ Abgeschlossen` setzen
3. Datum ins Fortschrittsprotokoll eintragen
4. `git add . ; git commit -m "feat(MX): ..."` ausführen

---

## Abhängigkeiten zwischen Meilensteinen

```
M1 (Foundation)
  └──► M2 (Resilience & Core Data)
         └──► M4 (RPC & Methods)
         └──► M5 (Visual UX & Security) ◄── M1 (auch direkt)
M1 (Foundation)
  └──► M3 (Server Address Space)
         └──► M4 (RPC & Methods)
M2 + M3 + M4 + M5
  └──────────────► M6 (Quality & Release)

M1 + M3 + M5
  └──────────────► M7 (Server Configuration Comfort)
                     └──► M8 (Visual Server Modeling)
                            └──► M9 (Server Runtime Dashboard)
                                   └──► M10 (Advanced OPC UA — Historian, A&C)
```

**Kritischer Pfad:** M1 → M2 → M4 → M6  
**Server-Komfort-Pfad:** M1 → M3 → M5 → M7 → M8 → M9 → M10
