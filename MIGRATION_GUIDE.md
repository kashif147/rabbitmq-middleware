# Migration Guide: Moving to @projectShell/rabbitmq-middleware

This guide walks through migrating your existing services to use the shared RabbitMQ middleware.

## Overview

The migration involves:

1. Installing the middleware package
2. Replacing direct amqplib usage with middleware
3. Migrating publishers
4. Migrating consumers
5. Testing the migration

## Step 1: Install the Middleware

### Option A: Link locally (for development)

```bash
# In the middleware directory
cd rabbitmq-middleware
npm install
npm run build
npm link

# In each service directory
cd ../user-service
npm link @projectShell/rabbitmq-middleware

cd ../portal-service
npm link @projectShell/rabbitmq-middleware

# ... repeat for other services
```

### Option B: Publish to npm (for production)

```bash
# In the middleware directory
cd rabbitmq-middleware
npm publish

# In each service
npm install @projectShell/rabbitmq-middleware
```

## Step 2: Initialize the Middleware

### CommonJS Services (portal-service, profile-service)

**Before:**

```javascript
// In app.js or main file
const { initEventSystem, setupConsumers } = require("./rabbitMQ");

app.listen(port, async () => {
  await initEventSystem();
  await setupConsumers();
});
```

**After:**

```javascript
// In app.js or main file
const { init, consumer } = require("@projectShell/rabbitmq-middleware");

app.listen(port, async () => {
  await init({
    url: process.env.RABBIT_URL,
    logger: console,
    prefetch: 10,
  });

  await setupConsumers(); // Your custom consumer setup
});
```

### ESM Services (account-service, user-service)

**Before:**

```javascript
// In app.js or main file
import { initEventSystem, setupConsumers } from "./rabbitMQ/index.js";

app.listen(port, async () => {
  await initEventSystem();
  await setupConsumers();
});
```

**After:**

```javascript
// In app.js or main file
import { init, consumer } from "@projectShell/rabbitmq-middleware";

app.listen(port, async () => {
  await init({
    url: process.env.RABBIT_URL,
    logger: logger, // Your pino/winston logger
    prefetch: 10,
  });

  await setupConsumers(); // Your custom consumer setup
});
```

## Step 3: Migrate Publishers

### CommonJS Example (portal-service)

**Before:**

```javascript
// portal-service/rabbitMQ/events.js
const { publishEvent } = require("./publisher.js");

async function publishDomainEvent(eventType, data, metadata = {}) {
  const payload = {
    eventId: generateEventId(),
    eventType,
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      service: "portal-service",
      version: "1.0",
      ...metadata,
    },
  };

  const success = await publishEvent(eventType, payload);
  return success;
}
```

**After:**

```javascript
// portal-service/rabbitMQ/events.js
const { publisher } = require("@projectShell/rabbitmq-middleware");

async function publishDomainEvent(eventType, data, metadata = {}) {
  const result = await publisher.publish(eventType, data, {
    tenantId: metadata.tenantId,
    correlationId: metadata.correlationId,
    metadata: {
      service: "portal-service",
      version: "1.0",
      ...metadata,
    },
  });

  return result.success;
}
```

### ESM Example (account-service)

**Before:**

```javascript
// account-service/src/rabbitMQ/publisher.js
import { publishEvent } from "./publisher.js";

export async function publishApplicationEvent(eventType, data) {
  const payload = {
    eventId: generateEventId(),
    eventType,
    timestamp: new Date().toISOString(),
    data,
  };

  return await publishEvent(eventType, payload);
}
```

**After:**

```javascript
// account-service/src/rabbitMQ/publisher.js
import { publisher } from "@projectShell/rabbitmq-middleware";

export async function publishApplicationEvent(eventType, data, options = {}) {
  const result = await publisher.publish(eventType, data, options);
  return result.success;
}
```

## Step 4: Migrate Consumers

### CommonJS Example (profile-service)

**Before:**

```javascript
// profile-service/rabbitMQ/events.js
const { createQueue, consumeQueue } = require("./consumer.js");
const {
  handleProfileApplicationCreate,
} = require("./listeners/eventHandler.js");

async function setupConsumers() {
  const QUEUE = "profile.portal.events";
  await createQueue(QUEUE, "portal.events", ["profile.application.create"]);
  await consumeQueue(QUEUE, handleProfileApplicationCreate);
}
```

**After:**

