# AGENTS.md – OPC UA Node-RED Open-Source Node

## Documentation Index

| Document | Purpose |
|---|---|
| [docs/theoretical-foundations.md](docs/theoretical-foundations.md) | OPC UA protocol deep-dive, Node-RED architecture, security, UDTs, PKI — read before implementing |
| [docs/work-packages.md](docs/work-packages.md) | All work packages with deliverables, acceptance criteria, and code scaffolds |
| [docs/milestones.md](docs/milestones.md) | Milestones grouping WPs into agent sessions — **start here each session** |
| [README.md](README.md) | User-facing overview, installation, quick start |

---

## Project Purpose

Develop a production-grade, open-source OPC UA integration for Node-RED that fills the gap between outdated legacy nodes and commercial enterprise solutions. Target users: system integrators, academics, start-ups, and industrial IoT developers.

**License:** Apache License 2.0 (chosen for patent grant protection in industrial/enterprise contexts)  
**Core dependency:** [`node-opcua`](https://github.com/node-opcua/node-opcua) (MIT) — the full OPC UA stack for Node.js/TypeScript

---

## Architecture Overview

### Fundamental Design Principles

- **Strict separation** of connection management, protocol logic, and UI
- **Central Configuration Node** (`opcua-client-config`) owns the single OPC UA session — never create one session per worker node
- **Smart Batching Scheduler** aggregates concurrent read/write requests into OPC UA `ReadMultiple`/`WriteMultiple` RPCs
- **Industrial-grade Auto-Healing** via exponential backoff reconnect and session re-establishment (not session recreation)
- **Visual UX** — NodeId browser, PKI management UI — all embedded in Node-RED editor dialogs

### Client Architecture (Three Pillars)

#### Pillar 1 — Connection & Session Pooling (Config Node)
- One `opcua-client-config` node manages a **Finite State Machine** with states:
  `DISCONNECTED → CONNECTING → CONNECTED → SESSION_ACTIVE → CONNECTION_LOST → RECONNECTING`
- Event emitter propagates state to all dependent worker nodes (status icons: red/yellow/green)
- Reconnect uses **exponential backoff** with a configurable max delay
- On reconnect: **reactivate** the existing Session ID rather than creating a new session (prevents server-side session table overflow)
- On deploy/redeploy: graceful disconnect and clean resource release

#### Pillar 2 — Smart Batching Scheduler
- Worker nodes (`opcua-read`, `opcua-write`) submit requests to an internal **Micro-Task-Queue** in the config node
- A high-resolution timer (5–10 ms window) batches concurrent requests into one `ReadMultipleRequest` or `WriteMultipleRequest`
- Server responses are de-multiplexed via internal Promise IDs back to the originating node
- Transparent to the user; reduces network load by up to 90% in high-node-count flows
- Large requests are automatically **fragmented** to respect server max packet size

#### Pillar 3 — Editor UX & PKI Management
- **Visual Address Space Browser** using `RED.treeList` component:
  - Backend registers `GET /opcua-admin/browse?nodeId=<Target>` via `RED.httpAdmin`
  - Lazy-loads child nodes on expand (avoids memory issues with large PLCs)
  - Clicking a variable copies its `NodeId` into the config dialog field
- **Security Dashboard** in the config node UI:
  - Lists certificates in `PKI/rejected/`
  - "Trust" button moves `.der` to `PKI/trusted/certs/` via `fs` module
  - No CLI knowledge required for TLS setup

### Server Architecture

- Central `opcua-server-config` node owns `OPCUAServer` lifecycle (port 4840 default)
- Graceful shutdown on `node.on('close', ...)` — releases TCP port on redeploy
- **Address Space Definition** via two parallel mechanisms:
  1. **Dynamic Node Builder**: `opcua-folder`, `opcua-variable` nodes build namespace programmatically via `namespace.addFolder()` / `namespace.addVariable()`
  2. **NodeSet2.xml Importer**: parses companion specifications (OPC UA for Machinery, Euromap, etc.) at startup via `generateAddressSpace()`
- **Context Bridge** (bidirectional data link):
  - OPC UA variable getters → `flow.get("key")` / global context read
  - OPC UA variable setters → `flow.set("key", value)` + optional msg trigger in flow
- **Method RPC**: `opcua-method` node injects method calls into the flow as messages; `opcua-method-response` returns results using an internal Correlation-ID (`msg._opcua_method_id`)

---

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (event-loop, non-blocking async) |
| OPC UA | `node-opcua` (TypeScript, MIT) |
| Node-RED UI | `RED.treeList`, `RED.httpAdmin`, HTML node editors |
| State Management | Finite State Machine + EventEmitter |
| Scheduling | Micro-Task-Queue with high-resolution timer |
| Security | X.509 / PKI, Basic256Sha256, JWT user auth |
| Testing | Mocha or Jest, TDD, mock OPC UA server, ≥85% coverage |
| CI/CD | GitHub Actions |
| Packaging | npm, `package.json` with `node-red` section |

---

## Requirements Catalog

### Client Requirements

| ID | Class | Requirement |
|---|---|---|
| REQ-C-01 | Architecture | Central `opcua-client-config` Config Node handles all connection pooling |
| REQ-C-02 | Functional | Stateful `opc.tcp` connection with clean teardown on Node-RED shutdown |
| REQ-C-03 | Functional | Read, Write, Browse, and Method Call worker nodes |
| REQ-C-04 | Functional | OPC UA Subscriptions for DataChanges and Events (async, push-based) |
| REQ-C-05 | UX/UI | Embedded visual Address Space browser with click-to-insert NodeId |
| REQ-C-06 | Performance | Smart Batching: bundle concurrent reads/writes into `ReadMultiple`/`WriteMultiple` |
| REQ-C-07 | Stability | Auto-Healing with exponential backoff; prevent orphaned sessions on server |
| REQ-C-08 | Security | Message Security modes: None, Sign, SignAndEncrypt; policy: Basic256Sha256+ |
| REQ-C-09 | Data | Auto-deserialize Extension Objects (UDTs) into nested JSON for `msg.payload` |
| REQ-C-10 | Quality | TDD with ≥85% test coverage |

### Server Requirements

| ID | Class | Requirement |
|---|---|---|
| REQ-S-01 | Architecture | Async OPC UA server bound to Node-RED lifecycle (start/stop sync) |
| REQ-S-02 | Functional | Address space modelled via configurable `opcua-folder` / `opcua-variable` nodes |
| REQ-S-03 | Functional | NodeSet2.xml import for companion specifications at startup |
| REQ-S-04 | Integration | Variables dynamically bound to Node-RED flow/global context via getter/setter |
| REQ-S-05 | Functional | Server-side RPC methods routed into flow asynchronously with correlation ID |
| REQ-S-06 | Security | Multiple endpoint security policies + client certificate whitelisting |

---

## Work Packages

> Full elaboration with deliverables, acceptance criteria, implementation scaffolds and dependency graph: **[docs/work-packages.md](docs/work-packages.md)**

### Client Work Packages

| WP | Focus | Key Deliverables |
|---|---|---|
| WP-C-1 | Base infrastructure & Config Node | npm package structure, Apache 2.0 license, FSM, EventEmitter, status icons |
| WP-C-2 | Resilience Engineering | Catch `BadSessionClosed`/`BadConnectionClosed`, exponential backoff, session re-establishment |
| WP-C-3 | Worker Nodes & Smart Batching | `opcua-read`, `opcua-write`, `opcua-subscribe`, `opcua-method`; batching scheduler; UDT deserializer |
| WP-C-4 | Visual Tree-View Browser | `RED.httpAdmin` browse routes, lazy-loading `RED.treeList`, click-to-insert NodeId |
| WP-C-5 | Security & PKI UI | X.509 cert generator on first run, Security Dashboard, trust/reject certificates via UI |
| WP-C-6 | CI/CD & Documentation | GitHub Actions, mock OPC UA server for tests, Mocha/Jest unit tests, Node-RED Info Sidebar docs |

### Server Work Packages

| WP | Focus | Key Deliverables |
|---|---|---|
| WP-S-1 | Core server & lifecycle | `opcua-server-config`, port management, graceful shutdown |
| WP-S-2 | Address Space Builder & Context Bridge | `opcua-folder`/`opcua-variable` nodes, getter/setter bindings to Node-RED context |
| WP-S-3 | NodeSet2.xml Importer | XML parse at startup, error handling for malformed schemas |
| WP-S-4 | RPC Methods & Event Handling | `opcua-method` + `opcua-method-response` with Correlation-ID pattern |
| WP-S-5 | Server PKI & RBAC | Certificate accept/reject UI, optional role-based access control |

---

## Coding Conventions

> For OPC UA protocol fundamentals, security architecture, Subscription mechanics, UDT internals, Node-RED lifecycle hooks, and node-opcua API examples, see **[docs/theoretical-foundations.md](docs/theoretical-foundations.md)**

- **Never** create one OPC UA session per worker node — always delegate to the config node
- **Never** use serial/sequential Read requests when concurrent requests can be batched
- **Never** recreate a session after reconnect if the server may still hold the previous session — attempt re-establishment first
- `msg.payload` contains the normalized data value; OPC UA metadata goes into `msg.opcua` (e.g. `msg.opcua.timestamp`, `msg.opcua.statusCode`)
- Extension Objects (UDTs) must be recursively decoded into plain JSON — do not pass raw `ByteString` to the flow
- All browse operations use `BrowseDirection.Forward` with lazy-loading to support large PLC address spaces
- PKI operations (trust/reject certs) are file system moves — use `fs.rename()`, never `fs.copyFile()` + `fs.unlink()`
- Attach Correlation-IDs (`msg._opcua_method_id`) when routing async method-calls through flows

## Security Requirements

- Default security mode: `SignAndEncrypt` with `Basic256Sha256` policy
- Auto-generate a unique X.509 application certificate on first startup
- Never log credentials, private keys, or certificate material
- Validate all NodeIds and input parameters at system boundaries before sending to the OPC UA stack
- Rejected server certificates must stay in `PKI/rejected/` until explicitly trusted by the user

## Testing Conventions

- Spin up a local mock `OPCUAServer` instance in `beforeEach` / `afterAll` hooks
- Cover edge cases: unexpected connection drops, data type mismatches, oversized packets, concurrent subscriptions
- Minimum 85% line coverage enforced in CI
- Integration tests must verify session re-establishment without server-side session-table growth
