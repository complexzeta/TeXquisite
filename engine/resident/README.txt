Modified SwiftLaTeX/pdfTeX compiler. Upstream source and license accompany this binary.
Checkpoint additions are reproduced by scripts/patch-checkpoint-engine.mjs and scripts/build-checkpoint-engine.mjs using Emscripten 3.1.46.
The bundled format was generated from the locally installed TeX Live 2025 files; format.json records compatibility fingerprints.
Application and worker sources are included under src/. The compiler runs offline with read-only TeX resources.
