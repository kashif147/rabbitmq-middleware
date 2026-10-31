// Exchange routing for the payment-link events, and the unchanged fallback for unknown types.
jest.mock("../src/connection.js", () => ({
  isConnected: jest.fn(() => true),
  getNamedChannel: jest.fn(),
}));
const connectionManager = require("../src/connection.js");
const publisher = require("../src/publisher.js");

const EXPECTED = {
  "applications.payment-link.requested.v1": "application.events",
  "applications.payment-link.email.requested.v1": "application.events",
  "payments.payment-link.issued.v1": "payment.events",
  "payments.payment-link.failed.v1": "payment.events",
  "payments.payment-link.expired.v1": "payment.events",
  "payments.application-payment.status-changed.v1": "payment.events",
  "payments.application-payment.authorisation-expiring.v1": "payment.events",
  "members.gap-letter.requested.v1": "membership.events",
};

test.each(Object.entries(EXPECTED))("%s -> %s", (eventType, exchange) => {
  expect(publisher.getExchangeForEvent(eventType)).toBe(exchange);
});

test("unknown event types still fall back to application.events", () => {
  expect(publisher.getExchangeForEvent("payments.not-a-real-event.v9")).toBe("application.events");
});

test("existing mappings are unchanged", () => {
  expect(publisher.getExchangeForEvent("applications.review.processed.v1")).toBe("application.events");
  expect(publisher.getExchangeForEvent("application.status.updated")).toBe("accounts.events");
  expect(publisher.getExchangeForEvent("issues.issue.created.v1")).toBe("issues.events");
});

test("publish routes on the event type and carries tenant context in payload and header", async () => {
  const channel = { closed: false, publish: jest.fn(() => true) };
  connectionManager.getNamedChannel.mockResolvedValue(channel);
  publisher.setLogger({ info() {}, warn() {}, error() {}, debug() {} });

  const result = await publisher.publish(
    "payments.payment-link.issued.v1",
    { applicationId: "a1" },
    { tenantId: "tenant-1", correlationId: "c1" },
  );

  expect(result.success).toBe(true);
  const [exchange, routingKey, body, options] = channel.publish.mock.calls[0];
  expect(exchange).toBe("payment.events");
  expect(routingKey).toBe("payments.payment-link.issued.v1");
  const payload = JSON.parse(body.toString());
  expect(payload.tenantId).toBe("tenant-1");
  expect(payload.data).toEqual({ applicationId: "a1" });
  expect(options.headers["x-tenant-id"]).toBe("tenant-1");
});
