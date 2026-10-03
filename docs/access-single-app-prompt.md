# Prompt: one Access application on `/login`, the Worker gates everything else

Hand this whole file to a fresh session.

---

You are working on Epoch (SvelteKit 3 / Svelte 5 / Cloudflare Workers + D1), a private family-tree
app whose identity comes from Cloudflare Access. Read `AGENTS.md` first and follow it exactly
(layering, naming, comments-explain-why, colocated tests, commit discipline and the commit trailer
it asks for). Then read:

- `docs/decisions.md`: ADR-001 (identity), the invitations ADR ("Access is a separate gate"),
  ADR-024 (public welcome page) and the highest-numbered ADR, so you know the next number.
- `README.md`: the "Dev identity" and "Public welcome page" sections.
- `src/hooks.server.ts`, `src/lib/server/auth/access.ts`, `src/lib/server/auth/public-routes.ts`
  and its test, `src/routes/welcome/*`, `src/lib/components/brand/EpochMark.svelte`,
  `src/lib/services/tree-api.ts` (the `call` helper) and `src/routes/privacy-matrix.test.ts`.

Create branch `feat/access-single-app` from the latest `main`. The repo needs Node ≥ 24.

## Where things stand

Today the whole host sits behind one Access application. ADR-024 added a public `/welcome` splash,
which needs a **second** Access application with a Bypass policy for `/welcome`, `/_app/*`,
`/brand/*`, `/favicon.svg` and `/favicon.ico`. The hook already validates the Access JWT on every
request: header first, then the `CF_Authorization` cookie, checking signature (rotating JWKS),
issuer, audience and expiry. A signed-out full-page GET (not `/api/*`, not a SvelteKit data
request, not a public page) is redirected 303 to `/welcome`, and API calls answer 401.

## The goal

Exactly **one** Access application, covering only `<host>/login`. Every other path is plain Worker
traffic, and the Worker is the gate:

1. A signed-out visitor opening any page is redirected to `/welcome?next=<where they were>`.
2. "Sign in" links to `/login?next=…`. Access intercepts `/login`, authenticates the visitor and
   sets the `CF_Authorization` cookie.
3. The request then reaches Epoch's `/login` route, which redirects to `next`.
4. Later requests carry the cookie on every path, and the existing hook validates it.

### Cloudflare behaviour this relies on (verify if you can, state it in the ADR either way)

These are believed true but were not confirmed against the docs:

- The `CF_Authorization` cookie is set on the application's hostname with path `/`, so it is sent
  on paths the Access application does not cover.
- Access injects the `Cf-Access-Jwt-Assertion` header only on paths it protects. On every other
  path the cookie is all there is, and `extractAccessJwt` already reads it.
- `/cdn-cgi/access/logout` works anywhere on a host that has an Access application.

If you can reach developers.cloudflare.com, check them and cite the pages. If you cannot, write
the ADR as "assumed, verify on first deploy" and make the code correct whichever way they fall.

## Work items

Make each one its own small commit, with its tests in the same commit.

1. **Safe `next` paths** (`src/lib/server/auth/public-routes.ts` or a sibling module).
   - Write `safeNextPath(raw: string | null): string`. It returns a same-site path (pathname,
     search and hash), or `/` when the input is anything else.
   - Implement it by resolving against a fixed placeholder origin with `new URL` and requiring the
     origin to be unchanged. Do not hand-roll prefix checks.
   - It must also reject `/login` and `/welcome` themselves, so a redirect can never loop.
   - Unit tests must cover:
     - `null` and empty input
     - `/trees/t1?focus=p2`
     - `//evil.example`
     - `/\evil.example`
     - `https://evil.example`
     - `javascript:alert(1)`
     - `%2F%2Fevil.example` as it arrives after `searchParams.get` decodes it
     - `/login?next=/x` and `/welcome`
2. **Redirect decision.**
   - Replace the boolean `shouldRedirectToWelcome` with a function that returns the redirect
     location or `null`. Add an input `hasInvalidToken`: a token was present but failed
     validation (expired, wrong audience, bad signature).
   - Rules, in order:
     - A signed-in user gets no redirect.
     - Methods other than GET and HEAD, SvelteKit data requests, `/api` and `/api/*`, `/welcome`
       and `/login` get no redirect.
     - An invalid token goes to `/login?next=<path+search>`, because the visitor has signed in
       before and Access can usually renew the session without asking anything.
     - Otherwise go to `/welcome?next=<path+search>`.
   - Keep `/apiary` (a non-API path that starts with "api") redirecting.
   - Update the existing tests and add cases for the invalid-token branch and for the `next`
     encoding.
3. **Hook** (`src/hooks.server.ts`). Record `hasInvalidToken` in the existing `catch` around
   `validateAccessJwt` and use the new decision. Keep the 303 and the `x-correlation-id` header.
