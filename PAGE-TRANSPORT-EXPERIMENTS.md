# Page transport experiments: no new release

The recommended Windows build remains **0.128.0**. Two page-transport prototypes passed functional and pixel checks but did not demonstrate a dependable sustained-typing improvement. Their application changes were withdrawn. No 0.129 release was published and the installed application was left unchanged.

## Controlled cloud tests

The independent synthetic lecture uses a 640 x 400 bp page, ordinary text and inline mathematics, actual device pixel ratio 2.5, fit width and alternating 0.128 / candidate / 0.128 / candidate trials on Windows 2025. Its affected range includes three images (pages 8-10), each 3410 x 2131 pixels. No private lecture source was uploaded.

Each trial records 20 text edits, 10 equation edits and 60 distinct typing inputs at 100 ms intervals. Every input is measured to the first displayed frame that includes it, including coalesced inputs. Initial document building and local preparation are completed before timed edits. The endpoint is a completed canvas in a hidden window, not physical-screen paint. This small experiment does not establish 99.9th-percentile bounds or performance on another machine.

## Whole-band response: rejected

The first prototype loaded and rendered all affected pages in one worker request, returning the images together. This reduced round trips but removed useful overlap between rendering and viewer composition.

| Burst median by trial | Baseline 0.128 | Whole-band prototype |
| --- | ---: | ---: |
| First comparison | 191.5 ms | 310 ms |
| Second comparison | 129 ms | 297 ms |

The baseline displayed 59 and 60 updates during the bursts; the prototype displayed 53 and 55. [Comparison run](https://github.com/complexzeta/TeXquisite/actions/runs/41659084979), [prototype source](https://github.com/complexzeta/TeXquisite/commit/d6044a2a733c32f29992cc4eb86e1c8a5e185ce8). Its installer was withheld and local copies removed.

## Streamed response: no convincing sustained improvement

The second prototype kept the native work together but sent each page as soon as it was ready, restoring overlap with viewer composition. Four additional tests checked early delivery, closing, failure and incomplete streams.

| Pooled timings | Baseline 0.128 median | Streamed prototype median | Baseline p95 | Streamed p95 |
| --- | ---: | ---: | ---: | ---: |
| Text (40 inputs per version) | 140 ms | 125 ms | 204 ms | 154 ms |
| Equation (20 inputs per version) | 141 ms | 126 ms | 206 ms | 179 ms |
| Burst (120 inputs per version) | 287.5 ms | 290.5 ms | 371 ms | 375 ms |

The isolated-edit change was not consistent between repetitions: text medians were 150 -> 125.5 ms in the first pair and 124 -> 124 ms in the second. Burst medians were 328 -> 317 ms and 249 -> 271.5 ms. Burst updates were 107 versus 108 overall. These results do not justify promoting the prototype.

[Streamed comparison](https://github.com/complexzeta/TeXquisite/actions/runs/41662692008), [fixture and download pins](https://github.com/complexzeta/TeXquisite/commit/c99da3230bb7f12d0be489b05964b1b67254b0a4), [tested application source](https://github.com/complexzeta/TeXquisite/commit/d10652e9cc2692f22cbe4a68fef523d0e5342d8a). The exact prototype passed [102 selected checks, 19 integration reports and 28 pixel cases](https://github.com/complexzeta/TeXquisite/actions/runs/41661130981), including streamed-versus-full-render parity. Functional success was not treated as a performance success. [Aggregate results](PAGE-TRANSPORT-RESULTS.json) preserve the measurements. Unreleased Actions binaries and raw diagnostic reports have limited retention; source commits and this summary remain available.

## Measurement-control correction

The old Playwright readiness helper supplied an asynchronous predicate to waitForFunction. The installed implementation treated its returned Promise as truthy and could finish before the query resolved false. The corrected helper explicitly awaits each query and polls false results. Tests cover false results, timeouts and rejected queries.

Historical edit-to-canvas timestamps remain real, but some first inputs began before local preparation completed. They must not be described as guaranteed warm edits or directly compared with this newly prepared synthetic fixture. The 0.128 release body and its source report include this qualification. The corrected controls remain in the test tools even though both transport prototypes were withdrawn.

## Larger remaining target

Earlier local profiling showed a paragraph crossing page boundaries being rejected by the fast paragraph compositor, requiring page-level output instead. Extending the pageless lecture path to that case is a more substantial opportunity than rearranging PDF messages. It needs layout, mathematical-content and navigation proofs. Source-only result caching also needs careful tracking of TeX state and dependencies for arbitrary preambles; it was not introduced by these experiments.
