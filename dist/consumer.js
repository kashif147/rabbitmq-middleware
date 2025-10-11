const connectionManager = require("./connection.js");

class EventConsumer {
  constructor() {
    this.consumers = new Map();
    this.handlers = new Map();
    this.logger = console;
    this.maxRetries = 3;
    this.retryDelay = 5000;
  }

  setLogger(logger) {
    this.logger = logger;
  }

  async createQueue(queueName, options = {}) {
    const {
      durable = true,
      deadLetterExchange = "dlx",
      deadLetterRoutingKey = `${queueName}.dlq`,
      messageTtl,
      maxLength,
    } = options;

    const channel = await connectionManager.getChannel();

    const queueOptions = {
      durable,
      arguments: {
        "x-dead-letter-exchange": deadLetterExchange,
        "x-dead-letter-routing-key": deadLetterRoutingKey,
      },
    };

    if (messageTtl) {
      queueOptions.arguments["x-message-ttl"] = messageTtl;
    }

    if (maxLength) {
      queueOptions.arguments["x-max-length"] = maxLength;
    }

    await channel.assertQueue(queueName, queueOptions);

    // Create DLQ
    const dlqName = `${queueName}.dlq`;
    await channel.assertQueue(dlqName, { durable: true });
    await channel.bindQueue(dlqName, deadLetterExchange, deadLetterRoutingKey);

    this.logger.info?.(`✅ Queue created: ${queueName} with DLQ: ${dlqName}`);

    return queueName;
  }

  async bindQueue(queueName, exchange, routingKeys = []) {
    const channel = await connectionManager.getChannel();

    if (!Array.isArray(routingKeys)) {
      routingKeys = [routingKeys];
    }

    for (const routingKey of routingKeys) {
      await channel.bindQueue(queueName, exchange, routingKey);
      this.logger.info?.(
        `✅ Queue bound: ${queueName} -> ${exchange} (${routingKey})`
      );
    }
  }

  registerHandler(eventType, handler) {
    if (typeof handler !== "function") {
      throw new Error(`Handler for ${eventType} must be a function`);
    }

    this.handlers.set(eventType, handler);
    this.logger.info?.(`✅ Handler registered for event: ${eventType}`);
  }

  async consume(queueName, options = {}) {
    const { noAck = false, prefetch = 10, consumerTag } = options;

    const channel = await connectionManager.getChannel();

    await channel.prefetch(prefetch);

    this.logger.info?.(`🎧 Starting consumer for queue: ${queueName}`);

    const consumer = await channel.consume(
      queueName,
      async (msg) => {
        if (!msg) return;

        await this.handleMessage(msg, channel, queueName);
      },
      {
        noAck,
        consumerTag,
      }
    );

    this.consumers.set(queueName, consumer);
    this.logger.info?.(
      `✅ Consumer started: ${queueName} (tag: ${consumer.consumerTag})`
    );

    return consumer;
  }

  async handleMessage(msg, channel, queueName) {
    let payload;
    let retryCount = 0;

    try {
      payload = JSON.parse(msg.content.toString());
      const { eventType, eventId, correlationId } = payload;

      // Get retry count from headers
      if (msg.properties.headers && msg.properties.headers["x-retry-count"]) {
        retryCount = parseInt(msg.properties.headers["x-retry-count"]);
      }

      this.logger.info?.(`📥 Message received: ${eventType}`, {
        queueName,
        eventId,
        correlationId,
        routingKey: msg.fields.routingKey,
        retryCount,
      });

      // Find and execute handler
      const handler = this.handlers.get(eventType);

      if (!handler) {
        this.logger.warn?.(`⚠️ No handler registered for event: ${eventType}`);
        channel.ack(msg); // Acknowledge to prevent reprocessing
        return;
      }

      // Execute handler
      await handler(payload, {
        routingKey: msg.fields.routingKey,
        exchange: msg.fields.exchange,
        headers: msg.properties.headers,
        redelivered: msg.fields.redelivered,
        message: msg,
      });

      // Acknowledge successful processing
      channel.ack(msg);

      this.logger.info?.(`✅ Message processed successfully: ${eventType}`, {
        eventId,
        queueName,
      });
    } catch (error) {
      this.logger.error?.(`❌ Error processing message:`, {
        queueName,
        eventType: payload?.eventType,
        eventId: payload?.eventId,
        error: error.message,
        stack: error.stack,
        retryCount,
      });

      // Handle retry logic
      if (retryCount < this.maxRetries) {
        await this.retryMessage(msg, channel, retryCount + 1);
      } else {
        // Max retries reached, send to DLQ
        this.logger.error?.(`💀 Max retries reached, sending to DLQ:`, {
          queueName,
          eventType: payload?.eventType,
          eventId: payload?.eventId,
          retryCount,
        });
        channel.nack(msg, false, false);
      }
    }
  }

  async retryMessage(msg, channel, retryCount) {
    try {
      const payload = JSON.parse(msg.content.toString());

      this.logger.info?.(`🔄 Retrying message (attempt ${retryCount}):`, {
        eventType: payload.eventType,
        eventId: payload.eventId,
      });

      // Acknowledge original message
      channel.ack(msg);

      // Republish with retry count
      const retryDelay = this.retryDelay * retryCount;

      setTimeout(async () => {
        const newHeaders = {
          ...msg.properties.headers,
          "x-retry-count": retryCount,
          "x-original-queue": msg.fields.routingKey,
        };

        channel.publish(
          msg.fields.exchange,
          msg.fields.routingKey,
          msg.content,
          {
            ...msg.properties,
            headers: newHeaders,
          }
        );
      }, retryDelay);
    } catch (error) {
      this.logger.error?.(`❌ Failed to retry message: ${error.message}`);
      channel.nack(msg, false, false);
    }
  }

  async cancelConsumer(queueName) {
    const consumer = this.consumers.get(queueName);
    if (!consumer) {
      this.logger.warn?.(`⚠️ No consumer found for queue: ${queueName}`);
      return;
    }

    try {
      const channel = await connectionManager.getChannel();
      await channel.cancel(consumer.consumerTag);
      this.consumers.delete(queueName);
      this.logger.info?.(`✅ Consumer cancelled: ${queueName}`);
    } catch (error) {
      this.logger.error?.(`❌ Error cancelling consumer: ${error.message}`);
    }
  }

  async cancelAllConsumers() {
    const queueNames = Array.from(this.consumers.keys());

    for (const queueName of queueNames) {
      await this.cancelConsumer(queueName);
    }

    this.consumers.clear();
    this.logger.info?.("✅ All consumers cancelled");
  }

  getActiveConsumers() {
    return Array.from(this.consumers.keys());
  }
}

// Singleton instance
const consumer = new EventConsumer();

module.exports = consumer;
