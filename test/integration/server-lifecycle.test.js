'use strict';
// WP-S-1: Integration test — server lifecycle (start, stop, redeploy)
// See: docs/work-packages.md#wp-s-1-kern-server--lifecycle-management

const assert = require('assert');
const { createMockServer } = require('../fixtures/mock-server');

describe('Server Lifecycle (Integration)', () => {
  it('starts and stops without port conflict on redeploy', async function () {
    this.timeout(15000);
    const PORT = 4844;

    const s1 = await createMockServer(PORT);
    await s1.stop();

    // Second start on same port must succeed (no EADDRINUSE)
    const s2 = await createMockServer(PORT);
    await s2.stop();

    assert.ok(true, 'Both start/stop cycles completed without port conflict');
  });

  it('exposes OPC UA variables on the expected NodeIds', async function () {
    this.timeout(15000);
    const { server, endpointUrl, state, stop } = await createMockServer(4845);

    try {
      // TODO: Connect a client and verify Temperature is readable
      assert.ok(endpointUrl.startsWith('opc.tcp://'));
    } finally {
      await stop();
    }
  });
});
