# Interactive latency check — 28 October 2026

The application remains **0.100.0**. This pass adds a repeatable benchmark; it does not ship a new executable or change the renderer.

## Current results

The final run used an isolated copy of a four-page partial manuscript with a substantial mathematical preamble and custom support styles on the existing Windows/TeX Live 2025 setup. The original document was unchanged. Lecture mode and Continuous scroll were enabled, with fit-width scale about 1.47549 and device pixel ratio 2.5; the existing user application remained open. These are individual hidden-window canvas/viewport observations, not physical-screen measurements, distributions, or BaKoMa comparisons.

| Action | First matching revision in the preview viewport | Maximum age of a displayed revision |
| --- | ---: | ---: |
| First word in a prepared paragraph | 89 ms | 89 ms |
| Undo that word | 67 ms | 67 ms |
| Typing after a three-second pause | 55 ms | 66 ms |
| Move away from an edited paragraph and type immediately | 631 ms | 631 ms |
| Move to another paragraph and type immediately | 528 ms | 249 ms |
| Create a paragraph and type | 71 ms | 71 ms |
| Delete text | 54 ms | 60 ms |
| Restore text | 56 ms | 58 ms |
| Paste a section with four short paragraphs | 63 ms | 63 ms |
| Delete that section | 54 ms | 54 ms |
| Restore that section | 59 ms | 59 ms |

Input starts at the editor mutation. A live canvas is identified by its current local revision, never its retained baseline hash. Viewport visibility is tracked separately from canvas creation, including canvases that become visible after scrolling. The second move coalesced several keystrokes before showing its first revision; its 249 ms revision age is distinct from the 528 ms wait from the first keystroke.

Ten checks compared unchanged leading-strip pixels of displayed flowing blocks with the accepted PDF raster. All were byte-identical. Automatic saving passed, and the test restored its private source copy. These checks cover neighboring ink around the exercised blocks, rather than every possible layout.

Earlier controls had paragraph-move waits of roughly 0.6–0.8 s to a canvas. Cache state, machine load and preparation timing vary. **The target of consistently less than 300 ms remains unmet.**

## Remaining bottleneck and withheld experiment

Leaving an edited block can require a complete baseline refresh before another block can be prepared safely. One measured refresh spent about 418 ms compiling, 61 ms capturing inputs and 130 ms storing/rendering, plus commit overhead. A second transition waited for local compiler and raster preparation. Edits within a prepared block were substantially faster.

A renderer experiment compared the displayed tile directly with accepted pixels to avoid an additional full composed-page raster. Its conservative variant allowed the shortcut only for byte-identical pixels and retained the original full proof for every difference. Sixteen focused raster, ink, cache and experimental guards passed; the private-document run retained all ten neighboring-pixel checks. A control used the same development runtime with the released renderer; main process, compiler worker and PDF worker bytes were identical.

Some internal preparation work decreased, but first-update latency after paragraph moves did not improve reliably across controls. The experiment was withheld and the released source/runtime restored. Substantial further improvement requires work on transitions between edited blocks while preserving displayed edits and correct compiler context.

## Repeating a private-document probe

`scripts/document-latency-test.cjs` requires `PERSISTENT_TEX_DOCUMENT_PROBE` to name a UTF-8 JSON file in a dedicated private campaign directory with these fields:

- `root`: absolute path to a writable **copy** of the document inside that campaign directory, with its local support files.
- `settings`: a private copy of the application's session JSON for engine, support-folder and view preferences.
- `original`: original document path, used only for a final hash check.
- `originalHash`: original file's lowercase SHA-256 hash.

The harness refuses to use the original file as its writable project. The copy must contain three distinct ordinary paragraphs and a literal document start. It creates a separate Electron profile through the artifact helper. Set process-local `TEMP`, `TMP` and `PERSISTENT_TEX_TEST_ARTIFACTS` to Kingston directories. `PERSISTENT_TEX_EXECUTABLE` optionally selects an existing unpacked application; otherwise it tests the development build. `PERSISTENT_TEX_PROFILE=1` adds build timing details.

Run `node scripts/document-latency-test.cjs`. Results and logs stay in the private artifact directory and can contain private paths and diagnostics. Do not commit them, the project, or the session to a public repository. Retain small reports and remove closed disposable profiles afterward.
