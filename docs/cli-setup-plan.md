# Plan: `npm run setup`, a CLI that installs Epoch into a Cloudflare account

Status: **Planned.** Nothing here is built. Research done 2026-10-08 against `cf` 1.0.0-beta.13
and wrangler 4.148.0. Every claim marked *(spike)* was read from docs or the tools' source but not
run against a real account; step 0 checks them before any code is written.

## Goal

One command, run from the checkout the app will be deployed from. It:

1. signs the user in to Cloudflare in a browser, **without the user creating an API token**;
2. asks only what it cannot discover from the account;
3. proves that any resource it finds by name belongs to *this* install before using it;
4. creates the D1 database, R2 bucket, queue, Worker, custom domain and the Zero Trust config
   (one Access application on `<host>/login` and its Allow policy, per ADR-026);
5. deploys, checks the result, and can be re-run safely at any point.

It replaces `scripts/setup-cloudflare.sh`, which is stale: it applies only the newest migration,
overwrites `src/app.d.ts`, drops `migrations_dir`, ignores Access and Email Sending, and
recreates resources blindly.

## What the research found

### `cf`, the new Cloudflare CLI

- **Package:** `cf` on npm, published by Cloudflare (`wrangler-publisher` among the maintainers),
  Node ≥ 22. It is a beta, so pin an exact version as a devDependency.
- **Generated from the public OpenAPI.** Commands follow `cf <product> [group…] <operation>`, print
  JSON on stdout and progress on stderr. `cf cli search "<task>"` finds commands; `cf schema <cmd>`
  shows the request.
  - **Commands this tool uses:** `cf accounts list`, `cf zones list`, `cf d1 create`,
    `cf r2 buckets create`, `cf queues create`, `cf zero-trust organization get|create`,
    `cf zero-trust access applications create|update`,
    `cf zero-trust access policies create|update`, `cf accounts tokens create|delete`,
    `cf workers secrets bulk` and `cf d1 migrations apply`.
  - **No raw request command:** there is no `cf api`-style generic request.
