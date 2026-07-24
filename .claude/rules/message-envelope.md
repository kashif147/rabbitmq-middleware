# Standard envelope

Every published message (`publisher.publish()`) is wrapped in the same shape regardless of caller:
`{ eventId (uuid), eventType, timestamp, occurredAt, correlationId (uuid if not supplied), tenantId,
userId, sourceService, data, metadata: { service, version, ...} }`. Consumers get this same envelope
as `payload`, plus a separate `context` object (`routingKey`, `exchange`, `headers`, `redelivered`,
`message`) as the handler's second argument.

`structuredLog` (the `{onPublish, onConsume, onFail, onDlq}` hooks passed into `init()`) is how
publish/consume/failure/DLQ events get written to each service's structured business logs — see
`@projectShell/logging-lib`'s `createRabbitStructuredLogHandlers`, which every service wires in. When
`structuredLog` isn't provided, this package falls back to plain `console`/injected-`logger` calls
instead. Both paths extract the same `profileId`/`applicationId`/`membershipId` business-correlation
IDs out of the payload via a small heuristic (`profileId`/`profile.id`, `applicationId`/
`application.id`, `membershipId`/`memberId`/`membershipNumber`) — this heuristic is **duplicated
identically in both `publisher.js` and `consumer.js`**. If you change the extraction logic, update
both copies; changing only one silently makes publish-side and consume-side logs disagree on
business-correlation IDs for the same message.
