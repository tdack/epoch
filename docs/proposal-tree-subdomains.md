# Proposal: a tree on its own subdomain

- **Status:** proposal, 2026-10-16. Nothing is built. When an option is chosen, it becomes an ADR in
  [decisions.md](./decisions.md) and its work moves into [backlog.md](./backlog.md).
- **Goal:** the tree "The Dacks" at `/trees/dacks` can also be reached at `dacks.example.com`, and
  that host shows only that tree. The owner should not have to create a Cloudflare API token to set
  it up.
- **Assumes:** Epoch is served from a custom domain on a Cloudflare zone, not `workers.dev`, which
  has no wildcard subdomains.

## Summary

Giving a tree a subdomain does not need to change anything in Cloudflare, so it needs no runtime
OAuth and no token. A **one-time** change at setup does the Cloudflare side:

1. A proxied wildcard DNS record, `*.example.com`, pointing at the originless address `100::`.
2. A Worker route, `*.example.com/*`, on the Epoch Worker.
3. A second destination, `*.example.com/login`, on Epoch's existing Access application.

Setup already signs the owner in to Cloudflare with OAuth (through `cf auth create`, see
`tools/setup/steps/sign-in.ts`). It needs two more scopes, `dns.write` and `workers-routes.write`.
After that, every subdomain reaches the same Worker. Turning a tree's subdomain on or off is then a
D1 write, and the Worker maps the `Host` header to a tree.

That is option A, recommended below. Two options are given for an owner who will not put a
wildcard on their zone: B (per-tree Cloudflare changes from the CLI) and C (per-tree changes from
inside the app, with a stored credential). C is where Cloudflare's new third-party OAuth clients
would come in. It works, but costs more than it gives for a single-owner install.

## What the research found

### Cloudflare routing and certificates

