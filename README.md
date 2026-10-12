# Epoch

A private family-tree application for one owner and the relatives and researchers they invite.
Each family runs its own copy on its own Cloudflare account, so no platform holds or mines the
data. Epoch is inspired by webtrees' capabilities, not its screens.

## Features

### A family tree that handles real families

- **More than one family per child.** A child can have more than one mother, father or parental
  family, each link typed as biological, adoptive, foster, guardian or unknown.
- **Partnerships, not just marriages.** Married and unmarried partners, separation, divorce,
  annulment, death, widowhood and remarriage. Repeated partnerships between the same two people
  stay distinct and are labelled "1st partnership", "2nd partnership", with dates.
- **Step relationships** are worked out from a parent's partnerships rather than entered by hand.
- **Honest dates.** Approximate, ranged, incomplete and conflicting dates are kept as written;
  `ABT 1900` never becomes an invented exact day.
- **Several names per person**, with types, components and a preferred display name, plus
  repeatable facts and events for people and partnerships.

### Exploring the tree

- A focus-centred family view where generations up and down, siblings, step relatives and
  relationship types can be shown or hidden. The view is kept in the address, so reloading,
  **Back** and shared links restore it.
- **3D views** beside the flat view: **Rings** (one ring per generation), **Ball** (height is
  calendar time), **Ribbons** (lines of descent braiding at each partnership) and **Orrery**
  (partners as paired stars). Each can show the whole tree and trace several lines at once.
- **Charts** centred on any person: pedigree, descendants, fan and hourglass, each with a text
  outline.
- **Relationship finder** showing every route between two people.
- **Ranked search** over names, record ids, places and years, saying why each person matched.
- **Lists** of people, partnerships and surnames, paged on the server, plus recents and favourites.

### Records and research

- **Person pages:** names, facts (add, edit, remove, reorder), family, evidence, media and history.
- **Partnership pages:** partners, events, children, chronology, evidence and warnings.
- **Places** named by facts, with rename and merge.
- **Sources, repositories and citations**, showing what each source supports.
- **Shared notes**, and where each one is used.
- **Research tasks** with filters.
- A **data-quality report** that flags likely mistakes, with dismissals.
- **Media** attached to people, kept private in your own storage.

### Editing safely together

- **Roles per tree:** owner, manager, editor, contributor and viewer.
- **Invitations.** Only the install owner, tree members and people with an open invitation can get
  in. Anyone else who signs in is told to ask the owner for an invitation, and nothing is stored
  about them.
- **Living-person privacy**, configured per tree by its managers.
- **Undo.** Every change is recorded in a change log, and each one shows a toast with **Undo**. Undo
  reverts your own latest change, and says why if someone else has since changed the same records.
- **Conflict protection.** If two people edit the same record at once, the second save is refused
  rather than overwriting the first.
- **Delete with impact.** Removing a person or link first shows exactly what will be affected.

### GEDCOM import and export

- Import with validation and a **preview** before anything is written.
- **Duplicate families** in a messy file (same two partners, identical facts, no disagreement about
  a child) are offered for merging, on by default; **possible duplicates** are listed for review.
- **Merge duplicate partnerships** already in a tree from a partnership's menu, or **Merge…** in the
  person drawer. The dialog lists what moves or goes and asks you to choose where the facts differ.
  Merges can be undone.
- Export writes the tree back out, including structures Epoch does not yet show, which are kept
  from the import rather than discarded. Merged families keep their original ids.

## Requirements

- **Node 24 or later** (see `.nvmrc`).
- To deploy: a Cloudflare account with a **paid Workers plan**, a **Zero Trust organisation with an
  identity provider**, and somewhere to serve from (a workers.dev subdomain or an active domain).

## Running locally

```sh
nvm use                       # or otherwise install Node 24
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local      # creates the local database
npm run dev
```

The app runs at <http://localhost:5173>. If the database has not been migrated (or new migrations
have been pulled since), every page answers with a message saying to run `npm run db:migrate:local`.

### Sample data

With the dev server running:

```sh
npm run seed
```

This imports [test/data/The Simpsons.ged](<./test/data/The Simpsons.ged>) as a tree named "The
Simpsons", and does nothing if that tree already exists. If the dev server is on
another port, set `SEED_URL`, for example `SEED_URL=http://localhost:5178 npm run seed`.

For a larger tree with sources, places and media links, import
[test/data/The Windsors.ged](<./test/data/The Windsors.ged>) from the app. All the files in
`test/data/` are fictional or public, so they are safe to share.

### Signing in locally

