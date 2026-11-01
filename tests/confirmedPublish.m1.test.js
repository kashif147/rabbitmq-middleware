// M1 - publisher.publishConfirmed (broker-confirmed, deterministic eventId) + tenant.provisioning.* mapping.
// Run: node --test tests/  (no broker: the confirm channel is a stub)
const test = require("node:test");
const assert = require("node:assert");
const connectionManager = require("../src/connection.js");
const publisher = require("../src/publisher.js");
const dist = require("../dist/publisher.js");

const T = "6acd6119b28a863c61361ae0";
const EID = "prov:3f1c9a0b2d7e4f60a1b2c3d4e5f60718";
function stubChannel(mode) {
  const sent = [];
  return {
    sent,
    publish(exchange, routingKey, buf, opts, cb) {
      sent.push({ exchange, routingKey, body: JSON.parse(buf.toString()), opts });
      if (mode === "ack") setImmediate(() => cb(null));
      else if (mode === "nack") setImmediate(() => cb(new Error("nack")));
      else if (mode === "throw") throw new Error("channel closed");
      // "silent": never confirms
      return true;
    },
  };
}
const withChannel = (t, ch) => t.mock.method(connectionManager, "getConfirmChannel", async () => ch);
const quiet = () => { publisher.setLogger({}); };

test("provisioning event types map to provisioning.events (src and dist identical)", () => {
  for (const p of [publisher, dist]) {
    for (const e of ["tenant.provisioning.step.requested.v1", "tenant.provisioning.step.completed.v1", "tenant.provisioning.step.failed.v1"]) {
      assert.strictEqual(p.getExchangeForEvent(e), "provisioning.events", e);
    }
  }
  assert.strictEqual(publisher.getExchangeForEvent("user.created"), "user.events"); // existing mappings unchanged
});

test("ack -> success with the CALLER's eventId (envelope + messageId), tenant header, exchange from the mapping", async (t) => {
  quiet();
  const ch = stubChannel("ack");
  withChannel(t, ch);
  const r = await publisher.publishConfirmed("tenant.provisioning.step.requested.v1", { stepKey: "k" }, { eventId: EID, tenantId: T });
  assert.deepStrictEqual([r.success, r.eventId, r.exchange, r.routingKey], [true, EID, "provisioning.events", "tenant.provisioning.step.requested.v1"]);
  const m = ch.sent[0];
  assert.strictEqual(m.body.eventId, EID);
  assert.strictEqual(m.body.tenantId, T);
  assert.strictEqual(m.opts.messageId, EID);
  assert.strictEqual(m.opts.headers["x-tenant-id"], T);
  assert.strictEqual(m.opts.persistent, true);
});

test("same eventId published twice -> two identical messages with the same id (consumers deduplicate)", async (t) => {
  quiet();
  const ch = stubChannel("ack");
  withChannel(t, ch);
  await publisher.publishConfirmed("tenant.provisioning.step.requested.v1", { a: 1 }, { eventId: EID, tenantId: T });
  await publisher.publishConfirmed("tenant.provisioning.step.requested.v1", { a: 1 }, { eventId: EID, tenantId: T });
  assert.deepStrictEqual(ch.sent.map((m) => m.body.eventId), [EID, EID]);
});

test("nack / timeout / channel error / no channel -> success false, never throws, nothing claimed", async (t) => {
  quiet();
  withChannel(t, stubChannel("nack"));
  assert.deepStrictEqual(await publisher.publishConfirmed("tenant.provisioning.step.requested.v1", {}, { eventId: EID, tenantId: T }), { success: false, error: "broker nack", eventId: EID });
  t.mock.restoreAll();
  withChannel(t, stubChannel("silent"));
  const to = await publisher.publishConfirmed("tenant.provisioning.step.requested.v1", {}, { eventId: EID, tenantId: T, confirmTimeoutMs: 30 });
  assert.deepStrictEqual([to.success, to.error], [false, "confirm timeout"]);
  t.mock.restoreAll();
  withChannel(t, stubChannel("throw"));
  assert.strictEqual((await publisher.publishConfirmed("tenant.provisioning.step.requested.v1", {}, { eventId: EID, tenantId: T })).success, false);
  t.mock.restoreAll();
  t.mock.method(connectionManager, "getConfirmChannel", async () => { throw new Error("down"); });
  assert.match((await publisher.publishConfirmed("tenant.provisioning.step.requested.v1", {}, { eventId: EID, tenantId: T })).error, /confirm channel unavailable/);
});

test("eventId and an internal tenantId are required (no generated id, no placeholder tenant)", async (t) => {
  quiet();
  const ch = stubChannel("ack");
  withChannel(t, ch);
  for (const opts of [{ tenantId: T }, { eventId: "short", tenantId: T }, { eventId: "has space and more", tenantId: T }, { eventId: EID }, { eventId: EID, tenantId: "MULTIAUTH" }, { eventId: EID, tenantId: "default" }]) {
    assert.strictEqual((await publisher.publishConfirmed("tenant.provisioning.step.requested.v1", {}, opts)).success, false, JSON.stringify(opts));
  }
  assert.strictEqual(ch.sent.length, 0);
});

test("publish() is unchanged: still the regular channel, still a generated id", async (t) => {
  quiet();
  const sent = [];
  t.mock.method(connectionManager, "getChannel", async () => ({ publish: (...a) => (sent.push(a), true) }));
  const r = await publisher.publish("user.created", {}, { tenantId: T });
  assert.strictEqual(r.success, true);
  assert.notStrictEqual(r.eventId, EID);
  assert.strictEqual(sent.length, 1);
});
