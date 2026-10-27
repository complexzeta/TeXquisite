# Architecture

TeXquisite is an Electron desktop app. The main process owns documents, serialized automatic saving, periodic backups, build scheduling, immutable input snapshots and committed preview bundles. The renderer provides a CodeMirror source editor, menus and a PDFium preview.

The resident compiler is modified SwiftLaTeX/pdfTeX in WebAssembly. It reads the selected local TeX installation and project input snapshots. Exact source/context/dependency guards authorize cached checkpoints. Local paragraphs, continuous flow and bounded page ranges require layout/raster proofs before replacing visible output. Full-document verification follows typing pauses; the last successful frame remains visible while edits are incomplete or a build fails.

Native latexmk compilation supports incompatible formats and other engines. Source discovery/builds use isolated working copies and disabled shell escape. Compiler workers and the full build scheduler transfer ownership explicitly to prevent concurrent reuse of mutable state.

The installation checker searches PATH and common Windows locations, supports an explicit folder and verifies executable/package availability. Fast-preview formats are fingerprinted; mismatches use clearly labelled native compilation. Windows with TeX Live is the initial supported test configuration.

The prebuilt resident engine is included for ordinary source builds. Its upstream source archive, modifications, build scripts and compiler license are included; see engine/resident/SOURCE-BUILD.md. Fingerprinted LaTeX format inputs retain their original licenses and headers.

After a full frame is committed, a compatible pending automatic plain-text revision may explicitly claim the newly converged compiler for local preparation. The claim checks exact edit/source, root, engine, executable, source inputs, support folders, mapping mode, generation and exclusive idle ownership. It never consumes manual builds. Local preparation and visual proof still precede display; unsupported edits retain full-build fallback. Continuous page geometry is resolved before acknowledging a full frame, avoiding an additional background geometry request before its canvas can be attached.

Full-frame preparation can carry a transient display-focus hint derived from that frame's captured source and navigation. Continuous Follow typing may use it to select and reveal the frame's actual source page while newer typing continues on the same physical line. The frame source identity, source prefix before that line, bounded cursor-column distance and output-bearing source line are checked again before revealing. The hint never changes source-map hashes, authorizes editing, permits stale source/PDF navigation or bypasses a local proof. Different files/lines, changed prefixes and footer/end-document targets are rejected.
