# Plan: `npm run setup`, a CLI that installs Epoch into a Cloudflare account

Status: **Built, not yet run against a real account.** The tool is in `tools/setup/`; the "Built" section at the end lists where it differs from this plan. Every claim marked *(spike)* is still open until `npm run setup -- spike` has been run. Research done 2026-10-08 against `cf` 1.0.0-beta.13
and wrangler 4.148.0. Every claim marked *(spike)* was read from docs or the tools' source but not
run against a real account; step 0 checks them before any code is written.

## Goal

One command, run from the checkout the app will be deployed from. It:

1. signs the user in to Cloudflare in a browser, **without the user creating an API token**;
2. asks only what it cannot discover from the account;
3. proves that any resource it finds by name belongs to *this* install before using it;
4. creates the D1 database, R2 bucket, queue, Worker and its custom domain, plus one Access
   application on `<host>/login` and its Allow policy (ADR-026). It does not set up Zero Trust or
   the domain themselves (see "Assumptions and scope");
5. deploys, checks the result, and can be re-run safely at any point.

## Assumptions and scope

The tool assumes the account already has these. It checks each one read-only, and stops with a
clear message if it is missing:

| Prerequisite | How the tool checks |
| --- | --- |
| **A paid Workers plan**, needed for Queues and Workflows | Not checked up front: that needs a billing scope. A plan error from queue creation or deploy is mapped to "this needs Workers Paid" |
| **Zero Trust configured**: an organisation (team domain) and at least one identity provider | `cf zero-trust organization get` and `cf zero-trust identity-providers list` |
| **Somewhere to serve it**, either one of: | Asked in step 3 |
| the account's workers.dev subdomain (`<account>.workers.dev`) | `GET /accounts/{id}/workers/subdomain`. If none is set, stop: choosing it is account configuration |
| or an active zone, for a custom domain | `cf zones list`, active zones only |

**The tool never creates or changes account-level configuration.** That includes the Zero Trust
organisation, identity providers, Access groups, Access tags, zones and DNS (beyond the record the
Worker custom domain manages for itself), and Email Sending domains. Its Cloudflare footprint is:

- D1, R2, the queue and the Worker (with its workflow and queue consumer);
- the Worker's hostname: either its workers.dev address (`workers_dev: true`) or **one Worker
  custom domain** on the chosen zone, both set through the deploy config;
- **one Access application** on `<host>/login`;
- **one reusable Access policy**, used only by that application.

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
    `cf r2 buckets create`, `cf queues create`, `cf zero-trust organization get`,
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

- **A self-hosted application protects a hostname and path,** and the hostname can be a
  workers.dev address. The docs were inconsistent on this, but the owner's account settles it.
  Its live Epoch install has a self-hosted app on `epoch-genealogy.example.workers.dev/login` (read
  2026-10-09, read-only), as do other apps on `*.workers.dev/<path>`. Hosts on a custom domain
  need an active zone.
- **The Worker's own "Protect this Worker" Access toggle does not fit.** It works on `workers.dev`,
  but it protects the whole Worker or only its previews, never one path. ADR-026 needs exactly
  `/login`.
- **So both hosting choices work with ADR-026:** a workers.dev address or a custom domain, each
  with one self-hosted app on `<host>/login`.
- **App create:** `POST /accounts/{id}/access/apps` with `type: "self_hosted"`, `domain`, `name`,
  `policies` (reusable policy ids with `precedence`), `path_cookie_attribute`,
  `enable_binding_cookie`, `allowed_idps`, `auto_redirect_to_identity` and
  `app_launcher_visible`. The response carries the application's `aud`. *(spike: confirm `aud` is
  in the create response, and that the Access endpoints accept OAuth tokens, not only API tokens.)*

## Decision: how the tool is authorised