```javascript
// profile-service/rabbitMQ/events.js
const { consumer } = require("@projectShell/rabbitmq-middleware");
const {
  handleProfileApplicationCreate,
} = require("./listeners/eventHandler.js");

async function setupConsumers() {
  const QUEUE = "profile.portal.events";

  // Create queue with DLQ support
  await consumer.createQueue(QUEUE, {
    durable: true,
    messageTtl: 3600000, // 1 hour
  });

  // Bind to exchange
  await consumer.bindQueue(QUEUE, "portal.events", [
    "profile.application.create",
  ]);

  // Register handler
  consumer.registerHandler(
    "profile.application.create",
    async (payload, context) => {
      await handleProfileApplicationCreate(
        payload,
        context.routingKey,
        context.message
      );
    }
  );

  // Start consuming
  await consumer.consume(QUEUE, { prefetch: 10 });
}
```

### ESM Example (account-service)

**Before:**

```javascript
// account-service/src/rabbitMQ/events.js
import { createQueue, consumeQueue } from "./consumer.js";
import { handleApplicationSubmitted } from "./listeners/eventHandler.js";

export async function setupConsumers() {
  const QUEUE = "accounts.application.events";
  await createQueue(QUEUE, "application.events", [
    "application.status.submitted",
  ]);
  await consumeQueue(QUEUE, handleApplicationSubmitted);
}
```

**After:**

```javascript
// account-service/src/rabbitMQ/events.js
import { consumer } from "@projectShell/rabbitmq-middleware";
import { handleApplicationSubmitted } from "./listeners/eventHandler.js";

export async function setupConsumers() {
  const QUEUE = "accounts.application.events";

  await consumer.createQueue(QUEUE);
  await consumer.bindQueue(QUEUE, "application.events", [
    "application.status.submitted",
  ]);

  consumer.registerHandler(
    "application.status.submitted",
    async (payload, context) => {
      await handleApplicationSubmitted(
        payload,
        context.routingKey,
        context.message
      );
    }
  );

  await consumer.consume(QUEUE);
}
```

## Step 5: Update Event Handlers

### Update Handler Signature

**Before:**

```javascript
async function handleApplicationStatusUpdate(payload, routingKey, msg) {
  const { eventType, data } = payload;
  // Process event
}
```

**After:**

```javascript
// The middleware automatically extracts and passes the right data
async function handleApplicationStatusUpdate(payload, context) {
  const { eventId, eventType, data, metadata, correlationId } = payload;
  const { routingKey, exchange, headers, redelivered } = context;
  // Process event
}
```

## Step 6: Add Graceful Shutdown

### CommonJS

```javascript
// At the end of app.js
const { shutdown } = require("@projectShell/rabbitmq-middleware");

process.on("SIGTERM", async () => {
  console.log("Shutting down gracefully...");
  await shutdown();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  await shutdown();
  process.exit(0);
});
```

### ESM

```javascript
// At the end of app.js
import { shutdown } from "@projectShell/rabbitmq-middleware";

process.on("SIGTERM", async () => {
  console.log("Shutting down gracefully...");
  await shutdown();
  process.exit(0);
});
```

## Step 7: Remove Old RabbitMQ Files (Optional)

After migration is complete and tested, you can remove:

- `rabbitMQ/publisher.js` (replaced by middleware)
- `rabbitMQ/consumer.js` (replaced by middleware)
- Direct connection management code

Keep:

- `rabbitMQ/events.js` (your event constants and setup logic)
- `rabbitMQ/listeners/` (your event handlers)

## Service-Specific Migration Examples

### Portal Service Migration

```javascript
// portal-service/rabbitMQ/index.js
const {
  init,
  publisher,
  consumer,
  EVENT_TYPES,
  shutdown,
} = require("@projectShell/rabbitmq-middleware");

// Re-export for backward compatibility
const PROFILE_EVENTS = EVENT_TYPES;

async function initEventSystem() {
  await init({
    url: process.env.RABBIT_URL,
    logger: console,
  });
}

async function publishDomainEvent(eventType, data, metadata = {}) {
  const result = await publisher.publish(eventType, data, {
    tenantId: metadata.tenantId,
    correlationId: metadata.correlationId,
    metadata: {
      service: "portal-service",
      version: "1.0",
      ...metadata,
    },
  });

  return result.success;
}

async function setupConsumers() {
  const PAYMENT_QUEUE = "portal.payment.events";

  await consumer.createQueue(PAYMENT_QUEUE);
  await consumer.bindQueue(PAYMENT_QUEUE, "accounts.events", [
    "application.status.updated",
  ]);

  consumer.registerHandler(
    "application.status.updated",
    require("./listeners/eventHandler.js").handleApplicationStatusUpdate
  );

  await consumer.consume(PAYMENT_QUEUE);
}

async function shutdownEventSystem() {
  await shutdown();
}

module.exports = {
  PROFILE_EVENTS,
  initEventSystem,
  publishDomainEvent,
  setupConsumers,
  shutdownEventSystem,
};
```

