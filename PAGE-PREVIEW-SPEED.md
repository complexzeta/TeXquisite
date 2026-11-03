# Full-resolution page preview performance

TeXquisite 0.128.0 reuses exact unchanged page images between local PDF updates. Page size, text size, magnification and raster resolution are preserved. The saved source and strict Build/Export path are unchanged.

## Matched Windows comparison

Two repetitions in 0.127 / 0.128 / 0.127 / 0.128 order used the same private ten-page lecture, source edits, viewport and actual device pixel ratio of 2.5. Each trial recorded 20 ordinary text edits, 10 equation edits and a 40-character typing burst offered at 100 ms intervals. The source document was not uploaded.

| Delay from edit to completed canvas | 0.127 median | 0.128 median | 0.127 p95 | 0.128 p95 | 0.127 maximum | 0.128 maximum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Text edits (40 per version) | 224.5 ms | 174 ms | 287 ms | 245 ms | 791 ms | 489 ms |
| Equation edits (20 per version) | 209.5 ms | 167.5 ms | 242 ms | 208 ms | 248 ms | 208 ms |
| Sustained typing (80 inputs per version) | 372 ms | 255.5 ms | 479 ms | 369 ms | 506 ms | 399 ms |

The two bursts produced 54 displayed updates in 0.127 and 67 in 0.128. Coalesced inputs are measured to the first displayed frame that includes them, rather than discarded. Repeated insertion/deletion tests can reuse both pages; burst edits use successive distinct source versions and still benefit from reusing the unchanged preceding page.

The preceding page was reused in both final trials: about 0.1-0.2 ms of worker work, versus about 39 ms of rasterization in the matched baseline. The edited final page was freshly rendered. The real attached viewer canvases and the optimized worker output matched a full raster pixel for pixel at the actual viewing scale on both affected pages in all four trials.

## Scope and remaining delays

The endpoint is a completed canvas in a hidden Electron window, not measured physical-screen paint. This small comparison is not a 99.9th-percentile or arbitrary-document guarantee. Host memory and background load vary. All completed trials in this predeclared final comparison are included, including first-edit outliers. Earlier prototypes and incomplete memory-guard trials remain separate diagnostic records; they are not mixed into this final-binary comparison. Post-timing pixel validation releases temporary data between checks to limit the test harness's extra memory use; the timed editing phase does not force garbage collection.

The 300 ms target is still not met consistently: fast typing p95 was 369 ms, and the slowest first edit was 489 ms. Preparation before the first local update remains a useful target. These results do not establish parity with an earlier page size or with BaKoMa.

## Safety and validation

Page identities compare the complete reachable page/resource object graph, including embedded fonts, raw content streams, inherited geometry and exact unresolved resource references. Different fonts, content, geometry, missing-reference numbers or later-resolved resources invalidate reuse. Reference renumbering for resolved objects and unrelated sibling-page changes do not prevent an otherwise exact match. Unsupported rendering/catalog features keep the ordinary renderer.

The worker retains at most eight images and 32 MiB of counted pixel/identity bytes; temporary rendering allocations are separate. Local PDFs larger than 2 MiB bypass identity parsing. Nothing is added to the document on disk.

The exact packaged source is `ce404e48abff267c48ca13c06febf0c5dfa44638`. [Source and packaged verification](https://github.com/complexzeta/TeXquisite/actions/runs/41649731040) passed 95 selected unit/native checks, 19 integration reports and 28 pixel cases. Each pixel case also checks a fresh-document cache lookup against a full render. The tests cover descenders, mathematics, colour, strokes, crop/rotation fallback, native page streams, identity invalidation, memory/entry limits, navigation and automatic error recovery.

[Permanent Windows download and aggregate results](https://github.com/complexzeta/TeXquisite/releases/tag/v0.128.0). The previous [0.127 results](https://github.com/complexzeta/TeXquisite/releases/download/v0.127.0/PAGE-PREVIEW-SPEED.md) remain available separately.
