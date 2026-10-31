# TeXquisite

A standalone LaTeX editor with source and compiled preview side by side. It saves automatically, updates the preview while you type, and keeps the last successful output visible during incomplete edits.

## Download and try it

**Early Windows x64 test release:** [Download TeXquisite 0.100.0](https://github.com/complexzeta/TeXquisite/releases/download/v0.100.0/TeXquisite-0.100.0-Windows.exe).

1. Install TeX Live separately, including latexmk. TeXquisite does not bundle a full TeX distribution.
2. Run the portable executable; no VS Code, Node.js or account is required to use it.
3. In the first-run Build Settings check, confirm the detected TeX installation, or choose its installation/executable folder. Apply the settings.
4. Open a .tex file, or choose the built-in mathematical example.

[First-run guide](FIRST-RUN.md) · [Releases and checksums](https://github.com/complexzeta/TeXquisite/releases) · [Interactive latency results](LATENCY-RESULTS.md) · [Report a problem](https://github.com/complexzeta/TeXquisite/issues)

## Features

- Automatic saving and live preview, with a retained last-good PDF.
- Lecture mode keeps local editing ready across pauses; Document mode automatically verifies the full document while idle.
- Supported Lecture-mode section edits use flowing blocks that can grow past PDF page boundaries. Numbered headings and labels, including standard hyperref headings, can avoid page-rendering fallback; auxiliary/bookmark writes wait for a full Build or Export.
- Continuous scroll and paged views; source/PDF navigation and Follow typing.
- Resizable source/output panels, horizontal or vertical arrangement, fit-width zoom.
- Optional matching delimiters and environments, image paste, project search and source backups.
- Persistent pdfTeX state and guarded local preview updates for supported edits.
- Compatible queued plain-text edits can switch to local preparation after a full preview, avoiding repeated full builds while typing.
- Reuses loaded packages across reference/bookmark convergence passes when the pre-auxiliary state and its inputs are unchanged.
- Unresolved cross-references retain their warnings without forcing repeated native builds once auxiliary files have stabilized.
- Native compilation for XeLaTeX, LuaLaTeX, PostScript workflows and incompatible fast-preview formats.

## Current limits

This is a public test build, not a finished replacement for every TeX workflow. Windows with TeX Live is the initial supported setup. MiKTeX native compilation is experimental; macOS and Linux application packages are not provided.

Fast preview uses either the bundled TeX Live 2025 format or a matching format prepared locally from an indexed TeX Live installation. Settings offers **Prepare matching fast preview** when needed. Preparation is optional, can take a couple of minutes once, and is cached across restarts with compiler/input integrity checks. Unsupported kernels can continue using native compilation with a visible explanation; updates may be slower. First loads, changed preambles, page-layout changes and complicated TikZ diagrams can take longer than small warm edits. No universal per-keystroke latency is promised.

The 0.85.0 portable passed clean Windows Server 2022/2025 smoke tests with TeX Live 2024, 2025 and 2026. See the [compatibility results and limits](https://github.com/complexzeta/TeXquisite/blob/main/COMPATIBILITY-RESULTS.md).

The Windows executable is an unsigned test build. Use the release checksum to identify the published file.

Choose **Build → Working mode** or the small mode selector in the preview toolbar. Lecture mode defers idle full-document verification after successful local edits, preserving the interactive formatter for the next edit. Continuous scroll is recommended for lectures. Edits requiring a broader build still compile automatically; first loads, preamble changes and complex diagrams can remain slower. Build explicitly verifies the full document, and Export PDF builds and verifies current source before exporting in either mode. A successful local preview is not a promise that pagination or references throughout the document are current. Document mode is the default and resumes automatic full-document checks after a pause. Both modes keep the same saving and backup behavior.

When TeXquisite can safely render a temporary repair, it keeps navigation mappings for unchanged source lines. A permanent bottom status bar shows the number of reported errors in red and updates automatically as errors are corrected. Its compact message offers **Go to error**, **Check now** and **Details** on demand; hover for the full explanation, or open Problems for spelling, delimiter or package advice. Errors do not open a panel or cover or resize the document. Scrolling through blank space does not request navigation. View's **Show preview timing details** option controls only the optional timing text; the error bar remains visible. Suggestions never edit your source automatically. If repair is unsafe, the previous output remains visible; verified export still requires a successful complete build.

An empty literal document body, including a comments-only body, produces one blank page. The placeholder is added only to the compilation copy; it never changes the editor or saved source.

For an unexpectedly slow update, choose **Build > Copy performance report** immediately afterward. This copies a bounded timing/routing and memory summary, excluding source text, file paths and compiler logs. It separates local preview acknowledgements from full-document verification; these are renderer timings, not a measurement of the physical screen. Nothing is uploaded automatically.

## Files and privacy

Documents remain ordinary local TeX files. The app creates local drafts, previews and periodic source backups. No account is required and no source or diagnostic is uploaded automatically. Native builds disable shell escape and latexmk configuration files. Local compilation is not a security sandbox for untrusted TeX documents.

## Build from source

Windows development was tested with Node.js 24 and npm. Install TeX separately to run compilation/integration tests.

~~~powershell
npm ci
npm run build
npm start
~~~

The repository includes the prebuilt resident engine, its original upstream source archive, modifications and [engine build instructions](engine/resident/SOURCE-BUILD.md). Rebuilding that engine is optional for ordinary application development and requires the documented Emscripten toolchain.

A small test set needs no installed TeX:

~~~powershell
npm run build
node --test test/toolchain.test.cjs test/footer-navigation.test.cjs test/flow-navigation.test.cjs
~~~

Integration tests require installed TeX and write disposable artifacts. Set PERSISTENT_TEX_TEST_ARTIFACTS and process-local TEMP/TMP to a suitable directory when running a large campaign. Do not commit documents, profiles, generated PDFs, caches or test output.

Run the bounded reliability campaign with `npm run test:reliability`. It checks saving/conflicts, backups, diagnostics, tab selection, closing/recovery and a 24-cycle diagram/math session in a spaced and accented path.

On Windows it uses Kingston when present and refuses an automatic system-drive fallback; set `PERSISTENT_TEX_TEST_ARTIFACTS` explicitly for another location or CI. Child temporary files stay in the campaign too. Successful fixtures are removed after reports are copied and verified; failed fixtures are kept for diagnosis.

`node scripts/reliability-test.cjs --only=units,backups` runs selected checks after building. Set `PERSISTENT_TEX_EXECUTABLE` to test an extracted portable instead of the development runtime.

The [0.96 reliability results](https://github.com/complexzeta/TeXquisite/blob/main/RELIABILITY-RESULTS.md) describe the checks and their limits.

## License and source

TeXquisite application code is licensed under [AGPL-3.0-only](LICENSE). Third-party components retain their respective licenses; see [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt). The modified SwiftLaTeX/pdfTeX compiler is accompanied by its upstream source, patch/build scripts and license. Corresponding source for each downloadable version is available from the matching Git tag and the source archives on its release page.
