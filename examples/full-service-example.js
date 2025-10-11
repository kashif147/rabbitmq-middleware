const {
  init,
  publisher,
  consumer,
  EVENT_TYPES,
  validateEventPayload,
  shutdown,
} = require("../../src/index.js");

class UserService {
  constructor() {
    this.serviceName = "user-service";
  }

  async initialize() {
    // Initialize RabbitMQ middleware
    await init({
      url: process.env.RABBIT_URL || "amqp://localhost:5672",
      logger: console,
      prefetch: 10,
      maxReconnectAttempts: 10,
      publishRetries: 3,
      consumerMaxRetries: 3,
    });

    // Setup consumers
    await this.setupConsumers();

    console.log(`✅ ${this.serviceName} initialized successfully`);
  }

  async setupConsumers() {
    const queueName = `${this.serviceName}.events`;

    // Create queue with DLQ
    await consumer.createQueue(queueName, {
      durable: true,
      messageTtl: 3600000, // 1 hour
      maxLength: 10000,
    });

    // Bind to relevant events
    await consumer.bindQueue(queueName, "application.events", [
      EVENT_TYPES.APPLICATION_CREATED,
      EVENT_TYPES.APPLICATION_APPROVED,
    ]);

    // Register handlers
    consumer.registerHandler(
      EVENT_TYPES.APPLICATION_CREATED,
      this.handleApplicationCreated.bind(this)
    );

    consumer.registerHandler(
      EVENT_TYPES.APPLICATION_APPROVED,
      this.handleApplicationApproved.bind(this)
    );

    // Start consuming
    await consumer.consume(queueName, { prefetch: 10 });

    console.log(`✅ Consumers setup for ${this.serviceName}`);
  }

  async handleApplicationCreated(payload, context) {
    console.log("📥 Application created:", {
      applicationId: payload.data.applicationId,
      eventId: payload.eventId,
      correlationId: payload.correlationId,
    });

    // Business logic here
    await this.processNewApplication(payload.data);

    console.log("✅ Application created handler completed");
  }

  async handleApplicationApproved(payload, context) {
    console.log("📥 Application approved:", {
      applicationId: payload.data.applicationId,
      eventId: payload.eventId,
    });

    // Business logic here
    await this.notifyUserOfApproval(payload.data);

    console.log("✅ Application approved handler completed");
  }

  async processNewApplication(data) {
    // Simulate processing
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log("  ✓ Application processed");
  }

  async notifyUserOfApproval(data) {
    // Simulate notification
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log("  ✓ User notified");
  }

  async createUser(userData) {
    // Validate event payload
    const validation = validateEventPayload(EVENT_TYPES.USER_CREATED, userData);

    if (!validation.valid) {
      throw new Error(`Invalid user data: ${validation.errors.join(", ")}`);
    }

    // Business logic to create user
    console.log("Creating user:", userData.userId);

    // Publish user created event
    const result = await publisher.publish(EVENT_TYPES.USER_CREATED, userData, {
      tenantId: userData.tenantId,
      correlationId: `user-creation-${Date.now()}`,
      metadata: {
        service: this.serviceName,
        action: "create-user",
      },
    });

    if (!result.success) {
      console.error("Failed to publish user.created event:", result.error);
      throw new Error("Failed to publish event");
    }

    console.log("✅ User created and event published:", result.eventId);
    return result;
  }

  async updateUser(userId, updates) {
    console.log("Updating user:", userId);

    // Publish user updated event
    const result = await publisher.publish(
      EVENT_TYPES.USER_UPDATED,
      {
        userId,
        ...updates,
      },
      {
        tenantId: updates.tenantId,
        correlationId: `user-update-${Date.now()}`,
        metadata: {
          service: this.serviceName,
          action: "update-user",
        },
      }
    );

    if (!result.success) {
      console.error("Failed to publish user.updated event:", result.error);
      throw new Error("Failed to publish event");
    }

    console.log("✅ User updated and event published:", result.eventId);
    return result;
  }

  async shutdown() {
    console.log(`Shutting down ${this.serviceName}...`);
    await shutdown();
    console.log(`✅ ${this.serviceName} shutdown complete`);
  }
}

// Run the service
async function main() {
  const service = new UserService();

  try {
    await service.initialize();

    // Simulate some operations
    await service.createUser({
      userId: "user-123",
      email: "john@example.com",
      username: "john_doe",
      tenantId: "tenant-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await service.updateUser("user-123", {
      email: "john.doe@example.com",
      tenantId: "tenant-1",
    });

    console.log("\n✅ Service running... (Press Ctrl+C to exit)");

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      await service.shutdown();
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      await service.shutdown();
      process.exit(0);
    });
  } catch (error) {
    console.error("❌ Service error:", error);
    await service.shutdown();
    process.exit(1);
  }
}

main();
