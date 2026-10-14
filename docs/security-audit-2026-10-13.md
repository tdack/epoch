# Epoch security audit — 2026-10-13

## Metadata

| Field | Value |
|---|---|
| Report date | 2026-10-13 |
| Target repo | `/Volumes/Storage/Users/troy/Projects/epoch` |
| Application | Epoch, a SvelteKit app (Svelte 5 runes, SSR+CSR) on Cloudflare Workers/Pages |
| Platform | D1 (SQLite via Drizzle), R2, Queues, Workflows, Cloudflare Access (Zero Trust JWT) |
| Audit type | Multi-agent SAST (static, source-only), plus risk calibration and a 3-model red-team consensus |
| Scope | Application source in the repository |
| Out of scope | Cloudflare Access dashboard config, deployed R2 public-access settings, runtime secret values, git history |
| Findings | 18 (1 HIGH, 3 MEDIUM, 1 LOW–MEDIUM, 5 LOW, 8 INFORMATIONAL) |

## Scope and methodology

Four parallel SAST passes reviewed the codebase by area: auth/access, SvelteKit SSR/CSR, the D1 data layer, and R2 plus secrets. A risk-calibration pass, a 3-model red-team consensus, and a verification pass followed.

Judgments below are source-verified, but the severity calibration used no calibrated model: the `jev` CLI was unavailable in this environment. Treat every severity as expert judgment, not calibrated probability. Parser behavior in F2 was executed; the other findings come from source reading.

The following were not reviewed and are not determinable from source:

- The deployed Cloudflare Access dashboard configuration (AUD, cookie attributes, which paths are protected).
- Live R2 public-access settings, CORS, and lifecycle rules beyond what the repository declares.
- Runtime secret values.
- Git history.

These three configuration surfaces are called out as residual uncertainty and could move the overall rating in either direction.

## Severity index

| ID | Severity | Finding | Location | Origin |
|---|---|---|---|---|
| F1 | HIGH | Runtime-settable dev authentication bypass | `src/hooks.server.ts:96`, `:127-144` | Red-team consensus (split) |
| F2 | MEDIUM | Open redirect on `/login` via `?next=` (dot-segment bypass) | `src/lib/server/auth/public-routes.ts:147-158` | NEW, consensus + verification |
| F3 | MEDIUM | Unexpected 500 errors return the raw exception message | `src/lib/server/http/error-response.ts:26-28` | Verified (corrects a prior pass) |
| F4 | MEDIUM | Unbounded GEDCOM/GEDZip import | `src/routes/api/import/+server.ts:10-24`, `src/lib/server/gedcom/gedzip.ts:26-36` | SAST |
| F5 | LOW–MEDIUM | Import-queue consumer trusts message fields | `src/lib/server/services/gedcom-service.ts:288-291`, `:349-370` | NEW, verified PARTIAL |
| F6 | LOW | JWT `exp`/`nbf` are only enforced when present | `src/lib/server/auth/access.ts:223-229` | SAST |
| F7 | LOW | No Content-Security-Policy or HTML security headers | `vite.config.ts`, `src/app.html` | SAST |
| F8 | LOW | Mutation write/undo statements key on `id` only | `src/lib/server/repositories/change-store.ts:364-375` | SAST |
| F9 | LOW | No upload/import volume quota or rate limit | `src/routes/api/media/upload/+server.ts:61-140` | SAST |
| F10 | LOW | Access JWT intake is broader than Cloudflare's | `src/lib/server/auth/access.ts:303-321` | SAST |
| F11 | INFORMATIONAL | `workers_dev: true` exposes the Worker outside Access | `wrangler.deploy.jsonc:71` | SAST |
| F12 | INFORMATIONAL | Public-visitor read context has no default-deny | `src/hooks.server.ts:149-165` | Verification (latent) |
| F13 | INFORMATIONAL | `sql.raw()` string-building helper | `src/lib/server/repositories/visibility.ts:21` | SAST (latent) |
| F14 | INFORMATIONAL | Unscoped id-lookup repository helpers | `evidence-repository.ts`, `graph-window-repository.ts` | SAST (latent) |
| F15 | INFORMATIONAL | Export download replays the stored Content-Type | `src/routes/api/export/download/[instanceId]/+server.ts:101-105` | SAST |
| F16 | INFORMATIONAL | Unused sensitive bindings declared on the platform env type | `src/app.d.ts:24-28` | SAST |
| F17 | INFORMATIONAL | `new RegExp` built from an id (ReDoS footgun) | `src/lib/server/gedcom/export-payload.ts:136` | SAST (latent) |
| F18 | INFORMATIONAL | CSRF relies on SvelteKit defaults; JSON endpoints rely on CORS | `vite.config.ts` | SAST |

