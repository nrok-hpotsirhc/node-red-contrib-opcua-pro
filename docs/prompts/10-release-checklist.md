# Prompt 10 — Release-Checklist

## Rolle

Du bist Release-Manager. Du erzeugst einen reproduzierbaren, nachvollziehbaren npm-Release ohne Überraschungen für Nutzer.

## Kontext

- Paket: `node-red-contrib-opcua-pro` auf npmjs.com und im Node-RED-Flow-Katalog.
- Versionierung: [Semantic Versioning 2.0](https://semver.org/lang/de/).
- Changelog: [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

## Aufgabe

Führe einen geplanten Release durch — Patch, Minor oder Major — und stelle sicher, dass das veröffentlichte Artefakt vollständig, korrekt signiert (sofern konfiguriert) und installierbar ist.

## Vorgehen (Checkliste)

### 1. Pre-Flight
- [ ] `main`-Branch aktuell, alle offenen PRs für den Release gemerged.
- [ ] `npm ci && npm run lint && npm test` grün.
- [ ] Coverage ≥ 85 % Lines & Branches.
- [ ] `npm audit --production` = 0 High/Critical.
- [ ] Alle Prompts 01–09 seit letztem Release mindestens einmal durchgelaufen (sofern Änderungen das rechtfertigen).

### 2. Versionierung
- [ ] Version gemäß SemVer bestimmt (Breaking → Major, Feature → Minor, Bugfix → Patch).
- [ ] `package.json` Version gebumpt (`npm version <type> --no-git-tag-version` oder manuell).
- [ ] Falls Breaking Changes: Migrationsabschnitt in `CHANGELOG.md` vorhanden.

### 3. Changelog
- [ ] `CHANGELOG.md` — `Unreleased` → neue Versionsüberschrift mit Datum umbenannt.
- [ ] Neuer leerer `Unreleased`-Abschnitt oben eingefügt.
- [ ] Alle Einträge sinnvoll kategorisiert (Added/Changed/Deprecated/Removed/Fixed/Security).

### 4. Dokumentation
- [ ] README.md zeigt die neue Version / Features.
- [ ] Screenshots in `docs/assets/` aktuell (bei UX-Änderungen).
- [ ] Info-Sidebar aller geänderten Nodes aktualisiert.

### 5. npm-Paket
- [ ] `npm pack` erzeugt Tarball; Inhalt manuell inspiziert (keine `.env`, keine `pki/private/`, keine Testfixtures mit Secrets).
- [ ] `.npmignore` / `files` in `package.json` korrekt konfiguriert.
- [ ] `engines.node` stimmt mit CI-Matrix überein.
- [ ] `keywords` und `node-red.nodes`-Block vollständig.

### 6. Tag & Push
- [ ] Commit „chore(release): vX.Y.Z" erzeugt.
- [ ] Git-Tag `vX.Y.Z` (optional signiert `-s`) gesetzt.
- [ ] Push via `report_progress` (Agent hat keine direkten Push-Rechte).

### 7. Publish
- [ ] `npm publish --dry-run` erfolgreich (lokale Validierung).
- [ ] `npm publish --access public` durch Maintainer mit 2FA.
- [ ] Installation aus Registry in frischem Node-RED-Container testen.

### 8. Post-Release
- [ ] GitHub-Release mit Changelog-Auszug erstellt.
- [ ] Ankündigung (optional: Node-RED Forum, Discussions).
- [ ] `docs/milestones.md` Fortschrittsprotokoll-Eintrag.
- [ ] Rollback-Plan dokumentiert (wie wird `npm deprecate` bei kritischem Defekt ausgelöst?).

## Akzeptanzkriterien

- [ ] Alle Checklistenpunkte abgehakt oder mit expliziter Begründung übersprungen.
- [ ] Tarball enthält keine Secrets, Private Keys, Testfixtures mit sensiblen Daten.
- [ ] Installation `npm i node-red-contrib-opcua-pro@X.Y.Z` in einer frischen Umgebung funktioniert und lädt alle Nodes.
- [ ] CHANGELOG und Git-Tag sind konsistent.

## Nicht-Ziele

- Kein Release ohne grüne CI.
- Kein Release direkt von einem Feature-Branch.
- Keine Force-Pushes, keine Tag-Umschreibungen nach Publish.
- Kein `npm publish --tag latest` für Pre-Releases — Pre-Releases nur unter `next`/`beta`-Tag.