| Rank | Mode | Used for | User handles a token? | Status |
| --- | --- | --- | --- | --- |
| 1 | **`cf` profile** `epoch-<name>` (OAuth, device flow), bound to the checkout | Discovery, D1/R2/queue, Zero Trust, zone and Email Sending checks | No | Default |
| 2a | **Wrangler profile** `epoch-<name>` (OAuth), bound to the checkout | Migrations, build, `wrangler deploy` now and every later `npm run deploy` | No | Default for the deploy half |
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
  `access-org.read`, `access-idp.read`, `access-app.write`, `access-policy.read`,
  `access-policy.write` and
  `email-sending.read`.
  - The Zero Trust scopes are read-only, except for apps and policies, so the token cannot change
    the organisation, identity providers or groups even by mistake.
  - `dns.read` and `workers-routes.read` are for the hostname collision check.
  - `workers-scripts.write` is for the secrets fallback.
- **With `--deploy-auth=ephemeral` only:** `account_api_tokens:create`.

After login, the tool reads the granted scopes. If any is missing, it stops before touching
anything and prints the re-run command with `--force`.

**An environment token changes everything.** If `CLOUDFLARE_API_TOKEN` is set in the shell or in
`.env`, both tools use it and profiles cannot be created. The tool detects this first. It then
either stops with an explanation, or, with `--api-token-env`, runs in mode 3 and checks the
token's permissions up front.

## Command line and terminal UX

**Libraries** (devDependencies, exact versions pinned; checked 2026-10-09):

| Need | Choice | Why |
| --- | --- | --- |
| Commands and flags | **commander** 15 | No dependencies, typed, and subcommands (`setup`, `doctor`, `allow`, `disallow`, `teardown`) with generated `--help`. yargs 18 does the same with six dependencies and more API than this needs |
| Prompts, spinners, layout | **@clack/prompts** 1.8 | Four small dependencies. It gives `intro`/`outro`, `select`, `multiselect`, `text` with `validate`, `confirm`, `spinner`, `tasks`, `note`, `log.*` and `isCancel` |
| Colour | **`node:util` `styleText`** | Built into Node 24, honours `NO_COLOR` and non-TTY output, and adds no dependency. clack 1.x no longer bundles picocolors. chalk would work, but would add a package for what Node already does |

**How it looks:**

- **One `intro` and one `outro` per run.** Each flow step is a clack group with a heading such as
  "Sign in" or "Reconcile", so the run reads as the numbered steps in this document.
- **Spinners around every `cf` and wrangler call.** The child's stdout is parsed as JSON. Its
  stderr goes to a log file, `.epoch/logs/<timestamp>.log`, never the screen.
  - On failure the tool shows a mapped, one-line reason, the log path, and the exact command to
    re-run.
  - `--verbose` streams the child output instead.
- **The device login code is shown in a `note` box.** It holds the URL and the one-time code, in
  large type, with "Opened in your browser" or "Open this on any device".
  - `cf` prints these itself. The tool reads them from its stderr and re-renders them *(spike:
    the output format; otherwise, pass it through untouched)*.
- **Pickers are `select` and `multiselect`,** with the discovered default first and a hint line.
  The account, zone, identity providers and Access policies use `multiselect`, with each
  policy's include rules and the apps using it as the hint.
- **Dangerous confirmations are typed.** Adopting an `unmarked` resource and the teardown steps use
  `text` with a `validate` that requires the exact resource name, not `confirm`.
- **The plan screen (step 5)** groups create, adopt, reference and unchanged, with the colour on
  the symbol (`+`, `~`, `=`, `→`) so it still reads with `NO_COLOR`. It ends in one `confirm`.
