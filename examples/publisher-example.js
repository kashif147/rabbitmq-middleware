const {
  init,
  publisher,
  EVENT_TYPES,
  shutdown,
} = require("../../src/index.js");

async function publisherExample() {
  try {
    // Initialize the middleware
    await init({
      url: process.env.RABBIT_URL || "amqp://localhost:5672",
      logger: console,
    });

    console.log("✅ Publisher initialized");

    // Example 1: Publish a user created event
    const result1 = await publisher.publish(
      EVENT_TYPES.USER_CREATED,
      {
        userId: "user-123",
        email: "john@example.com",
        username: "john_doe",
      },
      {
        tenantId: "tenant-1",
        correlationId: "req-001",
        metadata: {
          service: "user-service",
          action: "registration",
        },
      }
    );

    console.log("Published user.created:", result1);

    // Example 2: Publish an application status update
    const result2 = await publisher.publish(
      EVENT_TYPES.APPLICATION_STATUS_UPDATED,
      {
        applicationId: "app-456",
        status: "approved",
        previousStatus: "pending",
        approvedBy: "admin-789",
      },
      {
        tenantId: "tenant-1",
        userId: "user-123",
        correlationId: "req-002",
      }
    );

    console.log("Published application.status.updated:", result2);

    // Example 3: Batch publish
    const batchResults = await publisher.publishBatch([
      {
        eventType: EVENT_TYPES.PAYMENT_CREATED,
        data: {
          paymentId: "pay-001",
          amount: 99.99,
          currency: "USD",
        },
        options: { tenantId: "tenant-1", correlationId: "req-003" },
      },
      {
        eventType: EVENT_TYPES.PAYMENT_COMPLETED,
        data: {
          paymentId: "pay-001",
          amount: 99.99,
          currency: "USD",
          status: "completed",
          transactionId: "txn-abc123",
        },
        options: { tenantId: "tenant-1", correlationId: "req-004" },
      },
    ]);

    console.log("Batch publish results:", batchResults);

    // Wait a bit before shutting down
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Graceful shutdown
    await shutdown();
    console.log("✅ Publisher shutdown complete");
  } catch (error) {
    console.error("❌ Publisher error:", error);
    process.exit(1);
  }
}

// Run example
publisherExample();
