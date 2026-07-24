# CLAUDE.md

`@projectShell/rabbitmq-middleware` is the shared RabbitMQ wrapper (`amqplib` underneath) consumed by
every backend microservice in this platform — audit-service, communication-service, events-service,
notification-service, portal-service, profile-service, etc. all call `init()` / `publisher.publish()`
/ `consumer.registerHandler()` from this package rather than talking to `amqplib` directly.

`README.md` already documents the public API thoroughly and is accurate — read it first for usage
examples. This file and its imports cover what the README doesn't: build/publish mechanics, and the
non-obvious behavior inside `src/` that every consuming service is implicitly relying on — most
importantly, the exchange-mapping and retry-before-DLQ gotchas below, which have wide blast radius
because every service shares this one package.

### Build and deploy model
@.claude/rules/build-and-deploy.md

### API surface
@.claude/rules/api-surface.md

### Gotchas consumers rely on
@.claude/rules/gotchas.md

### Standard message envelope
@.claude/rules/message-envelope.md
