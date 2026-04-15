# Test Strategy & Catalogue

This document describes the complete automated test suite for `node-red-contrib-opcua-pro`. It explains **what** is tested, **why** each suite exists, and **how** to run the tests.

---

## Contents

1. [Philosophy](#philosophy)
2. [Test Counts at a Glance](#test-counts-at-a-glance)
3. [How to Run](#how-to-run)
4. [Unit Test Suites](#unit-test-suites)
   - [fsm.test.js](#fsmtestjs)
   - [batch-scheduler.test.js](#batch-schedulertestjs)
   - [udt-deserializer.test.js](#udt-deserializertestjs)
   - [pki-manager.test.js](#pki-managertestjs)
   - [session-manager.test.js](#session-managertestjs)
   - [connection-manager.test.js](#connection-managertestjs)
   - [context-bridge.test.js](#context-bridgetestjs)
   - [nodeset-importer.test.js](#nodeset-importertestjs)
5. [Integration Test Suite](#integration-test-suite)
   - [client-integration.test.js](#client-integrationtestjs)
6. [Mock Server](#mock-server)
7. [Coverage Policy](#coverage-policy)
8. [Maintaining the Test Suite](#maintaining-the-test-suite)
9. [CI Pipeline](#ci-pipeline)

---

## Philosophy

| Principle | Application |
|---|---|
| **Unit tests own the logic** | Every public function is covered without touching the network |
| **Integration tests verify the seam** | One suite exercises a real (in-process) OPC UA server |
| **Tests document intent** | Every test has a human-readable message; every file has a JSDoc header explaining scope |
| **Tests are maintained on every feature change** | PRs that add/change code must update the relevant test file and this document |
| **85 % line coverage is the floor** | Enforced in CI via `c8` |

Unit tests use in-process mocks only — no TCP, no file system (except `pki-manager` which tests file-system logic in a temp directory). Integration tests spin up an `OPCUAServer` on loopback port **4842**.

---

## Test Counts at a Glance

| File | Suite | Tests | Layer |
|---|---|---|---|
| `lib/client/fsm.test.js` | FSM | 10 | Unit |
| `lib/client/batch-scheduler.test.js` | BatchScheduler | 13 | Unit |
| `lib/client/udt-deserializer.test.js` | UDT Deserializer | 25 | Unit |
| `lib/client/pki-manager.test.js` | PKI Manager | 12 | Unit |
| `lib/client/session-manager.test.js` | Session Manager | 10 | Unit |
| `lib/client/connection-manager.test.js` | Connection Manager | 12 | Unit |
| `lib/server/context-bridge.test.js` | Context Bridge | 20 | Unit |
| `lib/server/nodeset-importer.test.js` | NodeSet Importer | 9 | Unit |
| **Unit total** | | **111** | |
| `test/integration/client-integration.test.js` | Client Integration | 8 | Integration |
| **Grand total** | | **119** | |

> **Maintenance rule**: Update the table above whenever you add, remove, or rename a test.

---

## How to Run

```bash
# Unit tests only (no server, fast)
node node_modules/mocha/bin/mocha.js --no-config "lib/**/*.test.js"

# Integration tests only (starts in-process OPC UA server on port 4842)
node node_modules/mocha/bin/mocha.js --no-config test/integration/client-integration.test.js

# All tests
node node_modules/mocha/bin/mocha.js --no-config "lib/**/*.test.js" test/integration/client-integration.test.js

# Single test file
node node_modules/mocha/bin/mocha.js --no-config lib/client/fsm.test.js

# Code coverage (requires c8, already in devDependencies)
npm run coverage
```

> **Windows**: If `npm test` fails with an execution policy error, use the `node node_modules/mocha/bin/mocha.js` form above.

---

## Unit Test Suites

### `fsm.test.js`

**File**: `lib/client/fsm.js`  
**What is tested**: The Finite State Machine that governs connection lifecycle.

| # | Test | What it verifies |
|---|---|---|
| 1 | starts DISCONNECTED | Initial state |
| 2 | transitions to CONNECTING | `transition('connect')` |
| 3 | transitions to CONNECTED | `transition('sessionCreated')` — wait, `connect → CONNECTING → connected → CONNECTED` |
| 4 | transitions to SESSION_ACTIVE | Full happy-path chain |
| 5 | transitions CONNECTION_LOST | From SESSION_ACTIVE via `connectionLost` |
| 6 | transitions RECONNECTING | From CONNECTION_LOST via `reconnect` |
| 7 | resets to DISCONNECTED | `reset` from any state |
| 8 | emits stateChanged event | EventEmitter integration |
| 9 | ignores invalid transitions | Returns false, state unchanged |
| 10 | emits old + new state in event | Both arguments present |

**Why**: The FSM is the backbone of the entire config node. Bugs here cascade to all worker nodes.

---

### `batch-scheduler.test.js`

**File**: `lib/client/batch-scheduler.js`  
**What is tested**: Aggregation of concurrent read/write calls into single RPCs.

| # | Test | What it verifies |
|---|---|---|
| 1 | N reads → 1 session.read() call | Core read-batching invariant |
| 2 | correct values routed by index | De-multiplexing after batch response |
| 3 | 5 writes → 1 session.write() call | Core write-batching invariant |
| 4 | 100 concurrent reads → 1 call | Load / scalability |
| 5 | read error propagates to ALL pending | Failure isolation |
| 6 | write error propagates to ALL pending | Failure isolation for writes |
| 7 | destroy() rejects pending reads | Graceful teardown |
| 8 | destroy() rejects pending writes | Graceful teardown for writes |
| 9 | destroy() on empty queue is safe | No crash on idle destroy |
| 10 | destroy() is idempotent | Safe to call twice |
| 11 | default batchWindowMs is 5 ms | API contract |
| 12 | large batch (200 reads) resolves all | No queue truncation |
| 13 | mixed read + write in same window | Both batches fire independently |

**Why**: Batching is the primary performance guarantee of this library. Any regression here means N×overhead for users with high node counts.

---

### `udt-deserializer.test.js`

**File**: `lib/client/udt-deserializer.js`  
**What is tested**: Decoding of OPC UA Extension Objects (UDTs) and raw `DataValue`s into plain JSON.

| # | Test | What it verifies |
|---|---|---|
| 1 | null input returns null | Null guard |
| 2 | undefined input returns null | Undefined guard |
| 3 | DataType.Null returns null | Explicit null DataType |
| 4 | Boolean scalar | Primitive pass-through |
| 5 | Int32 scalar | Numeric pass-through |
| 6 | Double scalar | Float pass-through |
| 7 | String scalar | String pass-through |
| 8 | DateTime scalar | Date object pass-through |
| 9 | Float32Array → regular array | TypedArray normalisation |
| 10 | Int32Array → regular array | TypedArray normalisation |
| 11 | empty TypedArray → [] | Edge: empty typed array |
| 12 | null-valued array → null | Edge: null value in array |
| 13 | flat ExtensionObject → plain object | UDT field extraction |
| 14 | `_xxx` internal fields stripped | node-opcua internals hidden from flow |
| 15 | recursive nested UDT | Multi-level struct decoding |
| 16 | TypedArray inside nested UDT | Mixed nested structure |
| 17 | Date in nested object | Date passthrough in struct |
| 18 | deserializeExtensionObject(null) | Null guard on direct call |
| 19 | deserializeExtensionObject(primitive) | Primitive falls through |
| 20 | normalizeDataValue — Good status | Value extracted, StatusCode present |
| 21 | normalizeDataValue — Bad status | Returns null when read failed |
| 22 | normalizeDataValue — null statusCode | Treated as Good |
| 23 | normalizeDataValue — missing timestamps | sourceTimestamp / serverTimestamp filled |
| 24 | object result is a plain object | No node-opcua class leaking into msg |
| 25 | nested result is a plain object | Same check for deep nesting |

**Why**: Raw OPC UA data types must not leak into Node-RED flows. Any serialisation failure causes hard-coded `undefined` or opaque objects in `msg.payload`.

---

### `pki-manager.test.js`

**File**: `lib/client/pki-manager.js`  
**What is tested**: PKI directory creation and certificate trust/reject file operations.

| # | Test | What it verifies |
|---|---|---|
| 1 | creates 5 required subdirectories | `ensurePkiDirectories()` |
| 2 | idempotent (safe to call twice) | No crash on existing dirs |
| 3 | listRejectedCertificates — empty dir | Returns [] |
| 4 | listRejectedCertificates — one cert | Returns filename |
| 5 | listRejectedCertificates — only .der | Non-.der files not listed |
| 6 | listRejectedCertificates — multiple | All .der files returned |
| 7 | trustCertificate — moves file | File present in trusted/, gone from rejected/ |
| 8 | trustCertificate — content preserved | Binary content identical after move |
| 9 | `../evil.der` path traversal rejected | OWASP A03 — injection prevention |
| 10 | forward-slash path rejected | Path traversal via `/foo/bar` |
| 11 | backslash path rejected | Path traversal via `..\\evil.der` |
| 12 | empty string filename rejected | Edge: empty input |
| 13 | nonexistent file throws | Helpful error on missing cert |

**Why**: PKI operations touch the file system with user-supplied certificate names. Path-traversal attacks must be caught at the boundary.

---

### `session-manager.test.js`

**File**: `lib/client/session-manager.js`  
**What is tested**: OPC UA user-identity construction and session create / re-establish logic.

| # | Test | What it verifies |
|---|---|---|
| 1 | Anonymous when no credentials | Default identity type |
| 2 | UserName token with credentials | Username/password identity |
| 3 | Anonymous when credentials are empty strings | Edge: empty creds |
| 4 | Anonymous when credentials are undefined | Edge: undefined creds |
| 5 | reestablishOrCreateSession — happy path | Returns same session on success |
| 6 | reestablishOrCreateSession — changeUser throws → createSession | Fallback to new session |
| 7 | reestablishOrCreateSession — close throws → still creates | Close failure does not abort |
| 8 | reestablishOrCreateSession — null existingSession | Immediately creates new session |
| 9 | identity forwarded to changeUser | Config options passed through |
| 10 | identity forwarded to createSession | Config options passed through on fresh create |

**Why**: Session re-establishment without server-side session-table growth (REQ-C-07) depends entirely on this module working correctly under every error path.

---

### `connection-manager.test.js`

**File**: `lib/client/connection-manager.js`  
**What is tested**: `OPCUAClient` factory options and default reconnect strategy.

| # | Test | What it verifies |
|---|---|---|
| 1 | DEFAULT_CONNECTION_STRATEGY.initialDelay | 1000 ms |
| 2 | DEFAULT_CONNECTION_STRATEGY.maxDelay | 30 000 ms |
| 3 | DEFAULT_CONNECTION_STRATEGY.maxRetry | Infinity |
| 4 | DEFAULT_CONNECTION_STRATEGY.randomisationFactor | 0.1 |
| 5 | applicationName forwarded | Config option wired to OPCUAClient |
| 6 | applicationName fallback | Default when config omits it |
| 7 | SignAndEncrypt default security mode | REQ-C-08 security default |
| 8 | Basic256Sha256 default security policy | REQ-C-08 security default |
| 9 | keepSessionAlive: true | Session keepalive enabled by default |
| 10 | custom strategy merges with defaults | Partial overrides work |
| 11 | cert files forwarded | Certificate paths preserved |
| 12 | createClient returns OPCUAClient instance | Return value correct |

**Why**: Incorrect reconnect parameters are invisible until production; a bad `maxRetry: 0` would silently disable auto-healing.

---

### `context-bridge.test.js`

**File**: `lib/server/context-bridge.js`  
**What is tested**: Bidirectional binding between OPC UA variables and Node-RED flow/global context.

| # | Test | What it verifies |
|---|---|---|
| 1 | resolveDataType — Boolean | DataType.Boolean |
| 2 | resolveDataType — Int32 | DataType.Int32 |
| 3 | resolveDataType — UInt32 | DataType.UInt32 |
| 4 | resolveDataType — Float | DataType.Float |
| 5 | resolveDataType — Double | DataType.Double |
| 6 | resolveDataType — String | DataType.String |
| 7 | resolveDataType — DateTime | DataType.DateTime |
| 8 | resolveDataType — ByteString | DataType.ByteString |
| 9 | resolveDataType — NodeId | DataType.NodeId |
| 10 | resolveDataType — unknown falls back to Variant | Safe default |
| 11 | resolveDataType — undefined falls back to Variant | Edge: missing config |
| 12 | createVariableBinding — calls namespace.addVariable | Integration with address space |
| 13 | getter reads value from context | Context.get → OPC UA getter chain |
| 14 | getter returns defaultValue when unset | Edge: context not yet written |
| 15 | setter writes value to context | OPC UA write → context.set |
| 16 | setter returns StatusCodes.Good | Correct OPC UA status on success |
| 17 | triggerOnWrite=true → sends msg | Flow notification on OPC UA write |
| 18 | triggerOnWrite=true → msg.payload value | Correct value in notification |
| 19 | triggerOnWrite=false → no msg | No spurious flow traffic |
| 20 | setter context.set() throws → BadInternalError | Error surfaced as OPC UA status |

**Why**: This module is the core of the server integration. Incorrect getter/setter wiring means OPC UA clients read stale data or writes are silently discarded.

---

### `nodeset-importer.test.js`

**File**: `lib/server/nodeset-importer.js`  
**What is tested**: Importing NodeSet2.xml companion specifications into the server address space.

| # | Test | What it verifies |
|---|---|---|
| 1 | empty array — no-op | Safe when no companion specs configured |
| 2 | undefined — no-op | Edge: missing config |
| 3 | null — no-op | Edge: null config |
| 4 | `../evil.xml` path traversal rejected | OWASP A03 — injection prevention |
| 5 | nonexistent file throws | Clear error on missing spec file |
| 6 | non-.xml extension (.json) rejected | Validates extension before FS access |
| 7 | .json file rejected with message | Error message is user-friendly |
| 8 | path traversal fires for each file | All paths validated, not just first |
| 9 | `generateAddressSpace` error wrapped | "NodeSet2 import failed:" prefix for clarity |

**Why**: NodeSet files are configured by operators and may contain adversarial paths. All paths must be validated before any file-system access.

---

## Integration Test Suite

### `client-integration.test.js`

**File**: `test/integration/client-integration.test.js`  
**What is tested**: Full end-to-end OPC UA client stack against a real in-process server.

**Server**: `test/fixtures/mock-server.js` — starts `OPCUAServer` on `opc.tcp://localhost:4842`  
**NodeIds exposed**:
- `ns=1;s=Temperature` — Double, readable + writable, initial value `23.5`
- `ns=1;s=Pressure` — Double, readable + writable, initial value `1.013`
- `ns=1;s=DeviceStatus` — String, read-only, initial value `'Running'`

| # | Test | What it verifies |
|---|---|---|
| 1 | read Temperature — Good status | Successful read end-to-end |
| 2 | read Temperature — correct initial value | Value correct (23.5) |
| 3 | read DeviceStatus — String type | Data type preserved across wire |
| 4 | write then re-read Temperature | Write path verified |
| 5 | BatchScheduler 3 reads → < 3 RPCs | Batching reduces network calls on real session |
| 6 | BatchScheduler correct values | All 3 values correct after batched read |
| 7 | subscription DataChange callback | Push-based subscription working |
| 8 | graceful disconnect | `client.disconnect()` resolves cleanly |

**BatchScheduler integration note**: Test 5 asserts `readCallCount < 3` (not `=== 1`) because node-opcua keepalive traffic can add extra `session.read` calls on a live connection. The important invariant is that batching **reduces** RPCs, not that it always achieves a single call.

**Why integration tests at all**: Unit tests with mocks cannot detect issues in node-opcua version upgrades, protocol-level serialisation bugs, or subtle session state sequences. This suite catches those.

---

## Mock Server

`test/fixtures/mock-server.js` exports:

```js
/**
 * @returns {{ server, endpointUrl, state, stop }}
 */
async function startMockServer()
```

Key implementation details developers should know:

- Uses `organizedBy: objects` (not `componentOf`) when adding variables to the OPC UA `Objects` folder. In node-opcua ≥ 2.x, the `Objects` folder only accepts `HasOrganizes` references — using `HasComponent` throws at startup.
- Every variable has an explicit `nodeId` string (`ns=1;s=Temperature` etc.). Without this, node-opcua assigns auto-incremented numeric IDs, making tests brittle across server restarts.
- Security mode: `None` — tests focus on data correctness, not TLS.
- If you need a new test variable: add it in `startMockServer()`, register the `nodeId` at the top of the integration test file, and document it in this section.

---

## Coverage Policy

Minimum coverage thresholds (enforced in CI via `c8`):

| Metric | Threshold |
|---|---|
| Lines | 85 % |
| Functions | 85 % |
| Branches | 80 % |

Run locally:

```bash
npm run coverage
# opens coverage/index.html (if configured) or prints summary
```

If a PR causes coverage to drop below these thresholds, CI will fail.  
Legitimate exclusions (e.g. error boundaries that can't be reached in tests) must be annotated with `/* c8 ignore next */` and explained in the PR description.

---

## Maintaining the Test Suite

### When you change existing code

1. Run the test file for that module first: `node node_modules/mocha/bin/mocha.js --no-config lib/client/<module>.test.js`
2. Fix any broken tests — **do not delete** tests just because they now fail; instead fix the code or update the test with a comment explaining the behaviour change.
3. Update the JSDoc header in the test file if the scope changed.
4. Update the test count table in this document.

### When you add a new module

1. Create `lib/<layer>/<module>.test.js` next to the source file.
2. Start with the mandatory JSDoc header (see [CONTRIBUTING.md](../CONTRIBUTING.md#jsdoc-header-on-every-test-file)).
3. Cover every exported function (≥ 1 happy path + ≥ 1 error path each).
4. Add the file to this document's test catalogue.
5. Run the full suite to confirm no regressions.

### Marking mock & test data

Every hardcoded value, stub, fixture, or seed datum that exists **only** for testing must be visibly annotated so it can be found and removed without touching production code:

```js
// single-line: comment on the same line
const INITIAL_TEMPERATURE = 23.5; // TEST DATA
const TEST_ENDPOINT = 'opc.tcp://localhost:4842'; // TEST DATA

/* multi-line block: comment above the value */
/* TEST DATA — seed value for write-then-read round-trip test */
const WRITTEN_VALUE = 99.9;
```

This convention makes all test-only content grep-able across the whole repository:

```bash
grep -r "TEST DATA" .
```

The rule applies to: mock server variables, hardcoded NodeIds in test files, fixture objects, stub return values, and any constant that would be meaningless outside a test context.

### When you bump `node-opcua`

1. Run the full suite immediately after `npm install`.
2. Integration tests are most likely to break after a major version bump.
3. If node-opcua changes an internal API that the mock server relies on, update `test/fixtures/mock-server.js` and add a comment documenting the version change.
4. Commit the `package-lock.json` bump together with any test fixes.

---

## CI Pipeline

GitHub Actions runs on every push and PR to `main`:

```yaml
# .github/workflows/test.yml (abbreviated)
- run: npm ci
- run: node node_modules/mocha/bin/mocha.js --no-config "lib/**/*.test.js"
- run: node node_modules/mocha/bin/mocha.js --no-config test/integration/client-integration.test.js
- run: npm run coverage  # fails if thresholds not met
```

The pipeline does **not** publish to npm. Publishing is triggered manually via a git tag (see [CONTRIBUTING.md § Release Process](../CONTRIBUTING.md#release-process)).