## Findings

Findings are ordered by severity, highest first. For non-exploitable hardening items, the template's snippet fields appear as **Current code** and **Remediation**.

### [HIGH] F1 — Runtime-settable dev authentication bypass

- **Location:** `src/hooks.server.ts:96` and `:127-144`; helper `isLocalHostname` at `src/lib/server/auth/access.ts:51-53`
- **Category:** Broken Authentication / Broken Access Control (CWE-290, CWE-489; OWASP A07+A05)
- **Description:** When `ACCESS_BYPASS_DEV=true` (read from both the build-time private env and the runtime binding), the only other control is `isLocalHostname(event.url.hostname)` — an exact allowlist of `localhost`, `127.0.0.1`, and `[::1]`. On the bypass path, identity comes from attacker-influenceable `x-dev-user-sub`, `x-dev-user-email`, and `x-dev-user-name` headers, or same-named cookies. The hook is the sole gate for every path except `/login` (ADR-026 — the app deliberately gave up edge-by-edge Access protection). If the flag is ever present in production and the deployment is reachable via a hostname that resolves to a local host, an attacker can assume the install owner's identity (full install takeover).
  - **Nuance — red-team consensus split:** Two of the three red-team reviewers judge the "spoofed production Host" chain to be UNAVAILABLE at the Cloudflare edge (`event.url.hostname` is the routed host; a client `Host: localhost` does not reach the Worker). The realistic vector is an exposed development instance — for example, a dev server tunneled via cloudflared/ngrok with a rewritten Host — with the flag set. That makes F1 an operational footgun plus a missing server-side kill-switch, not a guaranteed remote takeover. The third reviewer kept HIGH for blast radius and asked that the finding be reframed, not downgraded. This report presents F1 as the top finding for blast radius and cheap fix, with the corrected threat model.
- **Vulnerable code snippet:**
```ts
const allowDevBypass = isBypassFlagSet && isLocalHostname(event.url.hostname);
```
```ts
	} else if (allowDevBypass) {
		const devValue = (name: string) => event.request.headers.get(name) || event.cookies.get(name);
		const devSub = devValue('x-dev-user-sub') || 'dev-local-user';
		const devEmail = devValue('x-dev-user-email') || DEV_BYPASS_EMAIL;
		const devName = devValue('x-dev-user-name') || 'Local Developer';
		const admission = await resolveUser(
			bindings.DB,
			{ accessSub: devSub, email: devEmail, name: devName },
			{ fallbackId: 'dev-user-id', fallbackOwnerEmail }
		);
		event.locals.user = admission.user;
		event.locals.notAdmitted = admission.notAdmitted;
	}
```
- **Remediation code snippet:** Require a signal a production bundle cannot carry, for example gate on `import.meta.env.DEV === true` (false in a `vite build`), drop the runtime-binding fallback in production, and fail the build or deploy if `ACCESS_BYPASS_DEV` is set outside development. Also set `workers_dev: false` (see F11). Replace the hand-rolled hostname allowlist with a control the client cannot influence.
```ts
	const isDevBuild = import.meta.env.DEV === true;
	const allowDevBypass = isDevBuild && isBypassFlagSet && isLocalHostname(event.url.hostname);
	if (isBypassFlagSet && !allowDevBypass) {
		requestLogger.warn('ACCESS_BYPASS_DEV is set but ignored: not a dev build on a local host', {
			hostname: event.url.hostname
		});
	}
```

### [MEDIUM] F2 — Open redirect on `/login` via `?next=` (dot-segment bypass)

- **Location:** `src/lib/server/auth/public-routes.ts:147-158` (`safeNextPath`, return at `:157`); sink `src/routes/login/+page.server.ts:16` (`redirect(303, safeNextPath(url.searchParams.get('next')))`); secondary sink `src/routes/welcome/+page.server.ts:19,28`
- **Category:** Open Redirect (CWE-601; OWASP A01)
- **Description:** `safeNextPath` validates `resolved.origin` but returns `resolved.pathname`, which the WHATWG URL parser can serialize with a leading `//` after dot-segment collapsing. `next=/.//evil.com`, `/..//evil.com`, and `/a/..//evil.com` all pass the origin check and return `//evil.com`; the login page then issues `303` with `Location: //evil.com`, which browsers treat as a protocol-relative URL to `https://evil.com`. The existing test suite (`public-routes.test.ts:108-118`) covers `//evil.example`, `/\evil.example`, `javascript:` and others, but not dot-segment variants, so it gives false confidence. The initial SvelteKit SAST pass missed this finding (it wrongly listed open redirects as verified secure); the consensus and verification passes caught it, and the parser behavior was executed. Requires the victim to already be signed in for the redirect branch to fire, so it is a phishing/redirect-abuse vector rather than an anonymous redirect.
- **Current code:**
```ts
export function safeNextPath(raw: string | null): string {
	if (!raw) return '/';
	let resolved: URL;
	try {
		resolved = new URL(raw, PLACEHOLDER_ORIGIN);
	} catch {
		return '/';
	}
	if (resolved.origin !== PLACEHOLDER_ORIGIN) return '/';
	if (resolved.pathname === LOGIN_PATH || resolved.pathname === WELCOME_PATH) return '/';
	return resolved.pathname + resolved.search + resolved.hash;
}
```
- **Evidence:**

