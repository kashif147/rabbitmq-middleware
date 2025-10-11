# @projectShell/rabbitmq-middleware

Shared RabbitMQ middleware for Node.js microservices with support for both CommonJS and ESM.

## Features

- 🔄 **Auto-reconnection**: Automatic reconnection with configurable retry logic
- 📦 **Singleton Pattern**: Single connection per service with channel management
- 🔁 **Retry Logic**: Built-in retry mechanism with exponential backoff
- 💀 **Dead Letter Queues**: Automatic DLQ setup for failed messages
- 📊 **Event Schemas**: Standardized event types and payload validation
- 🌐 **Dual Module Support**: Works with both CommonJS and ESM
- 🎯 **Exchange Mapping**: Automatic event-to-exchange routing
- 📝 **Structured Logging**: Logger integration support

## Installation

```bash
npm install @projectShell/rabbitmq-middleware
```

## Quick Start

### CommonJS

```javascript
const {
  init,
  publisher,
  consumer,
  EVENT_TYPES,
} = require("@projectShell/rabbitmq-middleware");

// Initialize
await init({
  url: process.env.RABBIT_URL,
  logger: console, // or your custom logger
});

// Publish an event
await publisher.publish(
  EVENT_TYPES.USER_CREATED,
  {
    userId: "123",
    email: "user@example.com",
  },
  {
    tenantId: "tenant-1",
    correlationId: "req-123",
  }
);

// Consume events
consumer.registerHandler(EVENT_TYPES.USER_CREATED, async (payload, context) => {
  console.log("User created:", payload.data);
});

await consumer.createQueue("user-service.user.events");
await consumer.bindQueue("user-service.user.events", "user.events", [
  "user.created",
]);
await consumer.consume("user-service.user.events");
```

### ESM

```javascript
import {
  init,
  publisher,
  consumer,
  EVENT_TYPES,
} from "@projectShell/rabbitmq-middleware";

// Same API as CommonJS
await init({ url: process.env.RABBIT_URL });
```

## Configuration

### Initialization Options

```javascript
await init({
  url: "amqp://localhost:5672", // RabbitMQ URL
  logger: customLogger, // Custom logger instance
  prefetch: 10, // Channel prefetch count
  maxReconnectAttempts: 10, // Max reconnection attempts
  reconnectDelay: 5000, // Delay between reconnects (ms)
  publishRetries: 3, // Publish retry attempts
  consumerMaxRetries: 3, // Consumer retry attempts
  exchanges: [
    // Additional exchanges
    { name: "custom.events", type: "topic", options: { durable: true } },
  ],
});
```

## Publisher

### Publishing Events

```javascript
const result = await publisher.publish(
  "user.created", // Event type
  {
    // Event data
    userId: "123",
    email: "user@example.com",
  },
  {
    // Options
    tenantId: "tenant-1",
    userId: "123",
    correlationId: "req-123",
    metadata: {
      service: "user-service",
      version: "1.0",
    },
  }
);

if (result.success) {
  console.log("Published:", result.eventId);
}
```

### Batch Publishing

```javascript
const results = await publisher.publishBatch([
  {
    eventType: EVENT_TYPES.USER_CREATED,
    data: { userId: "1", email: "user1@example.com" },
    options: { tenantId: "tenant-1" },
  },
  {
    eventType: EVENT_TYPES.USER_UPDATED,
    data: { userId: "2", email: "user2@example.com" },
    options: { tenantId: "tenant-1" },
  },
]);
```

### Custom Exchange Mapping

```javascript
publisher.setExchangeMapping({
  "custom.event": "custom.exchange",
  "another.event": "another.exchange",
});
```

## Consumer

### Creating Queues with DLQ

```javascript
await consumer.createQueue("my-service.events", {
  durable: true,
  deadLetterExchange: "dlx",
  deadLetterRoutingKey: "my-service.events.dlq",
  messageTtl: 3600000, // 1 hour
  maxLength: 10000,
});
```

### Binding Queues

```javascript
// Bind to single routing key
await consumer.bindQueue("my-service.events", "user.events", "user.created");

// Bind to multiple routing keys
await consumer.bindQueue("my-service.events", "user.events", [
  "user.created",
  "user.updated",
  "user.deleted",
]);
```

### Registering Handlers

```javascript
consumer.registerHandler("user.created", async (payload, context) => {
  const { eventId, eventType, data, metadata } = payload;
  const { routingKey, exchange, headers, redelivered } = context;

  console.log("Processing user creation:", data.userId);

  // Your business logic here
  await processUser(data);
});
```

### Starting Consumers

```javascript
await consumer.consume("my-service.events", {
  prefetch: 10,
  noAck: false,
  consumerTag: "my-consumer-1",
});
```

### Managing Consumers

