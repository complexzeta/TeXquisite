# Retained lecture layout: first architectural experiment

Status: isolated prototype, **not connected to the editor or enabled in 0.111**.
There is no new executable to install. This does not establish a faster installed
application or meet the sustained 300 ms end-to-end target.

The existing optional three-block prototype only carries paragraphs whose
geometry stays neutral. This experiment separates baseline coordinates from
display coordinates so that several independently checked paragraphs can change
height. Unchanged raster strips stay attached; only the active block is repainted.
Following blocks move in browser flow, including when a paragraph grows beyond
a normal page. The immutable layout supplies forward/inverse coordinate mappings.

## What was tested

- Exact RGBA preservation of unchanged strips and neighboring live blocks through
  growth, contraction, revisits, and updates to a second block.
- Attached canvas reuse for ordinary edits; disposal of retired rasters.
- Viewport anchoring inside the page, on a following page, and inside content that
  was deleted. Subpixel scroll rounding is bounded by one physical pixel.
- Rejection of overlapping/changed footprints, malformed dimensions, excessive
  block counts and a display raster exceeding its configured pixel budget.
- Four unit cases, plus the existing 25 focused preview/ink/recovery/queue guards.
- Actual resident pdfTeX output for two editable text paragraphs and one unchanged
  inline-math paragraph. Ten rendered states matched an independently assembled
  raster exactly, including the unchanged math. The large insertion produced a
  1,678-pixel-tall fragment from a 64-pixel baseline.
- A malformed formula followed by correction restored usable native paragraph
  output. This tests native checkpoint recovery, not a new editor error UI.

## Component measurements

One synthetic 88-paragraph `article`/`amsmath` document, initially eight pages,
was compiled by the unchanged 0.111 resident engine. Ten fresh edits alternated
between two prepared paragraph checkpoints. A second resident owner compiled
each corresponding complete source serially. The larger insertion made the
complete document eleven pages.

| Path | Median | Maximum |
| --- | ---: | ---: |
| Eight small edits: native paragraph request plus PDFium raster | 33 ms | 41 ms |
| Ten edits including large insertion and deletion: same component path | 33 ms | 113 ms |
| Corresponding complete native compile plus first-page raster | 164 ms | 634 ms |

These are component experiments, **not a 0.111-versus-new-editor benchmark**.
They exclude initial checkpoint preparation, editor scheduling/IPC, source and
resource ownership checks, baseline pixel proofs, navigation publication and
physical display. Preparation was measured separately; the native renderer and
PDFium behavior were unchanged. Subsequent browser tests replayed these native
rasters to validate the retained compositor; those canvas-only timings must not
be added to the native times and presented as measured editor latency. The toy
80-pixel-wide stress case is correctness coverage, not a realistic typing benchmark.

## Safety and remaining work

`retainedStateCompatible` keeps the existing native character-category,
write-free, table-state and flow-state witnesses, plus width/padding checks. It
allows height changes without treating unchanged downstream state as proved by
appearance alone. Source/resource identity and baseline raster proofs remain the
caller's responsibility. No existing eligibility rule or native compiler was
modified.

The current character witness rejects inline math. Math can remain as unchanged
surrounding raster in this prototype, but editing a math paragraph cannot safely
carry other edited blocks yet. It needs a stronger native state/dependency proof;
a command whitelist would not establish that proof for arbitrary preambles.

The next integration must connect checked native candidates to this compositor,
publish current source identities and glyph maps together, preserve two-way
navigation/Follow/error recovery, and retire the retained frame correctly on a
full build, file switch or zoom. Geometry round trips here are not evidence that
those editor interactions have already been implemented. A mixed-session test
against 0.111 is required before offering a replacement executable. Starting
paragraphs that already cross PDF page boundaries also need an initial pageless
layout policy; this experiment covers growth across a boundary after preparation.

Run `npm run build`, `node --test test/retained-layout.test.cjs`,
`node scripts/retained-native-test.cjs`, and
`node scripts/retained-layout-test.cjs` with the standard external artifact/TEMP
settings. To replay native rasters in the browser test, point
`PERSISTENT_TEX_RETAINED_NATIVE_FIXTURE` to the native run's `fixture.json`.
The browser harness uses an isolated profile alongside its generated entry file.
