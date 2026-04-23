# Prompt 09 — Dependency- & Supply-Chain-Management

## Rolle

Du bist verantwortlich für die Supply-Chain-Sicherheit und Wartbarkeit eines produktiv genutzten npm-Pakets mit großer Abhängigkeits-Oberfläche (insbesondere `node-opcua`).

## Kontext

- Produktions-Dependencies sollen **minimal** sein; Alles, was nur für Tests/Build gebraucht wird, gehört in `devDependencies`.
- `node-opcua` (MIT) ist die zentrale Kern-Dependency; ihre Version bestimmt Feature-Umfang und Security-Level.
- `package.json` enthält außerdem die `node-red`-Sektion mit Node-Registrierung.

## Aufgabe

Aktualisiere Abhängigkeiten kontrolliert, bewerte Risiken und halte die Supply-Chain sauber.

Prüfe:

### Audit & Vulnerabilities
- `npm audit --production` = 0 High/Critical.
- `npm audit --omit=dev` vs. voller Audit — falls nur Dev-Dependencies betroffen sind, dokumentieren.
- GitHub Advisories für alle direkten Dependencies.

### Outdated-Check
- `npm outdated` auswerten; nach Major/Minor/Patch gruppieren.
- Major-Upgrades brauchen Evaluation + Changelog-Review; Minor/Patch sollten zügig eingespielt werden.

### Lizenz-Compliance
- Alle Dependencies MIT/Apache-2.0/BSD-kompatibel mit Apache-2.0 des Pakets?
- Keine GPL-/AGPL-Abhängigkeiten ohne explizite Ausnahme.
- `license-checker` oder `npm-license-crawler` laufen sauber durch.

### Dependency-Hygiene
- Keine ungenutzten Dependencies (`depcheck`).
- Keine fehlenden Dependencies (importiert, aber nicht in `package.json`).
- Lockfile (`package-lock.json`) ist konsistent (`npm ci` läuft sauber).
- `engines.node` in `package.json` spiegelt die tatsächlich unterstützten Node-Versionen (CI-Matrix).

### Reproduzierbarkeit
- `npm ci` in CI statt `npm install`.
- Keine `^`-Unschärfe in Lockfile — Lockfile muss deterministisch sein.

## Vorgehen

1. **Baseline-Report** — `npm audit`, `npm outdated`, `depcheck`, License-Report ausführen und Ergebnisse festhalten.
2. **Security-Patches zuerst** — Alle sicherheitsrelevanten Patch/Minor-Updates einspielen, Tests grün halten.
3. **Feature-Minor-Updates** — Einspielen + Regressionstest, Changelog-Eintrag.
4. **Major-Upgrades** — Pro Major-Upgrade eine eigene Session/PR; Breaking-Change-Review des upstream Changelogs; Anpassung der Code-Aufrufe.
5. **`node-opcua` speziell** — Ist besonders kritisch; vor Major-Upgrade immer Smoke-Test gegen Mock-Server und einen realen Referenzserver.
6. **Audit-Report archivieren** — Unter `docs/audits/YYYY-MM-DD.md` ablegen.

## Akzeptanzkriterien

- [ ] `npm ci && npm test && npm run lint` grün.
- [ ] `npm audit --production` = 0 High/Critical.
- [ ] Keine ungenutzten / fehlenden Dependencies laut `depcheck`.
- [ ] Lizenz-Report committed; keine inkompatiblen Lizenzen.
- [ ] CHANGELOG-Eintrag für alle nach außen sichtbaren Version-Bumps.
- [ ] `package-lock.json` ist im Commit enthalten.

## Nicht-Ziele

- Keine „Upgrade-Marathon"-Sessions, die mehrere Majors auf einmal einspielen.
- Keine Nutzung von Pre-Release-/Alpha-Versionen als Produktions-Dependency.
- Keine manuellen Edits an `package-lock.json`.
- Keine Installation einer neuen Dependency, ohne zuvor mit einer vorhandenen die Funktion prüfen zu können.
