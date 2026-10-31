# Recovery navigation and actionable error handling

Version 0.113 addresses a recoverable LaTeX error disabling source navigation
throughout a preview. A temporary repair must remain visibly approximate, but
need not discard every mapping from the actual rendered compilation.

## Changes

- Recovered resident previews retain mappings only for exactly unchanged source
  lines. Source identity still matches the current unmodified editor text.
  Repaired lines and their rendered bounds are excluded from nearest-neighbor
  navigation; offsets after length-changing repairs are projected explicitly.
- Local recovery filters glyph positions through the same source correspondence
  and retains valid mappings instead of deleting them all. Original source,
  frame identities and finite geometry remain required.
- Unmapped or repaired clicks explain their restriction rather than silently
  doing nothing. A compact notice offers Go to error, Retry preview and Details,
  even when the status bar is hidden. It overlays the output without resizing
  the source editor or moving its caret automatically.
- Problems now includes repair advice. A unique close spelling of a standard
  command can be suggested, for example intt to int; ambiguous alternatives are
  not guessed. Suggestions never edit the manuscript automatically.
- A healthy local result no longer clears an existing diagnostic optimistically.
  A bounded full recheck after a typing pause confirms recovery. The idle delay
  is not a debounce before displaying local typing updates.
- Direct PDF editing remains unavailable for approximate output, with an explicit
  explanation. The source editor remains usable. Verified export still requires
  a successful complete compilation of unmodified current source.

If no bounded safe repair is available, the last successful output is retained,
the error and available advice are shown, and the next correction is retried.
No source-map identity check, native state witness, raster proof, compatibility
check or export guard is relaxed by this change. Retained-layout mode remains
opt-in and is disabled by the trial launcher.

## Verification

Eighteen focused local checks passed, including seven new correspondence,
UTF-16, changed-line, blocked-pixel, stale-frame, codec and advice checks.
The [full source and packaged run](https://github.com/complexzeta/TeXquisite/actions/runs/41073390084) passed. Tested source: `528109f243a97284dd8b8fb416febcdd2a7b3baa`. Its recovery fixture exercises actual
clicks on both pages before and after an undefined command, blocked repaired
pixels, error actions, unchanged saved source, an error surviving unrelated
editing, unsafe errors retaining the previous view, and automatic correction.
The same fixture passed against the packaged executable. Both runs verified
that correction clears the notice automatically, without a manual Retry click.

The run also passed 45 focused guards, actual native ownership/recovery,
source/packaged navigation and display handoffs, the report-menu privacy test,
six serialized baseline/candidate sessions, and 132 packaged editing actions
with save, current-source strict export and normal reopen. All 16 uploaded
result records passed. Nineteen runtime assets match the cloud build; AGPL and
metadata, development-file exclusion and private-host-path scanning passed.

Packaged normal-mode plain text recorded 110 frames at median/p95/maximum
55/92/166 ms; inline math recorded 103 at 86/281/345 ms. These are synthetic
renderer acknowledgements on Windows Server 2025 / TeX Live 2026, not physical
display measurements or local-machine guarantees. This pass does not establish
a performance improvement or consistent sub-300 ms math, and did not rerun the
historical OS/TeX Live matrix or TikZ benchmark matrix.

The verified portable is 119,510,007 bytes; SHA-256:
`d2c4bfc92e1a355607350a4dddaf325b21cf44b5eb05696cead735b6d7192e92`.
It is staged on Kingston with retention disabled in its launcher. No main merge,
tag or public binary release was created; corresponding source is on the
existing draft branch and at the exact commit above.

Earlier runs caught two test issues: a target not brought into the viewport,
and a test attempting to click a notice already dismissed by successful
51 ms automatic correction. The corrected test checks canvas hit-testing,
starts inverse clicks from a different source position, waits for the actual
selection change, and verifies automatic dismissal without a redundant click.

Bulk fixtures, temporary data and build staging are on Kingston or disposable
cloud runners. The user's manuscript is not copied into public fixtures or
changed to work around its typo. The user closed 0.112 normally before the verified 0.113 launcher was started.
Documents and settings use the established profile; no source typo was edited
to hide the issue.