- **Workers Custom Domains do not support wildcards.** A request must match the registered
  hostname exactly. Per-tree hosts on Custom Domains would therefore need one API call per tree.
  ([Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/#request-matching-behaviour))
- **Worker routes do support wildcards.** Cloudflare documents subdomain routing as a proxied
  wildcard DNS record plus a `*.example.com/*` route, with the Worker reading the hostname.
  ([Hostname routing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/hostname-routing/#subdomain-routing))
- **Universal SSL covers first-level wildcards only.** `dacks.example.com` is covered for free.
  `dacks.epoch.example.com` is not: it needs Advanced Certificate Manager ($10 a month) or an
  uploaded certificate.
  ([Sandbox preview URLs, TLS caution](https://developers.cloudflare.com/sandbox/sdk/guides/preview-urls-custom-domain/))
- **Explicit DNS records override the wildcard,** but a `*.example.com/*` route matches any
  *proxied* hostname on the zone. On a zone that already serves `www.example.com` through
  Cloudflare, the route would take that traffic too, unless a more specific route with no Worker
  excludes it. Cloudflare's own advice is a dedicated zone or subdomain, or exclusion routes.
  ([Worker as origin](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/))

Setup defaults the app's own host to `<worker>.<zone>` (`tools/setup/steps/collect.ts:280`), so
tree hosts sit **beside** it (`dacks.example.com` next to `epoch.example.com`). They do not sit
under it. That keeps them inside Universal SSL.

### Cloudflare Access

- **A self-hosted application accepts wildcard subdomains,** such as `*.example.com/login`. A
  wildcard covers one level only, and never the apex.
  ([Application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/))
- **The application cookie belongs to one hostname.** The `CF_Authorization` cookie on
  `epoch.example.com` is not sent to `dacks.example.com`. The global session at the team domain
  means a second host signs in with redirects and no new login prompt.
  ([Authorization cookie](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/#multi-domain-applications))
- **A multi-domain application keeps one AUD.** Adding a destination to the existing application
  means `validateAccessJwt` and `CF_ACCESS_AUD` do not change.
- **Wildcard hosts get no "eager" cookies.** Access cannot set a cookie in advance on a host it
  cannot name. That is fine here, because each host does its own `/login` (ADR-026).

### Cloudflare OAuth for third-party apps

- **Self-managed OAuth clients went generally available in June 2026.** Before that, only partners
  Cloudflare approved by hand could use them.
  ([Changelog](https://developers.cloudflare.com/changelog/post/2026-06-03-public-oauth-clients/),
  [Create an OAuth client](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/))
- **How a client works:** authorization code flow only; PKCE for public clients and a client secret
  for confidential ones. Endpoints are `https://dash.cloudflare.com/oauth2/auth`, `/oauth2/token`
  and `/oauth2/revoke`. Discovery advertises `offline_access` and the `refresh_token` grant.
  ([Integrate](https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/))
- **Scopes match API token permissions.** The ones this needs exist: `dns.write`,
  `workers-routes.write`, `access-app.write` and `zone.read` (checked with `cf oauth-scopes list`).
- **Visibility:**
  - A new client is **private:** only members of the account that created it can authorize it.
  - Making it **public** needs a verified client domain and cannot be undone.
- **Redirect URIs are fixed when the client is registered.** One upstream "Epoch" client therefore
  cannot serve self-hosted installs on hosts nobody knows in advance. Each install would register
  its own private client.
- **No OAuth scope manages OAuth clients,** so setup cannot register one with its existing sign-in.
  Registering would be a dashboard step for the owner, which is close to the token-creation step
  this proposal is meant to avoid.
- **Not verified:** the lifetimes of access and refresh tokens. The docs pages read do not state
  them.

## Option A (recommended): a wildcard set up once, a flag per tree

### Cloudflare side: a new `./setup subdomains` step

- Asks for `dns.write` and `workers-routes.write`, as optional scopes in the manner of
  `TAG_SCOPES`, so an existing profile keeps working without them.
- **Before changing anything,** lists the zone's DNS records (`dns.read`, already granted) and
  reports every proxied hostname the wildcard route would capture. The owner chooses one of:
  - an exclusion route with no Worker for each of those hostnames;
  - a different zone;
  - stopping.
- Creates the proxied record `* AAAA 100::`, tagged or marked as Epoch's like the other resources,
  so reconcile and teardown can find it.
- Writes the route `{ "pattern": "*.example.com/*", "zone_name": "example.com" }` into
  `wrangler.deploy.jsonc`, beside the existing Custom Domain for the app host. `wrangler deploy`
  then owns the route; setup creates only the DNS record.
- Adds `*.example.com/login` as a destination on the existing Access application
  (`access-app.write`, already granted). Teardown removes it.
- Sets a new var, `EPOCH_TREE_HOST_ZONE=example.com`. With the var unset, the feature is off and
  every hostname other than the app host is refused.

### App side

- **The subdomain is the slug.** Every valid slug is already a valid DNS label: lower-case `a-z0-9`
  words joined by single hyphens, at most 60 characters, no leading or trailing hyphen
  (`isValidTreeSlug`). A separate column would be a second name to keep unique and in step.
- **Opt-in per tree.** Migration: `trees.is_on_subdomain` (not null, default 0). A tree without a
  slug cannot turn it on.
- **Reserved labels are refused,** both when the flag is turned on and when a slug changes while it
  is on: `www`, `api`, `mail`, `login`, the app host's own label, and any label that exists as an
  explicit DNS record. The record check needs a token, so setup writes that list as a var.
- **Who may turn it on:** those who may change the address today (`tree:update_settings`, or the
  install owner), from the same rename dialog that holds the Address field (ADR-045). Changing the
  slug moves the subdomain too, and the dialog already warns that old links stop working.

**Resolving the host.** The resolution runs in `hooks.server.ts`, before the signed-out rules.

| Host | Treatment |
|---|---|
| The app host | As today. |
| `<label>.<EPOCH_TREE_HOST_ZONE>`, where `<label>` is a tree with the flag on | `locals.hostTree = { id, slug }`. One indexed read, not cached, so turning the flag off takes effect on the next request (the reasoning of ADR-041). |
| Anything else | 404, with no detail. A label that names no tree must get the same answer as one that names a tree with the flag off, so a subdomain reveals no more than a slug (ADR-045). |

**Pinning: "only that tree is shown".** Routing alone does not enforce this. On a tree host, the
hook also checks the path:

- A `/trees/<segment>` path, or a `/api/trees/<segment>` path, whose segment is not the pinned tree
  gets a 404.
- Install-wide pages (`/manage/*`, the Files manager, `/trees/<id>/trees`, `/settings`) redirect to
  the same path on the app host.
- `/welcome`, `/login` and the static assets are served on the tree host.

**Addresses on a tree host.**

- **A `reroute` hook:** `dacks.example.com/people/x` resolves internally to
  `/trees/dacks/people/x`.
- **Why `reroute` here, when ADR-045 rejected it:** for slugs it needed a client-side lookup cache.
  Here the mapping is the hostname itself, so the client needs no lookup. `treePath` returns the
  empty string when the page is on the pinned tree's host, and every link built from it becomes
  host-relative.
- **The `/trees/dacks/...` form also works on the tree host.** It redirects to the short form, like
  the id-to-slug redirect in ADR-045.

**Sign-in.**

- `/welcome` and `/login` work per host, as ADR-026 intends.
- `safeNextPath` already keeps `next` same-site, so a sign-in on `dacks.example.com` returns to
  `dacks.example.com`.
- Sign out uses that host's `/cdn-cgi/access/logout`.

**The public tree (ADR-041).** The anonymous gate compares against the pinned tree, so the public
tree's subdomain is readable without signing in. `X-Robots-Tag: noindex` stays.

**Links between hosts.**

- Invitation emails, the tree switcher and the Trees page link to the tree's subdomain when its
  flag is on, otherwise to the app host.
- The app host keeps serving `/trees/dacks` either way. A redirect from there to the subdomain is a
  possible later step, not part of this proposal.

**Local development.**

- Browsers resolve `*.localhost` to loopback, so `dacks.localhost:5173` works under `vite dev` with
  `EPOCH_TREE_HOST_ZONE=localhost`.
- `isLocalHostname` must also accept `*.localhost`, but only for the dev bypass and only in a dev
  build. The existing test that `localhost.evil.example` is refused must still pass.

### Costs and risks

- **The wildcard route sends every unknown subdomain on the zone to the Worker,** which answers
  404. That is a little extra Worker traffic, and the zone loses the "unknown name does not
  resolve" behaviour.
- **A zone shared with other proxied sites needs exclusion routes,** kept in step by hand or by
  setup. A dedicated zone avoids this.
- **Each tree host keeps its own browser state:** a separate `CF_Authorization` cookie, and
  separate `localStorage` for whatever the client keeps there. Server-side settings (ADR-054) are
  per user, so they follow the user.
- **One extra D1 read** per request on a tree host.

## Option B: a per-tree Custom Domain from the CLI

`./setup subdomain add dacks` attaches `dacks.example.com` to the Worker as a Custom Domain, using
the setup sign-in with `workers-routes.write`. Cloudflare then creates the DNS record and the
certificate. The command also adds the host to the Access application.

- **For:** no wildcard, so nothing else on the zone is touched, and nothing is stored in the Worker.
- **Against:**
  - The owner runs a command for each tree instead of flipping a switch in the app.
  - Each Custom Domain may take a moment to get its certificate.
  - Access lists every host, and above about five hosts eager cookies become a redirect chain.
- **Fits** an owner on a shared zone who has only a few trees.

The app side is the same as option A, except that a host maps to a tree through a stored hostname
column instead of `EPOCH_TREE_HOST_ZONE`.

## Option C: per-tree changes from inside the app

The Worker itself creates the DNS record or Custom Domain when a manager turns the subdomain on.
It needs a Cloudflare credential at runtime. There are two ways to get one without the owner
creating a token by hand:

- **C1, an OAuth client per install.**
  - **Registration:** the owner registers a private OAuth client in the dashboard, with redirect URI
    `https://epoch.example.com/settings/cloudflare/callback` and scopes `dns.write`,
    `workers-routes.write`, `access-app.write`, `zone.read` and `offline_access`. Setup cannot do
    this step: there is no OAuth scope for OAuth clients.
  - **Consent:** an install-owner-only page runs the authorization code flow with the client
    secret.
  - **Storage:** the refresh token is stored encrypted in D1, with the key in a Worker secret. A
    refresh before each Cloudflare call gives a short-lived access token.
- **C2, a token minted by setup.** Setup already has a path that mints an account token
  (`account-api-tokens.write`, the `ephemeral` deploy-auth mode). It can mint one limited to the
  zone's DNS and Workers routes and store it as a Worker secret. The owner never sees it.

Both share these properties:

- **The Worker holds a credential** that can change DNS on the owner's zone. A bug in the Worker,
  or a compromised dependency, can then do more than read and write the family tree. Today the
  Worker holds no Cloudflare credential.
- **They add code** for refresh-token handling, revocation and expiry, plus a recovery path when the
  owner revokes the client.
- **C1 still has a manual dashboard step,** which is little better than creating a token.

C is worth it only if trees are created often by people other than the owner, and the owner cannot
use a wildcard. For a single-owner install, that seems unlikely.

## Recommendation and phases

Build option A in four phases:

1. **App side, behind the var:**
   - migration (expand), host resolution and pinning in the hook, `reroute`, a host-aware
     `treePath`, the flag in the rename dialog;
   - tests for pinning, the 404 parity between "no tree" and "flag off", and the public tree on its
     subdomain.

   This phase can be tried in full on `*.localhost` before Cloudflare is touched.
2. **Setup:**
   - the `subdomains` step with the capture check;
   - the wildcard record, the route in the deploy config, and the Access destination;
   - reconcile and teardown for each of those.
3. **A first-deploy check** of the items under "Verify on a real deploy".
4. **Update docs:** an ADR, `architecture.md` (Layout and views; Authorization) and
   `development.md` (Addresses).

Keep option B in mind for shared zones. It reuses phase 1 with a hostname column.

## Worked example: `epochgenealogy.app`

### Where things are now (2026-10-17)

| Checkout | Worker | Served at |
|---|---|---|
| `~/Projects/epoch` (main; deploys on push through Workers Builds) | `epoch-genealogy` | `epoch-genealogy.dack.workers.dev` |
| `~/Projects/epoch-website` (`website` branch, deploys with `cf`) | `epoch-website` | `epochgenealogy.app` and `www.epochgenealogy.app` (Custom Domains in `cloudflare.config.ts`) |
| `~/Projects/epoch-demo` (separate clone) | `demo-epochgenealogy-app` | `demo.epochgenealogy.app` (Custom Domain) |

The zone also holds Email Sending records (`cf-bounce` MX and TXT, `cf-bounce._domainkey`) and
`_dmarc`. All of them are DNS-only.

### Where things should end up

| Host | Served by | How |
|---|---|---|
| `www.epochgenealogy.app` | `epoch-website` | Custom Domain (unchanged) |
| `demo.epochgenealogy.app` | `demo-epochgenealogy-app` | Custom Domain (unchanged), plus the route `demo.epochgenealogy.app/*` with no Worker |
| `epochgenealogy.app` | `epoch-genealogy` | Custom Domain (moved from the website) |
| `<tree>.epochgenealogy.app` | `epoch-genealogy` | Route `*.epochgenealogy.app/*`, plus the proxied DNS record `* AAAA 100::` |

`www.epochgenealogy.app/*` also needs a route with no Worker. Routes take precedence over Custom
Domains on the same hostname, so without the two empty routes the wildcard would capture `www` and
`demo`. The wildcard does not match the apex, because `*.` matches subdomains only. Universal SSL
covers both the apex and `*.epochgenealogy.app`.

**Reserved labels:** `www`, `demo`, `cf-bounce`, `_dmarc` and `_domainkey`. The app host is the
apex, so it has no label of its own to reserve.

### Order of work

Steps 1 to 3 do not depend on any subdomain code and can happen now.

1. **Website to `www` only.**
   - In `epoch-website`, change `domains` to `['www.epochgenealogy.app']` and deploy.
   - Confirm that the apex Custom Domain is detached. If `cf` does not remove a domain that is no
     longer listed, remove it from the Worker's Domains tab.
   - The apex is down from this step until step 2 attaches it, so do 1 and 2 together.
   - Change the website's "open Epoch" links to `https://epochgenealogy.app`.
2. **The live install to the apex.** In `~/Projects/epoch`, run:

   ```sh
   ./setup --hosting custom --zone epochgenealogy.app --keep-workers-dev
   ```

   with the hostname `epochgenealogy.app`. Setup's clash check (`findHostnameUse`) refuses the apex
   while the website holds it, which enforces the order. This run:
   - writes the Custom Domain into `wrangler.deploy.jsonc`;
   - creates a new Access application on `epochgenealogy.app/login`, with a new AUD;
   - must also update the Workers Builds variable (`./setup builds`). Otherwise the next push to
     `cloudflare` redeploys with the old `workers_dev`-only values.
3. **Keep `workers.dev` for a while.**
   - Invitation emails link to the origin they were sent from (`url.origin` in the invitations
     endpoint). Invitations already sent point at `epoch-genealogy.dack.workers.dev`, and members
     signed in there have that host's cookie.
   - Turn `workers.dev` off, and delete its Access application, once those invitations have expired
     or been redeemed.
4. **Subdomains,** once phase 1 of this proposal is built and deployed:
   - the wildcard DNS record;
   - the routes `*.epochgenealogy.app/*` (in the deploy config), plus `www.epochgenealogy.app/*`
     and `demo.epochgenealogy.app/*` with no Worker (dashboard or API);
   - `EPOCH_TREE_HOST_ZONE=epochgenealogy.app`;
   - `*.epochgenealogy.app/login` added to the live install's Access application.
5. **Check that demo sign-in still works.** The demo has its own Access application, on
   `demo.epochgenealogy.app/login`, which the live install's `*.epochgenealogy.app/login` overlaps.
   - Cloudflare's docs say the more specific *path* wins within an application. They do not say
     which of two *applications* wins on overlapping hostnames.
   - If the wildcard application wins, the demo receives a token with the live install's AUD. It
     refuses that token (fail closed), so demo sign-in breaks without anything being exposed.
   - **Fallback:** the demo's public tree needs no sign-in at all. Alternatively, list each tree
     host on the live install's Access application instead of using the wildcard.

**The demo clone must never push.** Its only remote is GitHub `origin`, so a stray push is
possible. Run `git remote set-url --push origin DISABLED` in `~/Projects/epoch-demo`; fetch and
pull keep working. To update the demo, run `git pull` and then that clone's own deploy.

**Email:** the live install sends from `welcome@epoch.dack.id.au`. The `cf-bounce` records suggest
Email Sending is already set up on `epochgenealogy.app`, so a sender such as
`welcome@epochgenealogy.app` would match the new host. This is optional, and separate from the
move.

## Verify on a real deploy

- Routes take precedence over Custom Domains on the same hostname, and a route with no Worker
  cancels a less specific one
  ([Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/#matching-behavior)).
  Confirm on the zone that `www` and `demo` still reach their own Workers once the wildcard route
  and the two empty routes exist.
- Signing in on `dacks.example.com` while already signed in on the app host needs no new login
  prompt, only Access redirects.
- Whether signing out on one host ends the session on the others.
- `Cf-Access-Jwt-Assertion` and the cookie arrive on a wildcard destination as they do on the app
  host, with the same AUD.
- The wildcard certificate covers `dacks.example.com` on a Free-plan zone.
- `wrangler deploy` creates and removes the wildcard route with only `workers-routes.write`. It
  does not create the DNS record, which is why setup creates it.

## Open questions for the owner

1. Is a wildcard on your zone acceptable, or is the zone shared with other proxied sites (which
   leads to B, or to a dedicated zone)?
2. Should the app host redirect `/trees/dacks` to `dacks.example.com` once the flag is on, or keep
   serving both?
3. Is the subdomain always the slug? This proposal says yes. A separate value would allow a short
   subdomain with a long slug, but brings back the second name.
4. Who may turn it on: managers (the same as the address), or only the install owner? The change
   affects DNS-visible names, but under A it touches nothing in Cloudflare.