In a deployment, sign-in comes from Cloudflare Access. Locally, `.dev.vars` sets
`ACCESS_BYPASS_DEV=true`, so requests act as a local developer (`developer@epoch.local`) who stands
in for the install owner. To act as someone else, send the `x-dev-user-sub`, `x-dev-user-email` and
`x-dev-user-name` headers; that person must be invited to a tree first, as in a real install.

The bypass only applies when the flag is set. **Never set it in a deployed environment.**
`.dev.vars` is git-ignored.

## Installing into Cloudflare

```sh
./setup --plan   # read-only: shows what would be created or changed
./setup          # signs in, creates everything, deploys and checks the result
```

`./setup …` is the same as `npm run setup -- …`; either works.

Setup signs in through your browser (there is no API token to create) and asks only what it cannot
find out itself. It creates:

- the database, storage bucket, queue and Worker;
- a workers.dev address or one custom domain;
- one Cloudflare Access application on `<host>/login`, with an Allow policy chosen from your
  existing ones or a new one for your email address.

It never creates your account, plan, Zero Trust organisation or domain, never edits an Access policy
it did not create, and checks that anything it finds by name belongs to this install before using
it. It also records you as the install owner.

### Looking after an install

| Command | Does |
|---|---|
| `./setup doctor` | Reports anything that has drifted from what setup created |
| `./setup allow <email>` | Lets someone through the Access policy setup created |
| `./setup disallow <email>` | Removes them again |
| `./setup teardown` | Deletes only what this install created |
| `./setup builds` | Gives Workers Builds this install's values, after you connect the repository |
| `./setup --help` | Lists every flag, including ones that answer each prompt for scripted use |
| `npm run deploy` | Deploys a new version from your machine: builds, applies any new migrations and deploys |

With `--json`, only the result is printed (through npm, use `npm run -s setup -- …` so npm's own
banner stays off the output). Setup keeps its state in `.epoch/install.json` and writes your
values to `wrangler.deploy.jsonc`. Both are git-ignored, so none of your configuration ends up in
the repository. If you'd rather not use setup, copy `wrangler.jsonc` to `wrangler.deploy.jsonc` and
fill in your own Worker name, route, vars and sender address. No database id is needed:
Cloudflare finds the database by its name.

### Deploying on every push

To deploy on every push with Workers Builds:

1. In the Cloudflare dashboard, go to **Workers & Pages → your Worker → Settings → Builds** and
   connect the repository.
2. Run `./setup builds`.

Setup sets one build variable, `EPOCH_DEPLOY_VALUES`, which the build turns into
`wrangler.deploy.jsonc`. It also sets the production trigger:

- the build command to `npm run build:worker` and the deploy command to `npm run deploy:worker`, so
  the Worker is built once;
- the watch paths to `src/**`, so documentation and tooling changes don't start a build.

A push that changes only migrations, `wrangler.jsonc` or `package.json` therefore doesn't deploy on
its own. Run `npm run deploy` for those, or let them go out with the next change to `src/`. Setup
uses the sign-in it already has, so you don't need an API token.

If setup can't set the variable (for example, a sign-in made before this feature, or the
repository isn't connected yet), it prints the value for you to paste in. `./setup --force` signs
in again with the extra permission.

### Who can get in

Letting someone through Cloudflare Access is not enough on its own. Epoch then admits only the
install owner, members of any tree and people with an unexpired invitation (which is accepted on
their first visit). So a broad Access policy, such as everyone at your email domain, is safe; invite
people from a tree's **Members** page.

If you set up Access by hand instead of with `./setup`, the application needs:

- the path `/login` only, with an Allow policy for the people you will invite;
- **Cookie Path Attribute off** (otherwise sign-in does not carry over to other pages);
- **Binding Cookie off**.

and an install owner recorded in the database. Use a lower-case email address:

```bash
npx wrangler d1 execute epoch-genealogy-db --remote --command "INSERT INTO install_meta (install_id, owner_email, created_at) VALUES ('$(uuidgen | tr A-Z a-z)', 'you@example.com', unixepoch())"
```

### Moving from whole-site Access

If an older install has the whole site behind Access plus a Bypass application:

1. Deploy the current version first; it works under the old arrangement too.
2. **Change the existing Access application's path to `/login`** rather than creating a new one,
   so its audience tag and the `CF_ACCESS_AUD` secret stay the same. If you do create a new one,
   update the secret to its audience tag.
3. Delete the Bypass application.

Then check that signing in returns you to the page you asked for.

## Developing Epoch

Commands, tests, deploy internals and data backfills are in
[docs/development.md](./docs/development.md).
