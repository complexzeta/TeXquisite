# Section paste investigation — 0.97.0

A section-sized paste can require substantially more work than ordinary warm typing. Continuous flow first tries to update a prepared region. A section heading or changed output state can require page output instead; if the affected page span changes without a proved continuation, the local result is rejected and a full document build is required.

The rejected-layout path previously stopped its compiler. It now retires the local preview and offers the healthy warm compiler back through the controller's existing ownership checks. Manual builds, immutable source capture, project-input validation, page proofs and full-document verification keep their existing requirements. A stopped or busy compiler cannot be reclaimed through those checks.

## Initial measurements

An isolated article used amsmath, forty existing prose paragraphs with inline mathematics, and real clipboard paste events inserting a heading plus 1, 4 or 12 paragraphs. Continuous scroll and Lecture mode were enabled, at device scale 2.5. The harness observes matching source hashes on rendered canvases; this measures browser presentation, not physical display latency or a controlled BaKoMa comparison.

| Paragraphs pasted | Original path | Warm fallback fix |
| --- | ---: | ---: |
| 1 | 2171 ms | 948 ms |
| 4 | 9301 ms | 705 ms |
| 12 | 1587 ms | 346 ms |

These are individual diagnostic samples, not distribution estimates. The four-paragraph case demonstrably discarded its worker and spent about 8.2 seconds in compilation after fallback; with the fix, no cold preamble initialization was reported for that case. The other samples also vary with machine load and preparation state and must not all be attributed to this one change.

A separate experiment routed substantial multi-paragraph transactions directly to full compilation. It measured 1113, 1862 and 1407 ms for the same sizes, so that routing change was removed. It is not in this release.

## Packaged build verification

The final 0.97.0 packaged runtime passed the extended scenario with visible matching canvases: 1389, 1024 and 531 ms for the three paste sizes, then 137 ms to delete the last pasted section and 130 ms to restore it. The four-paragraph paste used full compilation without cold preamble initialization. These are another five individual samples; they demonstrate both the remaining paste delay and faster reuse during deletion/restoration, not a universal latency bound.

Forty-two focused guards passed serially, covering compiler handoff, native timeout recovery, invalidated project inputs, paragraph/raster verification and standby ownership. During earlier overlapping package/guard work, two tests exceeded their outer time budgets; they passed when repeated serially. The recovery fixtures now allow additional outer setup time for two cold compiler initializations without changing the application's local request deadlines. A new regression guard rejects a local result, verifies the compiler is returned before requesting fallback, and compiles successfully on that same worker.

Nine packaged application checks passed: section paste/delete/restore, region transitions, ordinary typing, typing after a twenty-second idle, PDF pixels, render priority, working modes/export/blank documents/restart/manual Build, document tabs, and continuous navigation. The final three checks were completed after a user-requested pause; the interrupted run was not counted as a pass. This is bounded functional coverage on the existing Windows/TeX Live setup, not a new machine compatibility matrix or proof of a latency guarantee.

## Remaining costs

Section edits can still require original-page raster verification, pagination recalculation, auxiliary-file convergence and full PDF rendering. This release does not implement general incremental TeX state promotion or promise instant arbitrary section edits. The existing 300 ms small-edit target remains unmet for broader layout transitions.

## Reproduce

After `npm run build`, set `PERSISTENT_TEX_SECTION_PASTE=1` and run `node scripts/sustained-typing-test.cjs`. The bounded scenario pastes three sections, deletes the last pasted section and restores it. `PERSISTENT_TEX_PROFILE=1` includes compiler-stage logs. `PERSISTENT_TEX_EXECUTABLE` selects an extracted portable build; otherwise the development runtime is used.

Generated projects and profiles use the shared test-artifact helper. Use Kingston or an explicit external `PERSISTENT_TEX_TEST_ARTIFACTS` directory and put TEMP/TMP there as well. Reports contain source hashes, not document text.
