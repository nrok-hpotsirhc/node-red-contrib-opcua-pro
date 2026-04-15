# Theoretische Grundlagen: OPC UA & Node-RED Integration

Dieses Dokument bildet die wissenschaftliche und technische Wissensbasis für die Entwicklung des Open-Source OPC UA Node-RED Nodes. Es dient als Referenz für alle Implementierungsentscheidungen und -konventionen.

---

## Inhaltsverzeichnis

1. [OPC UA — Geschichte und Evolution](#1-opc-ua--geschichte-und-evolution)
2. [Architekturparadigmen: Client-Server und Publish/Subscribe](#2-architekturparadigmen-client-server-und-publishsubscribe)
3. [Transportschichten und Encodings](#3-transportschichten-und-encodings)
4. [Sicherheitsarchitektur](#4-sicherheitsarchitektur)
5. [Informationsmodell und Address Space](#5-informationsmodell-und-address-space)
6. [Subscriptions, Monitored Items und Report-by-Exception](#6-subscriptions-monitored-items-und-report-by-exception)
7. [Methods und Remote Procedure Calls](#7-methods-und-remote-procedure-calls)
8. [Extension Objects und User Defined Types (UDTs)](#8-extension-objects-und-user-defined-types-udts)
9. [Companion Specifications und NodeSet2.xml](#9-companion-specifications-und-nodeset2xml)
10. [Node-RED Architektur und Low-Code-Paradigma](#10-node-red-architektur-und-low-code-paradigma)
11. [Analyse bestehender Implementierungen](#11-analyse-bestehender-implementierungen)
12. [Lizenzrechtliche Grundlagen](#12-lizenzrechtliche-grundlagen)
13. [Technische Grundlage: node-opcua Bibliothek](#13-technische-grundlage-node-opcua-bibliothek)

---

## 1. OPC UA — Geschichte und Evolution

### 1.1 OPC Classic: Die Vorläufertechnologie

Der Vorläufer von OPC UA, bekannt als „OPC Classic", entstammt einem Konsortium führender Automatisierungshersteller aus dem Jahr 1996. Er basiert auf den Microsoft-Technologien **COM** (Component Object Model) und **DCOM** (Distributed Component Object Model). Diese Abhängigkeit von Windows-spezifischen Technologien führte zu gravierenden Einschränkungen:

- **Plattformbindung**: Ausschließliche Lauffähigkeit auf Windows-Systemen
- **Netzwerkprobleme**: DCOM ist notorisch schwer durch Firewalls zu routen (dynamische Port-Zuweisung)
- **Dateninseln**: Proprietäre Abhängigkeiten verhinderten nahtlose vertikale Integration
- **Fehlende Semantik**: Das Modell transportiert Daten ohne inhärente Beschreibung ihrer Bedeutung

OPC Classic umfasste folgende Spezifikationen:
| Spezifikation | Zweck |
|---|---|
| OPC DA (Data Access) | Lesen/Schreiben von Echtzeitwerten |
| OPC HDA (Historical Data Access) | Zugriff auf historische Zeitreihen |
| OPC A&E (Alarms & Events) | Verarbeitung von Alarmen und Ereignissen |
| OPC DX (Data Exchange) | Server-zu-Server-Kommunikation |

### 1.2 OPC UA: Der Paradigmenwechsel (2008)

Mit der Veröffentlichung der OPC UA Spezifikation (IEC 62541) durch die OPC Foundation im Jahr 2008 wurde der radikale Bruch mit dem COM/DCOM-Modell vollzogen. Die tragenden Designprinzipien sind:

1. **Plattformunabhängigkeit**: Implementierungen existieren für C, C++, Java, .NET, Python, Node.js
2. **Transportneutralität**: Das Protokoll abstrahiert Dienste vollständig von der Transportschicht
3. **Semantische Interoperabilität**: Das objektorientierte Informationsmodell trägt Bedeutung, nicht nur Werte
4. **Skalierbarkeit**: Lauffähig auf Embedded-Systemen (< 128 KB RAM) bis hin zu Cloud-Infrastrukturen
5. **Security by Design**: Kryptographische Sicherheit ist nicht optional, sondern Kernbestandteil

OPC UA ermöglicht die **vertikale Integration** über alle Ebenen der Automatisierungspyramide — vom einzelnen Feldgerät über SCADA/MES bis zum ERP-System und zur Cloud. Dies macht OPC UA zum zentralen Enabler für **Industrie 4.0** und cyber-physische Systeme.

---

## 2. Architekturparadigmen: Client-Server und Publish/Subscribe

### 2.1 Das Client-Server-Modell

Im Client-Server-Modell von OPC UA initiiert der Client stets die Kommunikation. Der Ablauf einer vollständigen Verbindung folgt einem deterministischen Protokoll:

```
Client                              Server
  │                                   │
  ├─── GetEndpoints() ───────────────►│  (Endpunktermittlung)
  │◄─── Endpoint-Liste ───────────────┤
  │                                   │
  ├─── OpenSecureChannel() ──────────►│  (Aufbau des sicheren Kanals)
  │◄─── Channel-Token ────────────────┤
  │                                   │
  ├─── CreateSession() ──────────────►│  (Session-Erstellung)
  │◄─── SessionId + AuthToken ────────┤
  │                                   │
  ├─── ActivateSession() ────────────►│  (Aktivierung + Nutzerauthentifizierung)
  │◄─── Bestätigung ──────────────────┤
  │                                   │
  ├─── Read/Write/Browse/Subscribe ──►│  (Dienste nutzen)
  │◄─── Antworten ────────────────────┤
  │                                   │
  ├─── CloseSession() ───────────────►│  (Ordentlicher Abschluss)
  ├─── CloseSecureChannel() ─────────►│
```

**Wichtig für die Implementierung**: Die `SessionId` repräsentiert einen Server-seitigen Zustand. Bei einem Netzwerkabbruch bleibt dieser Zustand auf dem Server für eine konfigurierbare Dauer (typisch 30 Sekunden) erhalten. Ein intelligenter Client versucht, dieselbe Session via `ActivateSession()` mit der bestehenden `SessionId` zu reaktivieren, anstatt eine neue Session zu erstellen. Dies ist der Kernunterschied zwischen einem robusten und einem naiven Reconnect-Mechanismus.

### 2.2 Dienste-Überblick

OPC UA definiert Dienste (Services) als das Äquivalent zu Remote Procedure Calls. Für die Implementierung relevante Dienste:

| Dienstgruppe | Dienste | Relevanz |
|---|---|---|
| Session Services | CreateSession, ActivateSession, CloseSession | Session-Lifecycle |
| View Services | Browse, BrowseNext, TranslateBrowsePathsToNodeIds | Address Space Explorer |
| Attribute Services | Read, Write | Datenzugriff |
| Subscription Services | CreateSubscription, ModifySubscription, DeleteSubscription | Push-basierte Daten |
| MonitoredItem Services | CreateMonitoredItems, ModifyMonitoredItems | Datenpunkt-Abonnement |
| Method Services | Call | RPC |
| Node Management Services | AddNodes, DeleteNodes | Server-seitige Modellierung |

### 2.3 Publish/Subscribe (OPC UA Part 14)

Das in neueren Spezifikationsversionen eingeführte PubSub-Modell entkoppelt Publisher und Subscriber vollständig. Es nutzt UDP-Multicast oder MQTT als Transportmechanismus und ist primär für Broadcast-Szenarien in Netzwerken mit vielen Teilnehmern ausgelegt. Für die initiale Implementierung liegt der Schwerpunkt auf dem klassischen Client-Server-Modell. PubSub bleibt als optionale Erweiterung für spätere Versionen reserviert.

---

## 3. Transportschichten und Encodings

### 3.1 OPC UA Binary over TCP (UA-TCP)

Der primäre und performanteste Transport für industrielle Anwendungen. Das Format `opc.tcp://hostname:4840` identifiziert diesen Transport.

**Eigenschaften:**
- Binäres Encoding minimiert den Overhead auf ein Minimum
- Nativ optimiert für hohen Durchsatz und niedrige Latenz
- Unterstützt Message Chunking für große Pakete (konfigurierbare `maxMessageSize`)
- Sequence Numbers auf Paketebene verhindern Replay-Angriffe

**Message-Typen im UA-TCP-Header:**
| Message Type | Bedeutung |
|---|---|
| `HEL` / `ACK` | Hello / Acknowledge (Verbindungsparameter aushandeln) |
| `OPN` | OpenSecureChannel |
| `CLO` | CloseSecureChannel |
| `MSG` | Reguläre Dienst-Nachrichten |

### 3.2 HTTPS / JSON über WebSockets

Für Szenarien mit Cloud-Anbindung oder wenn Firewalls nur HTTP-Ports öffnen. JSON-Encoding ist verständlicher, aber 3–5× größer als Binary Encoding. Für die vorliegende Implementierung sekundär.

### 3.3 Message Chunking

Überschreitet eine OPC UA Nachricht die ausgehandelte `maxMessageSize` (typisch 65535 Byte), wird sie automatisch in mehrere Chunks aufgeteilt. Der Smart Batching Scheduler muss dies berücksichtigen: Werden zu viele Nodes in einem `ReadMultipleRequest` gebündelt, kann der resultierende Request größer als `maxMessageSize` werden und muss intern fragmentiert werden.

```
Chunk 1: [Header | IntermediateChunk | Payload-Teil-1]
Chunk 2: [Header | IntermediateChunk | Payload-Teil-2]
Chunk 3: [Header | FinalChunk       | Payload-Teil-3]
```

---

## 4. Sicherheitsarchitektur

### 4.1 Überblick: Mehrschichtige Sicherheit

OPC UA implementiert Sicherheit auf drei Ebenen: Transport, Nachricht und Session. Diese Schichten wirken unabhängig voneinander und ergeben zusammen eine robuste Defense-in-Depth-Architektur.

### 4.2 Security Modes

Der `MessageSecurityMode` wird beim `OpenSecureChannel` ausgehandelt:

| Mode | Schutz | Empfehlung |
|---|---|---|
| `None` | Kein Schutz (Plaintext) | Nur für isolierte Test-Netzwerke |
| `Sign` | Signatur (Integrität, keine Vertraulichkeit) | Interne Produktionsnetzwerke |
| `SignAndEncrypt` | Signatur + Verschlüsselung (Integrität + Vertraulichkeit) | **Default für neue Implementierungen** |

**Implementierungsregel**: Der neue Node verwendet `SignAndEncrypt` als Standard. `None` muss explizit vom Nutzer aktiviert werden und erzeugt eine Warnung im Node-RED Log.

### 4.3 Security Policies

Die Security Policy definiert die kryptographischen Algorithmen:

| Policy | Verschlüsselung | Signatur | Status |
|---|---|---|---|
| `None` | — | — | Veraltet / unsicher |
| `Basic128Rsa15` | RSA-15, AES-128-CBC | SHA-1 | Deprecation in Arbeit |
| `Basic256` | RSA-OAEP, AES-256-CBC | SHA-1 | Deprecation in Arbeit |
| `Basic256Sha256` | RSA-OAEP, AES-256-CBC | SHA-256 | **Empfohlen** |
| `Aes128_Sha256_RsaOaep` | RSA-OAEP, AES-128-CBC | SHA-256 | Modern |
| `Aes256_Sha256_RsaPss` | RSA-PSS, AES-256-CBC | SHA-256 | Höchste Sicherheit |

### 4.4 PKI und X.509 Zertifikate

Jeder OPC UA Teilnehmer (Client und Server) besitzt ein eindeutiges **X.509 v3 Zertifikat** mit einer zugehörigen privaten Schlüsseldatei. Der Zertifikatsaustausch folgt dem **Trust-on-First-Use (TOFU)** Prinzip mit manueller Bestätigung:

```
PKI/
├── own/
│   ├── certs/
│   │   └── client_certificate.der      ← Eigenes Zertifikat (öffentlich)
│   └── private/
│       └── client_key.pem              ← Privater Schlüssel (NIEMALS loggen!)
├── trusted/
│   └── certs/
│       └── server_certificate.der      ← Explizit vertrauenswürdige Server-Zertifikate
├── rejected/
│   └── server_certificate_new.der      ← Quarantäne: noch nicht vertraute Zertifikate
└── issuers/
    └── certs/
        └── ca_certificate.der          ← Certificate Authority Zertifikate
```

**Verbindungsablauf mit PKI:**
1. Client sendet sein Zertifikat im `CreateSession` Request
2. Server prüft: Ist das Client-Zertifikat in `trusted/certs/`? → Verbindung erlaubt
3. Ist es unbekannt? → Ablehnung; Zertifikat landet in Server's `rejected/`
4. Admin muss das Zertifikat manuell in `trusted/certs/` verschieben
5. Umgekehrt prüft der Client das Server-Zertifikat nach demselben Prinzip

Das **Security Dashboard** im `opcua-client-config` Node automatisiert Schritt 4 via Browser-UI.

### 4.5 Nutzer-Authentifizierung

Zusätzlich zur Applikations-Authentifizierung (Zertifikat) fordert OPC UA eine Nutzer-Authentifizierung beim `ActivateSession`:

| Methode | Sicherheit | Anwendungsfall |
|---|---|---|
| Anonymous | Keine | Öffentliche Daten / Tests |
| Username/Password | Mittel (über TLS) | Einfache Zugangskontrolle |
| X.509 User Certificate | Hoch | Enterprise / PKI-Infrastrukturen |
| IssuedToken (JWT) | Hoch | Cloud / OAuth-Szenarien |

---

## 5. Informationsmodell und Address Space

### 5.1 Konzeptionelle Grundlagen

Der **Address Space** ist das zentrale Konzept von OPC UA. Es handelt sich um einen gerichteten Graphen, in dem alle Entitäten (Sensoren, Maschinen, Daten, Methoden) als **Nodes** (Knoten) repräsentiert werden. Die Nodes sind über typisierte **References** (Referenzen) miteinander verbunden.

```
RootFolder
├── Objects/
│   └── Machine_1/ (FolderType)
│       ├── Temperature (VariableType: Double) ← ns=2;s=Machine_1.Temperature
│       ├── Status (VariableType: Int32)
│       └── Reset() (Method)
├── Types/
│   └── DataTypes/
│       └── MachineStatusType (EnumType)
└── Views/
```

### 5.2 Node-Klassen

OPC UA definiert **8 Node-Klassen**:

| Klasse | Beschreibung | Beispiel |
|---|---|---|
| `Object` | Repräsentiert eine physische oder logische Entität | Maschine, Sensor |
| `Variable` | Hält einen Datenwert | Temperaturwert |
| `Method` | Aufrufbare Funktion | Reset(), Start() |
| `ObjectType` | Typdefinition für Objects | MachineType |
| `VariableType` | Typdefinition für Variables | AnalogItemType |
| `ReferenceType` | Typdefinition für References | HasComponent |
| `DataType` | Datentyp-Definition | Double, Structure |
| `View` | Filter-Sicht auf den Address Space | — |

### 5.3 NodeId — Globale Identifikation

Jeder Node hat eine eindeutige **NodeId**, bestehend aus:
- `namespaceIndex (ns)`: Integer; ns=0 ist der OPC UA Standard-Namespace
- `identifier`: Der eigentliche Bezeichner in einem von vier Formaten

| Format | Syntax | Beispiel |
|---|---|---|
| Numeric | `ns=<idx>;i=<number>` | `ns=0;i=2253` (Server-Knoten) |
| String | `ns=<idx>;s=<string>` | `ns=2;s=Machine.Temperature` |
| GUID | `ns=<idx>;g=<guid>` | `ns=3;g=72962B91-...` |
| Opaque | `ns=<idx>;b=<base64>` | Selten, für proprietäre Systeme |

**Wichtige Standard-NodeIds (ns=0):**
- `i=84` — RootFolder
- `i=85` — Objects Folder
- `i=86` — Types Folder
- `i=2253` — Server-Objekt (enthält Serverstatus, Namespace-Array etc.)

### 5.4 Attributes

Jeder Node hat Attribute, die seinen Zustand beschreiben. Die wichtigsten:

| Attribut | Node-Klassen | Bedeutung |
|---|---|---|
| `NodeId` | Alle | Eindeutiger Identifier |
| `NodeClass` | Alle | Typ des Nodes |
| `BrowseName` | Alle | Menschenlesbarer Name (nicht für Adressierung gedacht) |
| `DisplayName` | Alle | Lokalisierter Anzeigename |
| `Value` | Variable | Der aktuelle Datenwert (inkl. Qualität und Timestamp) |
| `DataType` | Variable | NodeId des Datentyps |
| `ValueRank` | Variable | Skalar (-1), Array (1), Matrix (2+) |
| `ArrayDimensions` | Variable | Dimensionen für Arrays |
| `AccessLevel` | Variable | Lese/Schreib-Berechtigungen (Bitmask) |

### 5.5 References — Der Graph

References sind typisierte, gerichtete Kanten zwischen Nodes. Wichtige Reference-Typen:

| Reference | Beschreibung |
|---|---|
| `HierarchicalReferences` | Oberbegriff für strukturierende Referenzen |
| `HasComponent` | Parent enthält Child (Ordner enthält Variable) |
| `HasProperty` | Eigenschaft eines Nodes |
| `Organizes` | Folder → Kind-Knoten (lockere Organisation) |
| `HasSubtype` | Typvererbung |
| `HasTypeDefinition` | Instanz → sein Typ |

Beim Browsen des Address Space wird `BrowseDirection.Forward` genutzt, um die Kind-Knoten eines Elternknotens zu ermitteln. `BrowseDirection.Both` würde auch Rückwärtsreferenzen liefern (Performance-intensiver).

---

## 6. Subscriptions, Monitored Items und Report-by-Exception

### 6.1 Das Subscription-Konzept

Anstatt zyklisches Polling ist OPC UA auf **Push-basierte Datenübertragung** ausgelegt. Das dreistufige Modell:

```
OPC UA Server                     OPC UA Client
     │                                  │
     │  ◄── CreateSubscription() ───────┤
     │  ──── SubscriptionId ───────────►│
     │                                  │
     │  ◄── CreateMonitoredItems() ─────┤  (mit NodeIds und Sampling-Intervall)
     │  ──── MonitoredItemIds ─────────►│
     │                                  │
     │  [Server überwacht intern...]    │
     │                                  │
     │  ──── Publish (NotificationMsg) ►│  (nur bei Wertänderung oder Keepalive)
     │  ◄── PublishRequest ─────────────┤  (Bestätigung + nächste Publish-Anfrage)
```

**Parameter einer Subscription:**
- `publishingInterval` (ms): Wie oft der Server prüft und notifiziert (z.B. 500ms)
- `lifetimeCount`: Wie viele `publishingInterval`s ohne Publish-Anfrage toleriert werden
- `maxKeepAliveCount`: Wie oft der Server einen leeren Keepalive sendet (verhindert Timeout)

**Parameter eines Monitored Items:**
- `samplingInterval` (ms): Wie often der Server den Wert intern sampelt (≤ publishingInterval)
- `queueSize`: Puffergröße für verpasste Änderungen
- `discardOldest`: Bei Puffer-Überlauf: Älteste oder neueste verwerfen?
- `filter`: `DataChangeFilter` (Deadband) oder `EventFilter`

### 6.2 Report-by-Exception und Deadband-Filter

Der `DataChangeFilter` verhindert sinnloses Rauschen:

```javascript
dataChangeFilter: {
  trigger: DataChangeTrigger.StatusValueTimestamp,
  deadbandType: DeadbandType.Absolute,
  deadbandValue: 0.5  // Nur bei Änderung > 0.5 Einheiten senden
}
// Alternativ: DeadbandType.Percent (prozentualer Deadband)
```

### 6.3 Session Re-Establishment und Subscriptions

**Kritische Implementierungsdetail**: Nach einer Netzwerkunterbrechung sind Subscriptions nicht verloren, wenn die Session reaktiviert werden kann. `node-opcua` bietet hierfür den Mechanismus des `reconnectAndUpdateSession`. Die Subscription-IDs auf dem Server bleiben erhalten, solange die Session-Lifetime nicht überschritten wurde. Der Client muss nach der Reaktivierung lediglich die `Publish` Anfragen erneut senden — **er muss keine neuen Subscriptions erstellen**.

---

## 7. Methods und Remote Procedure Calls

### 7.1 Method-Aufruf-Mechanismus

OPC UA Methods sind der standardisierte RPC-Mechanismus. Ein Method-Call via `Call` Service:

```javascript
// Client-seitiger Aufruf
const result = await session.call({
  objectId: "ns=2;s=Machine_1",      // Objekt, zu dem die Methode gehört
  methodId: "ns=2;s=Machine_1.Reset", // Die Methode selbst
  inputArguments: [
    { dataType: DataType.Boolean, value: true }
  ]
});
// result.outputArguments enthält die Rückgabewerte
```

### 7.2 Korrelation in asynchronen Flows

Das Routing von Method-Calls durch Node-RED Flows erfordert eine **Correlation-ID**, da Node-RED-Nachrichten keinen eingebauten Request-Response-Mechanismus haben:

```
opcua-method Node                    Flow                   opcua-method-response Node
      │                                │                              │
      │── msg.payload = inputArgs ────►│                              │
      │   msg._opcua_method_id = UUID  │                              │
      │                                │◄── (Flow-Logik) ────────────►│
      │                                │── msg.payload = Ergebnis ───►│
      │                                │   msg._opcua_method_id = UUID│
      │◄── Antwort per UUID-Lookup ────┤                              │
```

Die UUID wird intern in einer `Map<UUID, PendingPromise>` im `opcua-method` Node gespeichert und bei Eingang des Ergebnisses aufgelöst.

---

## 8. Extension Objects und User Defined Types (UDTs)

### 8.1 Das Problem komplexer Datenstrukturen

Moderne SPSen (Siemens S7-1500, Rockwell, Mitsubishi) nutzen intensiv **User Defined Types (UDTs)** — verschachtelte Strukturdefinitionen, die mehrere Basisdatentypen bündeln. Diese werden in OPC UA als **Extension Objects** (NodeClass: `Structure`) übertragen.

Ein roher Extension Object auf dem Draht ist ein binär kodiertes `ByteString`-Blob, dem ein `TypeId` vorangestellt ist, der auf die Strukturdefinition im Address Space verweist.

### 8.2 Deserialisierung in node-opcua

`node-opcua` kann Extension Objects automatisch deserialisieren, wenn:
1. Der `DataType` der Variable im Address Space korrekt als `Structure` definiert ist
2. Die Struktur-Encoding-NodeId in der Bibliothek registriert ist

```javascript
// Automatische Deserialisierung durch node-opcua
const dataValue = await session.readVariableValue("ns=3;s=MachineData");

// dataValue.value.value ist nach der Deserialisierung ein JS-Objekt:
// {
//   temperature: 23.5,
//   pressure: 1.013,
//   status: { running: true, errorCode: 0 }
// }
```

### 8.3 Rekursive JSON-Konvertierung

Für den Fall, dass node-opcua ein Extension Object nicht automatisch decodiert (unregistrierter Typ), implementiert der Node eine rekursive Fallback-Dekodierung:

```
ExtensionObject (ByteString)
  └── TypeDefinition-Lookup (via Browse auf den DataType-Node)
      └── Struktur-Felder iterieren
          ├── Feld 1: Primitive (Double)    → direkt in JSON
          ├── Feld 2: Array (Float[])       → JSON-Array
          └── Feld 3: Nested Structure      → rekursiver Aufruf
```

**Regel**: `msg.payload` enthält immer ein normales JavaScript-Objekt. Rohe `ByteString`-Blobs werden niemals an den Flow weitergegeben.

---

## 9. Companion Specifications und NodeSet2.xml

### 9.1 Companion Specifications

Die OPC Foundation und Industrieverbände definieren **Companion Specifications**: standardisierte Informationsmodelle für spezifische Domänen.

| Spezifikation | Domäne |
|---|---|
| OPC UA for Machinery (OPC 10000-100) | Allgemeiner Maschinenbau |
| OPC UA for Euromap 77 | Kunststoff-Spritzguss |
| OPC UA for CNC Systems | Zerspanungsmaschinen |
| OPC UA for Robotics | Industrieroboter |
| OPC UA for MDIS | Marine/Öl & Gas |
| OPC UA for AutoID | RFID / Barcode-Leser |

### 9.2 NodeSet2.xml Format

Companion Specifications werden als `NodeSet2.xml` Dateien veröffentlicht. Sie definieren:
- Neue `DataType` Definitionen (Strukturen, Enums)
- Neue `ObjectType` Definitionen (Maschinenmuster)
- Instanzen und Beispiel-Topologien

```xml
<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">
  <NamespaceUris>
    <Uri>http://opcfoundation.org/UA/Machinery/</Uri>
  </NamespaceUris>
  <UAReferenceType NodeId="ns=1;i=4002" BrowseName="1:HasMachineryComponent">
    ...
  </UAReferenceType>
  <UAObjectType NodeId="ns=1;i=1000" BrowseName="1:MachineType">
    ...
  </UAObjectType>
</UANodeSet>
```

`node-opcua` bietet `generateAddressSpace(addressSpace, xmlFiles)` zum Einlesen dieser Dateien.

---

## 10. Node-RED Architektur und Low-Code-Paradigma

### 10.1 Grundprinzipien von Node-RED

Node-RED ist eine flow-basierte, visuelle Programmierumgebung auf Basis von Node.js. Kernkonzepte:

- **Nodes**: Grundbausteine; haben Inputs und/oder Outputs
- **Flows**: Verbindungen (Wires) zwischen Nodes bilden Datenflüsse
- **Messages (`msg`)**: JavaScript-Objekte, die durch den Flow transportiert werden
- **Context**: Persistenter Speicher (Node-, Flow-, Global-Scope)
- **Configuration Nodes**: Hintergrundknoten ohne eigene UI-Position, die von anderen Nodes referenziert werden

### 10.2 Node-RED Lifecycle-Hooks

Für die korrekte Implementierung müssen folgende Lifecycle-Events behandelt werden:

```javascript
module.exports = function(RED) {
  function OpcuaClientConfig(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Initialisierung (sync oder async)
    node.on('input', (msg, send, done) => {
      // Nachrichten verarbeiten
      done(); // Immer done() aufrufen!
    });

    node.on('close', (removed, done) => {
      // KRITISCH: Ressourcen freigeben (TCP-Verbindung, Session, Subscriptions)
      // Wird bei Redeploy UND bei Flow-Stop aufgerufen
      // removed === true → Node wurde aus dem Flow entfernt
      done();
    });
  }
  RED.nodes.registerType('opcua-client-config', OpcuaClientConfig);
};
```

### 10.3 Configuration Nodes

Configuration Nodes sind der Standard-Mechanismus in Node-RED für geteilte Ressourcen. Ein Worker-Node referenziert seinen Config-Node:

```javascript
// In der Worker-Node-Implementierung
function OpcuaRead(config) {
  RED.nodes.createNode(this, config);
  this.configNode = RED.nodes.getNode(config.connection); // Referenz holen
  
  if (!this.configNode) {
    this.status({ fill: "red", shape: "ring", text: "Kein Config-Node" });
    return;
  }
  
  // Auf State-Changes des Config-Nodes reagieren
  this.configNode.on('stateChange', (state) => {
    if (state === 'SESSION_ACTIVE') {
      this.status({ fill: "green", shape: "dot", text: "Verbunden" });
    }
  });
}
```

### 10.4 Node-RED Admin-API für Browser-Integration

Für den visuellen Address Space Browser registriert der Config-Node HTTP-Routen im Node-RED Admin-Server:

```javascript
// Backend: Route registrieren
RED.httpAdmin.get('/opcua-admin/browse', RED.auth.needsPermission('opcua.browse'), (req, res) => {
  const nodeId = req.query.nodeId || 'RootFolder';
  const configNodeId = req.query.configId;
  const configNode = RED.nodes.getNode(configNodeId);
  
  if (!configNode || !configNode.session) {
    return res.status(503).json({ error: 'Keine aktive Session' });
  }
  
  configNode.browse(nodeId)
    .then(results => res.json(results))
    .catch(err => res.status(500).json({ error: err.message }));
});
```

```javascript
// Frontend (in der .html-Datei des Nodes): RED.treeList nutzen
const treeList = $('<ol>').css({height: '350px'}).treeList({}).appendTo(container);
// AJAX-Aufruf zum Backend
$.getJSON('opcua-admin/browse?nodeId=RootFolder&configId=' + configId, (data) => {
  treeList.treeList('data', data.map(item => ({
    label: item.displayName,
    icon: item.nodeClass === 'Variable' ? 'fa fa-tag' : 'fa fa-folder',
    children: item.hasChildren ? [] : undefined,
    onexpand: (item) => loadChildren(item.nodeId)
  })));
});
```

### 10.5 Node-RED Context API

Für die Server-side Context Bridge:

```javascript
// Schreiben in verschiedene Context-Scopes
node.context().set('localKey', value);           // Node-Scope
node.context().flow.set('flowKey', value);       // Flow-Scope
node.context().global.set('globalKey', value);   // Global-Scope

// Lesen
const val = node.context().global.get('globalKey');

// Mit asynchronen Context-Stores (z.B. Redis-Persistenz)
node.context().global.get('key', 'storeAlias', (err, value) => { ... });
```

---

## 11. Analyse bestehender Implementierungen

### 11.1 node-red-contrib-opcua (Legacy)

- **Repository**: [github.com/node-red-contrib-opcua](https://github.com/node-red-contrib-opcua/)
- **Maintainer**: Mika Karaila, Community
- **Kernproblem**: Initiiert pro konfiguriertem Worker-Node eine eigene OPC UA Session → Session-Overflow bei SPSen mit harten Limits (typisch 5–20 gleichzeitige Sessions)
- **Weitere Defizite**: Kein Batching serieller Reads, instabiles Reconnect-Handling, keine UDT-Deserialisierung, keine visuelle NodeId-Auswahl

### 11.2 node-red-contrib-iiot-opcua (Fork)

- **Repository**: [github.com/BiancoRoyal/node-red-contrib-iiot-opcua](https://github.com/BiancoRoyal/node-red-contrib-iiot-opcua)
- **Maintainer**: Klaus Landsdorf
- **Verbesserungen**: Verbesserte Array-Unterstützung (Float[ ], Double[ ], Int64[ ]), dynamische Node-Aktivierung via `${OPCUA_ENABLE}` Umgebungsvariablen
- **Verbleibende Defizite**: Fundamentales Session-Management-Problem bleibt bestehen; kein Smart Batching

### 11.3 Kommerzielle State-of-the-Art Lösungen

Im kommerziellen Umfeld existieren vollständige Node-RED OPC UA Integrations-Pakete, die die Schwächen der Open-Source-Derivate durch ein durchdachtes Architekturdesign vollständig adressieren.

- **Lizenz**: Kommerziell (proprietär)
- **Architektonische Stärken**:
  - Intelligent Session Sharing (ein Config Node, beliebig viele Worker)
  - Smart Batching Algorithmus (bis zu 90% Performancegewinn durch Request-Aggregation)
  - Industrial-Grade Auto-Healing mit exponentialem Backoff
  - Visueller NodeId-Browser direkt im Konfigurations-Dialog
  - Certificate Manager UI
  - TDD Methodik mit hoher Testabdeckung

**Gap**: Diese Referenzarchitektur existiert ausschließlich als kommerzielle Lösung. Der neue OSS-Node schließt diese Lücke, indem er identische Architekturmuster unter Apache 2.0 bereitstellt.

---

## 12. Lizenzrechtliche Grundlagen

### 12.1 Abhängigkeits-Analyse

| Paket | Lizenz | Verwendung | Kompatibilität mit Apache 2.0 |
|---|---|---|---|
| `node-opcua` | MIT | Kernbibliothek | ✅ Vollständig kompatibel |
| `node-red` | Apache 2.0 | Runtime-Plattform | ✅ Identische Lizenz |
| `mocha` | MIT | Testing | ✅ Dev-Dependency, irrelevant |
| `jest` | MIT | Testing | ✅ Dev-Dependency, irrelevant |

### 12.2 Warum Apache License 2.0

Die MIT-Lizenz ist die einfachste permissive Lizenz, enthält jedoch **keinen expliziten Patent Grant**. In industriellen Umgebungen, in denen Patentfragen zentral sind (Siemens, Bosch, Endress+Hauser etc.), bietet die **Apache License 2.0** entscheidende Vorteile:

1. **Expliziter Patent Grant**: Jeder Contributor gewährt eine patentlizenzfreie Nutzung für seinen Beitrag
2. **Patent Retaliation Clause**: Klagen wegen Patentverletzung durch Projekt-Code entziehen dem Kläger automatisch die Lizenz
3. **Contribution Attribution**: NOTICE-Datei ermöglicht Tracking von Beiträgen
4. **Enterprise-Akzeptanz**: Präferenz großer Unternehmen für Apache 2.0 gegenüber MIT in sicherheitskritischen Systemen

**Lizenzkompatibilität**: Ein Apache 2.0-Projekt, das MIT-lizenzierte Bibliotheken (`node-opcua`) als `dependencies` deklariert, ist rechtlich vollständig korrekt. Die MIT-Bibliotheken behalten ihre MIT-Lizenz; der eigene Code steht unter Apache 2.0.

---

## 13. Technische Grundlage: node-opcua Bibliothek

### 13.1 Überblick

`node-opcua` (https://github.com/node-opcua/node-opcua) ist die vollständige OPC UA Stack-Implementierung für Node.js/TypeScript. Sie implementiert die OPC UA Spezifikation (IEC 62541) Parts 1–14.

- **Lizenz**: MIT
- **Sprache**: TypeScript (konsumierbar aus JavaScript)
- **OPC UA Konformitätslevel**: 4/4 (vollständig)
- **Aktive Wartung**: Ja (aktiv gepflegt, MIT-lizenziert)

### 13.2 Wichtige Client-APIs

```javascript
const { OPCUAClient, MessageSecurityMode, SecurityPolicy } = require('node-opcua');

// Client erstellen
const client = OPCUAClient.create({
  applicationName: 'NodeRED-OpcUA-Client',
  connectionStrategy: {
    initialDelay: 1000,          // 1s erster Retry
    maxRetry: Infinity,          // Unendlich viele Retries
    maxDelay: 30000              // Max 30s zwischen Retries
  },
  securityMode: MessageSecurityMode.SignAndEncrypt,
  securityPolicy: SecurityPolicy.Basic256Sha256,
  certificateFile: './pki/own/certs/client.der',
  privateKeyFile: './pki/own/private/client_key.pem',
  keepSessionAlive: true
});

// Verbindung aufbauen
await client.connect(endpointUrl);

// Session erstellen
const session = await client.createSession({ type: UserTokenType.Anonymous });

// Lesen
const dataValue = await session.readVariableValue('ns=2;s=Temperature');
console.log(dataValue.value.value);     // Der eigentliche Wert
console.log(dataValue.statusCode);      // Good / Bad / Uncertain
console.log(dataValue.sourceTimestamp); // Zeitstempel von der SPS

// Multi-Read (Smart Batching Grundlage)
const results = await session.read([
  { nodeId: 'ns=2;s=Temperature', attributeId: AttributeIds.Value },
  { nodeId: 'ns=2;s=Pressure',    attributeId: AttributeIds.Value }
]);

// Session schließen
await session.close();
await client.disconnect();
```

### 13.3 Wichtige Server-APIs

```javascript
const { OPCUAServer, Variant, DataType } = require('node-opcua');

// Server erstellen
const server = new OPCUAServer({
  port: 4840,
  resourcePath: '/UA/NodeRedServer',
  buildInfo: { productName: 'NodeREDOpcUAServer' }
});

await server.initialize();

// Address Space aufbauen
const addressSpace = server.engine.addressSpace;
const namespace = addressSpace.getOwnNamespace();

const folder = namespace.addFolder('RootFolder', { browseName: 'Sensors' });

const variable = namespace.addVariable({
  componentOf: folder,
  browseName: 'Temperature',
  dataType: 'Double',
  value: {
    get: () => new Variant({ dataType: DataType.Double, value: flow.get('temp') }),
    set: (variant) => { flow.set('temp', variant.value); return StatusCodes.Good; }
  }
});

await server.start();
```

### 13.4 Exponential Backoff in node-opcua

`node-opcua` implementiert die Reconnect-Logik intern, wenn `connectionStrategy` konfiguriert ist. Der Client feuert folgende Events:

```javascript
client.on('connection_lost', () => { /* FSM → CONNECTION_LOST */ });
client.on('reconnecting', ({ initialDelay, maxRetry, attempt }) => { /* FSM → RECONNECTING */ });
client.on('connection_reestablished', () => { /* FSM → CONNECTED → SESSION_ACTIVE */ });
client.on('after_reconnection', (err) => { /* Session reaktivieren */ });
```

---

## Weiterführende Referenzen

| Ressource | URL |
|---|---|
| OPC UA Spezifikation (IEC 62541) | https://reference.opcfoundation.org/ |
| node-opcua Dokumentation | https://node-opcua.github.io/api_doc/ |
| node-opcua Beispiele | https://github.com/node-opcua/node-opcua/tree/master/packages/node-opcua-samples |
| Node-RED Creating Nodes Guide | https://nodered.org/docs/creating-nodes/ |
| Node-RED Config Nodes | https://nodered.org/docs/creating-nodes/config-nodes |
| OPC Foundation | https://opcfoundation.org/ |
| Companion Specification Repository | https://github.com/OPCFoundation/ |