| Input | Outcome |
|---|---|
| `/.//evil.com` | `//evil.com` (EXTERNAL) |
| `/..//evil.com` | `//evil.com` (EXTERNAL) |
| `/a/..//evil.com` | `//evil.com` (EXTERNAL) |
| `//evil.com` | refused |
| `/\evil.com` | refused |
| `javascript:alert(1)` | refused |
| `/%2E%2F%2Fevil.com` | `//evil.com` (EXTERNAL) |

- **Remediation:**
```ts
const path = resolved.pathname + resolved.search + resolved.hash;
if (path.startsWith('//') || path.startsWith('/\\')) return '/';
// belt-and-braces: re-resolve the candidate and require the origin to survive
return path;
```
  Add test cases for `/.//evil.com`, `/..//evil.com`, `/a/..//evil.com`, and `/%2E%2F%2Fevil.com`.

### [MEDIUM] F3 — Unexpected 500 errors return the raw exception message to the client

- **Location:** `src/lib/server/http/error-response.ts:26-28` (`errorResponse`), the single failure path for all `/api/**` handlers via `src/lib/server/http/handler.ts:90-96`
- **Category:** Sensitive Data Exposure / Verbose Error (CWE-209, CWE-200; OWASP A04)
- **Description:** The `DomainError` branch is safe, but any other thrown value is returned verbatim as `{ error: message }` with HTTP 500. In this D1/Drizzle stack, an unexpected throw is typically a driver/ORM error whose message embeds schema or SQL (for example, `D1_ERROR: UNIQUE constraint failed: trees.slug`, or `no such column: ...`). A prior SAST pass incorrectly recorded this file as returning a generic body; this is the corrected, verified finding. The red-team rated this between MEDIUM and HIGH; this report keeps MEDIUM, because the leak is on the unexpected-exception branch only and auth failures are caught earlier in the hook and not echoed.
- **Vulnerable code snippet:**
```ts
	console.error(`${fallback}:`, err);
	const message = (err as { message?: string } | null)?.message || fallback;
	return Response.json({ error: `${options.messagePrefix ?? ''}${message}` }, { status: 500 });
```
- **Remediation:** Log the cause server-side only, and return a fixed message (optionally with a correlation id).
```ts
	// Log the cause (with its stack) server-side only.
	console.error(`${fallback}:`, err);
	// Never echo an unexpected error's raw message to the caller.
	return Response.json({ error: `${options.messagePrefix ?? ''}${fallback}` }, { status: 500 });
```

### [MEDIUM] F4 — Unbounded GEDCOM/GEDZip import (decompression bomb / memory-CPU exhaustion)

- **Location:** `src/routes/api/import/+server.ts:10-24`; `src/lib/server/gedcom/gedzip.ts:26-36` (`unpackGedzip` → `fflate.unzipSync`); queue path `src/lib/server/services/gedcom-service.ts:266-279`
- **Category:** Uncontrolled Resource Consumption (CWE-400, CWE-409; OWASP A05)
- **Description:** Unlike `/api/media/upload` (which streams and aborts at 25 MB), the import endpoint buffers the whole multipart body and the whole file into memory with no bound, then a `.gdz` upload is fully decompressed via `unzipSync` — a classic zip bomb. The import queue message is enqueued by any editor (`tree:import`), and the payload is re-stored to R2. A tiny crafted archive expanding to hundreds of MB (or a large direct upload) can exhaust the 128 MB isolate and burn CPU.
- **Vulnerable code snippet:**
```ts
async function readGedcom(file: File): Promise<string> {
	return decodeGedcomFile(new Uint8Array(await file.arrayBuffer()));
}
```
```ts
export function unpackGedzip(bytes: Uint8Array): Uint8Array {
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(bytes, { filter: (file) => file.name === DATASET_ENTRY });
	} catch {
		throw new ValidationError('The archive could not be read as a zip file');
	}
	const dataset = entries[DATASET_ENTRY];
	if (!dataset) throw new ValidationError(`The archive has no ${DATASET_ENTRY}`);
	return dataset;
}
```
- **Remediation:** Mirror the media uploader: count bytes while streaming and reject oversized bodies before `file.arrayBuffer()`, cap the decompressed dataset size (and/or the inflation ratio) in `unpackGedzip`, and add an import quota or rate limit (F9). `[NEEDS INPUT: choose MAX_IMPORT_BYTES and MAX_DATASET_BYTES]`
```ts
// Bounded form read: reject before buffering.
async function readGedcom(file: File): Promise<string> {
	if (file.size > MAX_IMPORT_BYTES) throw new ValidationError('Import file is too large');
	return decodeGedcomFile(new Uint8Array(await file.arrayBuffer()));
}
```
```ts
// Reject an entry that inflates past the cap instead of decompressing it.
entries = unzipSync(bytes, {
	filter: (file) => {
		if (file.originalSize > MAX_DATASET_BYTES) {
			throw new ValidationError('The archive expands beyond the import limit');
		}
		return file.name === DATASET_ENTRY;
	}
});
```

