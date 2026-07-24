# Gotchas consumers rely on

These are the two gotchas referenced from the platform-wide `backend/CLAUDE.md`
(`rabbitmq-gotchas.md` rule) in the full projectShell checkout — this file is their canonical,
detailed source; keep both in sync if either changes.

## An event type not in `exchangeMapping` silently lands on `application.events`

**`getExchangeForEvent(eventType)` in `src/publisher.js` silently defaults to `"application.events"`
for any event type not present in its internal `exchangeMapping` table**, unless the caller passes an
explicit `exchange` option to `publish()`. This is the single most important fact in this package for
anyone adding a new event type in *any* consuming service: forgetting to either (a) pass
`{ exchange: "..." }` explicitly, or (b) add the new routing key to `exchangeMapping` here, does not
error — the message just silently lands on `application.events` instead of wherever it was actually
meant to go, and nothing will ack/consume it there unless something happens to be listening.

**When adding a new event type**: check `exchangeMapping` in `src/publisher.js` first — either add
the routing key there, or pass `{ exchange: "..." }` explicitly on every `publish()` call for it.
Don't assume a typo or an unmapped event type will surface as a visible failure; it won't.

When working from the full `projectShell` checkout, this is additionally mechanically checked by
`.claude/hooks/enforce-hard-rules.mjs` (root-level `PreToolUse` hook): a `publishDomainEvent("...",
...)` call anywhere under `backend/` whose literal first argument isn't a key in this file's
`exchangeMapping` gets blocked at edit time, before it ever silently falls back to
`application.events`. Editing `publisher.js` itself (e.g. adding the new key) is exempt from this
check.

## Retry-before-DLQ uses `setTimeout`, not a durable RabbitMQ mechanism

**`src/consumer.js`'s retry-before-DLQ mechanism uses an in-process `setTimeout`, not a
RabbitMQ-native delay.** On handler failure, `retryMessage()` immediately `ack`s the *original*
message (so it's gone from the queue) and schedules a `setTimeout` that re-publishes the same payload
back onto the original exchange/routing-key after `retryDelay * retryCount` ms. **If the process
crashes or restarts during that window, the retry is lost — there is no persistence for in-flight
retry delays.**

This is a real gap between the README's "Retried with exponential backoff... After max retries, sent
to Dead Letter Queue" description and actual guaranteed-delivery semantics. If a consuming service's
handler needs stronger guarantees than "probably retries, unless the process dies at exactly the
wrong moment," build that at the service level (idempotent handlers plus a persisted job queue) —
don't assume this package provides it.

## A message with no registered handler is dropped silently, not retried

A message whose event type has **no registered handler at all** is just `ack`ed and dropped with a
`No handler registered` warning log — not retried, not DLQ'd. Register a handler for every routing
key a service binds to, or expect silent message loss, not an error you'd notice.

## `EVENT_TYPES`/`EXCHANGES` constants are defined but essentially unused

**In practice, almost nothing in this platform uses `EVENT_TYPES`/`EXCHANGES`** (a repo-wide grep
across every consuming service's source found essentially one usage) — every service publishes and
binds using raw string routing keys (`"applications.review.processed.v1"`,
`"members.subscription.resigned.v1"`, etc.) directly, not these constants. `EVENT_TYPES`/`EXCHANGES`
here are also far less complete than `publisher.js`'s actual `exchangeMapping` or `connection.js`'s
actual default exchange list. Follow the existing string-literal convention in a given service rather
than introducing `EVENT_TYPES` usage inconsistently — adding a new routing key to `EVENT_TYPES` here
has no effect on real traffic unless a consuming service is specifically updated to import and use
the constant instead of a literal string.
