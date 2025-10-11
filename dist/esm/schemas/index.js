// Event type definitions
const EVENT_TYPES = {
  // User events
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
  USER_DELETED: "user.deleted",
  USER_LOGIN: "user.login",
  USER_LOGOUT: "user.logout",

  // Payment events
  PAYMENT_CREATED: "payment.created",
  PAYMENT_COMPLETED: "payment.completed",
  PAYMENT_FAILED: "payment.failed",

  // Account events
  ACCOUNT_CREATED: "account.created",
  ACCOUNT_UPDATED: "account.updated",
  APPLICATION_STATUS_UPDATED: "application.status.updated",
  APPLICATION_STATUS_SUBMITTED: "application.status.submitted",

  // Application events
  APPLICATION_CREATED: "application.created",
  APPLICATION_UPDATED: "application.updated",
  APPLICATION_SUBMITTED: "application.submitted",
  APPLICATION_APPROVED: "application.approved",
  APPLICATION_REJECTED: "application.rejected",

  // Portal events
  PORTAL_APPLICATION_CREATED: "portal.application.created",
  PORTAL_APPLICATION_UPDATED: "portal.application.updated",
  PROFILE_APPLICATION_CREATE: "profile.application.create",

  // Profile events
  PROFILE_CREATED: "profile.created",
  PROFILE_UPDATED: "profile.updated",
  PROFILE_DELETED: "profile.deleted",
};

// Exchange definitions
const EXCHANGES = {
  USER_EVENTS: "user.events",
  PAYMENT_EVENTS: "payment.events",
  APPLICATION_EVENTS: "application.events",
  ACCOUNTS_EVENTS: "accounts.events",
  PORTAL_EVENTS: "portal.events",
  PROFILE_EVENTS: "profile.events",
  DLX: "dlx",
};

// Queue naming patterns
const QUEUE_PATTERNS = {
  SERVICE_SPECIFIC: (serviceName, eventCategory) =>
    `${serviceName}.${eventCategory}.events`,
  DLQ: (queueName) => `${queueName}.dlq`,
};

// Event payload schemas (for validation)
const EVENT_SCHEMAS = {
  [EVENT_TYPES.USER_CREATED]: {
    required: ["userId", "email"],
    optional: ["username", "profile", "tenantId"],
  },
  [EVENT_TYPES.USER_UPDATED]: {
    required: ["userId"],
    optional: ["email", "username", "profile", "tenantId"],
  },
  [EVENT_TYPES.APPLICATION_STATUS_UPDATED]: {
    required: ["applicationId", "status"],
    optional: ["tenantId", "userId", "previousStatus", "reason"],
  },
  [EVENT_TYPES.APPLICATION_STATUS_SUBMITTED]: {
    required: ["applicationId", "tenantId"],
    optional: [
      "userId",
      "submittedAt",
      "personalDetails",
      "professionalDetails",
      "subscriptionDetails",
    ],
  },
  [EVENT_TYPES.PROFILE_APPLICATION_CREATE]: {
    required: ["applicationId", "tenantId", "status"],
    optional: ["personalDetails", "professionalDetails", "subscriptionDetails"],
  },
  [EVENT_TYPES.PAYMENT_CREATED]: {
    required: ["paymentId", "amount", "currency"],
    optional: ["userId", "applicationId", "tenantId", "method"],
  },
  [EVENT_TYPES.PAYMENT_COMPLETED]: {
    required: ["paymentId", "amount", "currency", "status"],
    optional: ["userId", "applicationId", "tenantId", "transactionId"],
  },
};

// Validation helper
function validateEventPayload(eventType, data) {
  const schema = EVENT_SCHEMAS[eventType];

  if (!schema) {
    return { valid: true, errors: [] }; // No schema = no validation
  }

  const errors = [];

  // Check required fields
  for (const field of schema.required) {
    if (!(field in data) || data[field] === null || data[field] === undefined) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export { EVENT_TYPES,
  EXCHANGES,
  QUEUE_PATTERNS,
  EVENT_SCHEMAS,
  validateEventPayload, };
