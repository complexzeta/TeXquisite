# Cached-canvas update: Windows 0.131.0

Unchanged pages can now keep their existing attached canvas during a local PDF update. The worker must first confirm the same exact page/resource bytes and rendering scale. The renderer then avoids allocating, painting and reattaching that page. Fonts, magnification, resolution, saved source, compiler and strict Build/Export behaviour are unchanged.

A detached, cleared, resized, copied or unknown canvas cannot be used as proof of a cached image. Invalidated offers request fresh pixels. Cancelled work does not clear borrowed displayed pages. Cache eviction and unsupported PDFs retain normal rendering. The worker cache remains bounded at eight entries / 32 MiB; the new renderer records use weak references to existing canvas objects.

## Controlled packaged comparison

Four alternating trials used the same **0.131 packaged Windows binary**, with canvas reuse disabled/enabled/disabled/enabled. This is not a released 0.128-versus-0.131 binary comparison. Each trial used an independent synthetic ten-page lecture, 640 x 400 bp paper, fit width, a 1428 x 755 viewport and actual DPR 2.5. The affected band contained pages 8-10; the unchanged preceding pages were eligible for reuse.

| Delay from edit to completed canvas | Reuse off median / p95 / max | Reuse on median / p95 / max |
| --- | --- | --- |
| Plain text, 40 samples each | 122.5 / 166 / 247 ms | 99.5 / 143 / 265 ms |
| Inline math, 20 samples each | 128 / 162 / 165 ms | 94 / 126 / 143 ms |
| Sustained typing, 120 inputs each | 253.5 / 371 / 396 ms | 111 / 137 / 156 ms |

Both alternating pairs improved: sustained medians were 301 -> 111.5 ms and 211 -> 111 ms; text medians were 125.5 -> 101 ms and 118 -> 97.5 ms. First-edit outliers remain included. The isolated text maximum did not improve, despite better median and p95; these samples do not establish a universal bound.

The typing stream offered 60 distinct characters at 100 ms intervals per trial. Coalesced inputs are measured to the first displayed frame that includes them, rather than discarded. Native preparation readiness is explicitly awaited. Source-build trials in the same run are recorded separately in the raw data; they are not pooled into the packaged result.

The endpoint is completion of a canvas in a hidden window, not measured physical-screen paint. The document was synthetic; no private document, preamble or profile was uploaded. Host load and memory vary. This is not a 99.9th-percentile, low-memory, arbitrary-document or BaKoMa-parity guarantee.

## Validation

[Package/source run](https://github.com/complexzeta/TeXquisite/actions/runs/41688947043): 100 selected unit/native checks, 29 bounded integration reports, 28 page-raster/cache pixel cases and 24 comparisons of actual displayed viewer pages against fresh full native rasters. All passed with zero channel differences. Tests include source/PDF navigation on reused pages, typing with an undefined command, automatic repair and error-count clearing, math deletion, status behaviour, fit width and layout changes.

[Supplemental ownership run](https://github.com/complexzeta/TeXquisite/actions/runs/41691370854): seven browser scenarios cover valid reuse, detached or cleared canvases, CSS resize during a pending reply, copied canvases, wrong tokens and worker failure. Invalidated offers request pixels; an injected worker failure retains the displayed page. The supplemental test commit changes no packaged application code.

The [earlier whole-paragraph experiment](CROSS-PAGE-FLOW-EXPERIMENT.md) remains withdrawn. This update keeps the page cache and removes repeated drawing of its already-validated images; it does not enable the slower cross-page paragraph renderer.

[Raw measurements](CACHED-CANVAS-RESULTS.json) · [Permanent Windows download](https://github.com/complexzeta/TeXquisite/releases/tag/v0.131.0).
