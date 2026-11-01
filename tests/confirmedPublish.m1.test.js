// M1 - publisher.publishConfirmed (broker-confirmed, deterministic eventId) + tenant.provisioning.* mapping, on the
// develop line (jest). The broker / channels are stubs.
jest.mock("../src/connection.js", () => ({
  isConnected: jest.fn(() => true),
  getNamedChannel: jest.fn(),
  getChannel: jest.fn(),
  getConfirmChannel: jest.fn(),
}));
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
      return true;
    },
  };
}
beforeEach(() => { jest.clearAllMocks(); publisher.setLogger({}); });

test("provisioning event types map to provisioning.events (src and dist); existing mappings unchanged", () => {
  for (const p of [publisher, dist]) {
    for (const e of ["tenant.provisioning.step.requested.v1", "tenant.provisioning.step.completed.v1", "tenant.provisioning.step.failed.v1"]) {
      expect(p.getExchangeForEvent(e)).toBe("provisioning.events");
    }
  }
  expect(publisher.getExchangeForEvent("payments.payment-link.issued.v1")).toBe("payment.events");
  expect(publisher.getExchangeForEvent("issues.issue.audit.v1")).toBe("issues.events");
});

test("ack -> success with the CALLER's eventId (envelope + messageId) and the internal tenant header", async () => {
  const ch = stubChannel("ack");
  connectionManager.getConfirmChannel.mockResolvedValue(ch);
  const r = await publisher.publishConfirmed("tenant.provisioning.step.requested.v1", { stepKey: "k" }, { eventId: EID, tenantId: T });
  expect(r).toMatchObject({ success: true, eventId: EID, exchange: "provisioning.events", routingKey: "tenant.provisioning.step.requested.v1" });
  expect(ch.sent[0].body).toMatchObject({ eventId: EID, tenantId: T });
  expect(ch.sent[0].opts).toMatchObject({ messageId: EID, persistent: true, headers: { "x-tenant-id": T } });
});

test("nack / timeout / channel error / no channel -> success false, never throws", async () => {
  connectionManager.getConfirmChannel.mockResolvedValue(stubChannel("nack"));
  expect(await publisher.publishConfirmed("tenant.provisioning.step.requested.v1", {}, { eventId: EID, tenantId: T })).toEqual({ success: false, error: "broker nack", eventId: EID });
  connectionManager.getConfirmChannel.mockResolvedValue(stubChannel("silent"));
  expect(await publisher.publishConfirmed("tenant.provisioning.step.requested.v1", {}, { eventId: EID, tenantId: T, confirmTimeoutMs: 30 })).toMatchObject({ success: false, error: "confirm timeout" });
  connectionManager.getConfirmChannel.mockResolvedValue(stubChannel("throw"));
  expect((await publisher.publishConfirmed("tenant.provisioning.step.requested.v1", {}, { eventId: EID, tenantId: T })).success).toBe(false);
  connectionManager.getConfirmChannel.mockRejectedValue(new Error("down"));
  expect((await publisher.publishConfirmed("tenant.provisioning.step.requested.v1", {}, { eventId: EID, tenantId: T })).error).toMatch(/confirm channel unavailable/);
});

test("eventId and an internal tenantId are required", async () => {
  const ch = stubChannel("ack");
  connectionManager.getConfirmChannel.mockResolvedValue(ch);
  for (const opts of [{ tenantId: T }, { eventId: "short", tenantId: T }, { eventId: EID }, { eventId: EID, tenantId: "MULTIAUTH" }]) {
    expect((await publisher.publishConfirmed("tenant.provisioning.step.requested.v1", {}, opts)).success).toBe(false);
  }
  expect(ch.sent).toHaveLength(0);
});

test("publish() never touches the confirm channel", async () => {
  connectionManager.getNamedChannel.mockResolvedValue({ publish: () => true });
  connectionManager.getChannel.mockResolvedValue({ publish: () => true });
  await publisher.publish("payments.payment-link.issued.v1", {}, { tenantId: T });
  expect(connectionManager.getConfirmChannel).not.toHaveBeenCalled();
});
