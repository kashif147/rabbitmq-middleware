# API surface

Four files, one singleton each, all wired together by `src/index.js`'s `init()`.

## `src/connection.js` (`connectionManager`)

One `amqplib` connection per process (`clientProperties.connection_name` set for visibility in the
RabbitMQ management UI), with **separate named channels** for publishing vs. consuming
(`getNamedChannel('publisher', ...)` / `getNamedChannel('consumer', ...)`) so a publish never blocks
behind consumer prefetch or vice versa. Auto-reconnects on connection `close` (up to
`maxReconnectAttempts`, fixed `reconnectDelay` between attempts — **not** exponential backoff,
despite the README's "exponential backoff" framing for *this* piece; the exponential backoff is on
publish retries in `publisher.js`, not here).

`setupExchanges()` asserts a **hardcoded default exchange list** (`user.events`, `payment.events`,
`application.events`, `accounts.events`, `portal.events`, `profile.events`, `membership.events`,
`product.events`, `journal.events`, `dlx`) merged with whatever a service passes via
`init({ exchanges: [...] })`. If a service needs an exchange not in that default list, it must pass
it explicitly in `init()` — several already do this (see audit-service's `rabbitMQ/index.js` comment
about `batch.events`/`finance.events`/`events.events` not being in the middleware's default set).

## `src/publisher.js` (`publisher`)

Retries on publish failure are real exponential backoff (`publishRetryDelay * attempt`, default 3
attempts) and happen synchronously within the same `publish()` call — a failed publish either
eventually succeeds or returns `{ success: false }` after retries; it does not silently drop.
`setExchangeMapping()` lets a service merge in its own `exchangeMapping` overrides at runtime instead
of editing this file, but nobody in this platform currently does that — every consuming service
either passes `exchange` explicitly per-publish or relies on this table being current. See
`gotchas.md` for the single most important behavior in this file (`getExchangeForEvent`'s silent
fallback).

## `src/consumer.js` (`consumer`)

Handler lookup tries `payload.eventType` first, then falls back to the AMQP routing key if no
handler matches the event type (useful when a publisher's `eventType` and routing key diverge). Once
`maxRetries` (default 3) is exhausted, the message is `nack`ed without requeue, which routes it to
`<queue>.dlq` via the dead-letter-exchange arguments set at `createQueue()` time — that final DLQ
step *is* durable (it's RabbitMQ's own DLX mechanism). See `gotchas.md` for the retry-before-DLQ gap
and the no-handler-registered drop case.

## `src/schemas/index.js` (`EVENT_TYPES`, `EXCHANGES`, `QUEUE_PATTERNS`, `EVENT_SCHEMAS`, `validateEventPayload`)

A small, curated set of constants and a lightweight payload validator — see `gotchas.md` for why
these constants don't reflect real traffic and shouldn't be assumed to.

`src/index.js` wires all four together: `init(options)` sets up the connection, exchanges, and
whichever of `publisher`/`consumer` a service actually uses.