4. **Fail-safe for the dev bypass.**
   - Under this design a stray `ACCESS_BYPASS_DEV=true` in production opens every path except
     `/login`. Today Access at the edge would still catch it.
   - Make the hook honour the bypass only when the request's hostname is `localhost`,
     `127.0.0.1` or `[::1]`, and log a warning (once per request is fine) when the flag is set
     but the host is not local.
   - Put the host check in `access.ts` beside `isDevBypassEnabled`, as a pure function with
     tests.
   - Check that e2e (`playwright.config.ts`) and `npm run seed` still run against localhost.
5. **A shared splash component.**
   - Move the welcome page's markup into `src/lib/components/brand/Splash.svelte`.
   - Give it a `Props` interface with TSDoc per prop, as AGENTS.md asks. Props: the button's
     label and href, and an optional message.
   - `/welcome` and `/login` both use it, so the two pages cannot drift apart.
   - Keep the Open Graph tags on `/welcome` only.
6. **`/welcome`.**
   - Read `next` through `safeNextPath`.
   - Signed out: "Sign in" goes to `/login?next=…`.
   - Signed in: "Continue to your trees" goes straight to `next`.
   - Keep `csr = false`.
7. **`/login` route** (`src/routes/login/+page.server.ts` and `+page.svelte`, `csr = false`).
   - With a user: `redirect(303, safeNextPath(next))`.
   - Without a user, Access passed the request but Epoch could not verify it (misconfigured AUD,
     clock skew, dev without bypass). Render the splash with a plain message and a link back to
     `/welcome`. Never redirect from here when there is no user: that is how loops start.
   - Set `Cache-Control: no-store` on both outcomes, since the response depends on identity.
   - Add the load to `NO_RECORD_LOADS` in `privacy-matrix.test.ts`.
8. **Client handling of 401.**
   - In `tree-api.ts` `call`, when running in the browser (`browser` from `$app/environment`)
     and the response is 401, do a full navigation with
     `window.location.assign('/login?next=' + encodeURIComponent(location.pathname + location.search))`.
     It must not be `goto`: Access has to see the request.
   - Then still throw the `ApiError` so callers stop.
   - On the server, keep today's behaviour.
   - Grep `src/` for other `fetch('/api` or `fetch(\`/api` call sites that bypass `call`. Route
     them through `call`, or give them the same handling.
   - Add a unit test with a stubbed `fetch` and `location`, if the existing test setup allows it.
9. **Docs.**
   - Add a new ADR (next free number) that supersedes ADR-024's "Access must bypass the page"
     bullet. Edit that bullet to say it is superseded, and by which ADR.
   - The new ADR states the model, the assumptions above, and what was given up:
     - The Worker is now the only gate.
     - Anonymous traffic now reaches the Worker.
     - Session expiry is handled by the app.
     - Service tokens only work against `/login`.
   - Rewrite README "Public welcome page" for one application on `<host>/login`, and include
     migration steps for an existing deployment:
     1. Deploy this code first. It is correct under the old whole-host setup too.
     2. **Edit the existing Access application's path to `/login`** rather than creating a new
        application. That keeps its AUD tag, so the `CF_ACCESS_AUD` secret does not change. If
        they do create a new application, they must update the secret.
     3. Delete the Bypass application.

## Out of scope

Logout UI, service-token API access, rate limiting, and any Cloudflare dashboard change: you
cannot make those, so document them instead.

## Gate before every push

`npm run check`, `npm run lint` and `npm test` must all pass. `union-merge.test.ts` and
`union-page-service.test.ts` have been seen to hit the 5-second timeout in slow containers on an
untouched `main` too. If only those time out, rerun them alone and say so; do not raise
timeouts or skip tests.

Then run the app once with the bypass off (no `.dev.vars` flag) and check with curl:

| Request | Expected |
| --- | --- |
| `/` | 303 to `/welcome?next=%2F` |
| `/trees/x?focus=y` | 303 to `/welcome?next=` carrying the encoded path |
| `/api/trees` | 401 |
| `/welcome` | 200, Sign in links to `/login?next=…` |
| `/login?next=//evil.example` | 200 with the message (no user locally), no redirect |
| A request with an expired, well-formed JWT cookie, built with the helpers in `access.test.ts` | 303 to `/login?next=…` |

Then run once with the bypass on and check that `/login?next=/trees/x` redirects 303 to
`/trees/x`.

## Done when

- One Access application on `/login` is all the README asks for, with the migration steps above.
- All the curl checks behave as listed, and the gate is green.
- Small conventional commits are pushed to `feat/access-single-app`.
- A short summary lists any Cloudflare assumption you could not verify.

Do not open a pull request unless asked.
