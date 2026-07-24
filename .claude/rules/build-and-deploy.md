# Build and deploy model

```bash
npm run build       # build:cjs + build:esm — regenerates dist/ and dist/esm/ from src/
npm test             # jest — but there are no *.test.js files anywhere in this repo
```

`npm test` reports "no tests found" (or similar) — `jest` is wired up as a devDependency and script,
but no test suite has actually been written for this package. Don't assume test coverage exists; if
you change retry/DLQ/exchange-mapping behavior, there's nothing here to catch a regression except
manual verification against a consuming service.

**Same deployment model as `policy-middleware`**: `src/` is the only thing you edit; `dist/` and
`dist/esm/` are generated and consumed directly by services installing this package via
`git+https://github.com/kashif147/rabbitmq-middleware.git#main` (see any service's `package.json`).
Forgetting `npm run build` (and committing the result) after a `src/` change means every consuming
service keeps pulling stale compiled behavior on its next `npm install`.

**The ESM build (`scripts/build-esm.js`) is — like `policy-middleware`'s — a regex-based CJS→ESM
rewriter, not a real transpiler.** It's a bit more capable here (it also handles
`module.exports = { NAME: some.nested.value, ... }` property-assignment exports, which
`src/index.js` uses to re-export `schemas.EVENT_TYPES` etc.), but it's still pattern-matching, not
parsing. Inspect `dist/esm/*.js` after building if you change an unusual `require`/`module.exports`
shape in `src/`.

`PROJECT_STATUS.md` and `CHANGELOG.md` are both frozen at the initial `1.0.0` release (Oct 2025); the
package is currently at `1.0.4` per `package.json`. Don't treat either doc as reflecting current
state — e.g. `PROJECT_STATUS.md` says "7 exchanges" and `CHANGELOG.md`'s event-type list is a small
subset of what `src/publisher.js`'s `exchangeMapping` actually contains today. `README.md` is the
exception: it documents the public API thoroughly and is accurate — read it for usage examples
before this file, which covers only what the README doesn't.

## Not hook-enforced — attempted, and why it was skipped

The "commit `src/` and `dist/` together" rule above is **not** mechanically enforced by
`.claude/hooks/enforce-hard-rules.mjs`, unlike the platform's other hard rules (see
`policy-middleware/.claude/rules/build-and-deploy.md` for the identical situation and the full
reasoning — same package layout, same rule, same blocker). In short: this check needs to hook `git
commit` itself (a `Bash` matcher), which needed empirical verification of the hook subprocess's
working directory that Claude Code's auto-mode safety classifier blocked (reasonably — the
verification method looked like a self-surveillance mechanism). Rather than ship an unverified
commit-blocking hook, it was left undone. See policy-middleware's doc for the concrete path to
revisit this with explicit user sign-off.
