---
target: tree view
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Volumes/Storage/Users/troy/Projects/epoch/src/routes/trees/[id]/+page.svelte"
target_fingerprint: "sha256:6870b047b3bed77bb387725006e4d7e3431c825c0b56fb98e0b392cc9ca368ae"
target_path: /Volumes/Storage/Users/troy/Projects/epoch/src/routes/trees/[id]/+page.svelte
timestamp: 2026-10-06T20-22-06Z
slug: src-routes-trees-id-page-svelte
closed: true
---
# Critique: tree view (src/routes/trees/[id]/+page.svelte)
Method: dual-agent (A: design review · B: detector + browser)

## Heuristics (26/40, Acceptable)
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 3 | "Display 2" badge on an untouched ?mode=layers link misreports state |
| 2 | Match real world | 3 | Flat/Layers/Floors and "Side branches" are jargon; unlabelled union date; GEDCOM "28 JAN 1985" beside "9 Mar 1966" |
| 3 | User control | 3 | URL history and undo strong; single click re-centres the whole chart |
| 4 | Consistency | 2 | stone-900 selected state vs emerald; "partner" vs "direct line" across modes; Flat has its own zoom bar |
| 5 | Error prevention | 2 | Delete person in the same context menu; per-row trash icons; canvas menu and Add person not role-gated |
| 6 | Recognition vs recall | 2 | Double-click/long-press/right-click/drag gestures unsignposted |
| 7 | Flexibility | 3 | Arrow keys, `/`, context key, shareable URLs; no shortcut sheet |
| 8 | Minimalist design | 3 | Three stacked bars; 448px canvas with dead space below at 1280x800 |
| 9 | Error recovery | 3 | Undo toasts, rollback toasts; bare drawer error state |
| 10 | Help | 2 | Hints only in title attributes; nothing explains modes or gestures |

## Priority issues
- [P1] Phone first view unreadable: fits whole graph to ~19%, cards collapse to surname initials ("D D D D"). Fix: fit to immediate family at a readable minimum, given-name initials, fit height too. (/impeccable adapt)
- [P1] Destructive edits under-framed and not role-aware: Delete person beside Show details (tree-actions.ts:49), trash per drawer row, canvas actions and header Add person passed unconditionally (+page.svelte:386, +layout.svelte:88). Fix: gate by role, divider before danger items, consequence copy naming who is affected. (/impeccable harden)
- [P2] Click re-centres, details behind double-click (+page.svelte:417-425); gestures hidden. Fix: click selects/opens drawer, explicit "Centre on" control, first-visit hint. (/impeccable clarify)
- [P2] Chrome stack wastes the stage: canvas starts y~200, 448px tall with ~150px dead cream. Fix: canvas fills to 100dvh, toolbar floats as panel pill. (/impeccable layout)
- [P2] Inconsistent state language and off-ramp text sizes: stone-900 selected fills (TreeToolbar.svelte:151), 10/11/13px HTML text in toolbar/nav/legend/finder (detector: 30 font-size findings, ~19 real), legend summary 10px, white off-system context menu, amber notice wash used as plain container. (/impeccable polish)

## Persona red flags
Alex: stepper-only generations; tree-wide default in a transient popover; Flat cannot show side branches. Sam: role=application canvas with tabindex -1; Enter on union edits; zoom bar lacks focus-ring; hints in title. Casey: initials soup; long-press only route to details; Floors offered then refused; legend covers chart. Margaret (occasional older editor): click jumps chart; jargon modes; four routes to "add a relative" in the drawer; trash icons by her children.

## Detector
37 findings (36 advisory, 1 warning). False positives: layout-transition (matches stroke-width), all gpt-thin-border-wide-shadow (closed dialogs), header overflow (sr-only), SVG text sizes vs rem ramp. Plausible drift: 10/11/13px HTML text, 9px/10px radii, #f0efed and #fecaca literals, nested-cards on legend/drawer.

## Questions
- If a click re-centres, is the chart for looking at a family or navigating a graph?
- Do Layers and Floors answer a question relatives ask, and if so why are they named for geometry?
- Why does a shared canvas show nothing about other editors or recent changes?
- Should the tree-wide default view sit one misclick away in a filter popover?
