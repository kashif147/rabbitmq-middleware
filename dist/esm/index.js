import connectionManager from "./connection.js";
import publisher from "./publisher.js";
import consumer from "./consumer.js";
import schemas from "./schemas/index.js";

// Initialize RabbitMQ with configuration
async function init(config = {}) {
  const {
    url,
    exchanges = [],
    prefetch = 10,
    logger,
    maxReconnectAttempts = 10,
    reconnectDelay = 5000,
    publishRetries = 3,
    consumerMaxRetries = 3,
  } = config;

  // Set logger if provided
  if (logger) {
    connectionManager.setLogger(logger);
    publisher.setLogger(logger);
    consumer.setLogger(logger);
  }

  // Configure connection manager
  connectionManager.maxReconnectAttempts = maxReconnectAttempts;
  connectionManager.reconnectDelay = reconnectDelay;

  // Configure publisher
  publisher.publishRetries = publishRetries;

  // Configure consumer
  consumer.maxRetries = consumerMaxRetries;

  // Connect to RabbitMQ
  await connectionManager.connect({ url, exchanges, prefetch });

  return {
    connectionManager,
    publisher,
    consumer,
  };
}

// Graceful shutdown
async function shutdown() {
  await consumer.cancelAllConsumers();
  await connectionManager.close();
}

export { init,
  shutdown,
  connectionManager,
  publisher,
  consumer,
  ...schemas, };
