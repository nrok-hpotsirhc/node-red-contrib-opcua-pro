# Work Packages — OPC UA Node-RED Open-Source Node

Dieses Dokument beschreibt alle Arbeitspakete (Work Packages) in vollständiger Ausarbeitung. Jedes WP enthält: Ziel, Deliverables, Akzeptanzkriterien, Abhängigkeiten und technische Implementierungshinweise.

**Lizenz:** Apache License 2.0  
**Basis:** [docs/theoretical-foundations.md](./theoretical-foundations.md)  
**Anforderungen:** Siehe [AGENTS.md](../AGENTS.md#requirements-catalog)

---

## Inhaltsverzeichnis

### Client Work Packages
- [WP-C-1: Basis-Infrastruktur & Configuration Node](#wp-c-1-basis-infrastruktur--configuration-node)
- [WP-C-2: Resilience Engineering (Session & Error Management)](#wp-c-2-resilience-engineering-session--error-management)
- [WP-C-3: Worker Nodes & Smart Batching](#wp-c-3-worker-nodes--smart-batching)
- [WP-C-4: Visueller Tree-View Browser](#wp-c-4-visueller-tree-view-browser)
- [WP-C-5: Security & PKI UI](#wp-c-5-security--pki-ui)
- [WP-C-6: CI/CD & Dokumentation](#wp-c-6-cicd--dokumentation)

### Server Work Packages
- [WP-S-1: Kern-Server & Lifecycle Management](#wp-s-1-kern-server--lifecycle-management)
- [WP-S-2: Address Space Builder & Context Bridge](#wp-s-2-address-space-builder--context-bridge)
- [WP-S-3: NodeSet2.xml Importer](#wp-s-3-nodeset2xml-importer)
- [WP-S-4: RPC-Methoden & Event Handling](#wp-s-4-rpc-methoden--event-handling)
- [WP-S-5: Server PKI & RBAC](#wp-s-5-server-pki--rbac)

### [Abhängigkeitsmatrix](#abhängigkeitsmatrix)
### [Definition of Done](#definition-of-done)

---

## WP-C-1: Basis-Infrastruktur & Configuration Node

**Erfüllt:** REQ-C-01, REQ-C-02  
**Abhängigkeiten:** keine  
**Komplexität:** Hoch

### Ziel

Aufbau der vollständigen npm-Paketstruktur und Implementierung des zentralen `opcua-client-config` Configuration Nodes als Finite State Machine (FSM). Dieser Node ist der Kern der gesamten Client-Architektur — alle weiteren WPs bauen darauf auf.

### Deliverables

| # | Deliverable | Datei |
|---|---|---|
| D-C-1.1 | npm-Paketstruktur mit `package.json` | `package.json` |
| D-C-1.2 | Apache 2.0 Lizenzdatei | `LICENSE` |
| D-C-1.3 | Config-Node Backend (Finite State Machine) | `nodes/client/opcua-client-config/opcua-client-config.js` |
| D-C-1.4 | Config-Node Frontend (HTML-Dialog) | `nodes/client/opcua-client-config/opcua-client-config.html` |
| D-C-1.5 | FSM-Zustandsdiagramm als Dokumentation | `docs/architecture/fsm-client.md` |
| D-C-1.6 | Unit-Tests für FSM-Übergänge | `nodes/client/opcua-client-config/opcua-client-config.test.js` |

### Technische Implementierung

#### 1.1 Finite State Machine

Die FSM steuert den gesamten Verbindungslebenszyklus. Zustände und Übergänge:

```
                  deploy()
DISCONNECTED ──────────────► CONNECTING
     ▲                           │
     │ disconnect()        connect() OK
     │                           ▼
RECONNECTING ◄──────── CONNECTED
     ▲    connection_    │
     │    lost           │ createSession() OK
     │                   ▼
     └─────────── SESSION_ACTIVE
     connection_lost
```

Implementierung als einfaches Objekt mit Event-Emitter:

```javascript
const EventEmitter = require('events');

class OpcuaClientFSM extends EventEmitter {
  constructor() {
    super();
    this.state = 'DISCONNECTED';
  }

  transition(newState) {
    const allowed = {
      DISCONNECTED:    ['CONNECTING'],
      CONNECTING:      ['CONNECTED', 'DISCONNECTED'],
      CONNECTED:       ['SESSION_ACTIVE', 'CONNECTION_LOST'],
      SESSION_ACTIVE:  ['CONNECTION_LOST', 'DISCONNECTED'],
      CONNECTION_LOST: ['RECONNECTING', 'DISCONNECTED'],
      RECONNECTING:    ['CONNECTED', 'DISCONNECTED']
    };
    if (!allowed[this.state]?.includes(newState)) {
      throw new Error(`Ungültiger Übergang: ${this.state} → ${newState}`);
    }
    const prev = this.state;
    this.state = newState;
    this.emit('stateChange', newState, prev);
  }
}
```

#### 1.2 Config-Node HTML-Konfigurationsdialog

Der Dialog muss folgende Felder enthalten:

| Feld | Typ | Beispielwert | Validierung |
|---|---|---|---|
| `endpoint` | URL | `opc.tcp://192.168.1.100:4840` | URL-Format prüfen |
| `securityMode` | Select | `SignAndEncrypt` | Pflicht |
| `securityPolicy` | Select | `Basic256Sha256` | Pflicht |
| `authMode` | Select | `Anonymous` | — |
| `username` | Text | `admin` | Nur wenn authMode=UserName |
| `password` | Password | `***` | Nur wenn authMode=UserName; credential-aware |
| `applicationName` | Text | `NodeRED Client` | — |
| `requestedSessionTimeout` | Number | `60000` (ms) | > 0 |

**Wichtig**: Passwörter müssen über `RED.nodes.registerType(..., { credentials: { password: { type: 'password' } } })` als sichere Credentials gespeichert werden — niemals im properties-Objekt des Nodes.

#### 1.3 Visuelles Status-Feedback für Worker-Nodes

Der Config-Node emittiert State-Change-Events. Worker-Nodes reagieren:

```javascript
// In jedem Worker-Node
const statusMap = {
  'DISCONNECTED':   { fill: 'red',    shape: 'ring', text: 'Getrennt' },
  'CONNECTING':     { fill: 'yellow', shape: 'ring', text: 'Verbinde...' },
  'CONNECTED':      { fill: 'yellow', shape: 'dot',  text: 'Verbunden' },
  'SESSION_ACTIVE': { fill: 'green',  shape: 'dot',  text: 'Bereit' },
  'CONNECTION_LOST':{ fill: 'red',    shape: 'dot',  text: 'Verbindung lost' },
  'RECONNECTING':   { fill: 'yellow', shape: 'ring', text: 'Reconnect...' }
};

configNode.on('stateChange', (state) => {
  node.status(statusMap[state] || { fill: 'grey', shape: 'ring', text: state });
});
```

### Akzeptanzkriterien

- [ ] `npm install` führt zu einem installierbaren Node-RED Package ohne Fehler
- [ ] Config-Node erscheint im Node-RED Editor unter der Kategorie „OPC UA"
- [ ] Alle 6 FSM-Zustände korrekt erreichbar per Unit-Test
- [ ] Ungültige Zustandsübergänge werfen Exception
- [ ] Credentials werden verschlüsselt gespeichert (kein Klartext in `flows.json`)
- [ ] Status-Icons aktualisieren sich bei abhängigen Worker-Nodes

---

## WP-C-2: Resilience Engineering (Session & Error Management)

**Erfüllt:** REQ-C-07  
**Abhängigkeiten:** WP-C-1  
**Komplexität:** Sehr hoch

### Ziel

Implementierung der industrietauglichen Reconnect- und Session-Recovery-Logik. Der Kern dieses WPs ist die Unterscheidung zwischen **Session Recreation** (naiv, ressourcenleckend) und **Session Re-Establishment** (korrekt, ressourcenschonend).

### Deliverables

| # | Deliverable | Datei |
|---|---|---|
| D-C-2.1 | Exponential Backoff Reconnect-Logik | `lib/client/connection-manager.js` |
| D-C-2.2 | Session Re-Establishment Mechanismus | `lib/client/session-manager.js` |
| D-C-2.3 | OPC UA Error-Code Handler | `lib/client/error-handler.js` |
| D-C-2.4 | Integration-Tests für Reconnect-Szenarien | `test/integration/client-reconnect.test.js` |

### Technische Implementierung

#### 2.1 Exponential Backoff

```javascript
// lib/client/connection-manager.js
const connectionStrategy = {
  initialDelay: 1000,      // 1 Sekunde erster Versuch
  maxDelay: 30000,         // Max 30 Sekunden Wartezeit
  maxRetry: Infinity,      // Endlos versuchen (industrieller Betrieb)
  randomisationFactor: 0.1 // ±10% Jitter gegen Thundering Herd
};
```

Das `node-opcua`-interne `connectionStrategy` übernimmt den Backoff automatisch, wenn es beim `OPCUAClient.create()` übergeben wird. Die FSM wird über die Events `connection_lost`, `reconnecting`, `connection_reestablished` und `after_reconnection` gesteuert.

#### 2.2 Session Re-Establishment vs. Recreation

**Verbot**: Eine neue Session darf erst dann erstellt werden, wenn die Session-Lifetime auf dem Server definitiv abgelaufen ist:

```javascript
client.on('connection_reestablished', async () => {
  try {
    // Versuch 1: Bestehende Session reaktivieren (Session-ID noch gültig)
    await session.changeSessionIdentity({ type: UserTokenType.Anonymous });
    // Wenn erfolgreich → Session ist wieder aktiv, Subscriptions laufen weiter
    fsm.transition('SESSION_ACTIVE');
  } catch (err) {
    if (err.statusCode === StatusCodes.BadSessionIdInvalid ||
        err.statusCode === StatusCodes.BadSessionNotActivated) {
      // Session-Lifetime abgelaufen → neue Session erstellen ist jetzt OK
      await createNewSession();
    } else {
      throw err; // Unbekannter Fehler → eskalieren
    }
  }
});
```

#### 2.3 Kritische Fehlercodes

| OPC UA Status Code | Bedeutung | Reaktion |
|---|---|---|
| `BadSessionClosed` | Session wurde server-seitig geschlossen | Session neu aufbauen |
| `BadSessionIdInvalid` | Session-ID unbekannt (Timeout) | Neue Session erstellen |
| `BadConnectionClosed` | TCP-Verbindung unterbrochen | Reconnect-Loop starten |
| `BadServerNotConnected` | Server nicht erreichbar | Reconnect mit Backoff |
| `BadTooManySessions` | Server-Session-Limit erreicht | Warten + retry; kritischer Alert loggen |
| `BadUserAccessDenied` | Authentifizierungsfehler | Fehler melden; KEIN auto-retry |
| `BadCertificateUntrusted` | Zertifikat nicht vertrauenswürdig | Fehler melden; in PKI/rejected ablegen |

#### 2.4 Subscription-Reaktivierung

Nach erfolgreicher Session-Reaktivierung müssen die bestehenden Subscriptions wieder aktiviert werden. `node-opcua` bietet hierfür `session.republish()`. Der Session-Manager prüft nach jedem Reconnect, ob Subscriptions neu angemeldet werden müssen:

```javascript
// Nach Reconnect in session-manager.js
async function reactivateSubscriptions(session, existingSubscriptions) {
  for (const sub of existingSubscriptions) {
    try {
      await sub.setPublishingMode(true); // Sicherstellen, dass Publishing aktiv ist
    } catch (err) {
      // Subscription existiert nicht mehr → neu anlegen
      await recreateSubscription(session, sub.config);
    }
  }
}
```

### Akzeptanzkriterien

- [ ] Netzwerkunterbrechung von < Session-Lifetime → kein Wachstum der Server-Session-Tabelle im Integrationstest
- [ ] Netzwerkunterbrechung von > Session-Lifetime → genau eine neue Session wird erstellt
- [ ] Subscriptions liefern nach Reconnect weiterhin Daten ohne manuellen Eingriff
- [ ] `BadTooManySessions` wird als kritischer Fehler geloggt und nicht silent verschluckt
- [ ] Exponentieller Backoff verifizierbar: Zeitabstände zwischen Retries nehmen zu

---

## WP-C-3: Worker Nodes & Smart Batching

**Erfüllt:** REQ-C-03, REQ-C-04, REQ-C-06, REQ-C-09  
**Abhängigkeiten:** WP-C-1, WP-C-2  
**Komplexität:** Hoch

### Ziel

Implementierung aller vier operativen Worker-Nodes (`opcua-read`, `opcua-write`, `opcua-subscribe`, `opcua-method`) sowie des Smart Batching Schedulers und der UDT-Deserialisierung.

### Deliverables

| # | Deliverable | Datei |
|---|---|---|
| D-C-3.1 | `opcua-read` Node | `nodes/client/opcua-read/` |
| D-C-3.2 | `opcua-write` Node | `nodes/client/opcua-write/` |
| D-C-3.3 | `opcua-subscribe` Node | `nodes/client/opcua-subscribe/` |
| D-C-3.4 | `opcua-method` Node | `nodes/client/opcua-method/` |
| D-C-3.5 | Smart Batching Scheduler | `lib/client/batch-scheduler.js` |
| D-C-3.6 | UDT-Deserializer | `lib/client/udt-deserializer.js` |
| D-C-3.7 | Unit-Tests für alle Nodes | `nodes/client/*/opcua-*.test.js` |

### Technische Implementierung

#### 3.1 Smart Batching Scheduler

```javascript
// lib/client/batch-scheduler.js
class BatchScheduler {
  constructor(session, options = {}) {
    this.session = session;
    this.batchWindowMs = options.batchWindowMs || 5;
    this.readQueue = [];
    this.writeQueue = [];
    this.timer = null;
  }

  scheduleRead(nodeId, attributeId = AttributeIds.Value) {
    return new Promise((resolve, reject) => {
      this.readQueue.push({ nodeId, attributeId, resolve, reject });
      this._scheduleBatch();
    });
  }

  scheduleWrite(nodeId, value) {
    return new Promise((resolve, reject) => {
      this.writeQueue.push({ nodeId, value, resolve, reject });
      this._scheduleBatch();
    });
  }

  _scheduleBatch() {
    if (this.timer) return; // Timer läuft bereits
    this.timer = setTimeout(() => this._flush(), this.batchWindowMs);
  }

  async _flush() {
    this.timer = null;

    // Read-Batch ausführen
    if (this.readQueue.length > 0) {
      const batch = this.readQueue.splice(0);
      try {
        const results = await this.session.read(
          batch.map(r => ({ nodeId: r.nodeId, attributeId: r.attributeId }))
        );
        batch.forEach((req, i) => req.resolve(results[i]));
      } catch (err) {
        batch.forEach(req => req.reject(err));
      }
    }

    // Write-Batch ausführen
    if (this.writeQueue.length > 0) {
      const batch = this.writeQueue.splice(0);
      try {
        const results = await this.session.write(
          batch.map(w => ({ nodeId: w.nodeId, value: w.value }))
        );
        batch.forEach((req, i) => req.resolve(results[i]));
      } catch (err) {
        batch.forEach(req => req.reject(err));
      }
    }
  }
}
```

#### 3.2 Payload-Normalisierung

Jede OPC UA Antwort wird in das standardisierte `msg`-Format überführt:

```javascript
// lib/client/payload-normalizer.js
function normalizeDataValue(dataValue, nodeId) {
  const msg = {
    payload: deserializeValue(dataValue.value),  // Eigentlicher Wert
    opcua: {
      nodeId:          nodeId,
      statusCode:      dataValue.statusCode.name, // "Good", "Bad", "Uncertain"
      sourceTimestamp: dataValue.sourceTimestamp,
      serverTimestamp: dataValue.serverTimestamp,
      dataType:        dataValue.value?.dataType
    }
  };
  return msg;
}
```

#### 3.3 opcua-read Node — Konfigurationsparameter

| Parameter | Beschreibung | Default |
|---|---|---|
| `nodeId` | OPC UA NodeId (oder `msg.topic`) | — |
| `attributeId` | Attribut (Value, Status, BrowseName...) | `Value` |
| `datatype` | Hint für Typkonvertierung | — |
| `connection` | Referenz auf `opcua-client-config` | — |

#### 3.4 opcua-subscribe Node — Konfigurationsparameter

| Parameter | Beschreibung | Default |
|---|---|---|
| `nodeId` | Zu abonnierende NodeId | — |
| `publishingInterval` | ms | 500 |
| `samplingInterval` | ms | 100 |
| `deadbandType` | None, Absolute, Percent | None |
| `deadbandValue` | Schwellwert | 0 |
| `queueSize` | Puffergröße | 10 |

#### 3.5 UDT-Deserializer

```javascript
// lib/client/udt-deserializer.js
function deserializeValue(variant) {
  if (!variant) return null;

  switch (variant.dataType) {
    case DataType.ExtensionObject:
      return deserializeExtensionObject(variant.value);
    case DataType.Null:
      return null;
    default:
      // Primitive und Arrays direkt zurückgeben
      return variant.arrayType !== VariantArrayType.Scalar
        ? Array.from(variant.value)   // TypedArray → normales JS-Array
        : variant.value;
  }
}

function deserializeExtensionObject(extObj) {
  if (!extObj || typeof extObj !== 'object') return extObj;
  // Rekursiv alle Felder konvertieren
  const result = {};
  for (const [key, val] of Object.entries(extObj)) {
    if (val && typeof val === 'object' && val.constructor?.name === 'ExtensionObject') {
      result[key] = deserializeExtensionObject(val);
    } else if (ArrayBuffer.isView(val)) {
      result[key] = Array.from(val);  // TypedArray (Float32Array etc.) → JS-Array
    } else {
      result[key] = val;
    }
  }
  return result;
}
```

### Akzeptanzkriterien

- [ ] 100 gleichzeitige `input`-Events auf `opcua-read` Nodes erzeugen genau 1 ReadMultipleRequest
- [ ] `msg.payload` enthält bei Scalaren den direkten Wert (keine OPC UA Wrapper-Objekte)
- [ ] `msg.opcua.statusCode` enthält `"Good"`, `"Bad"` oder `"Uncertain"` als String
- [ ] `Float32Array`, `Int32Array` etc. werden als normale JS-Arrays in `msg.payload` geliefert
- [ ] Extension Objects mit bekannten Typen werden vollständig in JSON deserialisiert
- [ ] `opcua-subscribe` liefert nach Reconnect (WP-C-2) weiterhin Daten

---

## WP-C-4: Visueller Tree-View Browser

**Erfüllt:** REQ-C-05  
**Abhängigkeiten:** WP-C-1  
**Komplexität:** Mittel

### Ziel

Integration eines visuellen OPC UA Address Space Browsers in den Node-RED Editor. Nutzer können durch den Serveradressraum navigieren und NodeIds per Klick in Konfigurationsfelder übernehmen.

### Deliverables

| # | Deliverable | Datei |
|---|---|---|
| D-C-4.1 | HTTP-Admin-Route für Browse-Requests | `nodes/client/opcua-client-config/opcua-client-config.js` (Erweiterung) |
| D-C-4.2 | Browser-UI (RED.treeList) | `nodes/client/opcua-client-config/opcua-client-config.html` (Erweiterung) |
| D-C-4.3 | Lazy-Load-Mechanismus für große Strukturen | Teil von D-C-4.2 |
| D-C-4.4 | Unit-Tests für Browse-Route | `nodes/client/opcua-client-config/browse-route.test.js` |

### Technische Implementierung

#### 4.1 Backend: Browse-Route

```javascript
// Registrierung im opcua-client-config.js
RED.httpAdmin.get(
  '/opcua-admin/browse',
  RED.auth.needsPermission('opcua-client-config.write'),
  async (req, res) => {
    const { nodeId = 'RootFolder', configId } = req.query;

    // Input-Validierung (Security Boundary)
    if (!configId || !/^[a-z0-9.]+$/i.test(configId)) {
      return res.status(400).json({ error: 'Ungültige configId' });
    }

    const configNode = RED.nodes.getNode(configId);
    if (!configNode?.session) {
      return res.status(503).json({ error: 'Keine aktive Session verfügbar' });
    }

    try {
      const browseResult = await configNode.session.browse({
        nodeId,
        browseDirection: BrowseDirection.Forward,
        includeSubtypes: true,
        nodeClassMask: 0,
        resultMask: 63  // DisplayName, BrowseName, NodeClass, TypeDefinition, ReferenceType, IsForward
      });

      const nodes = browseResult.references?.map(ref => ({
        nodeId:       ref.nodeId.toString(),
        displayName:  ref.displayName?.text,
        browseName:   ref.browseName?.name,
        nodeClass:    NodeClass[ref.nodeClass],
        hasChildren:  ref.nodeClass === NodeClass.Object || ref.nodeClass === NodeClass.Variable
      })) ?? [];

      res.json(nodes);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);
```

#### 4.2 Frontend: RED.treeList Integration

```html
<!-- Im HTML-Template des opcua-client-config oder eines Worker-Nodes -->
<button id="opcua-browse-btn" type="button" class="red-ui-button">
  <i class="fa fa-search"></i> Browse
</button>

<div id="opcua-browser-dialog" style="display:none;">
  <ol id="opcua-tree" style="height:350px; overflow-y:auto;"></ol>
</div>

<script>
(function() {
  const treeList = $('#opcua-tree').treeList({});

  function loadNodes(nodeId, parentItem) {
    const configId = $('#node-config-input-connection').val();
    $.getJSON(`opcua-admin/browse?nodeId=${encodeURIComponent(nodeId)}&configId=${configId}`)
      .done(nodes => {
        const items = nodes.map(n => ({
          label: n.displayName || n.browseName,
          icon: n.nodeClass === 'Variable' ? 'fa fa-tag' : 'fa fa-folder-o',
          expanded: false,
          children: n.hasChildren ? true : undefined,  // true = lazy load
          data: n,
          onexpand: (item) => loadNodes(item.data.nodeId, item)
        }));
        if (parentItem) parentItem.children = items;
        else treeList.treeList('data', items);
      });
  }

  // Klick auf Variable → NodeId in Eingabefeld übernehmen
  treeList.on('treelistselect', (event, item) => {
    if (item.data.nodeClass === 'Variable') {
      $('#node-input-nodeId').val(item.data.nodeId);
      $('#opcua-browser-dialog').hide();
    }
  });

  $('#opcua-browse-btn').on('click', () => {
    $('#opcua-browser-dialog').show();
    loadNodes('RootFolder', null);
  });
})();
</script>
```

### Akzeptanzkriterien

- [ ] Browse-Route antwortet innerhalb von 2 Sekunden für SPSen mit bis zu 10.000 Knoten
- [ ] Lazy Loading: Unterknoten werden erst beim Aufklappen eines Ordners geladen
- [ ] Klick auf Variable trägt NodeId korrekt in das Ziel-Eingabefeld ein
- [ ] Browse-Route validiert alle Eingabeparameter (kein Path-Traversal möglich)
- [ ] Browse-Route gibt 503 zurück, wenn keine Session aktiv ist (kein Crash)

---

## WP-C-5: Security & PKI UI

**Erfüllt:** REQ-C-08  
**Abhängigkeiten:** WP-C-1  
**Komplexität:** Mittel

### Ziel

Automatische X.509-Zertifikatsgenerierung beim ersten Start sowie ein browserbasiertes Security Dashboard zur Verwaltung von vertrauenswürdigen Zertifikaten ohne CLI-Kenntnisse.

### Deliverables

| # | Deliverable | Datei |
|---|---|---|
| D-C-5.1 | Auto-Zertifikatsgenerator (erste Inbetriebnahme) | `lib/client/pki-manager.js` |
| D-C-5.2 | Security Dashboard HTML | `nodes/client/opcua-client-config/opcua-client-config.html` (Erweiterung) |
| D-C-5.3 | HTTP-Admin-Routen für PKI-Operationen | `nodes/client/opcua-client-config/opcua-client-config.js` (Erweiterung) |
| D-C-5.4 | Unit-Tests für PKI-Operationen | `lib/client/pki-manager.test.js` |

### Technische Implementierung

#### 5.1 Automatische Zertifikatsgenerierung

```javascript
// lib/client/pki-manager.js
const { createSelfSignedCertificate, ensureValidCertificate } = require('node-opcua-certificate');
const path = require('path');
const fs = require('fs');

async function ensureClientCertificate(pkiDir, applicationName) {
  const certFile = path.join(pkiDir, 'own', 'certs', 'client.der');
  const keyFile  = path.join(pkiDir, 'own', 'private', 'client_key.pem');

  // Verzeichnisstruktur anlegen (falls nicht vorhanden)
  ['own/certs', 'own/private', 'trusted/certs', 'rejected', 'issuers/certs']
    .forEach(d => fs.mkdirSync(path.join(pkiDir, d), { recursive: true }));

  if (!fs.existsSync(certFile)) {
    await createSelfSignedCertificate({
      outputFile:      certFile,
      privateKey:      keyFile,
      applicationUri:  `urn:${require('os').hostname()}:NodeRED:${applicationName}`,
      subject:         `/CN=${applicationName}/O=NodeRED/C=DE`,
      validity:        3650  // 10 Jahre
    });
  }
  return { certFile, keyFile };
}
```

#### 5.2 PKI-HTTP-Routen

```javascript
// Abgelehnte Zertifikate auflisten
RED.httpAdmin.get('/opcua-admin/pki/rejected', RED.auth.needsPermission('opcua-client-config.write'),
  (req, res) => {
    const rejectedDir = path.join(pkiDir, 'rejected');
    const files = fs.readdirSync(rejectedDir).filter(f => f.endsWith('.der'));
    res.json(files.map(f => ({ name: f, path: path.join(rejectedDir, f) })));
  }
);

// Zertifikat vertrauen (verschieben, NICHT kopieren!)
RED.httpAdmin.post('/opcua-admin/pki/trust', RED.auth.needsPermission('opcua-client-config.write'),
  (req, res) => {
    const { filename } = req.body;

    // Eingabe-Validierung: nur .der-Dateien, kein Path-Traversal
    if (!/^[a-zA-Z0-9_\-]+\.der$/.test(filename)) {
      return res.status(400).json({ error: 'Ungültiger Dateiname' });
    }

    const src  = path.join(pkiDir, 'rejected', filename);
    const dest = path.join(pkiDir, 'trusted', 'certs', filename);

    try {
      // fs.rename() = atomare Operation, kein copyFile+unlink
      fs.renameSync(src, dest);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);
```

### Akzeptanzkriterien

- [ ] Erstes `npm install` + Node-RED Start erzeugt automatisch PKI-Verzeichnis + Zertifikat
- [ ] Kein manueller `openssl`-Befehl nötig
- [ ] Trust-Operation nutzt `fs.renameSync` (atomar, kein inkonsistenter Zwischenstatus)
- [ ] Dateiname-Validierung verhindert Path-Traversal-Angriffe
- [ ] Bereits vertrauenswürdige Zertifikate erscheinen nicht mehr in der Rejected-Liste

---

## WP-C-6: CI/CD & Dokumentation

**Erfüllt:** REQ-C-10  
**Abhängigkeiten:** WP-C-1 bis WP-C-5  
**Komplexität:** Mittel

### Deliverables

| # | Deliverable | Datei |
|---|---|---|
| D-C-6.1 | GitHub Actions CI-Pipeline | `.github/workflows/ci.yml` |
| D-C-6.2 | Mock OPC UA Server für Tests | `test/fixtures/mock-server.js` |
| D-C-6.3 | Integrationstests | `test/integration/` |
| D-C-6.4 | Coverage-Report (≥85%) | via `nyc` oder `c8` |
| D-C-6.5 | Node-RED Info Sidebar Dokumentation | In allen `.html`-Dateien |
| D-C-6.6 | README.md | `README.md` |

### Technische Implementierung

#### 6.1 Mock-Server für Tests

```javascript
// test/fixtures/mock-server.js
const { OPCUAServer, Variant, DataType } = require('node-opcua');

async function createMockServer(port = 4840) {
  const server = new OPCUAServer({
    port,
    resourcePath: '/test',
    buildInfo: { productName: 'MockServer' }
  });
  await server.initialize();

  const addressSpace = server.engine.addressSpace;
  const namespace = addressSpace.getOwnNamespace();
  const objectFolder = addressSpace.rootFolder.objects;

  let temperatureValue = 23.5;
  namespace.addVariable({
    componentOf: objectFolder,
    browseName: 'Temperature',
    dataType: 'Double',
    value: {
      get: () => new Variant({ dataType: DataType.Double, value: temperatureValue }),
      set: (v) => { temperatureValue = v.value; return require('node-opcua').StatusCodes.Good; }
    }
  });

  await server.start();
  return { server, setTemperature: (v) => { temperatureValue = v; } };
}

module.exports = { createMockServer };
```

#### 6.2 GitHub Actions Pipeline

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18.x, 20.x, 22.x]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm test
      - run: npm run coverage
      - name: Coverage Check (≥85%)
        run: npx c8 check-coverage --lines 85 --functions 85 --branches 80
```

### Akzeptanzkriterien

- [ ] CI-Pipeline schlägt fehl, wenn Testabdeckung unter 85% fällt
- [ ] Alle Tests laufen gegen einen lokalen Mock-Server (kein echter OPC UA Server nötig)
- [ ] Node-RED Info Sidebar zeigt für jeden Node eine komponentenspezifische Hilfe
- [ ] `npm test` funktioniert ohne externe Abhängigkeiten (kein laufender OPC UA Server nötig)

---

## WP-S-1: Kern-Server & Lifecycle Management

**Erfüllt:** REQ-S-01  
**Abhängigkeiten:** keine  
**Komplexität:** Mittel

### Ziel

Implementierung des `opcua-server-config` Configuration Nodes, der den kompletten Lifecycle eines OPC UA Servers an den Node-RED Deploy/Undeploy-Zyklus bindet.

### Deliverables

| # | Deliverable | Datei |
|---|---|---|
| D-S-1.1 | `opcua-server-config` Node Backend | `nodes/server/opcua-server-config/opcua-server-config.js` |
| D-S-1.2 | `opcua-server-config` Node Frontend | `nodes/server/opcua-server-config/opcua-server-config.html` |
| D-S-1.3 | Graceful Shutdown Logik | Teil von D-S-1.1 |
| D-S-1.4 | Unit-Tests (Start/Stop/Redeploy) | `nodes/server/opcua-server-config/opcua-server-config.test.js` |

### Technische Implementierung

#### 1.1 Server-Lifecycle Hooks

```javascript
// nodes/server/opcua-server-config/opcua-server-config.js
function OpcuaServerConfig(config) {
  RED.nodes.createNode(this, config);
  const node = this;

  let server = null;

  async function startServer() {
    server = new OPCUAServer({
      port: parseInt(config.port) || 4840,
      resourcePath: config.resourcePath || '/UA/NodeRED',
      buildInfo: {
        productName:      config.productName || 'Node-RED OPC UA Server',
        buildNumber:      require('../../package.json').version,
        buildDate:        new Date()
      }
    });

    server.on('post_initialize', () => {
      // Address-Space-Builder-Nodes werden hier aufgerufen
      node.emit('addressSpaceReady', server.engine.addressSpace);
    });

    await server.initialize();
    await server.start();
    node.status({ fill: 'green', shape: 'dot', text: `Port ${config.port}: Aktiv` });
  }

  nodes.on('close', async (removed, done) => {
    // KRITISCH: TCP-Port MUSS freigegeben werden, sonst schlägt Redeploy fehl
    if (server) {
      try {
        await server.shutdown(2000); // 2s Graceful-Period
      } catch (err) {
        node.warn(`Server-Shutdown Fehler: ${err.message}`);
      } finally {
        server = null;
      }
    }
    done();
  });

  startServer().catch(err => {
    node.error(`Server-Start fehlgeschlagen: ${err.message}`);
    node.status({ fill: 'red', shape: 'dot', text: 'Fehler beim Start' });
  });
}
```

### Akzeptanzkriterien

- [ ] Zwei aufeinanderfolgende Deploys belegen nicht denselben Port doppelt (kein EADDRINUSE)
- [ ] `server.shutdown()` wird bei `node.on('close', ...)` immer aufgerufen
- [ ] `done()` wird immer aufgerufen (auch im Fehlerfall), um Deadlocks zu vermeiden

---

## WP-S-2: Address Space Builder & Context Bridge

**Erfüllt:** REQ-S-02, REQ-S-04  
**Abhängigkeiten:** WP-S-1  
**Komplexität:** Hoch

### Deliverables

| # | Deliverable | Datei |
|---|---|---|
| D-S-2.1 | `opcua-folder` Node | `nodes/server/opcua-folder/` |
| D-S-2.2 | `opcua-variable` Node | `nodes/server/opcua-variable/` |
| D-S-2.3 | Context Bridge (bidirektional) | `lib/server/context-bridge.js` |
| D-S-2.4 | Unit-Tests für Context Bridge | `lib/server/context-bridge.test.js` |

### Technische Implementierung

#### 2.1 Context Bridge

```javascript
// lib/server/context-bridge.js
function createVariableBinding(namespace, parentNode, nodeConfig, flowContext) {
  return namespace.addVariable({
    componentOf: parentNode,
    browseName:  nodeConfig.browseName,
    dataType:    nodeConfig.dataType,
    value: {
      // Getter: OPC UA Client liest → Wert aus Node-RED Context
      get: () => {
        const raw = flowContext.get(nodeConfig.contextKey);
        return new Variant({ dataType: resolveDataType(nodeConfig.dataType), value: raw ?? nodeConfig.defaultValue });
      },
      // Setter: OPC UA Client schreibt → Node-RED Context aktualisieren + optional msg triggern
      set: (variant) => {
        flowContext.set(nodeConfig.contextKey, variant.value);
        if (nodeConfig.triggerOnWrite) {
          // msg in den Flow einschreiben
          nodeConfig.ownerNode.send({ payload: variant.value, topic: nodeConfig.browseName });
        }
        return StatusCodes.Good;
      }
    }
  });
}
```

### Akzeptanzkriterien

- [ ] Wert, der via `flow.set()` gesetzt wird, ist bei sofortiger OPC UA Leseanfrage verfügbar
- [ ] OPC UA Write-Aufruf aktualisiert `flow.get()` und sendet optional eine msg in den Flow
- [ ] Datentyp-Konflikte (Client schreibt String in Double-Variable) geben `BadTypeMismatch` zurück

---

## WP-S-3: NodeSet2.xml Importer

**Erfüllt:** REQ-S-03  
**Abhängigkeiten:** WP-S-1  
**Komplexität:** Mittel

### Deliverables

| # | Deliverable | Datei |
|---|---|---|
| D-S-3.1 | XML-Import-Logik | `lib/server/nodeset-importer.js` |
| D-S-3.2 | Fehlerbehandlung für ungültige Schemas | Teil von D-S-3.1 |
| D-S-3.3 | UI-Feld für Dateipfad im Server-Config | `nodes/server/opcua-server-config/opcua-server-config.html` |
| D-S-3.4 | Tests mit Beispiel-NodeSet2 | `test/fixtures/sample.NodeSet2.xml` |

### Technische Implementierung

```javascript
// lib/server/nodeset-importer.js
const { generateAddressSpace } = require('node-opcua-address-space');

async function importNodeSet(addressSpace, xmlFilePaths) {
  const validPaths = xmlFilePaths.filter(p => {
    // Eingabevalidierung: kein Path-Traversal
    const normalized = path.normalize(p);
    if (normalized.includes('..')) throw new Error(`Ungültiger Pfad: ${p}`);
    if (!fs.existsSync(normalized)) throw new Error(`Datei nicht gefunden: ${normalized}`);
    return true;
  });

  try {
    await generateAddressSpace(addressSpace, validPaths);
  } catch (err) {
    // Fehler isolieren: ein falsches XML soll Node-RED nicht crashen
    throw new Error(`NodeSet2 Import fehlgeschlagen: ${err.message}`);
  }
}
```

### Akzeptanzkriterien

- [ ] Gültige NodeSet2.xml Datei (OPC UA for Machinery) wird ohne Fehler geladen
- [ ] Fehlerhafte XML-Datei wirft Exception mit sprechendem Fehlertext, aber Node-RED bleibt stabil
- [ ] Path-Traversal-Eingaben (`../../etc/passwd`) werden abgelehnt

---

## WP-S-4: RPC-Methoden & Event Handling

**Erfüllt:** REQ-S-05  
**Abhängigkeiten:** WP-S-2  
**Komplexität:** Hoch

### Deliverables

| # | Deliverable | Datei |
|---|---|---|
| D-S-4.1 | `opcua-method` Node (Methoden-Trigger) | `nodes/server/opcua-method/` |
| D-S-4.2 | `opcua-method-response` Node | `nodes/server/opcua-method-response/` |
| D-S-4.3 | Correlation-ID Tabelle | Teil der Method-Nodes |
| D-S-4.4 | Unit-Tests für Correlation-ID Mechanismus | `nodes/server/opcua-method/opcua-method.test.js` |

### Technische Implementierung

```javascript
// Korrelationstabelle im opcua-method Node
const pendingCalls = new Map(); // UUID → { resolve, reject, timeout }

// Methode im Address Space registrieren
namespace.addMethod(machineObject, {
  browseName: config.methodName,
  inputArguments:  [ /* ... */ ],
  outputArguments: [ /* ... */ ]
});

machineObject[config.methodName] = async (inputArguments, context) => {
  const correlationId = require('crypto').randomUUID();

  const result = await new Promise((resolve, reject) => {
    // Timeout: Method-Call darf max. N Sekunden dauern
    const timeout = setTimeout(() => {
      pendingCalls.delete(correlationId);
      reject(new Error('Method-Call Timeout'));
    }, config.timeoutMs || 10000);

    pendingCalls.set(correlationId, { resolve, reject, timeout });

    // msg in den Flow schicken
    node.send({
      payload:           inputArguments.map(a => a.value),
      _opcua_method_id:  correlationId,
      topic:             config.methodName
    });
  });

  return { statusCode: StatusCodes.Good, outputArguments: result };
};
```

```javascript
// Im opcua-method-response Node
node.on('input', (msg) => {
  const pending = methodNode.pendingCalls.get(msg._opcua_method_id);
  if (pending) {
    clearTimeout(pending.timeout);
    methodNode.pendingCalls.delete(msg._opcua_method_id);
    pending.resolve(msg.payload);
  }
  done();
});
```

### Akzeptanzkriterien

- [ ] OPC UA Method-Call → msg erscheint im Flow mit `msg._opcua_method_id` und `msg.payload` (Input-Args)
- [ ] `opcua-method-response` liefert Ergebnis korrekt an den wartenden OPC UA Client zurück
- [ ] Abgelaufene Calls (Timeout) führen nicht zu Memory-Leaks in der Korrelationstabelle
- [ ] Gleichzeitige Method-Calls werden korrekt per UUID korreliert

---

## WP-S-5: Server PKI & RBAC

**Erfüllt:** REQ-S-06  
**Abhängigkeiten:** WP-S-1  
**Komplexität:** Mittel

### Deliverables

| # | Deliverable | Datei |
|---|---|---|
| D-S-5.1 | Server-Zertifikatsgenerator | `lib/server/pki-manager.js` |
| D-S-5.2 | Client-Zertifikat Whitelist UI | `nodes/server/opcua-server-config/opcua-server-config.html` |
| D-S-5.3 | RBAC-Framework (optional, v2) | `lib/server/rbac.js` |

### Akzeptanzkriterien

- [ ] Unbekannte Clients landen in `PKI/rejected/` und werden abgewiesen
- [ ] "Trust"-Button im UI verschiebt Zertifikat atomar nach `PKI/trusted/certs/`
- [ ] Keine privaten Schlüssel oder Credentials werden in Logs ausgegeben

---

## Abhängigkeitsmatrix

```
WP-C-1 ──► WP-C-2 ──► WP-C-3
  │                       │
  ├──────────────────────►WP-C-4
  │
  └──────────────────────►WP-C-5

WP-C-1..5 ──────────────►WP-C-6

WP-S-1 ──► WP-S-2 ──► WP-S-4
  │
  ├──────────────────────►WP-S-3
  └──────────────────────►WP-S-5
```

**Kritischer Pfad Client**: WP-C-1 → WP-C-2 → WP-C-3 → WP-C-6  
**Kritischer Pfad Server**: WP-S-1 → WP-S-2 → WP-S-4

---

## Definition of Done

Ein Work Package gilt als abgeschlossen, wenn **alle** folgenden Kriterien erfüllt sind:

| Kriterium | Prüfung |
|---|---|
| Alle Deliverables vorhanden | Dateien existieren im Repository |
| Unit-Tests grün | `npm test` ohne Fehler |
| Code-Coverage ≥ 85% | `npm run coverage` bestätigt Schwellwert |
| Keine `console.log` in Production-Code | `grep -r "console.log" nodes/ lib/` gibt nichts zurück |
| Keine Credentials in Logs | Manuelle Review + automatische Secret-Scan CI-Stage |
| Input-Validierung an allen Systemgrenzen | Code-Review bestätigt Validierung bei HTTP-Routen |
| Node-RED Info Sidebar vorhanden | Jeder Node hat `<script type="text/html" data-help-name="...">` |
| No regression in bestehenden Tests | CI-Pipeline vollständig grün |
