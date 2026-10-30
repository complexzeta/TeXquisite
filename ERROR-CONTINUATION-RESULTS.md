# Continuing to edit elsewhere while an error remains

The 0.115 trial addresses two failures that the same-region retry optimization
in 0.114 did not cover.

TeX truncates long diagnostic lines with a leading `...`. The repair helper
required a complete literal source prefix, so an otherwise recoverable undefined
command could prevent any new full preview from being published. A sufficiently
long diagnostic suffix can now identify the command if it has exactly one
literal match on the reported source line. Short, ambiguous, expanded or
nonmatching contexts remain rejected; command boundaries are still checked.

After a successful full recovery, the compiler's baseline contains temporary
repairs while the editor retains the original error. Comparing a new edit's
unchanged prefix/suffix against the repaired baseline incorrectly treated that
error as an additional outside-region edit. The recovered local context now
retains the exact original root source separately. Region ownership checks use
that original source; actual typesetting and baseline raster proofs continue to
use the repaired compiler copy. Included-file comparisons keep their own source
baseline. Transitioning between recovered and healthy full publications retires
the old local context.

The preview remains explicitly approximate and the original error stays visible.
No repair changes the editor or saved source, and strict export still requires a
successful complete compilation of the unmodified current source. These changes
do not make arbitrary invalid TeX executable or remove the bounded-recovery
limits.

## Verification

Sixteen focused local tests and the source build passed. The tests cover
truncated/ambiguous diagnostic contexts, unchanged original text, edits before
and after a retained error, compiler-copy construction, included-file isolation,
context retirement, supersession and correction.

The GUI regression uses a long line containing an undefined command, keeps that
command in the saved source, and requires timed local frames while editing
paragraphs both before and after it. It also checks actual two-way navigation on
two pages, restrictions around repaired pixels, error actions, persistence of an
unrelated error, unsafe-error guidance and eventual correction/notice dismissal.

Three isolated local source runs passed. The first recorded the two other-paragraph
updates at 164/135 ms, the synchronized run recorded 106/80 ms, and the final
sampling-corrected run recorded 122/100 ms. These are hidden
renderer measurements, not physical-display or user-document guarantees. A
read-only predicate check also matched a shortened diagnostic against the
affected document without writing any file.

The first two cloud attempts recovered the long error line and passed navigation
and error-action checks, but failed the stricter local-frame gate. Preparation
synchronization was strengthened to acknowledge cursor moves and require the
target paragraph's readiness. A subsequent instrumented local failure recorded
the correctly labelled, current-source local canvas with a completed timing ID.
The test's default animation-frame polling was throttled in hidden windows and
could miss that transient frame before the normal 650 ms idle verification
replaced it. The final harness polls at 10 ms, as the lecture-session harness
does, and retains bounded frame metadata on failure. The actual timed local-frame
assertion is unchanged. Failed runs are not counted as successful verification.

