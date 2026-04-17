# Prompt 03 — Security Audit

## Rolle

Du bist ein Security-Engineer mit Schwerpunkt auf industrieller Kommunikation, PKI und Node.js-Supply-Chain-Risiken. Dein Maßstab ist OWASP ASVS Level 2 sowie die OPC-UA-spezifischen Sicherheitsanforderungen (Basic256Sha256, SignAndEncrypt, Zertifikatsvalidierung).

## Kontext

- Sicherheitsanforderungen: [`AGENTS.md`](../../AGENTS.md) → *Security Requirements*
- PKI-Konzept & Dashboard: WP-C-5 / WP-S-5 in [`docs/work-packages.md`](../work-packages.md)
- Relevante Module: `lib/client/pki-manager.js`, `lib/server/pki-manager.js`, alle HTTP-Admin-Routen (`RED.httpAdmin`), Config-Node-Dialoge, Credential-Handling.

## Aufgabe

Führe einen vollständigen Security-Audit durch und behebe gefundene Schwachstellen. Fokus:

### Kryptografie & PKI
- Ist der Default `SecurityMode = SignAndEncrypt` mit `Basic256Sha256`?
- Werden abgelehnte Zertifikate ausschließlich in `PKI/rejected/` abgelegt und erst nach expliziter User-Aktion verschoben?
- Wird `fs.rename` (atomar) statt `copyFile + unlink` verwendet?
- Ist die Schlüsselerzeugung beim ersten Start hinreichend stark (RSA ≥ 2048 bzw. ECC P-256)?
- Laufen Zertifikate mit sinnvoller Gültigkeitsdauer und Subject/SAN?

### Input-Validation
- Werden alle `NodeId`-Strings, `BrowsePath`-Parameter und Methoden-Argumente an System­grenzen validiert, bevor sie an `node-opcua` gehen?
- Sind alle Query-Parameter der `RED.httpAdmin`-Routen (`/opcua-admin/browse`, PKI-Routen) gegen Path-Traversal, Command-Injection und ReDoS abgesichert?
- Wird `JSON.parse` nur auf vertrauensvollen Quellen aufgerufen, mit Fehlerbehandlung?

### Secrets & Logging
- Keine Credentials, Private Keys, Zertifikatsinhalte, Session-Tokens oder Passwörter in Logs?
- Wird `node.credentials` korrekt genutzt (nicht im `node.context`)?
- Keine Secrets in Tests, Fixtures oder CI-Outputs?

### Zugriff & Admin-APIs
- Verwenden alle Admin-Routen `RED.auth.needsPermission(...)`?
- Sind schreibende Endpoints gegen CSRF geschützt (Node-RED liefert Standard-Mechanismen)?
- Ist die PKI-UI-Route idempotent und fehlerresistent?

### Supply Chain
- `npm audit` ohne offene High/Critical-Findings.
- Keine Dependencies mit deprecated Status ohne Ersatzplan.
- Lockfile gepflegt und konsistent.

## Vorgehen

1. **Threat Model skizzieren** — Angreifermodell (Insider, Netzwerk, bösartiger Server, bösartiger Flow-Author).
2. **Automatische Scans** — `npm audit`, ggf. `npm outdated`, Lint-Security-Regeln.
3. **Manuelle Code-Prüfung** — Gezielt nach `fs.*`, `exec*`, `require(variable)`, `eval`, `new Function`, ungeprüften Query-Parametern suchen.
4. **Findings protokollieren** — Je Finding: Schwere (`critical/high/medium/low`), Datei, Zeile, Beschreibung, vorgeschlagener Fix.
5. **Fixes umsetzen** — Beginne mit `critical/high`. Jeder Fix kriegt einen Regressionstest, der die Schwachstelle reproduziert und nach dem Fix negativ wird.
6. **Re-Scan** — `npm audit`, Tests, Lint erneut ausführen.

## Akzeptanzkriterien

- [ ] Findings-Report liegt vor (im Chat / PR-Beschreibung).
- [ ] Keine offenen `critical`- oder `high`-Findings.
- [ ] Alle Fixes durch Tests abgedeckt (positiv + negativ).
- [ ] `npm audit` = 0 High/Critical.
- [ ] Default-Konfiguration erzwingt weiterhin sichere Voreinstellungen.
- [ ] Dokumentation (`README.md`, Info-Sidebar) reflektiert Security-Defaults und Zertifikatsprozess.

## Nicht-Ziele

- Keine Aufweichung der Defaults („unsigned zulassen") zur Vereinfachung.
- Keine Implementierung neuer Crypto-Primitives — ausschließlich geprüfte Bibliotheken (`node-opcua`, Node-Core `crypto`).
- Keine Entfernung von Zertifikatsprüfungen „für Dev-Zwecke".
