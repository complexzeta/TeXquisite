# Experimental paragraph checkpoint reuse

This is a bounded prototype, disabled by default. It is not included in a new
portable release. Version 0.100.0 remains the published application.

The experiment tests whether independent paragraph checkpoints and retained
page pixels can avoid a full-document refresh when moving between edited
paragraphs. The result supports continuing this approach for ordinary prose;
it does not establish a consistent 300 ms bound or BaKoMa parity.

## Measurements

A private four-page manuscript with a substantial preamble was copied into an
isolated project on external storage. Two ordinary paragraphs on different
pages were edited in alternation, adding/removing a short word. The same
sequence was run against the released 0.100 application. No private document,
session, paths, or raw reports belong in this repository.

| Run | First move to second block | Subsequent returns, median | Return range | Returns above 300 ms |
| --- | ---: | ---: | ---: | ---: |
| Released 0.100 control | 918 ms | 894 ms | 790–1202 ms | 9/9 |
| Initial prototype | 478 ms | 106 ms | 92–178 ms | 0/9 |
| Prototype repeat | 642 ms | 234 ms | 119–422 ms | 2/9 |
| Final guarded prototype | 619 ms | 131 ms | 104–557 ms | 1/9 |

These are small, sequential, hidden-window measurements to a matching revision
on a canvas within the preview viewport, not physical-screen latency or a
statistical performance guarantee. The initial and repeat runs preceded the
additional character-category/file-write exclusions. The final run includes
them. Load/cache variance remains visible.

Every accepted update checked that the other edited region retained its pixels.
After restoring the original text, complete restored canvases on both edited
pages matched the original PDF raster with zero differing pixels in the repeat
and final runs. Existing placement, raster and ink proofs remain in force.

Broader trials deliberately exposed the limits: display math and a short plain
paragraph between floating figures required canonical fallback and took roughly
2–3.6 seconds. They were not admitted by weakening the proof.

## Scope and mechanism

Development opt-in: `PERSISTENT_TEX_MULTI_BLOCK=1`, Lecture mode and Continuous
scroll. There is no new user-facing setting. Normal startup retains the existing
preview path.

An immutable baseline source has a bounded ledger of up to three paragraph
substitutions. Each checkpoint compiles the original prefix plus only its own
paragraph substitution. Independent, nonoverlapping raster patches retain other
edited paragraphs. One resident worker and the existing bounded checkpoint
cache are reused. Current editor text, hashes and mapped ranges include all
substitutions; a full build/export must compile the complete editor source.

Admission requires unchanged geometry and existing TeX table/flow-state checks,
ordinary ASCII tokens with ordinary category codes, no observed noncompiler
file writes during typesetting, no detected lecture output side effects, and
the existing visual proof. Layout or state changes, unsupported regions, an
expired baseline, changed footprint, overlap or an exhausted ledger take the
canonical path. Immediate file writes and active characters have explicit native
regressions. These exclusions are conservative, not a proof of arbitrary macro
semantics or all native engine state.

## Work required before enabling this

- Account for the first uncached block and occasional slow cached returns.
- Handle paragraph growth/reflow and interaction with floats and math.
- Implement exact inverse navigation for retained edited blocks.
- Extend invalidation and custom macro/engine-state coverage; EqTable equality
  alone is not a complete semantic proof for arbitrary TeX programs.
- Broaden zoom, document switching, cancellation, history and memory testing.

Keep this experimental. The benefit justifies further work on the narrow path;
it does not justify promising immediate updates for arbitrary paragraphs yet.

## Focused checks

The prototype's four native/source guards and 29 existing ownership, placement,
ink and inverse-navigation guards passed serially. The multi-patch canvas check
and the two-edit save/export/reopen integration check passed. The first session
fixture omitted required engine settings and timed out before creating a window;
correcting that fixture resolved the test startup failure without a product
change.

Build first. Select an external `PERSISTENT_TEX_TEST_ARTIFACTS` directory and put
process-local `TEMP`/`TMP` on that drive. Run native and Electron suites serially:

```
node --test --test-concurrency=1 test/neutral-blocks.test.cjs test/neutral-preview.test.cjs
node scripts/neutral-canvas-test.cjs
node scripts/neutral-session-test.cjs
```

The session test requires both independent local patches, automatic saving,
current-source PDF export containing both changes, and reopening the saved
source and Lecture setting. The generic private-document harness additionally
accepts `PERSISTENT_TEX_BLOCK_REVISITS=1` and `PERSISTENT_TEX_BLOCK_COUNT=2`.
It still requires an explicit separate writable project clone; never point it
at a user's working document.