The [final cloud run](https://github.com/complexzeta/TeXquisite/actions/runs/41098613844)
passed at exact tested source/runtime commit
`89e2b25dbae3fce7c6c79e121bacc13014db118e`. Its 56 focused guards, native
ownership/recovery, source and packaged navigation/error controls, report/menu
checks, eight source editing sessions and 132 packaged editing actions passed.
All 18 result records passed. Nineteen packaged runtime assets match the build;
metadata/AGPL, development-file exclusion and private-host-path checks passed.
The broad OS/TeX-version and TikZ matrices were not rerun.

With the error unchanged, the source GUI recorded other-paragraph updates at
44/48 ms and the packaged GUI at **43/48 ms**, before/after the error respectively.
These are two selected hidden-renderer samples in each fixture, not a general
latency guarantee. The packaged mixed workload recorded 113 plain-text frames
at median/p95/max 54/89/148 ms and 104 math frames at 65/161/260 ms. No paired
normal-mode 0.114/0.115 performance comparison was run, so these are validation
measurements rather than proof of a general speed increase.

The verified 0.115 portable is 119,503,827 bytes, SHA-256:

```text
02bae5d00e9b9ca417e4308d029eda952a328598fdc3518397dd46dca21ea638
```

The trial launcher retains the existing app profile, uses external temporary
storage and disables experimental retained layout. This remains a draft-branch
trial, with no main merge, tag or new public binary release.

## 0.116: keep the local compiler warm across pauses

Although 0.115 continued rendering, an error still made Lecture mode schedule a
full verification 650 ms after each local update. That check could reclaim the
warm compiler, replace the local frame and prepare the paragraph again before
the next word. Healthy Lecture-mode typing did not incur that repeated work.

For a successful root flow update, 0.116 can retain the known error without that
idle full build when native flow state is unchanged, the active region contains
no repaired baseline text, original-source region/dependency checks pass, and
every current error is among the known recovery diagnostics. Diagnostics acquire
the current edit/source identity and projected line numbers rather than being
cleared or left stale. An unrelated or unknown error refuses this shortcut.

The compiler copy and displayed frame remain approximate. Changes to repaired
text, new errors, state-changing edits, unsupported local paths and Document mode
retain normal full verification. Explicit Retry still recompiles. Full recovered
publications re-prove their local regions against the new diagnostic snapshot
while retaining an initialized worker. Source saving and strict export behavior
are unchanged.

A dedicated healthy/error comparison types three words in the same paragraph,
with a one-second pause after each. It requires a timed local frame and no full
publication during each pause, and checks current error actions, explicit Retry,
rejection of export from broken source, automatic rechecking after defining the
missing command, and correction.

Two isolated local runs passed. In the complete guard run, healthy updates took
351/21/21 ms and updates with a remote error took 249/21/20 ms. The earlier run
recorded 221/20/22 versus 241/20/22 ms. The first update includes different warmup
and rendering work; these small, ordered samples do not establish a general
speedup or a universal first-frame bound. The useful result is that subsequent
updates stayed warm across pauses in both phases, without full recompilation.
These remain hidden-renderer measurements rather than physical-screen timings.

The [final cloud run](https://github.com/complexzeta/TeXquisite/actions/runs/41106998921)
passed on source/test commit `98dd36cd5c91355aa8d5637475f9ea8274d99167`:
58 focused guards, the native guard, and all 20 integration/package result
records passed. The new paused-typing case passed in source and packaged normal
mode, alongside the existing recovery/navigation and editing sessions.

| Fixture | Healthy updates (ms) | Updates with a distant error (ms) |
| --- | --- | --- |
| Source, cloud | 150 / 14 / 14 | 100 / 14 / 13 |
| Packaged, cloud | 136 / 12 / 13 | 92 / 13 / 12 |

Both versions retained their context across every pause and passed explicit
Retry, strict broken-source export rejection, definition-change rechecking and
correction checks. These results have the same measurement limits as the local
samples. The engine WASM is unchanged; this was not a new TeX Live matrix or TikZ
benchmark.

The packaged verifier matched 19 runtime assets to the build and checked metadata,
licensing, absence of private paths and exclusion of development files. The
verified 0.116 portable is 119,548,264 bytes, SHA-256:

```text
a133e7ad805cb156e6f4b853f5eb95aee9d2ce96e1ff006906dfbaad4019111f
```

Its launcher preserves the default profile and uses Kingston for temporary
storage, with experimental retained-layout flags off. This remains a draft-branch
trial, without a main merge, tag or new public binary release.

## 0.117 verified trial: leave the page lane after separating text from a drawing

A local compiler can keep a paragraph checkpoint from before a blank line was
inserted. If that old paragraph also contained a drawing, ordinary text updates
continue through page rendering even after the editor now shows two paragraphs.
The page lane can consequently reprocess unrelated drawing material on every
word. Retaining a compatible old context during a later full publication can
also retain those obsolete paragraph boundaries.

The candidate requests one required idle verification after a successful,
unrepaired Lecture-mode page update that inserts an earlier paragraph terminator
in the first paragraph of its proved root range. Ordinary typing and deletion
without a new terminator do not request it. A canonical publication then retires
the old page context, takes a newly verified worker through the existing ownership
guards where possible, and proves the smaller current paragraph before declaring
it ready. Included files, recovered baselines and Document mode do not take this
shortcut. A structural split still has a one-time verification/preparation cost.

Two additional proof failures can prevent that text from using flow output:

- A neighboring drawing's antialiased edge can touch the default one-point text
  margin. In foreground Lecture mode the candidate can try smaller margins down
  to a quarter point. Every proposal must repeat the fragment ink-fit check,
  unchanged baseline raster comparison and tile proof. Future edits that exceed
  the selected margin still fail their ink check and fall back.
- A fixed eight-pixel coverage budget for an entire paragraph is excessively
  restrictive at high display densities. The candidate associates the allowance
  with independently matched PDF glyph geometry and scales it by pixel density,
  with a geometry-only per-glyph maximum of 64 pixels and a whole-patch budget
  of 64 pixels at 1x, capped at 1024 at 4x. Only opaque
  grayscale coverage differences of at most 80 are eligible; both images must
  retain the stroke edges. A proved faint gray fringe may cross the near-white
  cutoff when both pixel values are at least 192, within the same coverage budget
  and glyph/core checks. Identical vector outlines also authorize an opaque gray
  hinted edge crossing that cutoff under the same difference and core checks.
  Missing/added core ink, color, alpha and unproved glyphs
  retain their rejection rules. Full-page raster proofs and strict export are
  unchanged. This is a deliberately bounded relaxation of local antialiasing
  coverage, not an exact-byte equality claim.

Calibration also used to return early when its origin already matched. That
discarded independently matching glyph boxes and made a single ordinary coverage
difference fail the local proof. The candidate can return a zero translation
with those boxes after the same strong finite consensus, rather than treating
correct alignment as failed calibration. Large shifts, ambiguous/weak consensus
and missing geometry remain refused; identical unsuccessful proposals are not
repeated indefinitely.

A thin serif may have no dark pixel within the original two-pixel edge search
even though its glyph has a core stroke elsewhere. For an independently matched
glyph only, the candidate can verify that core in both images and use the nearby
gray-to-white fringe instead. These exceptions share the same per-glyph and
density-normalized patch budgets. Unmatched geometry, absent core strokes, missing/added
core ink, color and alpha changes retain their refusal checks. The uncalibrated and
full-page comparisons retain their original edge criterion.

Complex mathematical glyphs can exceed the geometry-only allowance even when
their vector shapes are identical. The candidate therefore also asks the PDF
worker for an embedded glyph's complete outline and effective font size, fill
color and linear transform, using the [PDFium glyph APIs](https://raw.githubusercontent.com/chromium/pdfium/main/public/fpdf_edit.h).
A bounded canonical identity is hashed and compared independently in the two
PDFs. Only equal, complete identities with the existing matching glyph geometry
can use the shared patch coverage pool beyond the smaller geometry-only quota.
The total pool and all color, alpha, core-stroke and ink checks still apply.
Missing, ambiguous or unsupported outline data supplies no extra allowance.
Ordinary preview-edit glyph extraction is unchanged; vector identities are
requested and cached separately during calibration.

The first cloud candidate failed its new GUI gate because the harness typed
before the freshly published context was prepared; that edit correctly used a
full publication instead. Its timing and proof assertions were retained. The
harness now waits for three consecutive explicit ready acknowledgements with
the exact baseline source hash and narrowed range. Cloud coverage also exercises
normal and 250% display scaling, math, italic descenders, continued warm typing,
exact source saving, and the existing recovery/navigation/export guards.

Earlier local synthetic runs reached flow output with later warm updates of
52–89 ms, but first updates during preparation still took 526–675 ms. A private
document-copy check exposed the high-DPI coverage rejection and was not a pass.
Those results do not validate the latest candidate against the user's document.
Further builds, GUI tests and packaging run in the cloud to avoid interfering
with the user's computer. The first longer AMS-art fixture then exposed the
aligned-origin bug; it was fixed without removing the raster gate.

The [final cloud run](https://github.com/complexzeta/TeXquisite/actions/runs/41127701844)
passed on runtime/test commit `3a8a0bd916e4fe513409bb580e22ebe90755714b`:
66 focused guards, the native ownership guard, and all 24 integration/package
result records passed. Both densities passed on source and the packaged normal
configuration, including an exercised matching-outline witness, automatic
split reproof, exact source saving, descenders and continued warm typing without
additional full publications. Existing error recovery, two-way navigation,
report privacy, editing sessions, save/export/reopen and package checks passed.

| Fixture | Density | Page lane before split (ms) | Warm flow after reproof (ms) |
| --- | --- | --- | --- |
| Source | 1x | 36 | 26 / 19 / 18 |
| Source | 2.5x | 41 | 26 / 18 / 19 |
| Packaged | 1x | 36 | 25 / 18 / 18 |
| Packaged | 2.5x | 54 | 27 / 17 / 24 |

These are small ordered synthetic samples with hidden-renderer acknowledgements,
not physical-screen measurements, a paired version-to-version speed comparison,
or a guarantee for arbitrary documents. The split itself still requires one
canonical verification and new region proof. The latest candidate was not
benchmarked against the user's manuscript locally, to respect the request to
avoid resource-heavy work on that computer. No new broad TeX Live matrix or
TikZ performance campaign was run; the TeX WASM is unchanged.

Nineteen packaged runtime assets matched the build; version, licensing, private
path and development-file exclusions passed. The verified portable is
119,536,022 bytes, SHA-256:

```text
acf7e6e631c1f50ea946e820b43e7d56068c17bad9509557f5de7fafb94ab65b
```

The trial is staged on Kingston with its checksum/provenance and a launcher that
preserves the established profile, normal flags and external temporary storage.
This remains a draft-branch trial, without a main merge, tag or new public binary
release.
