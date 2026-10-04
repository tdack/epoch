#!/usr/bin/env bash
# One-off rewrite of misspelled co-author trailers across the whole history.
# See README.md beside this file for the runbook. Subcommands, in order:
#
#   rewrite.sh preflight            in the main checkout: is it safe to start?
#   rewrite.sh run <workdir>        bare-clone GitHub into <workdir>, back up, rewrite, verify,
#                                   add the commit-reference fixup; pushes nothing
#   rewrite.sh push <workdir>       force-push every rewritten branch to GitHub
#   rewrite.sh adopt                in each existing clone: drop the old history, keep
#                                   git-ignored state (.dev.vars, .wrangler, node_modules)
set -euo pipefail

URL=https://github.com/tdack/epoch.git
HERE=$(cd "$(dirname "$0")" && pwd)
# The files that quote commit ids; the fixup rewrites old ids to new ones in these only.
REF_FILES=(.git-blame-ignore-revs README.md AGENTS.md docs)

die() { echo "history-rewrite: $*" >&2; exit 1; }
say() { echo "==> $*"; }

trees_of_every_ref() {
	# One line per ref: its name and the tree of every commit on it, oldest first. A message-only
	# rewrite must leave this identical.
	local repo=$1
	git -C "$repo" for-each-ref --format='%(refname)' refs/heads | sort | while read -r ref; do
		printf '%s %s\n' "$ref" "$(git -C "$repo" log --reverse --format=%T "$ref" | shasum | cut -c1-40)"
	done
}

preflight() {
	git rev-parse --git-dir >/dev/null 2>&1 || die "run inside the repository"
	command -v git-filter-repo >/dev/null || die "git-filter-repo is not installed (brew install git-filter-repo)"
	say "fetching origin"
	git fetch --prune -q origin
	local failed=0

	if git rev-parse -q --verify origin/feat/3d-tree-views >/dev/null; then
		if git merge-base --is-ancestor origin/feat/3d-tree-views origin/main; then
			say "S16 (feat/3d-tree-views) is merged into origin/main"
		else
			echo "FAIL: feat/3d-tree-views is not merged into origin/main; finish S16 first"; failed=1
		fi
	fi

	if [ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ]; then
		say "local main matches origin/main"
	else
		echo "FAIL: local main and origin/main differ; push or pull first"; failed=1
	fi

	say "local branches whose work is not on origin/main (lost on adopt unless pushed or merged):"
	local lost=0
	while read -r b; do
		if ! git merge-base --is-ancestor "$b" origin/main; then
			echo "   $b ($(git rev-list --count origin/main.."$b") commits)"; lost=1
		fi
	done < <(git for-each-ref --format='%(refname:short)' refs/heads)
	[ $lost = 0 ] && echo "   none"

	say "remote branches already merged into origin/main (delete them before run, or they are rewritten too):"
	git branch -r --merged origin/main | grep -v -e 'origin/HEAD' -e 'origin/main$' || echo "   none"

	say "worktrees (each must be committed, then removed before adopt):"
	git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r w; do
		local state="clean"
		[ -n "$(git -C "$w" status --porcelain 2>/dev/null)" ] && state="UNCOMMITTED CHANGES"
		echo "   $w ($state)"
	done

	local stashes
	stashes=$(git stash list | wc -l | tr -d ' ')
	[ "$stashes" = 0 ] || echo "WARN: $stashes stash entries hold old commits; apply or drop them before adopt"

	say "dry run of the message rewrite"
	python3 "$HERE/dry-run.py" . || failed=1

	[ $failed = 0 ] && say "preflight passed" || die "preflight failed"
}

