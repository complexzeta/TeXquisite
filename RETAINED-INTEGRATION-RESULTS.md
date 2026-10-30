# Retained lecture layout: integration results

Retained variable-height layout is implemented and correctness-tested, but stays
**opt-in**. It has not demonstrated an overall editor speedup over 0.111.
The normal 0.112 configuration keeps the existing preview algorithm.

## Measured comparison

[Run 41004221190](https://github.com/complexzeta/TeXquisite/actions/runs/41004221190)
passed build, 34 focused guards, isolated canvas tests, real native ownership and
repair, full navigation/handoff tests and six serialized editing sessions.
Measured source: `24bf5504895f983be25071736458e5bd887e4dab`; control:
`73136916c1cbd5d59175dcbf0b05148652f6c01b` (0.111).

| Workload | 0.111 median / p95 / maximum | Retained median / p95 / maximum |
| --- | --- | --- |
| Healthy plain text | 54 / 92 / 139 ms | 55 / 121 / 143 ms |
| Plain text with errors and structural edits | 55 / 109 / 147 ms | 55 / 134 / 197 ms |
| Inline math with errors and structural edits | 74 / 160 / 224 ms | 74 / 166 / 261 ms |

These are bounded cloud renderer acknowledgements, including hash-confirmed
slow action frames and intermediate typing frames. Each fresh 100-paragraph
fixture used explicit letter PDF dimensions, a checked installation-matched
format and four editing rounds. Baseline and candidate used identical inputs,
engine and harness on the same runner, serially. Save, strict export of current
source and normal reopen passed. No missing-baseline rejections remained.
These are not physical-display measurements, local-machine guarantees, TikZ
benchmarks, a six-platform/version compatibility rerun or BaKoMa comparisons.
The 300 ms target held for these samples only. There is no measured basis for
enabling the new retention algorithm by default.

## Implementation and correctness

Retained frames require the existing native character, write, state and flow
witnesses, immutable source identity and exact reconstruction of carried edits.
Native compiler/state-proof thresholds were not weakened. Inline math cannot be
carried by the new mechanism; unsupported changes use guarded fallback. At most
three independently edited paragraphs are carried. The original source is sent
once per history, bounded to two million JavaScript code units, checked against
accepted navigation with SHA-256, then followed by an epoch/view recheck.

The compositor keeps unaffected strips attached, shifts following material,
preserves viewport anchors, bounds display-pixel allocations, and disposes
owned rasters at full, mode, file and ordinary-flow handoffs. Neighboring blocks
keep previous-line ink and crop bleed with their original owner. Navigation
jointly projects unchanged baseline glyphs and edited block-local glyphs.

A sole retained active paragraph can use bounded temporary error repair,
retiring its history without changing editor or saved source. Repair refuses to
overwrite other carried edits. Tests cover unknown-command recovery/correction,
math fallback, growth/shrinkage, multiple blocks, stale clicks, two-way navigation,
Follow, undo/redo, zoom, fit width, pane changes, mode/file switching, canonical
same-bundle resets, save/export and reopen.

Development opt-in requires both `PERSISTENT_TEX_MULTI_BLOCK=1` and
`PERSISTENT_TEX_RETAINED_FLOW=1`. The normal launcher sets neither.
Earlier 33-41 ms component tests excluded preparation, source ownership,
publication and navigation; they are not editor latency.

## CI repair and reliability follow-up

The email's run 40999401341 stopped at a TeX Live mirror timeout after build,
guards and canvas checks passed. The installer now validates bounded HTTPS
downloads and tries alternate mirrors, following the
[TeX Live installation guidance](https://www.tug.org/texlive/acquire-netinstall.html).
A later runner's updated LaTeX kernel correctly triggered native fallback;
fixtures now generate a matching format with the existing self-test and exact
input fingerprints. No compatibility guard was disabled. Other exploratory
runs caught a fixture page-scale assumption and a TypeScript error; the green
run above verifies their fixes.

The 0.112 follow-up adds **Build > Copy performance report**, an explicit
whitelist of in-memory timing, routing and memory fields. It excludes source,
paths, edit IDs and compiler logs; local and full verification timing are
separate. Nothing is uploaded. Switching from any local lecture flow into
Document mode now requests canonical document pages, even without retention.
Final 0.112 packaging verification is pending; no released binary is claimed.

Bulk profiles, fixtures and local temporary files use Kingston. Long GUI/TeX
sessions run on disposable cloud machines after low free memory was observed
locally. The cause of the reported crash is not established. Closed local
fixtures are removed only after reports are copied and verified; user documents,
profiles and the installed 0.111 executable remain untouched.
