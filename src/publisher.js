const connectionManager = require("./connection.js");
const { v4: uuidv4 } = require("uuid");

function extractBusinessIds(envelopeOrData) {
  const merged = {};
  if (envelopeOrData && typeof envelopeOrData === "object") {
    const nested = envelopeOrData.data;
    if (
      nested != null &&
      typeof nested === "object" &&
      !Array.isArray(nested)
    ) {
      Object.assign(merged, nested);
    }
    Object.assign(merged, envelopeOrData);
  }
  const profileId =
    merged.profileId ??
    merged.profile?.id ??
    merged.profile?._id ??
    null;
  const applicationId =
    merged.applicationId ??
    merged.application?.id ??
    merged.application?._id ??
    null;
  const membershipId =
    merged.membershipId ??
    merged.memberId ??
    merged.membership?.id ??
    merged.membershipNumber ??
    null;
  return {
    profileId: profileId != null ? String(profileId) : null,
    applicationId: applicationId != null ? String(applicationId) : null,
    membershipId: membershipId != null ? String(membershipId) : null,
  };
}

class EventPublisher {
  constructor() {
    this.logger = console;
    this.structuredLog = null;
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
      "journal.created.v1": "journal.events",

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
      "members.subscription.reporting.snapshot.v1": "membership.events",
      "members.subscription.resigned.v1": "membership.events",
      "members.subscription.resignation.undone.v1": "membership.events",
      "members.subscription.cancelled.v1": "membership.events",
      "members.subscription.cancel.grace.ended.v1": "membership.events",
      "members.subscription.cancellation.undone.v1": "membership.events",
      "members.subscription.category.changed.v1": "membership.events",
      "members.subscription.changed.v1": "membership.events",
      "members.member.notification.requested.v1": "membership.events",
      "members.payment-form.approved.v1": "membership.events",
      "members.payment.receipt.posted.v1": "membership.events",
      "members.reminder.batch.comms.requested.v1": "membership.events",
      "directdebit.collection.unpaid.v1": "application.events",
    };
  }

  setLogger(logger) {
    this.logger = logger;
  }

  setStructuredLog(handlers) {
    this.structuredLog =
      handlers && typeof handlers === "object" ? handlers : null;
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

    const occurredAt = new Date().toISOString();
    const sourceService =
      metadata.service ||
      process.env.SERVICE_NAME ||
      metadata.serviceName ||
      "unknown";

    // Build standardized payload (timestamp retained for backward compatibility)
    const payload = {
      eventId: uuidv4(),
      eventType,
      timestamp: occurredAt,
      occurredAt,
      correlationId: correlationId || uuidv4(),
      tenantId,
      userId,
      sourceService,
      data,
      metadata: {
        service: sourceService,
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

      if (!this.structuredLog?.onPublish) {
        this.logger.info?.(`📤 Publishing event: ${payload.eventType}`, {
          exchange,
          routingKey,
          eventId: payload.eventId,
          correlationId: payload.correlationId,
          attempt,
        });
      }

      const success = channel.publish(
        exchange,
        routingKey,
        Buffer.from(JSON.stringify(payload)),
        messageOptions
      );

      if (success) {
        const ids = extractBusinessIds(data);
        this.structuredLog?.onPublish?.({
          eventId: payload.eventId,
          correlationId: payload.correlationId,
          exchange,
          queue: null,
          routingKey,
          eventType: payload.eventType,
          retryCount: attempt - 1,
          profileId: ids.profileId,
          applicationId: ids.applicationId,
          membershipId: ids.membershipId,
        });
        if (!this.structuredLog?.onPublish) {
          this.logger.info?.(
            `✅ Event published successfully: ${payload.eventType}`,
            {
              eventId: payload.eventId,
              exchange,
              routingKey,
            }
          );
        }
        return { success: true, eventId: payload.eventId, payload };
      } else {
        throw new Error("Channel publish returned false - buffer full");
      }
    } catch (error) {
      const ids = extractBusinessIds(payload?.data ?? payload);
      this.structuredLog?.onFail?.({
        message: `publish failed: ${error.message}`,
        eventId: payload?.eventId,
        correlationId: payload?.correlationId,
        exchange,
        queue: null,
        routingKey,
        eventType: payload?.eventType,
        retryCount: attempt - 1,
        profileId: ids.profileId,
        applicationId: ids.applicationId,
        membershipId: ids.membershipId,
        error: error.message,
      });
      if (!this.structuredLog?.onFail) {
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
      }

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
