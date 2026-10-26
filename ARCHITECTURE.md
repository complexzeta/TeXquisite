# Architecture

TeXquisite is an Electron desktop app. The main process owns documents, serialized automatic saving, periodic backups, build scheduling, immutable input snapshots and committed preview bundles. The renderer provides a CodeMirror source editor, menus and a PDFium preview.

The resident compiler is modified SwiftLaTeX/pdfTeX in WebAssembly. It reads the selected local TeX installation and project input snapshots. Exact source/context/dependency guards authorize cached checkpoints. Local paragraphs, continuous flow and bounded page ranges require layout/raster proofs before replacing visible output. Full-document verification follows typing pauses; the last successful frame remains visible while edits are incomplete or a build fails.

Native latexmk compilation supports incompatible formats and other engines. Source discovery/builds use isolated working copies and disabled shell escape. Compiler workers and the full build scheduler transfer ownership explicitly to prevent concurrent reuse of mutable state.

The installation checker searches PATH and common Windows locations, supports an explicit folder and verifies executable/package availability. Fast-preview formats are fingerprinted; mismatches use clearly labelled native compilation. Windows with TeX Live is the initial supported test configuration.

The prebuilt resident engine is included for ordinary source builds. Its upstream source archive, modifications, build scripts and compiler license are included; see engine/resident/SOURCE-BUILD.md. Fingerprinted LaTeX format inputs retain their original licenses and headers.
