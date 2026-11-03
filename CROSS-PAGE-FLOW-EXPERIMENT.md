# Cross-page paragraph flow: tested and withdrawn

The cross-page prototype passed its functional tests but made typing slower. It was **not released or installed**. The production source was restored, and the installed Windows version remains 0.128.0.

A synthetic 10-page lecture used 640 x 400 bp paper, fit width, actual DPR 2.5, and one long paragraph crossing pages 9 and 10. Four alternating trials compared the same source build with cross-page flow disabled/enabled/disabled/enabled. Both configurations had the same window, document, TeX installation and test harness.

| Edit type | Control median / p95 | Prototype median / p95 |
| --- | --- | --- |
| Plain text, 40 samples each | 110.5 / 161 ms | 140 / 174 ms |
| Inline math, 20 samples each | 114 / 134 ms | 138 / 159 ms |
| Sustained typing, 120 inputs each | 202.5 / 293 ms | 331 / 400 ms |

Additional preparation waits after the initial document canvas and cursor request were 15/23 ms for the controls and 767/377 ms for the prototype. These waits are not complete fresh-build timings. Sustained-typing maxima were 350 ms for the control and 416 ms for the prototype. The isolated text maximum was lower in the prototype, but that small sample is not evidence of a reliable tail-latency improvement.

These are hidden completed-canvas measurements on a cloud runner. They do not establish physical-screen latency, behaviour under low memory, a 99.9th-percentile bound, or performance on a private lecture. No private source, preamble or profile was uploaded.

The prototype compiled from the saved paragraph prefix, placed a checked whole native paragraph bitmap between immutable surrounding strips, and retained source mappings for all three pieces. Its compiler was faster: one sampled final-restoration frame went from about 32 ms to 15 ms. However, the existing page renderer already reused the unchanged early pages. Repainting the entire long paragraph lost that advantage; the prototype's sampled display work was about 115 ms. This experiment therefore does not justify switching the current preview to whole-paragraph rendering.

The [passing cloud run](https://github.com/complexzeta/TeXquisite/actions/runs/41681032646) completed 106 selected unit/native checks and 17 bounded reports. Checks included surrounding-strip pixels, scrolling, resizing, canvas reuse/disposal, automatic undefined-command repair and counter clearing, bidirectional navigation, inline math and a page-footer fallback. This is functional evidence, not a claim of bitwise equality between the provisional paragraph and a canonical paginated PDF.

The [experimental source commit](https://github.com/complexzeta/TeXquisite/commit/4530dc4a9c49ca5518f6b789b87bdb440fee902d) preserves the implementation and reproducible synthetic harness. Intermediate attempts exposed fractional raster-boundary handling, accumulated antialiasing differences, an irrelevant page-crop transport check, and ligature outline lookup. The final prototype still regressed performance. None of those experimental runtime changes remains enabled in production.

The next substantial direction is reuse below the page level: retain unchanged lines or independently identified scene regions within a paragraph. That requires a reliable identity for their complete typesetting state, fonts, glue, rules and side effects. Equal source text alone is insufficient. A new benchmark should include first-edit preparation, changes near the beginning and end, wrapping/deletion/restoration, temporary errors, and native pixels and navigation before promoting such a renderer.

[Raw synthetic measurements and scope](CROSS-PAGE-FLOW-RESULTS.json).
