const connectionManager = require("./connection.js");

class EventPublisher {
  constructor() {
    this.logger = console;
    this.publishRetries = 3;
    this.publishRetryDelay = 1000;

    // Event type to exchange mapping
    this.exchangeMapping = {
      // User events
      "user.created": "user.events",
      "user.updated": "user.events",
      "user.deleted": "user.events",
      "user.login": "user.events",
      "user.logout": "user.events",

      // Payment/Account events
      "payment.created": "payment.events",
      "payment.completed": "payment.events",
      "payment.failed": "payment.events",
      "account.created": "accounts.events",
      "account.updated": "accounts.events",
      "application.status.updated": "accounts.events",
      "application.status.submitted": "accounts.events",

      // Application events
      "application.created": "application.events",
      "application.updated": "application.events",
      "application.submitted": "application.events",
      "application.approved": "application.events",
      "application.rejected": "application.events",
      "applications.review.approved.v1": "application.events",
      "applications.review.rejected.v1": "application.events",

      // Portal events
      "portal.application.created": "portal.events",
      "portal.application.updated": "portal.events",
      "profile.application.create": "portal.events",

      // Profile events
      "profile.created": "profile.events",
      "profile.updated": "profile.events",
      "profile.deleted": "profile.events",

      // Membership events
      "members.member.created.requested.v1": "membership.events",
      "members.subscription.upsert.requested.v1": "membership.events",
      "members.subscription.current.updated.v1": "membership.events",

      // M1: tenant provisioning (user-service orchestrator <-> owning services). Published only through
      // publishConfirmed() from a transactional outbox (deterministic eventId, broker ack).
      "tenant.provisioning.step.requested.v1": "provisioning.events",
      "tenant.provisioning.step.completed.v1": "provisioning.events",
      "tenant.provisioning.step.failed.v1": "provisioning.events",
    };
  }

  setLogger(logger) {
    this.logger = logger;
  }

  setExchangeMapping(mapping) {
    this.exchangeMapping = { ...this.exchangeMapping, ...mapping };
  }

  getExchangeForEvent(eventType) {
    return this.exchangeMapping[eventType] || "application.events";
  }

  async publish(eventType, data, options = {}) {
    const {
      correlationId,
      tenantId,
      userId,
      metadata = {},
      priority = 0,
      exchange,
      routingKey,
    } = options;

    // Build standardized payload
    const payload = {
      eventId: this.generateEventId(),
      eventType,
      timestamp: new Date().toISOString(),
      correlationId: correlationId || this.generateEventId(),
      tenantId,
      userId,
      data,
      metadata: {
        service: metadata.service || process.env.SERVICE_NAME || "unknown",
        version: metadata.version || "1.0",
        ...metadata,
      },
    };

    // Use explicit exchange from options, or fallback to mapping, or default
    const finalExchange = exchange || this.getExchangeForEvent(eventType);
    const finalRoutingKey = routingKey || eventType;

    const messageOptions = {
      contentType: "application/json",
      persistent: true,
      timestamp: Date.now(),
      priority,
      headers: {
        "x-event-type": eventType,
        "x-correlation-id": payload.correlationId,
        "x-tenant-id": tenantId,
        ...(options.headers || {}),
      },
    };

    return this.publishWithRetry(finalExchange, finalRoutingKey, payload, messageOptions);
  }

