# TeXquisite 0.133: first-line preview updates

This update avoids repeating preamble setup when edited body text shares the
physical line containing `\begin{document}`. It does not accelerate every edit.
Ordinary following-line text was already fast in the controlled native tests.

The compiler verifies its actual input buffer and every consumed source byte
before retaining this checkpoint. It rereads only the remaining physical line,
preserving the consumed position and the original line's end character. Real
preamble changes still invalidate the checkpoint. Unsupported or ambiguous
states retain the normal rebuild path; saved source is unchanged.

The shortcut is enabled by default in 0.133. For controlled comparisons or
troubleshooting, `PERSISTENT_TEX_PREAMBLE_READAHEAD=0` disables it.

## Ten-page edit-to-preview results

The [packaged regression run](https://github.com/complexzeta/TeXquisite/actions/runs/41728950972)
tested binary source `986eaf33ef33ef530ec6b7ced811a602795adb35` with an isolated
TeX Live 2026 installation. The synthetic lecture has ten explicitly separated
640 by 400 bp pages, six common packages, and first-paragraph text directly
after `\begin{document}` on the same line. Word insertion and undo preserve a
fixed document size across eight cycles per trial.

The same binary alternates disabled/enabled/disabled/enabled, with a fresh
synthetic profile for each trial. Each source-app and packaged-app trial has
16 measured frames. All 128 frames matched the expected complete-source hash;
autosaved text returned exactly to the original. The preview contained ten pages.

| Packaged trial | Median edit to completed canvas | Maximum |
| --- | ---: | ---: |
| Disabled 1 | 479.8 ms | 548.3 ms |
| Enabled 1 | 98.4 ms | 125.2 ms |
| Disabled 2 | 463.7 ms | 491.4 ms |
| Enabled 2 | 102.4 ms | 125.5 ms |

Source-app medians were 501.6/467.9 ms disabled and 98.6/100.1 ms enabled.
Each variant still produced 16 full-document commits per trial. This improves
the full-update fallback; it does not introduce a different partial renderer.

These are completed hidden-canvas measurements on Windows cloud runners,
not physical display paint, private-document measurements, or a three-hour soak.
The small correlated sample does not establish a 99.9th-percentile guarantee.
Other full-build and local-preparation delays remain possible.

## Regression and compatibility checks

The release package passed 107 unit/native checks and 65 integration reports.
The audit verified 28 sparse-raster cases, 24 cached-canvas viewer pixel cases,
32 paragraph viewer/full-build pixel comparisons, and the ten-page measurements.
It also checked automatic error recovery, correction of the error counter,
continued editing with errors elsewhere, two-way navigation, saved source,
strict export behavior, quiet status messages, and settings persistence.

The [compatibility matrix](https://github.com/complexzeta/TeXquisite/actions/runs/41729831693)
passed TeX Live 2024, 2025, and 2026 on Windows 2025. Each installation generated
and validated a matching format, passed 158 exact native pixel/text/geometry
comparisons, and tested the packaged app's editing, automatic saving, and restart.
Additional native fixtures cover math, package-defined formatting, and TikZ.

MiKTeX passed native compilation and source/packaged application checks on
Windows 2022 and Windows 2025. Its tests cover automatic/manual installation
selection, ordinary text and TikZ, second-page navigation, missing packages,
nonmodal errors, automatic correction, protected export, and restart.
**MiKTeX still uses native compilation; this release does not enable persistent
local lecture preview for MiKTeX or promise its TeX Live editing times.**

The compatibility workflow's Electron-installation repair changes only test
workflows. Its validation source is recorded separately from the exact binary
source. The [exact-portable Windows 2022 check](https://github.com/complexzeta/TeXquisite/actions/runs/41732236186)
compared all 1,184 packaged files. Only five generated logo assets differed
between the independently rebuilt Windows 2022 package and the release runtime;
application code and compiler files matched. The exact release executable was
then checksum-verified and passed the MiKTeX application checks on Windows 2022.
The numeric report records both package hashes and the differing asset names;
byte-reproducible logo generation across Windows images is not claimed.

## Provenance and limits

The rebuilt compiler uses the same corresponding upstream source and guarded
native patches as the earlier experiment. Its native build source is
`eb0d9aefaf36cd025d10fdd33b1d1fafa4ef6e79`; the shipped runtime source is the
separate binary-source commit above. Compiler hashes, SDK version, upstream
archive hash, validation runs, and package checksums are recorded in the release
provenance and [numeric results](READ-AHEAD-RELEASE-RESULTS.json).

Consumed preamble changes, begin-document macros, line-number-sensitive text,
changed end-line characters, references, temporary undefined commands, unmatched
math, and local page output are covered. Transformed consumed `^^` input declines
the shortcut. Source/dependency/auxiliary integrity checks remain in force.
Compiler changes invalidate incompatible prepared-format caches. First loads,
real preamble changes, large diagrams, and unsupported workflows can still take
longer than small warm edits.

Windows downloads remain unsigned public test builds. Mac and Linux downloads
remain the separate 0.123 previews; this Windows release does not replace them.
