# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-16

### Added

#### Client Nodes
- **opcua-client-config** — Central configuration node with Finite State Machine (FSM)
  managing a single OPC UA session for all worker nodes. Supports security modes
  (None, Sign, SignAndEncrypt), policies (Basic256Sha256, Aes128_Sha256_RsaOaep,
  Aes256_Sha256_RsaPss), and encrypted credential storage.
- **opcua-read** — Smart-batching read node. Concurrent requests are automatically
  bundled into a single `ReadMultipleRequest` via the BatchScheduler.
- **opcua-write** — Smart-batching write node with automatic Variant wrapping and
  configurable OPC UA data types.
- **opcua-subscribe** — Push-based DataChange subscription node with configurable
  publishing interval, sampling interval, deadband, and queue size.
- **opcua-method** — Client-side OPC UA method call node with input/output argument
  mapping and error propagation.

#### Server Nodes
- **opcua-server-config** — Server lifecycle manager bound to Node-RED deploy/undeploy.
  Graceful TCP port release on redeploy (no EADDRINUSE).
- **opcua-folder** — Programmatic address space folder creation with parent hierarchy.
- **opcua-variable** — Context-bridged variable node with bidirectional binding to
  Node-RED flow/global context via getter/setter. Supports `triggerOnWrite` to emit
  messages into the flow on external OPC UA writes.
- **opcua-server-method** — Server-side RPC method registration with Correlation-ID
  pattern (`msg._opcua_method_id`) and configurable timeout.
- **opcua-method-response** — Completes async method calls by matching Correlation-ID
  and resolving the pending OPC UA response.

#### Libraries
- **Finite State Machine** (`lib/client/fsm.js`) — 6-state FSM
  (DISCONNECTED → CONNECTING → CONNECTED → SESSION_ACTIVE → CONNECTION_LOST → RECONNECTING)
  with strict transition validation and EventEmitter-based state change notifications.
- **Connection Manager** (`lib/client/connection-manager.js`) — OPC UA client factory
  with configurable security and session timeout.
- **Session Manager** (`lib/client/session-manager.js`) — Session re-establishment
  (not recreation) after reconnect, subscription reactivation, user identity builder.
- **Error Handler** (`lib/client/error-handler.js`) — Classifies OPC UA StatusCodes
  into categories (AUTH, LIMIT, SESSION, NETWORK, GENERAL) for appropriate error handling.
- **Batch Scheduler** (`lib/client/batch-scheduler.js`) — High-resolution timer-based
  micro-task queue that aggregates concurrent read/write requests into single
  `ReadMultiple`/`WriteMultiple` RPCs. Supports configurable batch window and automatic
  request fragmentation.
- **UDT Deserializer** (`lib/client/udt-deserializer.js`) — Recursive Extension Object
  deserialization into plain JSON. Handles TypedArrays (Float32Array, Int32Array → JS Array),
  nested structures, and null-safe normalization.
- **PKI Manager (Client)** (`lib/client/pki-manager.js`) — Auto-generates X.509
  application certificate on first run. Lists/trusts/rejects server certificates
  via filesystem operations (`fs.renameSync` for atomic trust).
- **PKI Manager (Server)** (`lib/server/pki-manager.js`) — Server-side certificate
  management for client certificate whitelisting.
- **Context Bridge** (`lib/server/context-bridge.js`) — Bidirectional data binding
  between OPC UA variables and Node-RED flow/global context with type validation
  (`BadTypeMismatch` on data type conflicts).
- **NodeSet Importer** (`lib/server/nodeset-importer.js`) — Parses NodeSet2.xml
  companion specifications at startup. Validates paths against traversal attacks.

#### Visual UX
- **Address Space Browser** — Lazy-loading tree view (`RED.treeList`) registered on
  `GET /opcua-admin/browse`. Clicking a variable inserts its NodeId into the config
  dialog. Browse buttons integrated into all worker node HTML editors.
- **Security Dashboard** — Lists rejected/trusted certificates in the config node UI.
  Trust/reject operations via REST API with filename validation.
- **Server PKI Dashboard** — Equivalent certificate management UI for the server
  config node.

#### Infrastructure
- **GitHub Actions CI** (`.github/workflows/ci.yml`) — Matrix testing on Node.js 18, 20, 22.
  Coverage enforcement (≥85% lines/functions, ≥80% branches). Security audit and
  credential leak detection.
- **Node-RED Info Sidebar** — All 10 nodes include `data-help-name` sections with
  technical documentation for the Node-RED help panel.
- **Test suite** — 386+ unit and integration tests using Mocha + Sinon + c8.
  Mock OPC UA server for offline testing. Coverage ≥ 87% lines.

### Security
- Default security mode: `SignAndEncrypt` with `Basic256Sha256`.
- Auto-generated X.509 application certificates (10-year validity).
- Path traversal protection on all HTTP routes and file operations.
- Input validation for NodeIds, configIds, and certificate filenames.
- No credentials or private keys logged or committed.

### Dependencies
- `node-opcua` ^2.116.0 (MIT)
- Node.js ≥ 18.0.0
- Node-RED ≥ 3.0.0

[0.1.0]: https://github.com/your-org/node-red-contrib-opcua-pro/releases/tag/v0.1.0
