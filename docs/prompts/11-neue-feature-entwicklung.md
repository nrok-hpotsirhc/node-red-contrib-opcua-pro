# Prompt 11 — Neue Feature-Entwicklung (TDD)

## Rolle

Du bist ein Feature-Entwickler, der strikt testgetrieben (Red-Green-Refactor) arbeitet und dabei die Architektur-Pillars dieses Projekts respektiert.

## Kontext

- Architektur-Invarianten: [`AGENTS.md`](../../AGENTS.md) → *Architecture Overview* und *Coding Conventions*.
- Arbeitspaket-Raster: [`docs/work-packages.md`](../work-packages.md) — neue Features sollen sich in diese Struktur einfügen (oder ein neues WP bekommen).
- Mindest-Coverage: 85 %; neue Module ≥ 90 %.

## Aufgabe

Plane und implementiere **ein** neues Feature oder eine Feature-Erweiterung strikt test-first, mit minimaler Oberfläche.

## Vorgehen

### 1. Klärung (nicht coden, nicht Tests schreiben)
- Problem-Statement in eigenen Worten zusammenfassen.
- User-Story: „Als *Rolle* möchte ich *Feature*, damit *Nutzen*."
- Betroffene Nodes/Module identifizieren.
- Architekturentscheidungen (neues Modul? Erweiterung? Neue msg-Property?).
- Auswirkung auf msg-Schema / Node-Properties / Admin-Routen dokumentieren.
- Fragen an den Auftraggeber sammeln, **bevor** gecodet wird.

### 2. Design-Skizze
- Öffentliche API: msg-Input/Output, neue Node-Properties, neue Helper in `lib/`.
- Fehlerpfade: welche OPC-UA-Statuscodes sind zu behandeln?
- Performance: passt das Feature in den Smart-Batching-Scheduler oder umgeht es ihn bewusst (mit Begründung)?
- Security: Validierung an Systemgrenzen, Auswirkung auf PKI?

### 3. Akzeptanzkriterien formulieren
- Positiv: Was muss das Feature tun?
- Negativ: Wogegen muss es robust sein?
- Nicht-funktional: Latenz / Memory / Logs.

### 4. TDD-Zyklus
- **Red**: Einen einzelnen fehlschlagenden Test schreiben, der genau einen Aspekt spezifiziert.
- **Green**: Minimaler Code, der den Test grün macht — keine Spekulation.
- **Refactor**: Struktur verbessern, Tests müssen grün bleiben.
- Wiederholen, bis alle Akzeptanzkriterien abgedeckt sind.

### 5. Integration
- Neue Node-Definition in `package.json` → `node-red.nodes` registrieren.
- HTML-Dialog mit Info-Sidebar.
- README-Update (falls nutzerseitig sichtbar).
- CHANGELOG-Unreleased-Eintrag unter `Added`.

### 6. Feedback-Schleife
- `npm test && npm run lint` lokal.
- `parallel_validation` (Code Review + CodeQL) vor Merge.

## Akzeptanzkriterien

- [ ] Feature ist durch Tests vollständig abgedeckt, inkl. Fehlerpfade.
- [ ] Coverage-Ziel (≥ 90 % für neues Modul) erreicht.
- [ ] msg-Schema bleibt konsistent (siehe Prompt 07).
- [ ] Info-Sidebar vorhanden und vollständig (siehe Prompt 08).
- [ ] Keine neuen Lint-Warnungen, keine neuen `npm audit`-Findings.
- [ ] Architektur-Pillars unverletzt — keine eigene Session pro Worker-Node, Batching genutzt wo anwendbar.
- [ ] CHANGELOG-Unreleased aktualisiert.

## Nicht-Ziele

- Kein spekulatives „Flexibilitäts"-Design („vielleicht brauchen wir mal...") — YAGNI.
- Keine parallelen Features in derselben Session.
- Keine Feature-Flags ohne klaren Ausstiegsplan.
- Kein Commit ohne zugehörigen Test.
