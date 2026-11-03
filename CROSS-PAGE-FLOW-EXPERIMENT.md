# Cross-page paragraph flow experiment

This is an unreleased experiment. The installed and published Windows version remains 0.128.0 until packaged validation and a repeatable performance comparison justify a change.

The candidate lets a single paragraph span two or three old pages in Lecture + Continuous scroll. It renders the native unpaginated paragraph between immutable prefix and suffix strips. Build and Export retain the canonical paginated PDF.

Preparation requires unique source anchors, supported page geometry, complete fragment ink bounds, and independently rendered baseline checks for every affected page. The removed margins must contain only opaque white pixels outside the proved paragraph. Footers, headers, footnotes and other unowned ink retain the page-rendering fallback.

For long paragraphs, a line-based raster proof is available only after independent PDF glyph geometry and vector outlines cover every old glyph intersecting the footprint. Its lines must form a contiguous partition with bounded height and count. Each line is partitioned into cells no larger than 4 bp by 2 bp, with at most 64 changed pixels per cell and at most 65,536 cells per page, while retaining the ordinary dark-core, stroke and coverage checks. Every changed pixel must additionally be opaque grayscale, differ by at most 32 levels, and lie within an independently matched vector glyph; non-text drawing must remain byte-identical. This changes the scope of the difference-count budget from one long paragraph to independently checked cells; it does not require byte-identical antialiasing. Incomplete vector coverage continues to use the ordinary proof or the page fallback.

Cloud tests use only a synthetic 10-page lecture at DPR 2.5 and fit width. Four alternating trials compare the same source build with the new path disabled and enabled. They record isolated text and math edits, a 60-character stream at 10 characters/second, automatic typo recovery, and bidirectional navigation. A separate fixture with page numbers must retain page rendering. Browser tests independently check surrounding pixels, scroll position, resizing, canvas reuse and retirement.

The measured endpoint is completion of a hidden browser canvas, not physical-screen latency. These samples cannot establish a 99.9th-percentile bound, behaviour on a low-memory computer, or equivalence to BaKoMa. No private document, preamble or profile is uploaded.
