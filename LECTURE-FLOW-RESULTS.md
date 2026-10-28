# Flowing Lecture-mode sections — 0.98.0

Removing page-boundary work helps supported section edits substantially. Lecture mode now renders these edits as a flowing block that can grow beyond a normal PDF page. The initial full-document preview still has pages, margins and footers around unchanged content. A fully pageless initial layout remains further work.

## What changed

The existing paragraph flow formatter already holds back page building. Numbered section headings could nevertheless reject that path because their node lists include marks and deferred table-of-contents writes; hyperref additionally introduces PDF destinations. The new Lecture-only native entry point admits these specific node types. It removes deferred writes recursively from the final copied visual list, so painting a private fragment does not execute auxiliary/bookmark writes outside LaTeX's normal output-routine context. Actual TeX still computes heading text, numbering, fonts, mathematics and spacing.

Original-source capture, baseline raster proof, project-input checks and strict composition remain required. The fragment reports its state effects so navigation cannot reuse following content's old state. The ordinary flow path used by Document mode keeps its original whitelist. Full Build and Export retain normal pagination, output routines, auxiliary convergence and bookmark generation.

## Diagnostic measurements

One synthetic article contained forty existing prose paragraphs with inline mathematics. Real clipboard pastes inserted a section heading and 1, 4 or 12 paragraphs. The existing browser harness measured source changes to matching rendered canvases in Continuous scroll/Lecture mode at device scale 2.5.

| Paragraphs inserted | Released 0.97.0 | Initial 0.98 prototype | Visual-write prototype |
| --- | ---: | ---: | ---: |
| 1 | 1389 ms | 128 ms | 74 ms |
| 4 | 1024 ms | 129 ms | 88 ms |
| 12 | 531 ms | 190 ms | 139 ms |

The extended visual-write scenario then inserted another 32 paragraphs in 292 ms, deleted that insertion in 122 ms and restored it in 290 ms. All reported matching canvases were visible and used the flow path. These are individual diagnostic samples on the existing machine, not distribution estimates, physical-screen measurements, controlled BaKoMa comparisons or universal bounds.

## Final packaged verification

After the inverse-navigation fix, the final 0.98.0 package measured 86, 88 and 140 ms for the 1/4/12-paragraph pastes, then 280 ms for another 32 paragraphs. Deleting/restoring the large insertion took 136/319 ms. The harness required visible flowing output and proved that the large canvas grew taller than the initial PDF page. Ordinary prepared Lecture edits were generally around 54–84 ms in the selected trace; later-page/region transitions and some Document-mode catch-up cases remained slower, including a roughly 1.3-second Document sample. Consistent sub-300 ms behavior across all contexts is not claimed.

Forty-three focused native/compiler/proof/ownership guards and twenty-four related navigation/focus/codec guards passed. The related set includes two new identity/geometry guards for live inverse navigation. Two legacy navigation fixtures were migrated to external storage and rerun successfully there. Nine final packaged suites passed: section flow, region transitions, ordinary typing, typing after twenty seconds idle, PDF pixels, render priority, working modes/export/blank documents/restart/manual Build with hyperref, document tabs, and continuous navigation including both directions inside the section and stale-live-source rejection. The earlier package's failed inverse-navigation extension was fixed before release; its earlier passes were not substituted for the final executable's checks.

A native-only probe completed ordinary multi-paragraph blocks, unnumbered headings and display mathematics in roughly 38–57 ms before this change. Numbered headings were rejected after roughly 22–26 ms, causing slower page/full fallback. The initial Lecture-native prototype rendered numbered headings and labels in roughly 42–59 ms without reading the following content. Compiler-only results exclude transport, proof, rendering and display latency.

## Coverage and remaining limits

A native guard runs with and without hyperref. It checks inherited section numbers, consecutive headings, labels, marks, strict-mode rejection, unsupported-node rejection, a single fragment taller than a normal page, malformed-input recovery, unread suffix/end hooks, and restored full-document text and named destinations/bookmark presence. An initially unresolved-reference fixture could not establish a converged baseline; it was corrected to use a resolved reference before checking isolation of provisional writes. A hyperref prototype exposed incorrect bookmark-write context during private shipout; deferred-write filtering fixes that path.

An extended UI test exposed the old blanket refusal to navigate backward from local output. The current live block now supports preview-to-source navigation only when its root, active file, exact source text, displayed base, source hash and edit identity all match. Native glyph source intervals and nearby finite bounds select the caret; unverified surrounding page strips retain the prior refusal. Pure guards cover stale identities and malformed geometry, and the UI scenario checks both directions inside the new section block and rejection after its source changes.

Floats, footnotes, file open/close nodes, arbitrary specials and other unsupported output still use the existing slower page/full fallback. References to newly added labels and canonical bookmarks need a full Build or Export. After a block changes TeX state, navigation outside that live block can also need a full Build. Moving between previously edited regions can still require broader preparation. Large blocks also cost more to rasterize; this release does not replace the renderer with a fully virtualized document layout.

Other installed TeX Live versions that use a locally prepared matching fast-preview format may need to prepare it again after this compiler update: cached formats remain bound to the compiler's identity. The bundled TeX Live 2025 format keeps its existing format/node-layout compatibility. No new other-machine compatibility matrix is claimed.

## Reproduce

After building, set `PERSISTENT_TEX_SECTION_PASTE=1` for `node scripts/sustained-typing-test.cjs`; also set `PERSISTENT_TEX_SECTION_PASTE_GROW=1` to include the 32-paragraph transaction. `node scripts/lecture-flow-probe.cjs` runs the bounded compiler probe; `PERSISTENT_TEX_LECTURE_FLOW=1` selects its Lecture entry point and `PERSISTENT_TEX_PROBE_HYPERREF=1` loads hyperref. `node --test test/lecture-flow.test.cjs` runs the native guard. The mode/export UI test can load hyperref with `PERSISTENT_TEX_LECTURE_HYPERREF=1`.

Use Kingston or an explicit external test-artifact directory, and set TEMP/TMP there too. Engine builds support an external source/object directory and SDK cache, with one compiler job by default.