### [LOW–MEDIUM] F5 — Import-queue consumer trusts message fields (TOCTOU; no consume-time authorization)

- **Location:** `src/lib/server/services/gedcom-service.ts:288-291` (doc comment: "Write a file into a tree with no authorization check"), `:349-370` (`importStaged` reads `message.treeId`, `message.mode ?? 'replace'`, `message.actorId`); consumer `src/lib/server/workers/import-consumer.ts:22-34`; destructive path `src/lib/server/repositories/gedcom-repository.ts:183-208`
- **Category:** Broken Access Control / TOCTOU (CWE-639, CWE-367; OWASP A01)
- **Description:** Authorization is checked only at ENQUEUE time (`requireTreeAction('tree:import')`). The queue consumer re-validates nothing; `actorId` and `mode` (including `'replace'`, which deletes the tree's notes, citations, sources, events, and so on before re-import) are trusted from the message. A user whose editor access is revoked or demoted after a large import is enqueued can still have a destructive `replace` import execute after revocation; this also applies across deploys and retries. Correction to an initial claim: the queue is binding-only (no public HTTP publish surface), and producers must already hold `tree:import`, so "any account principal" is overstated. The affected population is the revoked editor, not arbitrary principals.
- **Current code:**
```ts
	/**
	 * Write a file into a tree with no authorization check: for the queue consumer, whose request
	 * was authorized when it was made, and for tests that seed a tree.
	 */
	async runImport(
```
- **Remediation:** Re-authorize at consume time before `runImport` (for example, `requireMemberAction(users, msg.body.treeId, msg.body.actorId, 'tree:import')`); on failure, call `msg.ack()` to drop rather than retry, so a revoked actor cannot loop. Alternatively, document the intended semantics explicitly if the TOCTOU window is accepted.

### [LOW] F6 — JWT `exp`/`nbf` are only enforced when present

- **Location:** `src/lib/server/auth/access.ts:223-229`
- **Category:** Improper JWT Validation (CWE-613, CWE-287; OWASP A07)
- **Description:** Both checks are guarded by a truthiness test on the claim itself, so a token that omits `exp` (or `nbf`) passes with no expiry or not-before enforcement. Signature (RS256), `aud`, and `iss` are still enforced, and Access always issues `exp`, so this is defense-in-depth/correctness rather than an exploitable bypass. Some reviewers rate it INFORMATIONAL.
- **Vulnerable code snippet:**
```ts
	const nowSeconds = Math.floor(Date.now() / 1000);
	if (payload.exp && payload.exp < nowSeconds) {
		throw new UnauthenticatedError('Cloudflare Access token expired');
	}
	if (payload.nbf && payload.nbf > nowSeconds) {
		throw new UnauthenticatedError('Cloudflare Access token not active yet');
	}
```
- **Remediation:** Fail closed on a missing or non-numeric `exp`.
```ts
	const nowSeconds = Math.floor(Date.now() / 1000);
	if (typeof payload.exp !== 'number' || payload.exp < nowSeconds) {
		throw new UnauthenticatedError('Cloudflare Access token expired or has no expiry');
	}
	if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > nowSeconds)) {
		throw new UnauthenticatedError('Cloudflare Access token not active yet');
	}
```

### [LOW] F7 — No Content-Security-Policy or HTML security headers

- **Location:** `vite.config.ts` (no `csp` key passed to `sveltekit(...)`); `src/app.html`
- **Category:** Security Misconfiguration / Defense in Depth (CWE-693, CWE-1021; OWASP A05)
- **Description:** SvelteKit's `csp` option is not configured, so no `Content-Security-Policy` is emitted, and no `Strict-Transport-Security`, `X-Frame-Options`/`frame-ancestors`, or `Referrer-Policy` is set on HTML responses (the hardened headers apply only to media serving). The current XSS surface is small (no `{@html}` anywhere), so this is hardening, not an active exploit.
- **Current code:** The `sveltekit({ ... })` call in `vite.config.ts` sets only `compilerOptions` and `adapter`; no `csp` key is present, and `src/app.html` sets no security headers.
- **Remediation:** Add a CSP and clickjacking/transport headers at the hook or the Cloudflare layer. `[NEEDS INPUT: chosen CSP directives and header values]`

### [LOW] F8 — Mutation write/undo statements key on `id` only (no `tree_id` guard)

- **Location:** `src/lib/server/repositories/change-store.ts:364-375` (`statementFor`), `:317-327` (`guard`), `:453-466` (`currentImages`)
- **Category:** Broken Access Control / Tenant Isolation — defense in depth (CWE-639; OWASP A01)
- **Description:** UPDATE/DELETE/guard-select match by primary key only; tenancy is enforced upstream by planners against the tree-scoped `TreeRows` snapshot. Not exploitable today (no request was found that crosses tenants), but it removes the second line of defense: one future planner that forgets its `require*` check would silently write across trees.
- **Current code:**
```ts
	private statementFor(op: RowOp) {
		const table = TABLES[op.table];
		const idColumn = (table as unknown as { id: never }).id;
		switch (opKind(op)) {
			case OP_KINDS.CREATE:
				return this.db.insert(table).values(revive(table, op.after!));
			case OP_KINDS.UPDATE:
				return this.db.update(table).set(revive(table, op.after!)).where(eq(idColumn, op.id));
			case OP_KINDS.DELETE:
				return this.db.delete(table).where(eq(idColumn, op.id));
		}
	}
```
- **Remediation:** Add the `tree_id` predicate to the WHERE clause where the table has the column.

### [LOW] F9 — No upload/import volume quota or rate limit

- **Location:** `src/routes/api/media/upload/+server.ts:61-140`; `src/lib/server/services/gedcom-service.ts:266-279`
- **Category:** Resource Abuse / Missing Controls (CWE-770, CWE-799; OWASP A04)
- **Description:** A collaborator with `media:manage` or `tree:import` can repeatedly push 25 MB media or large imports with no per-tree quota, per-user rate limit, or Cloudflare rate-limiting rule guarding the endpoints. That is billable R2 storage and egress and unbounded growth; the R2 lifecycle rule intentionally covers only `exports/`.
- **Current code:** `/api/media/upload` bounds a single body (streamed, aborts at 25 MB) but applies no per-tree or per-user quota. The import endpoint applies no quota either.
- **Remediation:** Add a per-tree storage quota and a per-user rate limit, and add a Cloudflare rate-limiting rule for the upload and import endpoints.

### [LOW] F10 — Access JWT intake is broader than Cloudflare's and skips `typ`/`type`

- **Location:** `src/lib/server/auth/access.ts:303-321` (`extractAccessJwt`); claim handling `:288-297`
- **Category:** Improper JWT Validation / Over-permissive intake (CWE-290, CWE-345; OWASP A07)
- **Description:** Beyond the `cf-access-jwt-assertion` header and the `CF_Authorization` cookie, `extractAccessJwt` also accepts any `Authorization: Bearer <jwt>`, and `header.typ` / `payload.type` are never checked. Not exploitable on its own (signature, `aud`, `iss`, and `exp` are still enforced); it broadens the intake surface. Some reviewers rate it INFORMATIONAL.
- **Current code:**
```ts
export function extractAccessJwt(request: Request): string | null {
	// Check header first (standard Cloudflare Access injection)
	const headerToken = request.headers.get('cf-access-jwt-assertion');
	if (headerToken) return headerToken.trim();

	const authHeader = request.headers.get('authorization');
	if (authHeader?.startsWith('Bearer ')) {
		return authHeader.substring(7).trim();
	}

	const cookie = request.headers.get('cookie');
	if (cookie) {
		const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
		if (match) {
			return decodeURIComponent(match[1]).trim();
		}
	}

	return null;
}
```
- **Remediation:** Accept only the `cf-access-jwt-assertion` header and the `CF_Authorization` cookie unless `Authorization: Bearer` is required, and validate `header.typ` / `payload.type` against the expected Access token type.

### [INFORMATIONAL] F11 — `workers_dev: true` exposes the Worker outside the Access-managed domain

- **Location:** `wrangler.deploy.jsonc:71`
- **Category:** Attack Surface / Security Misconfiguration (CWE-668; OWASP A05)
- **Description:** The `*.workers.dev` hostname has no Cloudflare Access in front of it; the `CF_Authorization` cookie is scoped to the custom domain, so requests degrade safely to anonymous. The surface should be disabled (`workers_dev: false`) or confirmed intentional.
- **Current code:**
```jsonc
	"workers_dev": true,
```
- **Remediation:** Set `"workers_dev": false` in `wrangler.deploy.jsonc`, or confirm and document that the `*.workers.dev` hostname is intentional.

### [INFORMATIONAL] F12 — Public-visitor read context has no default-deny (latent)

- **Location:** `src/hooks.server.ts:149-165` (`isPublicRead` → `event.locals.user = PUBLIC_VISITOR`); `src/lib/server/auth/public-routes.ts:96-102` (`publicReadAccess`, `kind:'api'` at `:99`); gate `src/lib/server/http/handler.ts:63`
- **Category:** Defense in Depth / Fragile Authorization (CWE-639; OWASP A01)
- **Description:** Any anonymous GET/HEAD under `/api/` is classified `kind:'api'` and stamped with `PUBLIC_VISITOR` WITHOUT any tree lookup (only `kind:'tree'` checks the public-tree segment). Because `PUBLIC_VISITOR` is a truthy `locals.user`, the central handler's `if (!locals.user) → 401` does not stop it, so each service MUST self-enforce. Verification traced all 32 anonymous-reachable GET handlers and found NONE that omits its guard (all route through `requireTreeScope`, `requireTreeAction`, `requireExportInstance`, `requireInstallOwner`, or an `isPublicVisitor` check), so there is NO live leak today. The risk is latent: a future handler could leak because the hook hands it a valid-looking user.
- **Current code:**
```ts
	if (publicRead && bindings.DB) {
		const isPublicRead =
			publicRead.kind === 'api' ||
			isPublicTreeSegment(
				await new PublicTreeService(getDb(bindings.DB)).current(),
				publicRead.treeId
			);
		if (isPublicRead) event.locals.user = PUBLIC_VISITOR;
	}
```
- **Remediation:** Make `treeHandler` require services to opt into public-visitor reads (fail closed), or add a test that enumerates GET handlers and asserts each routes through a guarded service.

### [INFORMATIONAL] F13 — `sql.raw()` string-building helper (latent)

- **Location:** `src/lib/server/repositories/visibility.ts:21` (`list`), used at `:39-40`
- **Category:** SQL Injection — latent/unsafe pattern (CWE-89; OWASP A03)
- **Description:** `list()` interpolates each array element into raw SQL. Every current caller passes frozen constants, so it is NOT injectable today; it is flagged because any future change that routes user input (for example, an event or fact-type filter) into it becomes an injection with no other code change. Sibling `sql.raw(alias)` helpers are safe only because callers pass literals.
- **Current code:**
```ts
const list = (types: readonly string[]) => sql.raw(types.map((t) => `'${t}'`).join(', '));
```
- **Remediation:** Parameterize with `sql.join` or Drizzle `inArray`.

### [INFORMATIONAL] F14 — Unscoped id-lookup repository helpers (latent)

- **Location:** `src/lib/server/repositories/evidence-repository.ts:222-234` (`linksOfSource`), `:350-358` (`namesByIds`); `src/lib/server/repositories/graph-window-repository.ts:234-242` (`namesOf`), `:291-304` (`actorNames`)
- **Category:** IDOR — latent helper-level gap (CWE-639; OWASP A01)
- **Description:** These fetch by id with no tree predicate. They are safe today only because every caller gates first (`linksOfSource` runs after `visibleSource(...)`; the others are fed ids from tree-scoped reads). Note that `person_names` and `source_repositories` have no `tree_id` column, so they must always be joined or bounded by a tree-scoped parent.
- **Current code:**
```ts
	/** Every name of these people. Callers have already checked the people belong to the tree. */
	namesOf(personIds: readonly string[]): Read<Array<Ranked<PersonNameRow>>> {
		return this.readIn(personNames, personIds, (chunk) =>
			this.db
				.select({ ...getTableColumns(personNames), rid: sql<number>`${personNames}.rowid` })
				.from(personNames)
				.where(inArray(personNames.personId, chunk))
		);
	}
```
- **Remediation:** Take `treeId` and join to the tree-scoped parent.

### [INFORMATIONAL] F15 — Export download replays the stored Content-Type without an allowlist

- **Location:** `src/routes/api/export/download/[instanceId]/+server.ts:101-105`
- **Category:** Content-Type Trust / Defense in Depth (CWE-436; OWASP A05)
- **Description:** Unlike the media serve route, the export download trusts `object.httpMetadata?.contentType`. Not exploitable today (exports are always written with fixed GEDCOM types and served as `attachment` with `nosniff`), but it would become exploitable if the export prefix ever accepted objects from another writer.
- **Current code:**
```ts
		const contentType =
			object.httpMetadata?.contentType ??
			(parsed.shouldCompress
				? 'application/vnd.familysearch.gedcom+zip'
				: 'text/vnd.familysearch.gedcom');
```
- **Remediation:** Derive the type from the allowlisted set, never from stored metadata.

### [INFORMATIONAL] F16 — Unused sensitive bindings declared on the platform env type

- **Location:** `src/app.d.ts:24-28`
- **Category:** Security Misconfiguration (surface typing) (CWE-16; OWASP A05)
- **Description:** `CF_IMAGES_TOKEN` and `CF_ACCOUNT_ID` are declared on `App.Platform['env']` but never referenced; advertising a token field invites a future handler to read or serialize it.
- **Current code:**
```ts
				CF_IMAGES_TOKEN?: string;
				CF_ACCOUNT_ID?: string;
```
- **Remediation:** Remove unused declarations.

### [INFORMATIONAL] F17 — `new RegExp` built from an id (ReDoS footgun, latent)

- **Location:** `src/lib/server/gedcom/export-payload.ts:136` (`new RegExp(\`^${treeId}:\`)`)
- **Category:** RegExp injection / ReDoS — latent (CWE-1333; OWASP A03)
- **Description:** The pattern is built from `treeId`. Not exploitable while ids stay server-minted UUIDs, but a caller-supplied id reaching this becomes a regex-injection/ReDoS footgun.
- **Current code:**
```ts
		indXrefMap.set(ind.id, ind.xrefId || ind.id.replace(new RegExp(`^${treeId}:`), ''));
```
- **Remediation:** Prefer a literal prefix check over a constructed `RegExp`.

### [INFORMATIONAL] F18 — CSRF relies on SvelteKit defaults; JSON endpoints rely on CORS

- **Location:** `vite.config.ts` (no `csrf` key); context `src/lib/server/auth/access.ts:303-322` (cookie-capable auth)
- **Category:** CSRF (CWE-352; OWASP A01) — currently covered
- **Description:** SvelteKit's origin check is on by default (`csrf.trustedOrigins: []`); form and multipart endpoints are origin-checked. JSON endpoints (`application/json`, parsed in `handler.ts:73`) are not covered by the built-in check but are protected because the app sets no `Access-Control-Allow-Origin` anywhere (preflight blocks cross-site) and a simple request cannot use `application/json`. The auth cookie `CF_Authorization` is capability/ambient, so CSRF is genuinely relevant; full exploitability depends on that cookie's `SameSite`, which is Cloudflare dashboard state (not determinable from source).
- **Current code:** `vite.config.ts` sets no `csrf` key, so SvelteKit's default origin check applies; no handler sets `Access-Control-Allow-Origin`.
- **Remediation:** Keep the defaults. Do NOT regress by setting `csrf.trustedOrigins: ['*']` or adding a permissive ACAO.

## OWASP/CWE mapping

| ID | CWE | OWASP Top 10 |
|---|---|---|
| F1 | CWE-290, CWE-489 | A07, A05 |
| F2 | CWE-601 | A01 |
| F3 | CWE-209, CWE-200 | A04 |
| F4 | CWE-400, CWE-409 | A05 |
| F5 | CWE-639, CWE-367 | A01 |
| F6 | CWE-613, CWE-287 | A07 |
| F7 | CWE-693, CWE-1021 | A05 |
| F8 | CWE-639 | A01 |
| F9 | CWE-770, CWE-799 | A04 |
| F10 | CWE-290, CWE-345 | A07 |
| F11 | CWE-668 | A05 |
| F12 | CWE-639 | A01 |
| F13 | CWE-89 | A03 |
| F14 | CWE-639 | A01 |
| F15 | CWE-436 | A05 |
| F16 | CWE-16 | A05 |
| F17 | CWE-1333 | A03 |
| F18 | CWE-352 | A01 |

## What's already solid

These controls were reviewed and found sound. They are context for the findings above and prevent alarmism.

- **Default-deny hook.** With no user, page loads issue `303` to `/welcome` or `/login`, API calls get `401`, and not-admitted users get `403`. Only `/welcome` and `/login` are public.
- **Access JWT verification.** Signature is verified with `crypto.subtle`, with RS256/RSASSA-PKCS1-v1_5 hard-coded (`alg:none` is closed). `aud` fails closed when unset. `iss` is exact-matched. JWKS is fetched from `https://<team>/cdn-cgi/access/certs` with a 10-minute TTL, a single forced refetch for an unknown `kid` (rate-capped), and a 24-hour max-stale bound. The certs URL is derived from server config, so there is no token-driven SSRF.
- **XSS surface.** No `{@html}` anywhere, and no raw DOM or `eval` sinks in app code. Rich text is rendered as escaped text.
- **Media serving.** Type comes from magic bytes, SVG is excluded, and responses use `nosniff`, `CSP: sandbox`, and `attachment`.
- **Secret handling.** Private env is correctly separated (`$app/env/private` is imported only in `hooks.server.ts`; no `PUBLIC_` secrets). No committed `.dev.vars` secrets and no hardcoded credentials.
- **R2 access.** No R2 presigning or S3. No path traversal reaches R2 (keys are parsed to strict shapes and server-derived UUIDs). Bindings are server-only.
- **Authorization.** Centralized via `requireTreeScope`, `requireTreeAction`, and `requireRealUser`. A 3-model red-team pass plus verification could not find a handler that omits its guard.
- **SQL.** Drizzle is parameterized throughout, with LIKE metacharacters escaped.
- **Email and outbound fetch.** Invite emails are HTML-escaped. The only server-side outbound `fetch` targets the config-derived certs URL (no SSRF found).
- **Other.** No WebSockets. No prototype pollution found.
- **Reviewed clean (not a finding).** The offline GEDCOM back-fill modules (`gedcom/evidence-backfill.ts`, `gedcom/note-backfill.ts`) build SQL as text but correctly escape quotes, use schema-derived identifiers and fixed literals, and are not request-reachable (they run via `scripts/*.mjs`).

## Executive summary

1. **Overall risk rating: Moderate–High.** Authentication/authorization code and data handling are materially well-implemented (no injectable SQL reachable, no XSS sinks, strict JWT signature/`aud`/`iss`, parameterized queries), and the top item (F1) is a design/operational issue whose practical exploitability is conditional. However, the whole trust model now rests on the Worker's own hook: ADR-026 explicitly concedes the app gave up edge-by-edge Access protection, and this Worker is the sole gate. Several real defects also exist (open redirect, error-message leak, unbounded import). Note the three-config uncertainty: Cloudflare Access dashboard settings (AUD, cookie attributes, which paths are protected), deployed R2 public access, and runtime secret values cannot be verified from source and could move the rating in either direction.
2. **Primary attack surface:** the Cloudflare Access auth boundary and the single `hooks.server.ts` gate; the `/login` redirect parameter; the error-handling chokepoint for `/api/**`; and the file import/upload pipeline (GEDCOM/GEDZip plus media).
3. **Prioritized remediation roadmap (top 5):**
   1. F1 — kill or forestall the runtime dev bypass (build-time-only gate, prod build fails if the flag is set, `workers_dev:false`).
   2. F2 — fix the open redirect in `safeNextPath` (reject `//`-leading results; add tests).
   3. F4 — bound GEDCOM/GEDZip import (streaming byte cap plus decompression cap plus quota).
   4. F3 — return generic bodies for unexpected 500s.
   5. F5 — re-authorize the import-queue consumer at consume time.

   Then: F6/F10 JWT hardening, F7 security headers, and F8/F13/F14 latent SQL and tenancy hardening.
4. **Reputational risk (paraphrased from consensus).** The reputational risk is trusting a clean source tree as a locked deploy: the code cannot vouch for the Access and R2 configuration it now depends on. Recommend an operational review of the Cloudflare Access application settings and R2 bucket public-access as the top operational follow-up.

## Flags

- `[FLAG: F1 remediation warns with 'ACCESS_BYPASS_DEV is set but ignored: not a dev build on a local host', while the current hook warns 'ACCESS_BYPASS_DEV is set but ignored: the host is not local' at src/hooks.server.ts:98 — confirm the intended wording when implementing]`
- `[NEEDS INPUT: chosen cap values for MAX_IMPORT_BYTES and MAX_DATASET_BYTES (F4)]`
- `[NEEDS INPUT: chosen CSP directives and header values (F7)]`
- `[FLAG: F2 test coverage at public-routes.test.ts:108-118 does not include the dot-segment variants; add them with the fix]`
- `[FLAG: F3 supersedes a prior SAST pass that recorded error-response.ts as returning a generic body]`
- `[FLAG: severity calibration is expert judgment, not calibrated probability; the jev CLI was unavailable in this environment]`
- `[FLAG: residual uncertainty — deployed Cloudflare Access dashboard config, live R2 public-access settings, and runtime secret values are not determinable from source]`
