import connectionManager from "./connection.js";

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

    // Use consumer channel for queue operations
    const channel = await connectionManager.getNamedChannel('consumer', 10);

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
    // Use consumer channel for queue bindings
    const channel = await connectionManager.getNamedChannel('consumer', 10);

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

    // Use dedicated consumer channel from the same connection
    const channel = await connectionManager.getNamedChannel('consumer', prefetch);

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

      // Enhanced message received logging with correlation data
      const receiveCorrelationData = {
        eventId,
        correlationId,
        eventType,
        queueName,
        routingKey: msg.fields.routingKey,
        exchange: msg.fields.exchange,
        retryCount,
        timestamp: new Date().toISOString(),
        service: payload?.metadata?.service || 'unknown',
        redelivered: msg.fields.redelivered,
      };

      this.logger.info?.(`📥 [RECEIVED] Message received: ${eventType}`, receiveCorrelationData);
      
      // Parseable format for correlation
      this.logger.info?.(`📥 [RECEIVED_CORRELATION] eventId=${eventId} correlationId=${correlationId} eventType=${eventType} queue=${queueName} retry=${retryCount} timestamp=${receiveCorrelationData.timestamp}`);

      // Find and execute handler - try eventType first, then routing key as fallback
      let handler = this.handlers.get(eventType);
      const routingKey = msg.fields.routingKey;

      if (!handler && routingKey && routingKey !== eventType) {
        // Fallback: try routing key if eventType doesn't match
        handler = this.handlers.get(routingKey);
        if (handler) {
          this.logger.info?.(`📌 Handler found by routing key: ${routingKey} (eventType: ${eventType})`);
        }
      }

      if (!handler) {
        const warnMsg = `⚠️ No handler registered for event: ${eventType}`;
        const warnData = {
          eventType,
          routingKey,
          registeredHandlers: Array.from(this.handlers.keys()),
          queueName,
        };
        
        if (this.logger && typeof this.logger.warn === 'function') {
          this.logger.warn(warnMsg, warnData);
        } else if (this.logger && typeof this.logger.log === 'function') {
          this.logger.log(warnMsg, warnData);
        } else {
          console.warn(warnMsg, warnData);
        }
        
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
      // Enhanced error logging with correlation data
      const errorCorrelationData = {
        // Core identifiers
        eventId: payload?.eventId,
        correlationId: payload?.correlationId,
        eventType: payload?.eventType,
        
        // Processing context
        queueName,
        routingKey: msg?.fields?.routingKey,
        exchange: msg?.fields?.exchange,
        retryCount,
        
        // Error details
        error: error.message,
        errorName: error.name,
        errorStack: error.stack,
        
        // Service metadata
        service: payload?.metadata?.service || 'unknown',
        timestamp: new Date().toISOString(),
        
        // Message metadata
        redelivered: msg?.fields?.redelivered,
        deliveryTag: msg?.fields?.deliveryTag,
      };

      this.logger.error?.(`❌ [ERROR] Error processing message:`, errorCorrelationData);
      
      // Parseable format for correlation
      this.logger.error?.(`❌ [ERROR_CORRELATION] eventId=${payload?.eventId} correlationId=${payload?.correlationId} queue=${queueName} retry=${retryCount} error="${error.message}" timestamp=${errorCorrelationData.timestamp}`);

      // Handle retry logic
      if (retryCount < this.maxRetries) {
        await this.retryMessage(msg, channel, retryCount + 1);
      } else {
        // Max retries reached, send to DLQ
        const dlqCorrelationData = {
          // Core identifiers for log correlation
          eventId: payload?.eventId,
          correlationId: payload?.correlationId,
          eventType: payload?.eventType,
          
          // DLQ metadata
          dlqQueue: `${queueName}.dlq`,
          originalQueue: queueName,
          originalExchange: msg.fields.exchange,
          originalRoutingKey: msg.fields.routingKey,
          
          // Processing metadata
          retryCount,
          maxRetries: this.maxRetries,
          timestamp: new Date().toISOString(),
          service: payload?.metadata?.service || 'unknown',
          
          // Error details
          error: error.message,
          errorStack: error.stack,
          errorName: error.name,
          
          // Message metadata
          messageSize: msg.content.length,
          redelivered: msg.fields.redelivered,
          deliveryTag: msg.fields.deliveryTag,
          
          // Headers for correlation
          headers: msg.properties.headers || {},
        };

        // Structured log for DLQ correlation
        this.logger.error?.(`💀 [DLQ] Message sent to Dead Letter Queue`, dlqCorrelationData);
        
        // Also log in a parseable format for correlation scripts
        this.logger.error?.(`💀 [DLQ_CORRELATION] eventId=${payload?.eventId} correlationId=${payload?.correlationId} queue=${queueName} dlq=${dlqCorrelationData.dlqQueue} timestamp=${dlqCorrelationData.timestamp} service=${dlqCorrelationData.service} error="${error.message}"`);
        
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
      // Use consumer channel for cancellation
      const channel = await connectionManager.getNamedChannel('consumer', 10);
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

export default consumer;
