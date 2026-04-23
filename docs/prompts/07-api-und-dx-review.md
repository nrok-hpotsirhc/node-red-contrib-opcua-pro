# Prompt 07 — API- & DX-Review

## Rolle

Du bist ein API-Designer / Developer-Advocate, der sich in die Lage eines Node-RED-Flow-Authors ohne OPC-UA-Vorwissen versetzt. Dein Maßstab: „Ein mittelguter Entwickler muss in 15 Minuten eine Verbindung aufbauen, einen Wert lesen und ein Schreiben auslösen können."

## Kontext

- Öffentliche API = msg-Schema (`msg.payload`, `msg.opcua`), Node-Properties, Admin-HTTP-Routen, exportierte Module in `lib/`.
- Editor-UX = HTML-Dialoge unter `nodes/*/*.html`, Address-Space-Browser, PKI-Dashboard.
- Info-Sidebar-Hilfetexte sind Teil der API-Oberfläche.

## Aufgabe

Führe einen ganzheitlichen API- und DX-Review durch und behebe Inkonsistenzen **vor** einem v1.0-Release (API-Freeze danach).

Prüfe:

### msg-Schema-Konsistenz
- Heißt der Statuscode überall gleich (`msg.opcua.statusCode`, nicht mal `status`, mal `statusCode`)?
- Zeitstempel durchgehend als ISO-String oder durchgehend als `Date`? Konvention dokumentiert?
- UDT-Payload stets als plain-JSON dekodiert, nie rohes `ByteString`?
- `msg._opcua_method_id` konsequent unterstrichen (interne Correlation-ID) und in Docs als intern markiert?

### Node-Properties
- Einheitliche Benennung (`nodeId`, nicht `node_id` vs. `nodeID`)?
- Defaults sinnvoll und sicher (SignAndEncrypt, Basic256Sha256, sinnvolles Batch-Fenster)?
- Validierung im Editor-Dialog gleichwertig zur Backend-Validierung?

### Editor-UX
- Tree-View-Browser funktioniert auch bei 10 k+ Nodes (Lazy, Pagination, Such-Filter)?
- PKI-Dashboard macht unmissverständlich klar, welche Aktion was bewirkt (Trust, Reject, Delete)?
- Status-Icons (rot/gelb/grün) mit Tooltip-Text, der den FSM-State erklärt?
- Alle sichtbaren Strings sind i18n-fähig (`RED._(...)`) — auch wenn zunächst nur DE/EN existiert?

### Admin-HTTP-Routen
- Einheitliches Präfix (`/opcua-admin/*`)?
- Konsistente Fehlerformate (`{ error: { code, message } }`)?
- Permissions via `RED.auth.needsPermission` gesetzt?

### Fehlererlebnis
- Fehlerausgaben sind actionable („Zertifikat nicht vertraut — öffne PKI-Dashboard" statt „BadCertificateUntrusted")?
- Node-Status (`node.status(...)`) spiegelt den letzten relevanten Zustand?

## Vorgehen

1. **API-Surface inventarisieren** — Tabelle aller msg-Felder, Node-Properties und HTTP-Routen; aktuelle Benennung + Soll-Benennung.
2. **Breaking-Change-Liste** erstellen; wenn möglich **non-breaking** über Aliase migrieren (Feld umbenannt, altes Feld weiterhin unterstützt + `deprecation`-Warnung).
3. **Walkthrough** — Ein leerer Node-RED-Flow, Hello-World-Szenario (Connect → Read → Write) durchspielen und jeden Reibungspunkt notieren.
4. **Umsetzung** — Kleine, atomare Commits. Jede Änderung an öffentlichem Verhalten mit Changelog-Eintrag.
5. **Docs aktualisieren** — README Quick-Start, Info-Sidebar jedes Nodes.

## Akzeptanzkriterien

- [ ] API-Surface-Tabelle liegt vor und ist committed (z. B. als Abschnitt in `docs/work-packages.md` oder eigenes `docs/api-reference.md`).
- [ ] Keine uneinheitlichen Feldnamen mehr im msg-Schema.
- [ ] Breaking Changes dokumentiert in `CHANGELOG.md` mit Migrationsleitfaden.
- [ ] Hello-World-Walkthrough ist reproduzierbar in ≤ 15 min.
- [ ] Alle Node-Dialoge lassen sich ohne JS-Fehler in der Browser-Konsole öffnen und speichern.
- [ ] i18n-Keys für alle sichtbaren Strings vorhanden (DE + EN).

## Nicht-Ziele

- Kein vollständiger Neuentwurf der Dialoge — fokussiere auf Konsistenz.
- Keine Umstellung auf ein fremdes UI-Framework (Node-RED gibt RED.* vor).
- Kein Brechen der msg-API ohne Non-Breaking-Migrationspfad über mindestens eine Minor-Version.
