import amqplib from "amqplib";

class ConnectionManager {
  constructor() {
    this.connection = null;
    this.channels = new Map(); // Map of channel names to channel instances
    this.defaultChannel = null; // Default channel for backward compatibility
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000; // 5 seconds
    this.exchanges = new Map();
    this.logger = console;
    this.connectionName = null;
  }

  setLogger(logger) {
    this.logger = logger;
  }

  async connect(config = {}) {
    // If connection exists, return it (one connection per service instance)
    // But update connectionName if provided in config
    if (this.connection && this.isConnected()) {
      const connectionName = config.connectionName || config.serviceName;
      if (connectionName && connectionName !== this.connectionName) {
        this.connectionName = connectionName;
        this.logger.info?.(`📝 Updated connection name: ${connectionName}`);
      }
      return { connection: this.connection, channel: this.defaultChannel || await this.getChannel() };
    }

    if (this.isConnecting) {
      // Wait for existing connection attempt
      return new Promise((resolve) => {
        const checkConnection = setInterval(() => {
          if (!this.isConnecting && this.connection && this.isConnected()) {
            clearInterval(checkConnection);
            resolve({ connection: this.connection, channel: this.defaultChannel || this.getChannel() });
          }
        }, 100);
      });
    }

    this.isConnecting = true;

    try {
      const url =
        config.url || process.env.RABBIT_URL || "amqp://localhost:5672";
      const connectionName = config.connectionName || config.serviceName || "unknown-service";
      this.connectionName = connectionName;

      this.logger.info?.(
        `🔗 Connecting to RabbitMQ: ${url.replace(/\/\/.*@/, "//***@")} (connection: ${connectionName})`
      );

      // Connect with client properties for connection name visibility in RabbitMQ management UI
      const connectionOptions = {
        clientProperties: {
          connection_name: connectionName,
          service: connectionName,
        },
      };

      // Create ONE connection per service instance
      this.connection = await amqplib.connect(url, connectionOptions);
      
      // Create default channel for backward compatibility
      this.defaultChannel = await this.connection.createChannel();
      await this.defaultChannel.prefetch(config.prefetch || 10);
      this.channels.set('default', this.defaultChannel);

      // Setup exchanges on default channel
      await this.setupExchanges(config.exchanges || [], this.defaultChannel);

      // Setup event handlers
      this.setupEventHandlers();

      this.reconnectAttempts = 0;
      this.isConnecting = false;

      this.logger.info?.(
        `✅ RabbitMQ connection established successfully (connection: ${connectionName}, channels: 1)`
      );

      return { connection: this.connection, channel: this.defaultChannel };
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

  async setupExchanges(exchangeConfigs, channel = null) {
    const targetChannel = channel || this.defaultChannel || await this.getChannel();
    const defaultExchanges = [
      { name: "user.events", type: "topic", options: { durable: true } },
      { name: "payment.events", type: "topic", options: { durable: true } },
      { name: "application.events", type: "topic", options: { durable: true } },
      { name: "accounts.events", type: "topic", options: { durable: true } },
      { name: "portal.events", type: "topic", options: { durable: true } },
      { name: "profile.events", type: "topic", options: { durable: true } },
      { name: "membership.events", type: "topic", options: { durable: true } },
      { name: "product.events", type: "topic", options: { durable: true } },
      { name: "dlx", type: "topic", options: { durable: true } }, // Dead Letter Exchange
    ];

    const exchanges = [...defaultExchanges, ...exchangeConfigs];

    for (const exchange of exchanges) {
      await targetChannel.assertExchange(
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
      this.defaultChannel = null;
      this.channels.clear();

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

    // Setup handlers for default channel
    if (this.defaultChannel) {
      this.defaultChannel.on("error", (err) => {
        this.logger.warn?.(`⚠️ RabbitMQ channel error (default): ${err.message}`);
      });

      this.defaultChannel.on("close", () => {
        this.logger.warn?.("⚠️ RabbitMQ channel closed: default");
        this.channels.delete('default');
        this.defaultChannel = null;
      });
    }
  }

  /**
   * Get the default channel (backward compatibility)
   * @returns {Promise<Channel>} Default channel
   */
  async getChannel() {
    if (!this.connection || !this.defaultChannel) {
      await this.connect();
    }
    return this.defaultChannel;
  }

  /**
   * Get or create a named channel from the same connection
   * @param {string} channelName - Name of the channel (e.g., 'publisher', 'consumer')
   * @param {number} prefetch - Prefetch count for the channel
   * @returns {Promise<Channel>} Named channel
   */
  async getNamedChannel(channelName = 'default', prefetch = 10) {
    if (!this.connection) {
      await this.connect();
    }

    // Return existing channel if it exists and is not closed
    if (this.channels.has(channelName)) {
      const channel = this.channels.get(channelName);
      if (channel && !channel.closed) {
        return channel;
      }
      // Channel was closed, remove it
      this.channels.delete(channelName);
    }

    // Create new channel from the same connection
    const channel = await this.connection.createChannel();
    await channel.prefetch(prefetch);
    this.channels.set(channelName, channel);

    // Setup event handlers for new channel
    channel.on("error", (err) => {
      this.logger.warn?.(`⚠️ RabbitMQ channel error (${channelName}): ${err.message}`);
    });

    channel.on("close", () => {
      this.logger.warn?.(`⚠️ RabbitMQ channel closed: ${channelName}`);
      this.channels.delete(channelName);
      if (channelName === 'default') {
        this.defaultChannel = null;
      }
    });

    this.logger.info?.(`✅ Created channel: ${channelName} (total channels: ${this.channels.size}, connection: ${this.connectionName})`);
    return channel;
  }

  /**
   * Get all active channels
   * @returns {Map<string, Channel>} Map of channel names to channels
   */
  getChannels() {
    return this.channels;
  }

  /**
   * Get channel count
   * @returns {number} Number of active channels
   */
  getChannelCount() {
    return this.channels.size;
  }

  async close() {
    try {
      // Close all channels first
      for (const [name, channel] of this.channels) {
        try {
          if (channel && !channel.closed) {
            await channel.close();
            this.logger.info?.(`✅ Closed channel: ${name}`);
          }
        } catch (error) {
          this.logger.warn?.(`⚠️ Error closing channel ${name}: ${error.message}`);
        }
      }
      this.channels.clear();
      this.defaultChannel = null;

      // Close connection
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
    return this.connection !== null && this.channels.size > 0;
  }
}

// Singleton instance
const connectionManager = new ConnectionManager();

export default connectionManager;
