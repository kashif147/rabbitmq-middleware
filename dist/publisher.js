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
      "members.subscription.resigned.v1": "membership.events",
      "members.subscription.resignation.undone.v1": "membership.events",
      "members.subscription.cancelled.v1": "membership.events",
      "members.subscription.cancel.grace.ended.v1": "membership.events",
      "members.subscription.cancellation.undone.v1": "membership.events",
      "members.subscription.category.changed.v1": "membership.events",
      "members.subscription.changed.v1": "membership.events",
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
      // Ensure connection is ready before publishing
      if (!connectionManager.isConnected()) {
        // Wait for connection to be established (with timeout)
        const maxWaitTime = 10000; // 10 seconds
        const startTime = Date.now();
        
        while (!connectionManager.isConnected() && (Date.now() - startTime) < maxWaitTime) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        
        if (!connectionManager.isConnected()) {
          throw new Error("RabbitMQ connection not available - connection timeout");
        }
      }

      // Use dedicated publisher channel from the same connection
      const channel = await connectionManager.getNamedChannel('publisher', 10);

      // Ensure channel is ready
      if (!channel || channel.closed) {
        throw new Error("Publisher channel not available or closed");
      }

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
          stack: error.stack,
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