```javascript
// Cancel specific consumer
await consumer.cancelConsumer("my-service.events");

// Cancel all consumers
await consumer.cancelAllConsumers();

// Get active consumers
const activeConsumers = consumer.getActiveConsumers();
console.log("Active queues:", activeConsumers);
```

## Event Types

Pre-defined event types are available:

```javascript
const { EVENT_TYPES } = require("@projectShell/rabbitmq-middleware");

EVENT_TYPES.USER_CREATED; // user.created
EVENT_TYPES.USER_UPDATED; // user.updated
EVENT_TYPES.USER_DELETED; // user.deleted
EVENT_TYPES.PAYMENT_CREATED; // payment.created
EVENT_TYPES.PAYMENT_COMPLETED; // payment.completed
EVENT_TYPES.APPLICATION_STATUS_UPDATED; // application.status.updated
EVENT_TYPES.PROFILE_APPLICATION_CREATE; // profile.application.create
// ... and more
```

## Event Schemas

Validate event payloads:

```javascript
const { validateEventPayload } = require("@projectShell/rabbitmq-middleware");

const validation = validateEventPayload("user.created", {
  userId: "123",
  email: "user@example.com",
});

if (!validation.valid) {
  console.error("Validation errors:", validation.errors);
}
```

## Error Handling

### Publisher Errors

The publisher automatically retries failed publishes with exponential backoff:

```javascript
const result = await publisher.publish("user.created", data);

if (!result.success) {
  console.error("Failed to publish:", result.error);
  // Handle failure (e.g., save to database, alert)
}
```

### Consumer Errors

Failed message processing triggers automatic retry:

1. Message fails processing
2. Retried with exponential backoff (up to `maxRetries`)
3. After max retries, sent to Dead Letter Queue
4. DLQ messages can be manually inspected and reprocessed

```javascript
consumer.registerHandler("user.created", async (payload) => {
  try {
    await processUser(payload.data);
  } catch (error) {
    // Error is caught by middleware
    // Automatic retry or DLQ routing
    throw error;
  }
});
```

## Connection Management

### Manual Connection Control

```javascript
const { connectionManager } = require("@projectShell/rabbitmq-middleware");

// Check connection status
if (connectionManager.isConnected()) {
  console.log("Connected to RabbitMQ");
}

// Get channel
const channel = await connectionManager.getChannel();

// Close connection
await connectionManager.close();
```

### Graceful Shutdown

```javascript
const { shutdown } = require("@projectShell/rabbitmq-middleware");

process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  await shutdown();
  process.exit(0);
});
```

## Complete Example

```javascript
const {
  init,
  publisher,
  consumer,
  EVENT_TYPES,
  shutdown,
} = require("@projectShell/rabbitmq-middleware");

async function startService() {
  // Initialize
  await init({
    url: process.env.RABBIT_URL,
    logger: console,
    prefetch: 10,
  });

  // Setup consumer
  const queueName = "user-service.events";

  await consumer.createQueue(queueName);
  await consumer.bindQueue(queueName, "user.events", [
    EVENT_TYPES.USER_CREATED,
    EVENT_TYPES.USER_UPDATED,
  ]);

  consumer.registerHandler(EVENT_TYPES.USER_CREATED, async (payload) => {
    console.log("User created:", payload.data);
  });

  consumer.registerHandler(EVENT_TYPES.USER_UPDATED, async (payload) => {
    console.log("User updated:", payload.data);
  });

  await consumer.consume(queueName);

  console.log("Service started successfully");

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
  });
}

startService().catch(console.error);
```

## Advanced Usage

### Custom Logger

```javascript
const customLogger = {
  info: (msg, meta) => console.log("[INFO]", msg, meta),
  warn: (msg, meta) => console.warn("[WARN]", msg, meta),
  error: (msg, meta) => console.error("[ERROR]", msg, meta),
};

await init({ logger: customLogger });
```

### Message Context

Handlers receive full message context:

```javascript
consumer.registerHandler("user.created", async (payload, context) => {
  console.log("Routing key:", context.routingKey);
  console.log("Exchange:", context.exchange);
  console.log("Headers:", context.headers);
  console.log("Redelivered:", context.redelivered);
  console.log("Original message:", context.message);
});
```

## Best Practices

1. **Use Event Types**: Use predefined `EVENT_TYPES` constants
2. **Validate Payloads**: Use `validateEventPayload` before publishing
3. **Correlation IDs**: Always include correlation IDs for tracing
4. **Tenant Isolation**: Include tenant IDs for multi-tenant systems
5. **Graceful Shutdown**: Always call `shutdown()` on process termination
6. **DLQ Monitoring**: Monitor and process dead letter queues
7. **Idempotent Handlers**: Design handlers to be idempotent
8. **Error Logging**: Log errors with full context for debugging

## License

MIT