run() {
	local work=${1:?workdir}
	[ -e "$work" ] && die "$work already exists; pick a fresh directory"
	mkdir -p "$work"
	local bare="$work/epoch.git"

	say "bare clone of $URL"
	git clone -q --bare "$URL" "$bare"
	say "backup bundle: $work/pre-rewrite.bundle"
	git -C "$bare" bundle create -q "$work/pre-rewrite.bundle" --all
	trees_of_every_ref "$bare" >"$work/trees-before.txt"

	say "rewriting messages"
	(cd "$bare" && git filter-repo --quiet --message-callback "$HERE/trailers.py")

	say "verifying"
	trees_of_every_ref "$bare" >"$work/trees-after.txt"
	diff -u "$work/trees-before.txt" "$work/trees-after.txt" || die "a commit's tree changed"
	local left
	left=$(git -C "$bare" log --all --format=%B | grep -c '^Co-Author:' || true)
	[ "$left" = 0 ] || die "$left Co-Author: lines remain"
	say "trees identical on every branch; no Co-Author: lines remain"

	say "fixing commit references in files on main"
	local tree="$work/main"
	git clone -q "$bare" "$tree"
	python3 - "$bare/filter-repo/commit-map" "$tree" "${REF_FILES[@]}" <<-'PY'
		import os, re, sys
		commit_map, tree, *targets = sys.argv[1:]
		pairs = [l.split() for l in open(commit_map).read().splitlines()[1:]]
		old_new = {o: n for o, n in pairs if o != n}
		def lookup(token):
		    hits = [o for o in old_new if o.startswith(token)]
		    return old_new[hits[0]][:len(token)] if len(hits) == 1 else None
		paths = []
		for t in targets:
		    p = os.path.join(tree, t)
		    if os.path.isdir(p):
		        paths += [os.path.join(d, f) for d, _, fs in os.walk(p) for f in fs if f.endswith('.md')]
		    elif os.path.exists(p):
		        paths.append(p)
		# A UUID's 8- and 12-digit groups look like short ids; skip tokens touching a hyphen.
		token = re.compile(r'(?<![0-9a-f-])[0-9a-f]{7,40}(?![0-9a-f-])')
		for p in paths:
		    text = open(p, encoding='utf-8').read()
		    def sub(m):
		        new = lookup(m.group(0))
		        if new:
		            print('   %s: %s -> %s' % (os.path.relpath(p, tree), m.group(0), new))
		        return new or m.group(0)
		    fixed = token.sub(sub, text)
		    if fixed != text:
		        open(p, 'w', encoding='utf-8').write(fixed)
	PY
	if [ -d "$tree/scripts/history-rewrite" ]; then
		git -C "$tree" rm -rq scripts/history-rewrite
	fi
	if [ -n "$(git -C "$tree" status --porcelain)" ]; then
		local msg="docs: point commit references at the rewritten history"
		[ -n "${CO_AUTHOR:-}" ] && msg=$(printf '%s\n\nCo-Authored-By: %s' "$msg" "$CO_AUTHOR")
		git -C "$tree" commit -qam "$msg"
		git -C "$tree" push -q origin main
		say "fixup committed on main: $(git -C "$tree" log -1 --format='%h %s')"
	else
		say "no file quoted an old commit id"
	fi

	say "done; nothing pushed. Inspect $tree, then: $0 push $work"
}

push() {
	local work=${1:?workdir}
	local bare="$work/epoch.git"
	[ -f "$bare/filter-repo/commit-map" ] || die "$bare has not been rewritten by run"
	git -C "$bare" remote get-url origin >/dev/null 2>&1 || git -C "$bare" remote add origin "$URL"
	say "force-pushing every branch to $URL"
	git -C "$bare" push --force origin 'refs/heads/*:refs/heads/*'
	say "pushed. Now run '$0 adopt' in every clone, or delete and re-clone it"
}

adopt() {
	git rev-parse --git-dir >/dev/null 2>&1 || die "run inside the clone"
	[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "check out main first"
	[ -z "$(git status --porcelain)" ] || die "commit or discard local changes first"
	[ "$(git worktree list | wc -l | tr -d ' ')" = 1 ] || die "remove the other worktrees first (git worktree list)"
	[ "$(git stash list | wc -l | tr -d ' ')" = 0 ] || die "apply or drop the stash entries first"

	say "fetching the rewritten history"
	git fetch --prune --force -q origin
	say "resetting main to origin/main"
	git reset -q --hard origin/main
	say "deleting every other local branch"
	git for-each-ref --format='%(refname:short)' refs/heads | grep -vx main | while read -r b; do
		git branch -qD "$b"
	done
	say "dropping the old objects"
	git reflog expire --expire=now --all
	git gc -q --prune=now

	local left
	left=$(git log --all --format=%B | grep -c '^Co-Author:' || true)
	[ "$left" = 0 ] || die "$left Co-Author: lines still reachable"
	say "clone adopted: $(git log -1 --format='%h %s')"
}

case "${1:-}" in
preflight) preflight ;;
run) run "${2:-}" ;;
push) push "${2:-}" ;;
adopt) adopt ;;
*) die "usage: $0 preflight | run <workdir> | push <workdir> | adopt" ;;
esac
