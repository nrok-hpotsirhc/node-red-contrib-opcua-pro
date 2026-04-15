# Contributing to node-red-contrib-opcua-industrial

Thank you for considering a contribution. This document explains how to set up the development environment, add new features correctly, and keep the test suite in good shape.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Project Structure](#project-structure)
4. [Architecture Overview](#architecture-overview)
5. [How to Add a New Client Node](#how-to-add-a-new-client-node)
6. [How to Add a New Server Node](#how-to-add-a-new-server-node)
7. [Testing Conventions](#testing-conventions)
8. [Coding Conventions](#coding-conventions)
9. [Security Rules](#security-rules)
10. [Pull Request Checklist](#pull-request-checklist)
11. [Release Process](#release-process)

---

## Prerequisites

| Tool | Minimum Version | Notes |
|---|---|---|
| Node.js | 18 LTS | `node --version` must show v18.x or newer |
| npm | 9 | Comes with Node.js 18 |
| Git | 2.x | Any recent version |

> **Windows note**: PowerShell execution policy may block `.ps1` scripts. Run Mocha via `node node_modules/mocha/bin/mocha.js` instead of `npm test` if you get a policy error.

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/<org>/node-red-contrib-opcua-industrial.git
cd node-red-contrib-opcua-industrial

# 2. Install (the hexy override is already in package.json — do not remove it)
npm install

# 3. Run all unit tests
npm test

# 4. Run integration tests (starts an in-process OPC UA server on port 4842)
node node_modules/mocha/bin/mocha.js --no-config test/integration/client-integration.test.js

# 5. Run everything at once
node node_modules/mocha/bin/mocha.js --no-config "lib/**/*.test.js" test/integration/client-integration.test.js

# 6. Coverage report
npm run coverage
```

After a successful install you should see **107 unit tests passing** and **8 integration tests passing**.

---

## Project Structure

```
├── lib/
│   ├── client/
│   │   ├── fsm.js                  # FSM for connection states
│   │   ├── connection-manager.js   # OPCUAClient factory + reconnect strategy
│   │   ├── session-manager.js      # Session create / re-establish logic
│   │   ├── batch-scheduler.js      # Smart request batching (read + write)
│   │   ├── udt-deserializer.js     # Extension Object → plain JSON
│   │   └── pki-manager.js          # PKI directory setup + trust/reject certs
│   └── server/
│       ├── context-bridge.js       # OPC UA variable ↔ Node-RED context binding
│       └── nodeset-importer.js     # NodeSet2.xml companion spec importer
├── nodes/
│   ├── opcua-client-config/        # Config node: connection + session lifecycle
│   ├── opcua-server-config/        # Config node: OPC UA server lifecycle
│   ├── opcua-read/                 # Worker: read one or more NodeIds
│   ├── opcua-write/                # Worker: write values
│   ├── opcua-subscribe/            # Worker: data-change subscriptions
│   ├── opcua-browse/               # Worker: address-space browser
│   ├── opcua-method/               # Worker: call OPC UA method
│   ├── opcua-folder/               # Server address-space: folder node
│   └── opcua-variable/             # Server address-space: variable node
├── test/
│   ├── fixtures/
│   │   └── mock-server.js          # In-process OPC UA server for integration tests
│   └── integration/
│       └── client-integration.test.js
├── docs/
│   ├── theoretical-foundations.md  # OPC UA protocol deep-dive
│   ├── work-packages.md            # WP deliverables & acceptance criteria
│   ├── milestones.md               # Session milestones
│   └── testing.md                  # Full test catalogue & strategy
├── AGENTS.md                       # AI-agent operating instructions
├── package.json
└── README.md
```

---

## Architecture Overview

There are three pillars — **never** violate the separation between them.

### Pillar 1 — Config Node / FSM

`opcua-client-config` owns the **one** OPC UA session for an entire flow.  
`lib/client/fsm.js` implements a strict Finite State Machine:

```
DISCONNECTED → CONNECTING → CONNECTED → SESSION_ACTIVE
                                        ↕
                              CONNECTION_LOST → RECONNECTING
```

Worker nodes (read, write, subscribe, …) receive connection-state events via an `EventEmitter`; they never manage their own sessions.

### Pillar 2 — Smart Batching Scheduler

`lib/client/batch-scheduler.js` aggregates concurrent `scheduleRead()` / `scheduleWrite()` calls that arrive within a configurable time window (default 5 ms) into a single `session.read(batch)` / `session.write(batch)` RPC. Responses are de-multiplexed by Promise-ID back to each caller. This reduces network overhead by up to 90 % in high-node-count flows.

### Pillar 3 — Editor UX & PKI

The address-space tree-view browser is served via `RED.httpAdmin` routes. PKI certificate management (trust / reject) is done through file-system moves in `lib/client/pki-manager.js`.

---

## How to Add a New Client Node

1. **Create the node directory**: `nodes/opcua-<name>/`
2. **Create the main file** `nodes/opcua-<name>/opcua-<name>.js`:
   ```js
   module.exports = function (RED) {
     function OpcuaMyNode(config) {
       RED.nodes.createNode(this, config);
       const configNode = RED.nodes.getNode(config.connection);
       if (!configNode) return;

       // Subscribe to connection state
       configNode.on('stateChanged', (state) => {
         this.status(state === 'SESSION_ACTIVE'
           ? { fill: 'green', shape: 'dot', text: 'connected' }
           : { fill: 'red',   shape: 'ring', text: state });
       });

       this.on('input', async (msg, send, done) => {
         try {
           // Use configNode.scheduleRead() / scheduleWrite() — never create your own session
           const result = await configNode.scheduleRead(config.nodeId);
           msg.payload = result.value.value;
           send(msg);
           done();
         } catch (err) {
           done(err);
         }
       });
     }
     RED.nodes.registerType('opcua-my', OpcuaMyNode);
   };
   ```
3. **Register in `package.json`** under `"node-red".nodes`:
   ```json
   "opcua-my": "nodes/opcua-my/opcua-my.js"
   ```
4. **Write tests** — see [Testing Conventions](#testing-conventions) below.
5. **Add an HTML editor dialog** in `nodes/opcua-<name>/opcua-<name>.html`.

---

## How to Add a New Server Node

Server nodes are built with the same pattern but call into `opcua-server-config`:

```js
const configNode = RED.nodes.getNode(config.server);
configNode.addVariable({
  browseName:  config.browseName,
  nodeId:      config.nodeId,
  dataType:    config.dataType,
  contextKey:  config.contextKey,   // flow.get / flow.set key
});
```

Use `lib/server/context-bridge.js` → `createVariableBinding()` to wire getters and setters to Node-RED flow/global context. Never read/write context directly in the node file.

---

## Testing Conventions

> Full test catalogue and run instructions: **[docs/testing.md](docs/testing.md)**

### File naming

| Scope | File Pattern | Example |
|---|---|---|
| Unit test | `<module>.test.js` next to the module | `lib/client/fsm.test.js` |
| Integration test | `test/integration/<feature>-integration.test.js` | `test/integration/client-integration.test.js` |

### JSDoc header on every test file

Every test file **must** begin with this block:

```js
/**
 * @file <module-name>.test.js
 *
 * What is tested here:
 * - <bullet list of tested behaviours>
 *
 * Why these test cases:
 * - <rationale for coverage decisions>
 */
```

### Unit tests — no external dependencies

Unit tests must not start servers, open sockets, or hit the network.  
Mock all external collaborators (node-opcua, fs, …) in-process.

```js
// Pattern for stubbing node-opcua before require()
const opcua = require('node-opcua');
let capturedOptions;
const origCreate = opcua.OPCUAClient.create.bind(opcua.OPCUAClient);
opcua.OPCUAClient.create = (opts) => { capturedOptions = opts; return origCreate(opts); };
const { createClient } = require('./connection-manager'); // now uses the stub
```

### Integration tests — mock server on port 4842

Integration tests use the in-process server in `test/fixtures/mock-server.js`.  
Port **4842** is reserved for tests (avoids collisions with production ports 4840/4841).

```js
const { startMockServer, stopMockServer } = require('../fixtures/mock-server');
before(async () => { ({ endpointUrl } = await startMockServer()); });
after( async () => { await stopMockServer(); });
```

### When you add a feature, you must also

1. Add at least one unit test for every public function / exported method you create.
2. Add an integration test if the feature involves a real OPC UA connection.
3. Run `npm run coverage` and confirm line coverage stays ≥ 85 %.
4. Update the test count table in [docs/testing.md](docs/testing.md).

### Running tests

```bash
# Unit tests only (fast, no server)
node node_modules/mocha/bin/mocha.js --no-config "lib/**/*.test.js"

# Integration tests only
node node_modules/mocha/bin/mocha.js --no-config test/integration/client-integration.test.js

# All tests
node node_modules/mocha/bin/mocha.js --no-config "lib/**/*.test.js" test/integration/client-integration.test.js

# Coverage
npm run coverage
```

---

## Coding Conventions

These rules are non-negotiable. CI will reject PRs that violate them.

| Rule | Rationale |
|---|---|
| **Never** create one OPC UA session per worker node | Sessions are expensive server-side resources; one config node = one session |
| **Never** use serial read requests when concurrent requests can be batched | Use `scheduleRead()` / `scheduleWrite()` on the config node |
| **Never** recreate a session after reconnect without first attempting re-establishment | Prevents server-side session-table overflow |
| `msg.payload` = data value; `msg.opcua` = metadata | Subscribers must not need to dig into OPC UA internals |
| Extension Objects must be fully decoded to plain JSON | Never pass raw `ByteString` objects into the flow |
| All browse operations use `BrowseDirection.Forward` with lazy-loading | Supports large PLC address spaces without memory issues |
| PKI moves use `fs.rename()`, never `fs.copyFile()` + `fs.unlink()` | Atomic operation; prevents cert duplication on crash |
| Correlation-IDs on async method calls (`msg._opcua_method_id`) | Required for correct de-multiplexing of method responses |
| Validate all NodeIds and input parameters at system boundaries | OWASP A03 — Injection prevention |
| Never log credentials, private keys, or certificate material | OWASP A02 — Cryptographic Failures |

---

## Security Rules

- Default security mode: `SignAndEncrypt` with `Basic256Sha256` policy.
- Auto-generate a unique X.509 application certificate on first startup.
- Rejected server certificates stay in `PKI/rejected/` until explicitly trusted by the user.
- Sanitise every file-path argument before passing to `fs` (reject `..` and absolute paths).

---

## Pull Request Checklist

Before opening a PR, confirm all of these:

- [ ] `node node_modules/mocha/bin/mocha.js --no-config "lib/**/*.test.js" test/integration/client-integration.test.js` — all tests pass
- [ ] `npm run coverage` — line coverage ≥ 85 %
- [ ] New/changed public functions have unit tests
- [ ] Every new test file has the required JSDoc header
- [ ] [docs/testing.md](docs/testing.md) updated with new test counts
- [ ] No credentials, private keys, or secrets in the diff
- [ ] `NodeId` inputs are validated before use
- [ ] The three architecture pillars are respected (no session creation in worker nodes)

---

## Release Process

1. Merge all PRs for the milestone into `main`.
2. Update `CHANGELOG.md` (one line per user-visible change).
3. Bump the version in `package.json` following [semver](https://semver.org/):
   - Patch (`x.y.Z`) — bug fix only
   - Minor (`x.Y.0`) — new backwards-compatible feature
   - Major (`X.0.0`) — breaking API change
4. Tag and push: `git tag vX.Y.Z && git push --tags`
5. GitHub Actions will publish to npm automatically.

---

*For the OPC UA protocol theory, security architecture, Subscription internals, UDT format, and node-opcua API examples, see [docs/theoretical-foundations.md](docs/theoretical-foundations.md).*
