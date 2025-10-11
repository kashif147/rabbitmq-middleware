import amqplib from "amqplib";

class ConnectionManager {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000; // 5 seconds
    this.exchanges = new Map();
    this.logger = console;
  }

  setLogger(logger) {
    this.logger = logger;
  }

  async connect(config = {}) {
    if (this.connection && this.channel) {
      return { connection: this.connection, channel: this.channel };
    }

    if (this.isConnecting) {
      // Wait for existing connection attempt
      return new Promise((resolve) => {
        const checkConnection = setInterval(() => {
          if (!this.isConnecting && this.connection && this.channel) {
            clearInterval(checkConnection);
            resolve({ connection: this.connection, channel: this.channel });
          }
        }, 100);
      });
    }

    this.isConnecting = true;

    try {
      const url =
        config.url || process.env.RABBIT_URL || "amqp://localhost:5672";

      this.logger.info?.(
        `🔗 Connecting to RabbitMQ: ${url.replace(/\/\/.*@/, "//***@")}`
      );

      this.connection = await amqplib.connect(url);
      this.channel = await this.connection.createChannel();

      // Set prefetch for better load distribution
      await this.channel.prefetch(config.prefetch || 10);

      // Setup exchanges
      await this.setupExchanges(config.exchanges || []);

      // Setup event handlers
      this.setupEventHandlers();

      this.reconnectAttempts = 0;
      this.isConnecting = false;

      this.logger.info?.("✅ RabbitMQ connection established successfully");

      return { connection: this.connection, channel: this.channel };
    } catch (error) {
      this.isConnecting = false;
      this.logger.error?.(`❌ Failed to connect to RabbitMQ: ${error.message}`);

      // Attempt reconnection
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        this.logger.info?.(
          `⏳ Reconnecting in ${this.reconnectDelay / 1000}s (attempt ${
            this.reconnectAttempts
          }/${this.maxReconnectAttempts})...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.reconnectDelay)
        );
        return this.connect(config);
      }

      throw error;
    }
  }

  async setupExchanges(exchangeConfigs) {
    const defaultExchanges = [
      { name: "user.events", type: "topic", options: { durable: true } },
      { name: "payment.events", type: "topic", options: { durable: true } },
      { name: "application.events", type: "topic", options: { durable: true } },
      { name: "accounts.events", type: "topic", options: { durable: true } },
      { name: "portal.events", type: "topic", options: { durable: true } },
      { name: "profile.events", type: "topic", options: { durable: true } },
      { name: "dlx", type: "topic", options: { durable: true } }, // Dead Letter Exchange
    ];

    const exchanges = [...defaultExchanges, ...exchangeConfigs];

    for (const exchange of exchanges) {
      await this.channel.assertExchange(
        exchange.name,
        exchange.type,
        exchange.options
      );
      this.exchanges.set(exchange.name, exchange);
      this.logger.info?.(`✅ Exchange asserted: ${exchange.name}`);
    }
  }

  setupEventHandlers() {
    // Connection error handler
    this.connection.on("error", (err) => {
      this.logger.warn?.(`⚠️ RabbitMQ connection error: ${err.message}`);
    });

    // Connection close handler
    this.connection.on("close", () => {
      this.logger.warn?.("⚠️ RabbitMQ connection closed");
      this.connection = null;
      this.channel = null;

      // Auto-reconnect
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        setTimeout(() => {
          this.logger.info?.("🔄 Attempting to reconnect...");
          this.connect().catch((err) => {
            this.logger.error?.(`❌ Reconnection failed: ${err.message}`);
          });
        }, this.reconnectDelay);
      }
    });

    // Channel error handler
    this.channel.on("error", (err) => {
      this.logger.warn?.(`⚠️ RabbitMQ channel error: ${err.message}`);
    });

    // Channel close handler
    this.channel.on("close", () => {
      this.logger.warn?.("⚠️ RabbitMQ channel closed");
      this.channel = null;
    });
  }

  async getChannel() {
    if (!this.channel) {
      await this.connect();
    }
    return this.channel;
  }

  async close() {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }
      this.logger.info?.("✅ RabbitMQ connection closed gracefully");
    } catch (error) {
      this.logger.warn?.(
        `⚠️ Error closing RabbitMQ connection: ${error.message}`
      );
    }
  }

  isConnected() {
    return this.connection !== null && this.channel !== null;
  }
}

// Singleton instance
const connectionManager = new ConnectionManager();

export default connectionManager;
