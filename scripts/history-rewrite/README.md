# History rewrite: co-author trailers

One-off. Until 2026-10-04, AGENTS.md told agents to write `Co-Author: <model-id> <noreply@github.com>`.
GitHub and GitLab ignore that spelling, so those commits credit nobody. This rewrite converts each one
to `Co-Authored-By: <Model Name> <noreply@<vendor>>`, and drops it where the commit already carries
that exact line. Only commit messages change: every commit's files stay byte-identical, and
`run` checks that. `run` removes this folder from `main` in its fixup commit.

| Before                                              | After                                                       |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `Co-Author: claude-sonnet-5-5 <noreply@github.com>` | `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` |
| `Co-Author: claude-opus-5-5 <noreply@github.com>`   | `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`   |
| `Co-Author: deepseek-v4-pro <noreply@github.com>`   | `Co-Authored-By: DeepSeek V4 Pro <noreply@deepseek.com>`    |

The existing `Co-Authored-By` and Copilot `Co-authored-by` trailers are left alone. A model id with no
rule in `trailers.py` stops the run, rather than guessing a vendor.

## Files

- `trailers.py`: the `git filter-repo --message-callback` body.
- `dry-run.py`: applies the callback to every commit message in a repo, writes nothing, and fails
  if anything other than a trailer would change.
- `rewrite.sh`: `preflight`, `run`, `push`, `adopt`.

Rehearsed 2026-10-04 on a copy of GitHub's history:

- 305 of 435 commits changed;
- every branch's trees were identical before and after;
- the fixup remapped the eight quoted commit ids (`.git-blame-ignore-revs`, plus seven in
  `docs/`);
- `adopt` turned a simulated old clone with a stray branch into a clean copy of the new history.

## Runbook

Do it in one sitting, with no agent sessions running.

### 1. Get to a quiet state

1. Merge S16 into `main`, and push `main`.
2. Stop every Claude session that works on this repo.
3. Remove the worktrees under `.claude/worktrees/`. Copy anything worth keeping out first:
   `preflight` lists any worktree that has uncommitted changes.
4. Delete remote branches that are already merged, for example:

   ```sh
   git push origin --delete claude/tender-euler-7ij59u feat/s15c-notes-tasks feat/3d-tree-views
   ```

5. Do the same on the Mac Mini: no unpushed work, and no worktrees.

### 2. Preflight

From the main checkout, with a copy of this folder kept outside the repo (`adopt` rewrites the
checkout):

```sh
cp -R scripts/history-rewrite ~/history-rewrite
~/history-rewrite/rewrite.sh preflight
```

It must end with `preflight passed`. It fails if S16 is unmerged, if `main` is not pushed, or if
the dry run finds a problem. It also lists:

- local branches with work that is not on `origin/main`;
- remote branches that are already merged;
- worktrees, and whether each has uncommitted changes;
- stash entries.

### 3. Rewrite

```sh
~/history-rewrite/rewrite.sh run ~/epoch-rewrite
```

This step pushes nothing to GitHub. It:

1. makes a bare clone of GitHub;
2. writes a backup to `~/epoch-rewrite/pre-rewrite.bundle`;
3. rewrites the messages;
4. checks that every branch's trees are unchanged and that no `Co-Author:` line is left;
5. commits a fixup on `main` that remaps the commit ids quoted in files and removes this folder.

To give the fixup commit an agent trailer, set `CO_AUTHOR='Claude Opus 5.5 <noreply@anthropic.com>'`.

Then look at the result:

```sh
git -C ~/epoch-rewrite/main log -3 --stat
```

### 4. Push

```sh
~/history-rewrite/rewrite.sh push ~/epoch-rewrite
```

This force-pushes every branch. The repo has no branch protection and no pull requests, so there
is nothing to switch off and no old pull-request refs remain.

### 5. Adopt on every clone

On this host, then on the Mac Mini, in the main checkout:

```sh
~/history-rewrite/rewrite.sh adopt
```

This does the following:

1. fetches the new history;
2. resets `main` to it;
3. deletes every other local branch;
4. expires the reflog and garbage-collects, so no old commit stays reachable.

It refuses to run while there are uncommitted changes, extra worktrees or stash entries.

`adopt` keeps the things git ignores, which a fresh clone would lose:

- `.dev.vars`;
- the local D1 database in `.wrangler/`;
- `node_modules`.

Deleting and re-cloning works too, but then you have to copy `.dev.vars` back, run
`npm install` and `npm run db:migrate:local`, and run `npm run seed` again.

**Never `git pull` the new history into a clone that still has the old one.** Git merges the two
histories, and every commit then exists twice.

### Afterwards

- Commits now have new ids. Cloudflare deployment metadata, and any notes outside the repo that
  quote an old id, point at commits that no longer exist.
- Keep `pre-rewrite.bundle` for a while.

## Rollback

Before `push`: delete `~/epoch-rewrite`. Nothing else has changed.

After `push`: restore GitHub from the bundle, then `adopt` in each clone again:

```sh
git clone --bare ~/epoch-rewrite/pre-rewrite.bundle /tmp/epoch-restore
git -C /tmp/epoch-restore push --force https://github.com/tdack/epoch.git 'refs/heads/*:refs/heads/*'
```
