# node-red-contrib-opcua-pro

Production-grade, open-source OPC UA integration for Node-RED.

[![CI](https://github.com/nrok-hpotsirhc/node-red-contrib-opcua-pro/actions/workflows/ci.yml/badge.svg)](https://github.com/nrok-hpotsirhc/node-red-contrib-opcua-pro/actions)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

## Overview

This package fills the gap between outdated legacy OPC UA nodes and commercial enterprise solutions. It brings enterprise-grade architecture patterns (session pooling, smart batching, auto-healing) to the open-source community.

| Feature | Legacy Nodes | This Package |
|---|---|---|
| Session Management | One session per node | One shared session (config node) |
| Read Performance | Serial ReadRequests | Smart Batching (ReadMultiple) |
| Reconnect | Manual restart required | Auto-Healing with exponential backoff |
| NodeId Selection | Manual text entry | Visual Address Space Browser |
| UDT Support | Raw ByteString | Auto-deserialized JSON |
| PKI Management | CLI required | Browser-based Security Dashboard |

## Project Status

| Meilenstein | Inhalt | Work Packages | Status |
|---|---|---|---|
| M1 — Foundation | npm-Paket, FSM, Client-Config-Node, Server-Config-Node | WP-C-1, WP-S-1 | ✅ Abgeschlossen |
| M2 — Resilience & Core Data | Reconnect/Backoff, Batch-Scheduler, Read/Write/Subscribe, UDT-Deserialisierung | WP-C-2, WP-C-3 | ✅ Abgeschlossen |
| M3 — Server Address Space | Folder/Variable-Nodes, Context-Bridge, NodeSet2.xml-Import | WP-S-2, WP-S-3 | ✅ Abgeschlossen |
| M4 — RPC & Methods | Client Method-Call, Server-Methoden, Correlation-ID-Pattern | WP-C-3 (Method), WP-S-4 | ✅ Abgeschlossen |
| M5 — Visual UX & Security | Address-Space-Browser, PKI-Dashboard, Auto-Zertifikat, Server-PKI | WP-C-4, WP-C-5, WP-S-5 | ✅ Abgeschlossen |
| M6 — Quality & Release | GitHub-Actions-CI, Coverage ≥ 85 %, Info-Sidebar, CHANGELOG, npm publish | WP-C-6 | ✅ Abgeschlossen |

> Details und Akzeptanzkriterien: [docs/milestones.md](docs/milestones.md)

### Qualitätskennzahlen

- **423 Tests** (Unit + Integration), alle grün
- **90 %+ Line Coverage**, 90 %+ Branch Coverage, 96 %+ Function Coverage
- **0 Vulnerabilities** (`npm audit`)
- **0 Lint-Errors** (ESLint)
- **Node.js 18 / 20 / 22** getestet via GitHub Actions CI

---

## Architecture

See [AGENTS.md](AGENTS.md) for the full architecture documentation.

- **Theoretical Foundations:** [docs/theoretical-foundations.md](docs/theoretical-foundations.md)
- **Work Packages:** [docs/work-packages.md](docs/work-packages.md)
- **Container Installation:** [docs/container-installation.md](docs/container-installation.md)

## Project Structure

```
node-red-contrib-opcua-pro/
├── nodes/
│   ├── client/
│   │   ├── opcua-client-config/   # FSM-based connection manager + browse/PKI routes
│   │   ├── opcua-read/            # Smart-batching read node
│   │   ├── opcua-write/           # Smart-batching write node
│   │   ├── opcua-subscribe/       # Push-based subscription node
│   │   └── opcua-method/          # Client-side method call node
│   └── server/
│       ├── opcua-server-config/   # Server lifecycle manager + PKI routes
│       ├── opcua-folder/          # Address space folder node
│       ├── opcua-variable/        # Context-bridged variable node
│       ├── opcua-server-method/   # Server-side RPC trigger
│       └── opcua-method-response/ # Correlated method response
├── lib/
│   ├── client/
│   │   ├── batch-scheduler.js     # Micro-task-queue for request batching
│   │   ├── connection-manager.js  # OPCUAClient factory with backoff
│   │   ├── error-handler.js       # StatusCode classification
│   │   ├── fsm.js                 # Finite State Machine
│   │   ├── pki-manager.js         # Client PKI certificate management
│   │   ├── session-manager.js     # Session re-establishment
│   │   └── udt-deserializer.js    # Extension Object → JSON
│   ├── server/
│   │   ├── context-bridge.js      # OPC UA ↔ Node-RED context binding
│   │   ├── nodeset-importer.js    # NodeSet2.xml import
│   │   └── pki-manager.js         # Server PKI certificate management
│   └── pki-base.js                # Shared PKI certificate generation
├── pki/                           # PKI certificates (gitignored)
├── test/
│   ├── fixtures/
│   │   ├── mock-server.js         # Mock OPC UA server for integration tests
│   │   └── sample.NodeSet2.xml    # Sample companion specification
│   └── integration/
│       ├── client-integration.test.js
│       ├── client-reconnect.test.js
│       ├── method-call.test.js
│       └── server-lifecycle.test.js
└── docs/
    ├── milestones.md
    ├── theoretical-foundations.md
    └── work-packages.md
```

## Installation

```bash
cd ~/.node-red
npm install node-red-contrib-opcua-pro
```

For Docker-based local development with Node-RED, see [docs/container-installation.md](docs/container-installation.md).

## Quick Start

1. Drag an **OPC UA Client Config** node onto the canvas and enter your server endpoint (e.g. `opc.tcp://192.168.1.100:4840`)
2. Add an **OPC UA Read** node and link it to the config node
3. Use the **Browse** button to visually select a NodeId
4. Wire an inject node → opcua-read → debug node and deploy

## Security

Default security mode is `SignAndEncrypt` with `Basic256Sha256`. On first start, a self-signed X.509 certificate is auto-generated. Use the Security Dashboard in the config node to trust server certificates without any CLI commands.

See [docs/theoretical-foundations.md#4-sicherheitsarchitektur](docs/theoretical-foundations.md#4-sicherheitsarchitektur) for details.

## License

Apache License 2.0 — see [LICENSE](LICENSE).

The core dependency `node-opcua` is MIT licensed.
