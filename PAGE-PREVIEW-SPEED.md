# Full-resolution page previews: 0.127.0

Small edits in a large-magnification lecture could spend more time copying and displaying two page images than typesetting the edited text. Version 0.127 reduces that work while preserving page size, magnification and native pixel density.

## Changes

For eligible pages, the PDF worker transfers a full-resolution image of the content area instead of a full-page image containing empty margins. The viewer composes that image at its exact integer position on the original full-size white page. Images, forms, annotations, unsupported fonts and nonstandard/rotated page boxes retain the existing renderer. Bounds include mathematical rules and strokes. Native PDFium page coordinates remain unchanged: translating the native bitmap caused tiny rounding differences on fractional-size pages and is not used.

Affected-page previews also reuse compression of identical PDF streams at the requested compression level. The existing cache owns its input bytes, checks equality after hashing, and is bounded to 8 MiB/128 entries. Baseline proofs and full builds/exports keep their existing compression path. Saved TeX is unchanged.

This is not arbitrary incremental TeX reflow. Both affected pages can still be processed. The optimization reduces empty-margin copying/transfer and repeated stream compression; it does not lower preview resolution or introduce a blurred draft phase.

## Verification

The exact packaged Windows build at `38b3559b6fc9e6816e11253339c7a1ebcd937bbb` passed [source and package verification](https://github.com/complexzeta/TeXquisite/actions/runs/41585273364): 90 selected unit/native checks and 19 integration/package reports. There were 28 exact-pixel cases across source and packaged runs, including italic descenders, mathematics, colours, thick strokes, fractional page dimensions, compression reuse, and rotated/cropped-page fallbacks. Cached and uncached page navigation was also compared.

Additional local checks compared both affected pages of the private lecture against full native renders at the actual display scale. The attached viewer canvases also matched exactly. The private document, profile and raw diagnostic logs were not uploaded.

## Measured performance

Measurements use a private copy of a ten-page lecture at 250% display scaling and Fit width. Text tests insert/delete one letter near the end; equation tests change/restore one number. A separate burst offers 40 edits at 100 ms intervals without waiting for previews. Burst latency includes coalescing: each input waits for a displayed revision at least as new as itself.

Two fresh matched pairs were run in baseline/candidate/baseline/candidate order: 280 input events total. Initial full-document compilation/preparation is excluded, but the first edit after local-ready is included. Available memory and machine load varied, so these are observed local comparisons, not a hardware-controlled guarantee.

| Pooled measurement | 0.126 | 0.127 |
| --- | ---: | ---: |
| Text edit median (40 edits/version) | 310 ms | 217 ms |
| Equation edit median (20 edits/version) | 300 ms | 203 ms |
| Text edit p95 | 461 ms | 302 ms |
| Equation edit p95 | 425 ms | 229 ms |
| Text edit worst | 630 ms | 916 ms |
| Equation edit worst | 441 ms | 246 ms |
| Typing-burst median (80 inputs/version) | 623 ms | 441 ms |
| Typing-burst p95 | 978 ms | 563 ms |
| Typing-burst worst | 1,178 ms | 580 ms |
| Canvas updates during the two bursts | 36 | 48 |

Run medians also varied: baseline text 380/254 ms versus candidate 245/206 ms; baseline equations 344/247 ms versus candidate 211/196 ms. The first edit in one candidate run took 916 ms, worse than the baseline maximum. It is retained in the pooled statistics. Subsequent isolated edits in that run were at most 241 ms for text and 227 ms for equations.

These are hidden-window completed-canvas measurements, not physical-display measurements or a 99.9th-percentile guarantee. The earlier recorded lecture-session timings and earlier isolated runs had different conditions; they are not substituted for this fresh paired baseline. **The 300 ms target is still not met for every edit**, particularly first edits and sustained typing. The release includes a sanitized result summary; private source, hashes identifying the document, profile paths and raw logs are excluded.