- **Login:** `cf auth login` and `cf auth create <name>` both take these flags:

  | Flag | Default | Effect |
  | --- | --- | --- |
  | `--device` | on | OAuth device authorization: prints a link and a one-time code. `--no-device` uses a localhost callback on port 8877 instead. |
  | `--browser` | on | Opens the link. `--no-browser` only prints it, for SSH. |
  | `--scopes` | the full list | The OAuth scopes to request. |

  An open issue reports that device login can hit a managed challenge from datacenter IPs
  ([cloudflare/cf#23](https://github.com/cloudflare/cf/issues/23)). That matters for remote
  shells, not a laptop.
- **Profiles bound to a directory:**
  - `cf auth create <name>` signs in a named profile.
  - `cf auth activate <name> [dir]` binds it to a directory and the folders under it, recorded in
    `profiles/directory-bindings.json` under the `cloudflare` config dir. Credentials are
    encrypted, optionally in the OS keyring, and refreshed automatically.
  - `--profile <name>` overrides the binding for one command.
- **Resolution order:** first `CLOUDFLARE_API_TOKEN` (including one loaded from `.env`), then
  `--profile`, then the directory binding, then the default profile. While `CLOUDFLARE_API_TOKEN`
  is set, `cf auth create`, `activate`, `deactivate` and `delete` refuse to run. `cf` does not
  accept the Global API Key.
- **Scopes cover everything Epoch needs, including Zero Trust.** The `cf` OAuth client registers
  481 scopes. They include `access-app.write`, `access-policy.write`, `access-org.write`,
  `access-idp.write` and `access-tag.write`, alongside `d1.write`, `workers-r2.write`,
  `queues.write`, `workers-scripts.write`, `workers-routes.write`, `zone.read`,
  `email-sending.write` and `account_api_tokens:create`.
- **Optional scopes:** since 22 August 2026 the consent screen lets the user untick optional
  scopes ([changelog](https://developers.cloudflare.com/changelog/post/2026-08-22-wrangler-mcp-optional-oauth-scopes/)),
  so the tool must check what was actually granted.
- **No token export.** `cf` has no command that prints its OAuth access token. Another program
  can only use a `cf` login by running `cf`.
- **`cf deploy` does not fit this repo.** It deploys a Build Output Specification, or builds
  through the framework. Epoch must deploy with `wrangler deploy workers/entry.ts` (AGENTS.md
  Important Notes 1–2), and nothing says `cf deploy` takes a custom entry. *(spike: confirm.)*

### Wrangler

- **Wrangler cannot create the Access application.** Its OAuth client
  (`wrangler login --scopes-list`) has no Access or Zero Trust scope at all.
- **It has profiles of its own:** `wrangler auth create|activate|list` (experimental), bound to a
  directory the same way, plus `wrangler auth token`.
- **It cannot borrow a `cf` login for deploy.**
  - Wrangler 4.148 embeds `cf`'s auth module and reads the same config dir.
  - The switch is the `CLOUDFLARE_CF_AUTH` environment variable, and it is read in exactly one
    place: `createRemoteBindingsAuth`, which serves the remote-bindings proxy for local dev.
  - `wrangler deploy` ignores it.
  - The pieces are clearly converging, and this is the first thing to re-check on each wrangler
    upgrade.

### Cloudflare Access

- **A self-hosted application protects a hostname and path.** The hostname must be on an active
  zone in the account.
- **The Worker's own "Protect this Worker" Access toggle does not fit.** It works on `workers.dev`,
  but it protects the whole Worker or only its previews, never one path. ADR-026 needs exactly
  `/login`.
- **So a custom domain on an active zone is a hard prerequisite.** An install on `workers.dev`
  alone is not supported.
- **App create:** `POST /accounts/{id}/access/apps` with `type: "self_hosted"`, `domain`, `name`,
  `policies` (reusable policy ids with `precedence`), `path_cookie_attribute`,
  `enable_binding_cookie`, `allowed_idps`, `auto_redirect_to_identity` and
  `app_launcher_visible`. The response carries the application's `aud`. *(spike: confirm `aud` is
  in the create response, and that the Access endpoints accept OAuth tokens, not only API tokens.)*

## Decision: how the tool is authorised

| Rank | Mode | Used for | User handles a token? | Status |
| --- | --- | --- | --- | --- |
| 1 | **`cf` profile** `epoch-<slug>` (OAuth, device flow), bound to the checkout | Discovery, D1/R2/queue, Zero Trust, zone and Email Sending checks | No | Default |
| 2a | **Wrangler profile** `epoch-<slug>` (OAuth), bound to the checkout | Migrations, build, `wrangler deploy` now and every later `npm run deploy` | No | Default for the deploy half |
| 2b | **Short-lived token the tool mints** via `cf accounts tokens create`: account-owned, limited to this account and zone, expiring in 1 hour, passed to wrangler only through its environment, deleted in a `finally` | Deploy only, when the user wants one consent or wrangler profiles misbehave | No (never shown or written) | `--deploy-auth=ephemeral` |
| 2c | `CLOUDFLARE_CF_AUTH` bridge: wrangler reuses the `cf` profile | Everything | No | Not possible in 4.148; adopt when wrangler deploy honours it |
| 3 | **User-supplied `CLOUDFLARE_API_TOKEN`** | Everything (CI, headless, IP-challenged shells) | Yes | `--api-token-env`, never the default |

Why this order:

- **Two consents is the honest default.** `cf` is the only client that can write Access config.
  Wrangler is what `npm run deploy` uses forever after.
  - A wrangler profile bound to the same directory means later deploys just work.
  - A minted token (2b) would save one consent during setup and leave the user without a wrangler
    login for next week's deploy.
- **2b stays as an option**, because it is the only single-consent path today. It also suits a
  remote shell where a second device login is awkward. Its cost is that it needs the broad
  `account_api_tokens:create` scope, so that scope is requested **only** with
  `--deploy-auth=ephemeral`.
- **Both logins are cross-checked.** The tool compares the user id and account id from
  `cf auth whoami` with `wrangler whoami`, and stops if they differ.

**Requested `cf` scopes** (narrowed with `--scopes`; exact names *(spike)*):

- **Always:** `account:read`, `user:read`, `zone.read`, `dns.read`, `d1.write`,
  `workers-r2.write`, `queues.write`, `workers-scripts.write`, `workers-routes.read`,
  `access-org.read`, `access-org.write`, `access-app.write`, `access-policy.write`,
  `access-group.write`, `access-idp.write`, `access-tag.write` and `email-sending.read`.
  - `dns.read` and `workers-routes.read` are for the hostname collision check.
  - `access-idp.write` is for creating One-time PIN.
  - `workers-scripts.write` is for the secrets fallback.
- **With `--deploy-auth=ephemeral` only:** `account_api_tokens:create`.

After login, the tool reads the granted scopes. If any is missing, it stops before touching
anything and prints the re-run command with `--force`.

**An environment token changes everything.** If `CLOUDFLARE_API_TOKEN` is set in the shell or in
`.env`, both tools use it and profiles cannot be created. The tool detects this first. It then
either stops with an explanation, or, with `--api-token-env`, runs in mode 3 and checks the
token's permissions up front.

## The flow

The tool is a Node 24 script, `scripts/setup/` (TypeScript run with `node --experimental-strip-types`
or `tsx`; decide in step 1), exposed as `npm run setup`. It shells out to the pinned `cf` and
wrangler and parses their JSON. It keeps its state in a git-ignored **install manifest**,
`.epoch/install.json`, holding the account id, slug, every resource id, the Access app and policy
ids, and an install UUID. Every step reads the manifest, does nothing if its work is already
done, and writes its result back, so an interrupted run resumes.

```
preflight → sign in → collect → reconcile (ownership) → show plan → confirm
         → provision → Zero Trust → write config → migrate → mark → deploy → verify → hand-off
```

### 1. Preflight (local, no network)

- Node ≥ 24, `npm ci` done, pinned `cf` and wrangler resolvable.
- `CLOUDFLARE_API_TOKEN` in the environment or `.env`? Pick the mode as above.
- Ask for the **install slug**, defaulting to `epoch`. It names the profiles and resources
  (`<slug>-db`, `<slug>-media`, `<slug>-import-queue`, `<slug>-export-workflow`, Worker
  `<slug>`). Workflow names are per account too, so it is derived from the slug as well. One
  checkout is one install.
- If `.epoch/install.json` exists, show it. A re-run means resume or update, never a fresh
  install.

### 2. Sign in

1. **`cf` profile.** Run `cf auth create epoch-<slug> --scopes … [--no-browser] [--no-device]`,
   then `cf auth activate epoch-<slug> .`.
   - The tool passes `--browser`/`--no-browser` and `--device`/`--no-device` straight through.
   - The device flow is the default, because it works over SSH: the link and code can be opened
     on another machine.
   - Skip this if the profile exists and `cf auth whoami` succeeds.
2. **Check scopes.** Fail fast if any is missing, as described above.
3. **Wrangler profile.** Run `wrangler auth create epoch-<slug>`, then
   `wrangler auth activate epoch-<slug> .`. Fall back to `wrangler login` if profiles are
   unavailable *(spike: profiles are experimental)*.
   - Skipped with `--deploy-auth=ephemeral`.
4. **Cross-check identity.** Compare `cf` with wrangler. Stop on a mismatch.

### 3. Collect: discover first, ask second

| Input | Source | Asked only when |
| --- | --- | --- |
| Account | `cf accounts list` | More than one account |
| Zone | `cf zones list`, active zones only | Always; it is the user's choice. Zero active zones → stop with "add a domain to Cloudflare first" |
| Hostname | Default `<slug>.<zone>` | Always, with that default. Refused if a DNS record or another Worker already serves it, unless the manifest says it is ours |
| Owner email | `cf auth whoami` | Confirm only |
| Zero Trust team domain | `cf zero-trust organization get` | Never. No org → see step 7 |
| Identity provider | `cf zero-trust access identity-providers list` | More than one exists. None → offer One-time PIN |
| Invitation sender | Email Sending domains on the zone | Only if the user wants emailed invitations (ADR-031). If the domain is not verified, the generated config **leaves out the `send_email` binding**. The app already treats a missing binding as "not sent" (`wasEmailSent: false`), and a binding naming an unverified sender may fail the deploy *(spike)*. Re-running setup after verification adds it |
| Data location | D1 location hint (`oc` suits Australia); R2 location hint, and optionally an R2 jurisdiction (`eu` or `fedramp`; there is no Australian one) | Offered, not required. Recorded because neither can be changed after creation. A chosen jurisdiction is also written to the R2 binding (`jurisdiction`) |

### 4. Reconcile: is an existing resource really ours?

Names are not proof. For each resource the tool works out a state, using **read-only checks
first**:

| State | Meaning | Action |
| --- | --- | --- |
| `absent` | Nothing by that name | Create it |
| `ours` | Its id is in the manifest **and** it carries this install's marker | Reuse it silently |
| `unmarked` | It exists, with no marker and not in the manifest (a hand-made install, or the old script) | Show a fingerprint; adopt only after the user types the resource name |
| `orphaned` | There is **no manifest** (a fresh clone, a new laptop), and the markers it finds all carry one install UUID | Offer to re-attach to install `<uuid>`. After the user types the resource names, rebuild the manifest from what was found and keep that UUID |
| `foreign` | A manifest exists and the marker carries a **different** UUID, or the markers found disagree with each other | Refuse. Suggest another slug. No override flag: release it from the other checkout instead |

Re-attaching is how a lost checkout gets back to its data. The data always lives in Cloudflare,
and the manifest is only a cache of what reconcile can rediscover.

**Markers** are written only after the user confirms. The D1 marker is written after migrations
(step 9), because its table comes from a migration. Each marker is cheap and can be checked later:

| Resource | Marker | Fingerprint shown before adopting |
| --- | --- | --- |
| D1 | Row in a new `install_meta` table holding the install UUID (an expand-only migration) | Applied migrations (`d1_migrations`) against `drizzle/`; counts of trees, people and users; owner emails; size and created date |
| R2 | Object `.epoch/install.json` | Object count, total size, a few sample keys |
| Worker | Var `EPOCH_INSTALL_ID` | Last deployment date; whether its D1, R2 and queue bindings point at the resources above. A Worker bound to a *different* D1 is a strong "not ours" |
| Queue | None possible | Its consumer: our Worker, someone else's, or none |
| Access app | Tag `epoch-install:<uuid>` and the name `Epoch (<slug>)`. Also looked up by domain `<host>/login`, because a hand-made app has another name | Its domain and path, policies and AUD; whether the deployed `CF_ACCESS_AUD` equals it |
| Access policy | Name `Epoch <slug> owners`, referenced by our app | Its include rules |

Adoption is also how **this repository's own live install moves under the tool.** Run setup with
`--slug epoch-genealogy`. Every resource comes back `unmarked`, the user confirms each one, and the
markers are written. Nothing is recreated, and the Access app keeps its AUD.

On that install `CF_ACCESS_AUD` is already a **secret**. Wrangler may refuse a var with the same
name *(spike)*. If it does, adopted installs keep the secret, and only new installs use a var.

### 5. Show the plan, then confirm

Print a Terraform-style list grouped by create, adopt and unchanged, with the hostname, owner and
data location. `--plan` stops here and changes nothing. Otherwise the user types `yes`.

### 6. Provision

Create or adopt D1, R2 and the queue. Write each id to the manifest as soon as it exists, and
the R2 marker object once the bucket is ours.

### 7. Zero Trust

1. `cf zero-trust organization get`. If there is none, try `organization create` with a team
   name the user chooses. If the API refuses (accounts that never onboarded Zero Trust may need
   the dashboard and a plan choice; *spike*), print the dashboard link, save progress, and exit.
   A re-run resumes here.
2. Identity provider: reuse the chosen one, or create One-time PIN.
3. **Who Access lets through to `/login`.** The app never edits Access: ADR-031 keeps Access a
   separate gate, and nothing in `src/lib/server` calls the Access API. So an emailed invitee who
   is not in the policy is turned away at `/login`. This is an owner decision *(open question 2)*:
   - **Owner-only policy.** Every invitee is added by hand in the dashboard.
   - **Proposed: an Access group `Epoch <slug> members`.** It starts with the owner email, and the
     reusable Allow policy includes it. The hand-off says how to add an invitee to the group.
     Later, the app could do this itself.
   - **Allow any identity the chosen IdP verifies** (for example, any One-time PIN email). Epoch's
     deny-by-default membership check is then the only authorisation gate, which ADR-026 already
     accepts for every path except `/login`.
4. **Access app** `Epoch (<slug>)`, created or updated:
   - `type: self_hosted` and `domain: <host>/login`.
   - Only that policy, `allowed_idps` set to the chosen one, and `auto_redirect_to_identity`
     when there is exactly one.
   - **`path_cookie_attribute: false` and `enable_binding_cookie: false`**, as the README and
     ADR-026 require.
   - The `epoch-install:<uuid>` tag.
   - Record its `aud`.
5. **Never touch the other apps, groups or policies in the account.** Updates go by id from the
   manifest, never by name.

Zero Trust runs **before** the deploy, so the first deploy already has the right AUD and
`/login` is protected the moment the domain goes live. There is never a window in which the
Worker serves the host without its Access app.

### 8. Write the deploy config

**Owner-specific values move out of the tracked `wrangler.jsonc`.** They are the D1 id,
`CF_ACCESS_TEAM_DOMAIN`, the sender address, the route and the install id.

- **The tracked `wrangler.jsonc` stays, and stays usable on a fresh clone.** It keeps every binding
  with a placeholder D1 id and no route.
  - `vite dev`, `getPlatformProxy` in `server/testing/d1.ts` and the local migrations need only
    the binding shapes.
  - A fresh clone still builds, type-checks and tests without running setup.
- **The tool writes a git-ignored `wrangler.deploy.jsonc` in the repository root**, so relative
  paths resolve the same way. It is the tracked file plus:
  - the real ids;
  - `routes: [{ pattern: <host>, custom_domain: true }]`;
  - the vars;
  - the slug-derived resource names;
  - the `send_email` binding, only when the sender domain is verified;
  - R2 `jurisdiction`, when one was chosen.
- **Deploy and remote commands pass it with `-c`.** `wrangler deploy workers/entry.ts -c
  wrangler.deploy.jsonc`.
- **The build still reads the tracked file, and that is safe.** `adapter-cloudflare` reads only
  `main`, `assets` (directory, binding, `not_found_handling`) and `pages_build_output_dir` from the
  wrangler config, so bindings never reach the build output.
  - The tool asserts that both files agree on those fields.
  - `main` stays at the adapter default (Important Note 1).
- **`CF_ACCESS_AUD` becomes a var, not a secret.**
  - The AUD is an audience identifier, not a credential. A var lets the first deploy carry it.
  - `src/env.ts` reads it from the private env either way. *(spike: confirm SvelteKit 3's
    `$app/env/private` sees `vars`.)*
  - Where it stays a secret (adopted installs, see step 4): `cf workers secrets bulk` after the
    deploy.

### 9. Migrate, mark, deploy

1. **Migrate.** `wrangler d1 migrations apply DB --remote -c wrangler.deploy.jsonc`, under the
   wrangler profile or the ephemeral token.
   - It applies every pending migration in order, unlike the old script.
   - `cf d1 migrations apply` is wire-compatible and takes the database id; it is the fallback if
     wrangler auth is the problem.
2. **Write the markers** confirmed in step 5. The D1 `install_meta` row can only go in now; the
   R2 object and the Access tag were written already.
3. **Deploy.** `npm run build`, then `wrangler deploy workers/entry.ts -c wrangler.deploy.jsonc`.
   This creates the Worker, the custom domain, the workflow and the queue consumer.
4. **Clean up an ephemeral token.** Delete it in a `finally`. On every run, sweep any leftover
   token named `epoch-<slug>-setup-*`.

**Later `npm run deploy` must use the same config.** Today `package.json` hardcodes
`epoch-genealogy-db` in `db:migrate` and `db:migrate:local`, and so do the three
`scripts/backfill-*.mjs`. The fix:

- Those scripts and `deploy` move to the binding name `DB`, plus `-c wrangler.deploy.jsonc` for
  the remote commands. *(spike: confirm `wrangler d1 migrations apply` and `d1 execute` accept a
  binding name.)*
- Failing that, they read the database name from the deploy config.
- This is delivery step 1. Until it lands, the hand-off **must not** claim that `npm run deploy`
  works.

### 10. Verify (read-only, against the live host)

Each check prints pass or fail with the fix:

| Request | Expected |
| --- | --- |
| `GET https://<host>/welcome` | 200 |
| `GET /` while signed out | 303 to `/welcome?next=/` |
| `GET /login` | Redirect to `https://<team>.cloudflareaccess.com/…`, so Access is in front |
| `GET /api/trees` | 401 |
| Deployed `CF_ACCESS_AUD` | Equals the app's `aud` |
| Certificate | The custom domain's certificate has been issued (it can take minutes; poll with a timeout) |

### 11. Hand-off

Print:

- the URL and the sign-in steps;
- who Access lets in, and how to let an invitee through Access as well as inviting them in Epoch;
- the commands for later. Once delivery step 1 has landed, `npm run deploy` works in this
  directory under the bound profiles;
- where the manifest is.

Offer to delete `scripts/setup-cloudflare.sh` if it is still present.

## Other commands

- `npm run setup -- --plan` reconciles and prints the plan, read-only.
- `npm run setup -- doctor` re-runs sign-in checks, reconcile and verify, then reports drift. Drift
  includes the Access app's cookie settings having been changed in the dashboard.
- `npm run setup -- teardown` deletes **only** resources whose marker matches the manifest. The
  user types the slug, and D1 and R2 need a second, separate confirmation, because a family tree
  cannot be recovered. It never runs as part of setup, and setup never rolls back by deleting.

## Delivery

0. **Spike (half a day, a throwaway account).** Settle every *(spike)* claim:
   - Device login.
   - Granted-scope readback after unticking one.
   - The Access endpoints accepting the `cf` OAuth token.
   - `aud` in the create response.
   - `organization create` on a fresh account.
   - Wrangler profiles plus `wrangler whoami`.
   - `cf accounts tokens create` permission-group ids.
   - `vars` reaching `$app/env/private`.
   - A var named `CF_ACCESS_AUD` deploying over an existing secret of that name.
   - A `send_email` binding naming an unverified sender: does the deploy fail?
   - `wrangler d1 migrations apply` and `d1 execute` taking the binding name `DB`.
   - `CLOUDFLARE_CF_AUTH` with `wrangler deploy --dry-run` (expected: ignored).

   Record the results in an ADR (next number after ADR-033). Adjust this plan where they differ.
1. **Config and scripts:**
   - Strip the owner values from the tracked `wrangler.jsonc`.
   - Git-ignore `wrangler.deploy.jsonc` and `.epoch/`.
   - Move `db:migrate`, `deploy` and the backfill scripts to the binding name and `-c`.
   - Add the `install_meta` migration (expand-only).
2. The manifest module and a typed wrapper around `cf` and wrangler (JSON in and out, mapped
   errors). Unit tests use recorded `cf` output.
3. Preflight, sign-in and collect.
4. Reconcile, plan and confirm. These carry the most tests: every state in the table above,
   including `foreign` and a Worker bound to another D1.
5. Provision, Zero Trust and deploy, each step resumable.
6. Verify, doctor and teardown.
7. Docs: replace the README's hand-made Access steps with `npm run setup`, record the ADR, and
   delete `scripts/setup-cloudflare.sh`. Update Phase 8 item 8 ("deployment, Access setup").

## Open questions for the owner

1. **Config layout.** Proposed: a tracked, dev-safe `wrangler.jsonc` without owner values, plus a
   generated, git-ignored `wrangler.deploy.jsonc`.
   - **The cost:** this repository's live values leave git. The live install is re-created locally
     once, through adoption, and remote commands need `-c`.
   - **The alternative:** keep owner values in the tracked file. That is simpler for a single
     owner, but every fork inherits someone else's ids.
2. **Who Access admits to `/login`:** owner-only, a members group (proposed), or anyone the IdP
   verifies (step 7.3).
3. **Default deploy auth:** a second OAuth consent for a wrangler profile (proposed), or the
   single-consent ephemeral token.
4. **Pin `cf` as a devDependency** (proposed, reproducible) or require a global install.
5. **Email Sending:** should setup try to onboard the sender domain, or only report its status?
   Report only is proposed, because domain verification touches DNS.
