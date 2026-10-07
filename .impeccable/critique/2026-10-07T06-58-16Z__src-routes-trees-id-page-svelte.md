---
target: tree view
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Volumes/Storage/Users/troy/Projects/epoch/src/routes/trees/[id]/+page.svelte"
target_fingerprint: "sha256:fb355c395dbd7525dae7013e965977d321f05f4cb4ff0b409d68aad07598d6fe"
target_path: /Volumes/Storage/Users/troy/Projects/epoch/src/routes/trees/[id]/+page.svelte
timestamp: 2026-10-07T06-58-16Z
slug: src-routes-trees-id-page-svelte
---
# Critique: tree view (src/routes/trees/[id]/+page.svelte)

Method: dual-agent (A: design review · B: detector and browser)

## Heuristics (27/40, Acceptable)
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 3 | Centred-on cue and delayed Loading pill; drawer shows nothing while loading (PersonDrawer.svelte:63) |
| 2 | Real world | 3 | Family copy; Flat/Layers/Floors are tool names; raw "28 JAN 1985" beside "9 Mar 1966" |
| 3 | User control | 2 | Clicking the focused person, or double-clicking anyone, closes opened "+N" branches (+page.svelte:251) |
| 4 | Consistency | 2 | Inline zoom bar copy in TreeCanvas vs ZoomControls; Layers splits controls across two bars; popover off-token colours/radius |
| 5 | Error prevention | 3 | Divider and red danger items, impact preview; disabled Reset looks enabled |
| 6 | Recognition | 3 | Hint names gestures but once dismissed nothing does |
| 7 | Flexibility | 3 | Arrow keys, Shift+F10, URL state; no zoom/fit keys |
| 8 | Minimalist | 3 | Calm; stacked chrome bands, 11-control Display panel |
| 9 | Error recovery | 3 | Rollback toasts, undo promised |
| 10 | Help | 2 | Hint dismissible forever, legend collapsed |

## Priority issues
- [P1] Click on the focused person, and every double-click, discard opened branches: navigate() resets expandedStubs unless the change names them (+page.svelte:251); handleFocusPerson and handleOpenPerson both go through it. Fix: no-op a click on the current focus; carry expandedStubs when focus is unchanged. (/impeccable harden)
- [P1] Sex shown by colour alone at compact and block levels (PersonCard.svelte:162-177), breaking the Line Before Hue Rule; phones now open at compact (0.45). Fix: keep the symbol at compact and a corner glyph at block. (/impeccable harden)
- [P2] Phone framing has no off-screen cue and Fit drops to ~24% blocks; chrome takes ~42% of the phone height. Fix: edge indicators or "more relatives" affordance, Fit respects the readable floor first, fold hint/tabs while using the canvas. (/impeccable adapt)
- [P2] Direct ?mode=layers link skips the Layers arrival defaults and shows a "2" changes badge the user never made (observed in browser; suspected race between arrival navigate and focus write-back, +page.svelte:171-239). (/impeccable harden)
- [P2] Focus person barely distinct: 3.5px stroke vs 3px hover (PersonCard.svelte:231,249). Fix: persistent focus treatment, distinct from hover and selection. (/impeccable bolder, scoped)

## Persona red flags
- Alex: no keyboard zoom/fit; no "Centre on" in the menu; double-click loses branches.
- Sam: "+N" stubs and collapsers always tabindex 0 (TreeCanvas.svelte:592,626); drawer close button lacks focus-ring and is ~32px; context menu lacks Home/End and a label.
- Casey: zoom buttons ~32px with no coarse sizing; context menu rows not 44px on touch (DESIGN.md requires); details via long-press or a top-of-screen menu only.
- Older relative (viewer): 12px muted dates, truncated names; hint says "right-click for more" though a viewer's menu has only Show details; "Show details" vs "Open profile" unexplained.

## Detector
CLI 23 findings (1 warning, 22 advisory). False positives: layout-transition (SVG stroke-width), SVG text sizes, closed-dialog shadows, sr-only header overflow, segmented control as nested card. Real drift: ParentLinkPopover 13px text, 10px radius, #f0efed/#fecaca/raw shadow; TreeLegend 13px chip text and 9px radius; PlaneStack label 13px; TreeContextMenu raw shadow; Layers sheet clipped 8px at canvas edge.

## Minor
Reset to defaults has no disabled style; drawer subtitle "Male-14 Aug 1975 –"; stub expansion re-zoomed 92%→67%; Floors siblings overlapped by parents; repeated inline hex panel colours; impact copy "Birth name X of X".

## Questions
- Should a single click refocus at all, or select, with refocus explicit?
- Is "three modes" the right concept, or one view with a depth dial?
- What if the canvas owned the window and all chrome floated over it?