  async publishWithRetry(
    exchange,
    routingKey,
    payload,
    messageOptions,
    attempt = 1
  ) {
    try {
      const channel = await connectionManager.getChannel();

      this.logger.info?.(`📤 Publishing event: ${payload.eventType}`, {
        exchange,
        routingKey,
        eventId: payload.eventId,
        correlationId: payload.correlationId,
        attempt,
      });

      const success = channel.publish(
        exchange,
        routingKey,
        Buffer.from(JSON.stringify(payload)),
        messageOptions
      );

      if (success) {
        this.logger.info?.(
          `✅ Event published successfully: ${payload.eventType}`,
          {
            eventId: payload.eventId,
            exchange,
            routingKey,
          }
        );
        return { success: true, eventId: payload.eventId, payload };
      } else {
        throw new Error("Channel publish returned false - buffer full");
      }
    } catch (error) {
      this.logger.error?.(
        `❌ Failed to publish event (attempt ${attempt}): ${error.message}`,
        {
          eventType: payload.eventType,
          eventId: payload.eventId,
          exchange,
          routingKey,
          error: error.message,
        }
      );

      if (attempt < this.publishRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.publishRetryDelay * attempt)
        );
        return this.publishWithRetry(
          exchange,
          routingKey,
          payload,
          messageOptions,
          attempt + 1
        );
      }

      return { success: false, error: error.message, eventId: payload.eventId };
    }
  }

  /**
   * M1: publish ONE message and resolve only when the broker CONFIRMS it (publisher confirms on a dedicated
   * confirm channel). For transactional outboxes:
   *  - options.eventId is REQUIRED and used as-is (deterministic: the same logical event always carries the same
   *    id, so a re-publish after a crash is deduplicated by consumers); it is also the AMQP messageId;
   *  - options.tenantId is REQUIRED (internal tenant id): envelope tenantId + x-tenant-id header;
   *  - no internal retry loop (the outbox owns retry / backoff); options.confirmTimeoutMs (default 10000);
   *  - resolves { success: true, eventId } on ack, { success: false, error, eventId } on nack / timeout /
   *    channel error. Never throws for a broker failure.
   * publish() is unchanged (it does not wait for a broker ack).
   */
  async publishConfirmed(eventType, data, options = {}) {
    const { eventId, tenantId, correlationId, metadata = {}, exchange, routingKey, confirmTimeoutMs = 10000 } = options;
    if (typeof eventId !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(eventId)) {
      return { success: false, error: "eventId required (8-128 chars [A-Za-z0-9._:-])", eventId };
    }
    if (typeof tenantId !== "string" || !/^[0-9a-f]{24}$/.test(tenantId)) {
      return { success: false, error: "tenantId (internal tenant id) required", eventId };
    }
    const payload = {
      eventId,
      eventType,
      timestamp: new Date().toISOString(),
      correlationId: correlationId || eventId,
      tenantId,
      data,
      metadata: {
        service: metadata.service || process.env.SERVICE_NAME || "unknown",
        version: metadata.version || "1.0",
        ...metadata,
      },
    };
    const finalExchange = exchange || this.getExchangeForEvent(eventType);
    const finalRoutingKey = routingKey || eventType;
    const messageOptions = {
      contentType: "application/json",
      persistent: true,
      messageId: eventId,
      timestamp: Date.now(),
      headers: { "x-event-type": eventType, "x-correlation-id": payload.correlationId, "x-tenant-id": tenantId },
    };
    let channel;
    try {
      channel = await connectionManager.getConfirmChannel();
    } catch (error) {
      return { success: false, error: `confirm channel unavailable: ${error.message}`, eventId };
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(r);
      };
      const timer = setTimeout(() => finish({ success: false, error: "confirm timeout", eventId }), confirmTimeoutMs);
      try {
        channel.publish(finalExchange, finalRoutingKey, Buffer.from(JSON.stringify(payload)), messageOptions, (err) =>
          finish(err ? { success: false, error: "broker nack", eventId } : { success: true, eventId, exchange: finalExchange, routingKey: finalRoutingKey })
        );
      } catch (error) {
        finish({ success: false, error: error.message, eventId });
      }
    });
  }

  generateEventId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async publishBatch(events) {
    const results = await Promise.allSettled(
      events.map((event) =>
        this.publish(event.eventType, event.data, event.options || {})
      )
    );

    return results.map((result, index) => ({
      eventType: events[index].eventType,
      success: result.status === "fulfilled" && result.value.success,
      result: result.status === "fulfilled" ? result.value : result.reason,
    }));
  }
}

// Singleton instance
const publisher = new EventPublisher();

module.exports = publisher;
