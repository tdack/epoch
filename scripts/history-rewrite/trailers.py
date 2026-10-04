# git filter-repo --message-callback body. filter-repo wraps this file in
# `def callback(message):`, so it ends with a bare `return`, and `message` is bytes.
# dry-run.py wraps it the same way, so both see exactly the same code.
#
# Rewrites the misspelled `Co-Author: <model-id> <noreply@github.com>` trailer
# into `Co-Authored-By: <Model Name> <noreply@<vendor>>`, and drops it where the
# commit already carries that exact Co-Authored-By line (the harness added one).
# Any trailer for a model id it does not recognise aborts the run rather than
# guessing a vendor.
import re

# Exact ids seen in the history; anything else falls through to the vendor rules.
KNOWN = {
    'claude-sonnet-5-5': ('Claude Sonnet 5.5', 'anthropic.com'),
    'claude-opus-5-5': ('Claude Opus 5.5', 'anthropic.com'),
    'deepseek-v4-pro': ('DeepSeek V4 Pro', 'deepseek.com'),
}

def display_name(model_id):
    if model_id in KNOWN:
        return KNOWN[model_id]
    m = re.fullmatch(r'claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?', model_id)
    if m:
        return ('Claude %s %s.%s' % (m.group(1).capitalize(), m.group(2), m.group(3)),
                'anthropic.com')
    m = re.fullmatch(r'gemini-(.+)', model_id)
    if m:
        return ('Gemini ' + ' '.join(p.capitalize() for p in m.group(1).split('-')),
                'google.com')
    m = re.fullmatch(r'gpt-(.+)', model_id)
    if m:
        return ('GPT-' + m.group(1), 'openai.com')
    raise SystemExit('history-rewrite: no vendor rule for model id %r' % model_id)

BAD = re.compile(r'^Co-Author:\s*(\S+)\s*<noreply@github\.com>\s*$')

text = message.decode('utf-8')
lines = text.split('\n')
existing = {l.strip().lower() for l in lines if l.lower().startswith('co-authored-by:')}
out = []
for line in lines:
    m = BAD.match(line)
    if not m:
        out.append(line)
        continue
    name, domain = display_name(m.group(1))
    fixed = 'Co-Authored-By: %s <noreply@%s>' % (name, domain)
    if fixed.lower() in existing:
        continue
    existing.add(fixed.lower())
    out.append(fixed)
return '\n'.join(out).encode('utf-8')
