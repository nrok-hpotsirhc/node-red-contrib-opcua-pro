# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-16

### Added

#### Client Nodes
- **opcua-client-config**: Central Configuration Node with Finite State Machine (6 states: DISCONNECTED → CONNECTING → CONNECTED → SESSION_ACTIVE → CONNECTION_LOST → RECONNECTING)
- **opcua-read**: Smart-batching read worker node — concurrent reads are batched into a single `ReadMultipleRequest`
- **opcua-write**: Smart-batching write worker node with automatic Variant wrapping
- **opcua-subscribe**: Push-based DataChange subscription with auto-reactivation after reconnect
- **opcua-method**: Client-side OPC UA Method Call node with input argument support

#### Server Nodes
- **opcua-server-config**: OPC UA Server lifecycle management bound to Node-RED deploy/undeploy cycle
- **opcua-folder**: Programmatic folder creation in the server address space
- **opcua-variable**: Context-bridged OPC UA variable node (bidirectional flow/global context binding)
- **opcua-server-method**: Server-side method registration with Correlation-ID (`msg._opcua_method_id`) pattern
- **opcua-method-response**: Returns method results using internal Correlation-ID for concurrent call support

#### Libraries
- **Batch Scheduler** (`lib/client/batch-scheduler.js`): Micro-task-queue with high-resolution timer for batching concurrent OPC UA operations
- **Connection Manager** (`lib/client/connection-manager.js`): OPCUAClient factory with exponential backoff reconnect strategy
- **Session Manager** (`lib/client/session-manager.js`): Session re-establishment (not recreation) after reconnect to prevent server-side session table overflow
- **Error Handler** (`lib/client/error-handler.js`): OPC UA StatusCode classification (RECONNECT / AUTH / LIMIT / DATA / UNKNOWN)
- **UDT Deserializer** (`lib/client/udt-deserializer.js`): Recursive Extension Object deserialization into plain JSON
- **Context Bridge** (`lib/server/context-bridge.js`): Bidirectional binding between OPC UA variables and Node-RED flow/global context
- **NodeSet Importer** (`lib/server/nodeset-importer.js`): NodeSet2.xml companion specification import at server startup
- **PKI Manager** (client + server): Auto-generation of X.509 application certificates on first run

#### UX & Security
- Visual Address Space Browser with lazy-loading `RED.treeList` in editor dialogs
- HTTP browse route (`GET /opcua-admin/browse`) for real-time address space exploration
- Security Dashboard for client and server PKI certificate management (list/trust/reject)
- Auto-generated X.509 certificates for TLS (SignAndEncrypt with Basic256Sha256)
- Path traversal protection on all HTTP routes and file operations

#### Quality & CI
- GitHub Actions CI pipeline testing on Node.js 18, 20, 22
- Test coverage ≥ 90% lines, ≥ 90% branches, ≥ 96% functions
- ESLint configuration for code quality enforcement
- Security scan: `npm audit` + credential leak detection
- 423 unit and integration tests
- Node-RED Info Sidebar help text for all 10 nodes
- Apache License 2.0

### Security
- Default security mode: `SignAndEncrypt` with `Basic256Sha256` policy
- Certificate validation with PKI rejected/trusted directory structure
- Input validation on all HTTP admin routes (configId, nodeId, filename)
- No credentials or private keys logged or committed
- `fs.renameSync()` for atomic trust operations (no copyFile + unlink race)

[0.1.0]: https://github.com/your-org/node-red-contrib-opcua-pro/releases/tag/v0.1.0