### Account Service Migration (ESM)

```javascript
// account-service/src/rabbitMQ/index.js
import {
  init,
  publisher,
  consumer,
  EVENT_TYPES,
  shutdown,
} from "@projectShell/rabbitmq-middleware";

import logger from "../config/logger.js";

export async function initEventSystem() {
  await init({
    url: process.env.RABBIT_URL,
    logger: logger,
  });
}

export async function publishApplicationEvent(eventType, data, options = {}) {
  const result = await publisher.publish(eventType, data, {
    tenantId: options.tenantId,
    correlationId: options.correlationId,
    metadata: {
      service: "account-service",
      version: "1.0",
      ...options.metadata,
    },
  });

  return result.success;
}

export async function setupConsumers() {
  const QUEUE = "accounts.application.events";

  await consumer.createQueue(QUEUE);
  await consumer.bindQueue(QUEUE, "application.events", [
    "application.status.submitted",
  ]);

  // Import and register handlers
  const { handleApplicationSubmitted } = await import(
    "./listeners/eventHandler.js"
  );

  consumer.registerHandler(
    "application.status.submitted",
    handleApplicationSubmitted
  );

  await consumer.consume(QUEUE);
}

export async function shutdownEventSystem() {
  await shutdown();
}

export { EVENT_TYPES, publisher, consumer };
```

## Testing the Migration

### 1. Unit Testing

```javascript
// Test publisher
const { publisher } = require("@projectShell/rabbitmq-middleware");

test("publishes user created event", async () => {
  const result = await publisher.publish("user.created", {
    userId: "123",
    email: "test@example.com",
  });

  expect(result.success).toBe(true);
  expect(result.eventId).toBeDefined();
});
```

### 2. Integration Testing

Run your services and verify:

- Events are published successfully
- Consumers receive and process events
- DLQs are created
- Reconnection works after connection loss

### 3. Manual Testing Checklist

- [ ] Service starts without errors
- [ ] Exchanges are created correctly
- [ ] Queues are created with DLQs
- [ ] Events are published successfully
- [ ] Events are consumed successfully
- [ ] Error handling works (test with failing handler)
- [ ] Retry logic works
- [ ] DLQ receives failed messages after max retries
- [ ] Graceful shutdown works

## Rollback Plan

If issues arise, you can quickly rollback by:

1. Revert code changes
2. Uninstall the middleware: `npm uninstall @projectShell/rabbitmq-middleware`
3. Restore old RabbitMQ implementation

Keep backups of:

- Original `rabbitMQ/publisher.js`
- Original `rabbitMQ/consumer.js`
- Original `rabbitMQ/events.js`

## Common Issues and Solutions

### Issue: Module not found

```
Error: Cannot find module '@projectShell/rabbitmq-middleware'
```

**Solution:** Run `npm link @projectShell/rabbitmq-middleware` or `npm install @projectShell/rabbitmq-middleware`

### Issue: Connection refused

```
Error: connect ECONNREFUSED 127.0.0.1:5672
```

**Solution:** Verify RabbitMQ is running and `RABBIT_URL` is correct

### Issue: Events not being consumed

**Solution:**

- Check queue bindings
- Verify exchange names match
- Ensure handlers are registered before consuming
- Check RabbitMQ management UI for queue status

### Issue: ESM/CommonJS compatibility

**Solution:**

- ESM services: Use `import` syntax
- CommonJS services: Use `require` syntax
- The middleware supports both

## Next Steps

After successful migration:

1. Monitor RabbitMQ metrics
2. Check DLQs regularly
3. Set up alerts for failed messages
4. Document service-specific event flows
5. Update service documentation

## Support

For issues or questions:

1. Check this migration guide
2. Review the main README.md
3. Check the examples/ directory
4. Review existing service implementations