- **Ctrl-C at any prompt** (`isCancel`) exits with "Nothing was changed after `<last completed
  step>`; re-run to resume", which is true because every step writes the manifest before the
  next begins. An ephemeral token is still deleted, from the `finally`.
- **The verify step uses `tasks`,** one line per check, ticked or crossed. The `outro` holds the
  URL and the next steps.

**Running without prompts** (CI, or a second run with known answers):

- `--yes` accepts every discovered default. It still refuses anything that needs a typed
  confirmation: adopting unmarked resources, `foreign`, and teardown.
- Every prompt has a matching flag: `--name`, `--hosting workers-dev|custom`, `--account`, `--zone`, `--hostname`, `--policy <id…>` or
  `--new-policy`, `--idp <id…>`, and `--d1-location`.
- With no TTY, a missing answer is an error that names the flag; the tool never hangs.
- `--json` prints one result object (the manifest plus the verify results) on stdout, with the
  progress on stderr, matching `cf`'s own convention.

**Code shape.** `tools/setup/`:

- `cli.ts`: the commander definitions.
- `steps/*.ts`: one module per flow step. Each is a pure function from the manifest and the
  answers to an updated manifest. No prompts live inside a step: the answers are collected
  first, so tests drive steps without a terminal.
- `ui.ts`: the only module that imports clack.
- `run.ts`: the typed `cf` and wrangler wrapper.

## The flow

The tool is a Node 24 script, `tools/setup/` (TypeScript run with `node --experimental-strip-types`
or `tsx`; decide in step 1), exposed as `npm run setup`. It shells out to the pinned `cf` and
wrangler and parses their JSON. It keeps its state in a git-ignored **install manifest**,
`.epoch/install.json`, holding the account id, Worker name, every resource id, the Access app and policy
ids, and an install UUID. Every step reads the manifest, does nothing if its work is already
done, and writes its result back, so an interrupted run resumes.

```
preflight → sign in → collect → reconcile (ownership) → show plan → confirm
         → provision → Access app and policy → write config → migrate → mark → deploy → verify → hand-off
```

### 1. Preflight (local, no network)

- Node ≥ 24, `npm ci` done, pinned `cf` and wrangler resolvable.
- `CLOUDFLARE_API_TOKEN` in the environment or `.env`? Pick the mode as above.
- Ask for the **Worker name**, defaulting to `epoch` (or the name in an existing deploy config).
  - It is the base for everything else: D1 `<name>-db`, R2 `<name>-media`, queue
    `<name>-import-queue`, workflow `<name>-export-workflow` (workflow names are per account
    too), profiles `epoch-<name>`, Access app `Epoch (<name>)` and the workers.dev host
    `<name>.<account>.workers.dev`.
  - The derived names are shown under the prompt as it is typed.
  - Validated against Worker name rules (lower case, digits, `-`, at most 63 characters).
  - Whether a Worker by that name already exists is checked after sign-in (step 4).
  - One checkout is one install.
- If `.epoch/install.json` exists, show it. A re-run means resume or update, never a fresh
  install.

### 2. Sign in

1. **`cf` profile.** Run `cf auth create epoch-<name> --scopes … [--no-browser] [--no-device]`,
   then `cf auth activate epoch-<name> .`.
   - The tool passes `--browser`/`--no-browser` and `--device`/`--no-device` straight through.
   - The device flow is the default, because it works over SSH: the link and code can be opened
     on another machine.
   - Skip this if the profile exists and `cf auth whoami` succeeds.
2. **Check scopes.** Fail fast if any is missing, as described above.
3. **Wrangler profile.** Run `wrangler auth create epoch-<name>`, then
   `wrangler auth activate epoch-<name> .`. Fall back to `wrangler login` if profiles are
   unavailable *(spike: profiles are experimental)*.
   - Skipped with `--deploy-auth=ephemeral`.
4. **Cross-check identity.** Compare `cf` with wrangler. Stop on a mismatch.

### 3. Collect: discover first, ask second

| Input | Source | Asked only when |
| --- | --- | --- |
| Account | `cf accounts list` | More than one account |
| Hosting | workers.dev subdomain and active zones | Always: **"workers.dev only"** (`<name>.<account>.workers.dev`) or **"a custom domain"**. Only the choices the account supports are offered |
| Zone | `cf zones list`, active zones only | Custom domain chosen and more than one active zone |
| Hostname | Default `<name>.<zone>` | Custom domain chosen. Refused if a DNS record or another Worker already serves it, unless the manifest says it is ours |
| Keep workers.dev on as well? | — | Custom domain chosen. Default **off** (`workers_dev: false`, `preview_urls: false`). The Access app covers only the chosen host, so a second, unprotected `/login` on workers.dev would only ever show the "could not verify" message, but there is no reason to serve it. Switching from workers.dev to a custom domain later is a re-run that moves the Access app's domain |
| Owner email | `cf auth whoami` | Confirm only |
| Zero Trust team domain | `cf zero-trust organization get` | Never. No organisation → stop (prerequisite) |
| Identity providers for the app | `cf zero-trust identity-providers list` | More than one exists: the user picks which the app offers (default: all). None → stop (prerequisite) |
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
| `foreign` | A manifest exists and the marker carries a **different** UUID, or the markers found disagree with each other | Refuse. Ask for another Worker name. No override flag: release it from the other checkout instead |

**An existing Worker with the chosen name** that is not `ours` or `orphaned` gets its own prompt.
The fingerprint (last deploy, bindings, whether it looks like Epoch) comes first, then three
choices:

1. **Choose another name** (the default). Back to the name prompt, with a free suggestion.
2. **Adopt it.** It is an earlier Epoch install. Keep its data and deploy over it: the `unmarked`
   path, with every resource shown.
3. **Replace it.** Deploy a new Epoch over that Worker, with **new** resources.

Choices 2 and 3 show a "this is what will happen" panel before any confirmation. For example:

```
Replacing Worker "epoch" (last deployed 2026-09-30, not an Epoch install)

  ~ Worker epoch             its code, bindings, vars and routes are overwritten
                             its secrets are kept unless listed here: (none)
  ~ Route   epoch.example.com  now served by Epoch
  - Bound   D1 shop-db       no longer bound to this Worker; NOT deleted, data kept
  + Create  D1 epoch-db, R2 epoch-media, queue epoch-import-queue
  ! Access  /login on epoch.example.com is protected from this deploy on

  Nothing is deleted. Undo: redeploy the previous version with `wrangler rollback`
  (code only; the bindings go back with it, the new resources stay).
```

- **Then two confirmations:** type the Worker name, then a separate `confirm` whose wording
  repeats the action ("Overwrite Worker epoch?").
- `--yes` never satisfies either.
- **Nothing is ever deleted as part of replace or adopt.** Only `teardown` deletes, and only
  resources marked as this install's.

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
| Access app | None written: tags are account-level objects, which are out of scope. It is ours when its id is in the manifest, or when its domain is exactly `<host>/login` and the D1 or Worker marker on the same host matches. Its name is `Epoch (<name>)`; a hand-made app may have another name | Its domain and path, policies and AUD; whether the deployed `CF_ACCESS_AUD` equals it |
| Access policy | None written. A policy the user picked from the existing ones is **referenced, never owned**: the tool attaches it and never edits it. A policy the tool created is ours when its id is in the manifest and it is named `Epoch <name> sign-in` | Its decision, its include rules, and every app that uses it |

Adoption is also how **this repository's own live install moves under the tool.** Run setup with
Worker name `epoch-genealogy` and hosting "workers.dev only". Every resource comes back `unmarked`, the user confirms each one, and the
markers are written. Nothing is recreated, and the Access app keeps its AUD. Its existing app (`epoch-genealogy -
Cloudflare Workers`, on `epoch-genealogy.example.workers.dev/login`) is found by domain, and its
existing policy is offered in the picker as the default.

On that install `CF_ACCESS_AUD` is already a **secret**. Wrangler may refuse a var with the same
name *(spike)*. If it does, adopted installs keep the secret, and only new installs use a var.

### 5. Show the plan, then confirm

Print a Terraform-style list grouped by create, adopt and unchanged, with the hostname, owner and
data location. `--plan` stops here and changes nothing. Otherwise the user types `yes`.

### 6. Provision

Create or adopt D1, R2 and the queue. Write each id to the manifest as soon as it exists, and
the R2 marker object once the bucket is ours.

### 7. Access application and policy

The organisation and identity providers already exist (see the prerequisites). The tool adds one
application, attaches existing policies or creates one new policy, and changes nothing else in
Zero Trust.

**What Access decides, and what Epoch decides.** These are two separate gates:

- **Access, at `/login`: who can sign in at all.** Access runs before the Worker sees the request,
  so an invitation cannot get anyone past it. ADR-016 says so: "the Access application policy must
  also allow the address".
- **Epoch, everywhere: what a signed-in person can see.** An invitation is redeemed on the
  invitee's first authenticated request (ADR-016). A signed-in person with no membership sees no
  trees.
- **There is no "first login is owner".** Ownership is per tree: whoever creates a tree owns it
  (`TreeRepository.create`), and `createTree` asks only that the caller is signed in. Nothing
  makes one person the owner of the install.
- **So the Access policy is what limits who can start their own trees.** ADR-016's "intended
  setup" lets everyone in at Access and relies on invitations. But under that setup any stranger
  the identity provider verifies can sign in and create (empty) trees of their own. They cannot
  see anyone else's.

**Step 1: choose the policy.** `cf zero-trust access policies list` returns the account's
reusable policies, and `cf zero-trust access applications list` shows which apps use each one.
The tool shows them as numbered options, then offers to create a new one:

```
Which Access policy should decide who can sign in to Epoch?

  1. Family (Allow): emails a@example.com, b@example.com. Used by: Photos, Wiki
  2. Example staff (Allow): email domain example.com. Used by: Grafana
  3. Everyone with One-time PIN (Allow): everyone. Used by: (none)
  4. Create a new policy "Epoch <name> sign-in" (Allow: your email only)

  More than one can be chosen (for example 1,2). Policies that Block or Bypass are not listed.
```

- **Existing policies are attached as they are and never edited.** The user owns them and they
  may protect other apps. They are recorded in the manifest as referenced, not owned. `doctor`
  reports if one is deleted or changed to Block.
- **Only Allow policies are offered.**
  - A Bypass policy on `/login` would let a request through with no identity, and the Worker
    could not validate it.
  - A Block policy admits nobody.
- **A policy that includes everyone is flagged** with the stranger warning above.
- **A new policy starts with the owner's email only.** The tool owns it, so
  `npm run setup -- allow <email>` and `-- disallow <email>` can edit it later. They refuse to
  edit a policy the tool does not own.
- **The default choice:** an existing policy that already includes the owner's email, if there is
  one; otherwise creating a new one. Either way the tool checks that the chosen policies admit the
  owner's email, so the person running setup can sign in afterwards.
  - It checks with `cf zero-trust access applications policy-tests` if that works with the OAuth
    scopes *(spike)*.
  - Otherwise it reads the include rules for email, email domain and everyone, and warns when a
    rule (a group or an identity-provider rule) cannot be checked locally.

**Step 2: create or update the Access app** `Epoch (<name>)`:
   - `type: self_hosted` and `domain: <host>/login`.
   - The chosen policies, in the order given.
   - `allowed_idps` set to the chosen providers, and `auto_redirect_to_identity` when there is
     exactly one.
   - **`path_cookie_attribute: false` and `enable_binding_cookie: false`**, as the README and
     ADR-026 require.
   - Record its `aud`.
**Never touch any other app, policy, group or identity provider.** Updates go by id from the
manifest, never by name.

The Access app is created **before** the deploy, so the first deploy already has the right AUD and
`/login` is protected the moment the domain goes live. There is never a window in which the
Worker serves the host without its Access app.

### 8. Write the deploy config

**Starting point.** The tool must work from nothing:

- **The template is the tracked `wrangler.jsonc`.** If it is missing, empty or unparseable, the
  tool uses a copy shipped in `tools/setup/templates/wrangler.template.jsonc`. A test keeps that
  copy's binding shapes equal to the tracked file's.
- **An existing `wrangler.deploy.jsonc` is read first,** whether written by hand or by an earlier
  run. Its values (Worker name, ids, host, vars) become the prompts' defaults and feed reconcile.
- **An empty or missing deploy file** simply means no defaults.
- **The tool always writes the whole file.** It regenerates it from the template plus the
  answers and shows a diff against the old one before writing.

**Owner-specific values move out of the tracked `wrangler.jsonc`.** They are the D1 id,
`CF_ACCESS_TEAM_DOMAIN`, the sender address, the route and the install id.

- **The tracked `wrangler.jsonc` stays, and stays usable on a fresh clone.** It keeps every binding
  with a placeholder D1 id and no route.
  - `vite dev`, `getPlatformProxy` in `server/testing/d1.ts` and the local migrations need only
    the binding shapes.
  - A fresh clone still builds, type-checks and tests without running setup.
- **The tool writes `wrangler.deploy.jsonc` in the repository root**, so relative paths resolve
  the same way. It is the tracked file plus:
  - the real ids;
  - the Worker `name`;
  - for a custom domain, `routes: [{ pattern: <host>, custom_domain: true }]` and `workers_dev`
    as chosen;
  - for workers.dev only, `workers_dev: true` and no routes;
  - the vars;
  - the resource names derived from the Worker name;
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
   R2 object went in at step 6, and the Worker's `EPOCH_INSTALL_ID` var ships with the deploy.
3. **Deploy.** `npm run build`, then `wrangler deploy workers/entry.ts -c wrangler.deploy.jsonc`.
   This creates the Worker, the custom domain, the workflow and the queue consumer.
4. **Clean up an ephemeral token.** Delete it in a `finally`. On every run, sweep any leftover
   token named `epoch-<name>-setup-*`.

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
- who the chosen policies let in. If they do not include everyone, the tool also says that an
  invitee must be let through Access as well as invited in Epoch: `npm run setup -- allow <email>`
  for a policy the tool created, otherwise in the dashboard;
- the first-run steps: sign in, then create the first tree, which makes you its owner;
- the commands for later. Once delivery step 1 has landed, `npm run deploy` works in this
  directory under the bound profiles;
- where the manifest is.

Offer to delete `scripts/setup-cloudflare.sh` if it is still present.

## Other commands

- `npm run setup -- --plan` reconciles and prints the plan, read-only.
- `npm run setup -- doctor` re-runs the prerequisite and sign-in checks, reconcile and verify,
  then reports drift. Drift includes the Access app's cookie settings having been changed in the
  dashboard.
- `npm run setup -- allow <email>` and `-- disallow <email>` edit the policy the tool created. They
  refuse to touch a policy the user picked from the existing ones.
- `npm run setup -- teardown` deletes **only** resources whose marker matches the manifest. The
  user types the Worker name, and D1 and R2 need a second, separate confirmation, because a family tree
  cannot be recovered. It never runs as part of setup, and setup never rolls back by deleting.

## Delivery

0. **Spike (half a day, a throwaway account).** Settle every *(spike)* claim:
   - Device login.
   - Granted-scope readback after unticking one.
   - The Access endpoints accepting the `cf` OAuth token.
   - `aud` in the create response.
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
   - Git-ignore `.epoch/`. (`wrangler.deploy.jsonc` was git-ignored here; ADR-038 later made it
     tracked.)
   - Move `db:migrate`, `deploy` and the backfill scripts to the binding name and `-c`.
   - Add the `install_meta` migration (expand-only).
2. The manifest module, the commander and clack shell (`cli.ts`, `ui.ts`, with `tools/setup/cli.ts`
   added as a knip entry), and a typed wrapper around `cf` and wrangler (JSON in and out, mapped
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
   generated `wrangler.deploy.jsonc`. (Resolved as ADR-038: the deploy file is tracked too.)
   - **The cost:** this repository's live values leave git. The live install is re-created locally
     once, through adoption, and remote commands need `-c`.
   - **The alternative:** keep owner values in the tracked file. That is simpler for a single
     owner, but every fork inherits someone else's ids.
2. **Who may create trees.** Today any signed-in person can, so a broad Access policy lets
   strangers start trees of their own.
   - **Option A: keep Access narrow.** Use the policy picker in step 7 and `setup allow`.
   - **Option B: add an install owner to the app.** The owner email that setup confirms is
     written to `install_meta`, and `tree:create` (and later, other install-wide actions) is
     limited to that owner and to people who already hold a membership.
     - **A signed-in person who is not admitted is sent back to `/welcome`.** Admitted means the
       install owner, someone holding any membership, or someone whose invitation was just
       redeemed. A page load from anyone else gets a 303 to `/welcome?reason=not-invited`, and an
       API call gets a 403. The welcome page then says who they are signed in as, tells them to
       ask the owner for an invitation, and offers sign-out (`/cdn-cgi/access/logout`), not
       "Continue". The redirect can't loop, because `/welcome` is public.
     - Then a broad Access policy is safe, and invitations become the only gate, as ADR-016
       intended.
     - That is app work, with an ADR, outside this tool.
3. **Default deploy auth:** a second OAuth consent for a wrangler profile (proposed), or the
   single-consent ephemeral token.
4. **Pin `cf` as a devDependency** (proposed, reproducible) or require a global install.
5. **Email Sending:** should setup try to onboard the sender domain, or only report its status?
   Report only is proposed, because domain verification touches DNS.

## Built

`tools/setup/` implements the flow above. Where it differs from the plan:

- **Layout.** `tools/setup/` has its own `package.json` (commander 15, @clack/prompts 1.8.1, `cf`
  1.0.0-beta.13, all exact). Root `lint`, `check`, `test` and `setup` run
  `scripts/ensure-setup-deps.mjs` first through npm `pre` hooks, so a fresh clone needs only the
  root `npm ci`. The root Vitest runs the tool's tests; `check` also runs `tsc -p tools/setup`.
- **Markers.** The D1 and R2 markers are both written in the migrate step (the R2 object moved from
  step 6), because that is the one place a wrangler credential is guaranteed to exist, including with
  `--deploy-auth=ephemeral`. With an ephemeral token the R2 marker cannot be read during reconcile, so
  such a bucket reads as unmarked until the next run.
- **Identity providers** are `cf zero-trust identity-providers list`, not under `access`.
- **Reading a Worker has no `cf` command** (`cf schema --list` has only deployments and secrets for
  Workers), so its bindings, the `EPOCH_INSTALL_ID` var and the custom-domain check are one raw
  `GET` each against the API, with the wrangler (or environment) token. They fail closed: only a 404 or
  error 10007 means "absent", so a broken call can never read as "no Worker" and let a deploy overwrite
  one.
- **`--deploy-auth=ephemeral` is refused for now.** Reconcile needs that wrangler token to inspect an
  existing Worker, which a minted deploy token (created later) cannot provide. The minting code
  (permission groups resolved by name, deleted in a `finally` and on a signal) is in place and tested
  but unreachable.
- **Account scope.** Access applications, the organisation and identity providers take
  `accounts <id>` positionals; D1, R2, queues, policies and tokens read `CLOUDFLARE_ACCOUNT_ID`.
- **R2 jurisdiction** is applied by `wrangler r2 bucket create` because `cf`'s create body has no
  jurisdiction field. **Email Sending** is per subdomain: `cf email-sending subdomains list --zone`.
- **`--force`** signs in again; the scope-failure message points at it.
- **`spike`** (`npm run setup -- spike`) runs the read-only checks, sends writes with `--dry-run`,
  and saves each raw response under `.epoch/spike/` for replacing the synthesized fixtures.
- Extra flags beyond the plan: `--r2-location`, `--r2-jurisdiction`, `--email-sender`,
  `--owner-email`.
- **Worker name, hosting, existing Worker, template** (the later scope change) are all implemented as
  steps 1, 3, 4 and 8 describe. `--name` replaces `--slug`; `--hosting workers-dev|custom` and
  `--keep-workers-dev` are new. The manifest still calls the name `workerName`.
- **Adopt is only offered when the Worker's own database is the one this install would use**; a Worker
  bound to another D1 can be renamed away from or replaced. Replace does not record the Worker as
  ours, so its AUD secret is not inherited.
- **Choosing another name** after a taken one overwrites the empty record of the abandoned name; once
  anything has been created, a different name is "a second install in one checkout" and is refused.
- **The build-field agreement check** runs `scripts/deploy-config.mjs`, not a copy.
- **New `cf`/API calls for the spike:** `GET /accounts/{id}/workers/subdomain` (raw API, no `cf`
  command exists); the check is `workers-subdomain`.
