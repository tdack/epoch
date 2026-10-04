#!/usr/bin/env python3
"""Show what trailers.py would do to every commit reachable from any ref, without writing.

Usage: dry-run.py [repo-path]   (defaults to the current directory)

Wraps trailers.py exactly as git filter-repo does, so an unknown model id fails here first.
Exits non-zero if any `Co-Author:` line would survive.
"""
import collections
import os
import subprocess
import sys

here = os.path.dirname(os.path.abspath(__file__))
repo = sys.argv[1] if len(sys.argv) > 1 else '.'
body = open(os.path.join(here, 'trailers.py'), encoding='utf-8').read()
scope = {}
exec('def callback(message):\n  ' + '\n  '.join(body.splitlines()), scope)
callback = scope['callback']


def git(*args):
    return subprocess.run(['git', '-C', repo, *args], check=True, capture_output=True).stdout


def trailers(message):
    return tuple(l for l in message.decode().split('\n') if l.lower().startswith('co-author'))


changes = collections.Counter()
survivors = 0
commits = git('rev-list', '--all').split()
for sha in commits:
    old = git('log', '-1', '--format=%B', sha.decode())
    new = callback(old)
    if old != new:
        changes[(trailers(old), trailers(new))] += 1
        # Only trailer lines may differ; anything else means the callback is wrong.
        strip = lambda m: [l for l in m.decode().split('\n') if not l.lower().startswith('co-author')]
        if strip(old) != strip(new):
            sys.exit('history-rewrite: non-trailer text changed in %s' % sha.decode())
    survivors += sum(1 for l in new.decode().split('\n') if l.startswith('Co-Author:'))

print('%d commits scanned, %d would change\n' % (len(commits), sum(changes.values())))
for (old, new), n in changes.most_common():
    print('%4d  %s' % (n, '\n      '.join(old)))
    print('   -> %s\n' % ('\n      '.join(new) or '(trailer removed)'))
if survivors:
    sys.exit('history-rewrite: %d Co-Author: lines would survive' % survivors)
