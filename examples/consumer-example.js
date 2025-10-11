const { init, consumer, EVENT_TYPES, shutdown } = require("../../src/index.js");

async function consumerExample() {
  try {
    // Initialize the middleware
    await init({
      url: process.env.RABBIT_URL || "amqp://localhost:5672",
      logger: console,
      consumerMaxRetries: 3,
    });

    console.log("✅ Consumer initialized");

    // Register event handlers
    consumer.registerHandler(
      EVENT_TYPES.USER_CREATED,
      async (payload, context) => {
        console.log("📥 Received user.created event:", {
          eventId: payload.eventId,
          userId: payload.data.userId,
          email: payload.data.email,
          correlationId: payload.correlationId,
          routingKey: context.routingKey,
        });

        // Simulate processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        console.log("✅ Processed user.created event");
      }
    );

    consumer.registerHandler(
      EVENT_TYPES.APPLICATION_STATUS_UPDATED,
      async (payload, context) => {
        console.log("📥 Received application.status.updated event:", {
          eventId: payload.eventId,
          applicationId: payload.data.applicationId,
          status: payload.data.status,
          correlationId: payload.correlationId,
        });

        // Simulate processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        console.log("✅ Processed application.status.updated event");
      }
    );

    consumer.registerHandler(
      EVENT_TYPES.PAYMENT_CREATED,
      async (payload, context) => {
        console.log("📥 Received payment.created event:", {
          eventId: payload.eventId,
          paymentId: payload.data.paymentId,
          amount: payload.data.amount,
        });

        // Simulate processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        console.log("✅ Processed payment.created event");
      }
    );

    // Create and setup queue for user events
    const userQueue = "example-service.user.events";
    await consumer.createQueue(userQueue, {
      durable: true,
      messageTtl: 3600000, // 1 hour
    });
    await consumer.bindQueue(userQueue, "user.events", [
      EVENT_TYPES.USER_CREATED,
      EVENT_TYPES.USER_UPDATED,
    ]);
    await consumer.consume(userQueue, { prefetch: 5 });

    // Create and setup queue for application events
    const applicationQueue = "example-service.application.events";
    await consumer.createQueue(applicationQueue);
    await consumer.bindQueue(applicationQueue, "accounts.events", [
      EVENT_TYPES.APPLICATION_STATUS_UPDATED,
    ]);
    await consumer.consume(applicationQueue, { prefetch: 5 });

    // Create and setup queue for payment events
    const paymentQueue = "example-service.payment.events";
    await consumer.createQueue(paymentQueue);
    await consumer.bindQueue(paymentQueue, "payment.events", [
      EVENT_TYPES.PAYMENT_CREATED,
      EVENT_TYPES.PAYMENT_COMPLETED,
    ]);
    await consumer.consume(paymentQueue, { prefetch: 5 });

    console.log("✅ All consumers started");
    console.log("Active consumers:", consumer.getActiveConsumers());
    console.log("⏳ Waiting for messages... (Press Ctrl+C to exit)");

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      console.log("\n⏹️  Shutting down...");
      await shutdown();
      console.log("✅ Consumer shutdown complete");
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      console.log("\n⏹️  Shutting down...");
      await shutdown();
      console.log("✅ Consumer shutdown complete");
      process.exit(0);
    });
  } catch (error) {
    console.error("❌ Consumer error:", error);
    process.exit(1);
  }
}

// Run example
consumerExample();
