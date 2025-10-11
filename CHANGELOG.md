# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2025-10-11

### Added

#### Core Features

- **Connection Manager**: Singleton pattern with automatic reconnection
  - Configurable retry logic with exponential backoff
  - Exchange setup for user.events, payment.events, application.events, etc.
  - Channel management with error handling
  - Event handlers for connection/channel errors
- **Event Publisher**: Standardized message publishing
  - Event type to exchange mapping
  - Standardized message format (eventId, timestamp, correlationId, etc.)
  - Support for tenantId and userId
  - Retry logic with configurable attempts
  - Batch publishing support
  - Custom metadata support
  - Message persistence and priority
- **Event Consumer**: Robust message consumption
  - Queue creation with configurable options
  - Dead Letter Queue (DLQ) automatic setup
  - Message acknowledgment handling
  - Retry logic with exponential backoff
  - Handler registration by event type
  - Multiple queue binding support
  - Consumer cancellation support
  - Prefetch configuration
- **Event Schemas**: Type definitions and validation
  - Pre-defined event type constants
  - Exchange definitions
  - Queue naming patterns
  - Event payload schemas
  - Payload validation helper

#### Module Support

- CommonJS support for legacy services
- ESM support for modern services
- Dual package exports
- Build scripts for both formats

#### Documentation

- Comprehensive README with examples
- Migration guide for all service types
- Usage examples (publisher, consumer, full service)
- API documentation
- Best practices guide
- Troubleshooting section

#### Examples

- Publisher example
- Consumer example
- Full service example

#### Configuration

- Flexible initialization options
- Logger integration support
- Environment-based configuration
- Service-specific customization

### Supported Event Types

#### User Events

- user.created
- user.updated
- user.deleted
- user.login
- user.logout

#### Payment/Account Events

- payment.created
- payment.completed
- payment.failed
- account.created
- account.updated
- application.status.updated
- application.status.submitted

#### Application Events

- application.created
- application.updated
- application.submitted
- application.approved
- application.rejected

#### Portal Events

- portal.application.created
- portal.application.updated
- profile.application.create

#### Profile Events

- profile.created
- profile.updated
- profile.deleted

### Supported Exchanges

- user.events
- payment.events
- application.events
- accounts.events
- portal.events
- profile.events
- dlx (Dead Letter Exchange)

### Features

- ✅ Automatic reconnection with configurable retry
- ✅ Dead Letter Queue support for failed messages
- ✅ Retry logic with exponential backoff
- ✅ Standardized message format
- ✅ Event type to exchange mapping
- ✅ Batch publishing
- ✅ Handler registration
- ✅ Graceful shutdown
- ✅ Logger integration
- ✅ Dual module support (CommonJS + ESM)

### Build System

- Build script for CommonJS
- Build script for ESM
- Package.json exports configuration
- NPM ignore rules
- Git ignore rules

### Development

- Examples directory with working code
- Migration guide
- Installation instructions
- Testing strategies
- Troubleshooting guide

---

## Future Enhancements (Planned)

### v1.1.0

- [ ] TypeScript definitions
- [ ] Message encryption support
- [ ] Prometheus metrics integration
- [ ] Distributed tracing support
- [ ] Circuit breaker pattern
- [ ] Rate limiting

### v1.2.0

- [ ] Priority queue support
- [ ] Delayed message support
- [ ] Message deduplication
- [ ] Schema registry integration
- [ ] Multiple connection support

### v2.0.0

- [ ] Full TypeScript rewrite
- [ ] Plugin system
- [ ] Advanced routing strategies
- [ ] Multi-tenancy improvements
- [ ] WebSocket bridge

---

## Version Format

We follow [Semantic Versioning](https://semver.org/):

- MAJOR version for incompatible API changes
- MINOR version for new functionality (backward compatible)
- PATCH version for bug fixes (backward compatible)
