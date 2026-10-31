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

## 0.118: automatic recovery without a full check between words

An active or previous error could impose work that healthy Lecture typing did
not: a recovered local frame requested a whole-document check after 650 ms,
and a correction retained an obsolete error until that check finished. A
confirmed undefined-command hint also required every character before the
command to stay identical, so typing before it retried the failing input.

There was also a stranded ownership wait after Export/full verification. A new
publication left the wait flag set; if the current paragraph intersected a
temporary repair, preparation returned before borrowing the compiler. Later
cursor moves then returned early indefinitely. Accepting a new basis now clears
that wait before paragraph checks. Actual compiler transfers still use the same
ownership guards. A focused regression and the GUI session deliberately let the
repaired paragraph be inspected first, then move to healthy text.

The new hint is bound to an exact engine-confirmed original/repaired pair and
its prepared slot. It handles ordinary text changes on either side of a literal
undefined command, shifting the skip only outside the changed text. Changing
the command or preceding definitions reconsiders the skip. An unchanged prefix
through the rejected token keeps the existing fast path for subsequent input.
Compound or structural substitutions cannot seed this hint; the actual repaired
copy still has to compile and pass normal local-output/rendering checks.

Confirmed recovery now uses the same provisional policy as healthy Lecture
output across flow, fixed-paragraph and page rendering, including its existing
handling of state changes and navigation limits. Formatting/argument edits that
invalidate the literal hint must run TeX again. If every resulting repair freshly
confirms a known canonical error, the same warm context may continue; a new fault
requests canonical checking. Neither path promotes repaired input to healthy source.
It stays explicitly approximate. Unchanged remote diagnostics may be projected
through ordinary text edits; that projection grants no compiler, editing or
export authority. A recovered canonical source can also hand a newer automatic
ordinary-text revision to the local queue using the original editor draft,
rather than comparing the new text to its spaces-only repair.
Diagnostic projection advances its comparison source only after an accepted
frame carrying the known remote errors. Separate ordinary edits around unchanged
math therefore remain ordinary edits; an unverified definition cannot be washed
out by the next word. This applies to both flowing and proved page output.

When an unmodified local compile succeeds and the complete reconstructed compiler
input equals the actual editor draft, obsolete root errors can clear immediately.
If native flow state also matches, Lecture mode keeps the healthy local compiler.
If state changed, a required full check is scheduled immediately instead of
waiting another 650 ms. Repairs outside the active region, included-file or
unlocated diagnostics and retained projected history cannot claim this equality.
Build and Export still require a current full unmodified-source validation.

Length-changing repairs that preserve line count, such as a temporary math
closer, can now offer a local basis for other unchanged paragraphs. Editor
positions stay in the original draft; compiled ranges are mapped by complete
lines and must match the active text exactly before native and raster proofs.
The repaired paragraph itself is refused when its bytes do not match. This does
not turn a repair into verified source or permit approximate export.

The missing-closer test also exposed a page-rendering refusal for fractional
paper sizes. The PDF library floors raster/CSS dimensions but returns exact
dimensions from its native page-size API. Page and band replacement now compare
those exact native dimensions, stored separately on each new canvas. Ordinary
metadata copying cannot overwrite them with another page's size. Raster sizes,
CSS behavior and pixel proofs are unchanged; genuine geometry changes, invalid
or partial metadata still refuse replacement under the existing tolerance.

The notice explains automatic checking while Live is on; its optional button is
called Check now. Routine correction and navigation messages no longer tell the
user to retry manually. Pausing Live still offers Retry preview.
The notice is refreshed after each accepted local frame, so an old recovered
full baseline cannot bring its error banner back after the next healthy word.
Navigation explanations preserve the concrete command/brace/argument advice.

The new synthetic source/packaged session types before and after an error across
one-second pauses, moves to another paragraph, returns and corrects the command,
checks immediate local diagnostic clearing and automatic state-change verification,
continues healthy typing, checks exact saving, then performs strict PDF export.
It also types in another paragraph with a missing math closer and automatically
checks its subsequent correction. The existing definition-based correction
session records the time until its automatic error-free publication.
Focused guards cover hint invalidation, original-draft handoff, state-change
metadata, remote errors and a mismatched retained full-source history.

Validation for runtime/test source `c14c5e3c5669b669ae27d1e1c9adca53cdfafd67`
passed in [the cloud source and packaged run](https://github.com/complexzeta/TeXquisite/actions/runs/41142305544):
75 focused guards, the separate native ownership guard, and all 26 integration
and package result records. Existing navigation, normal/high-density paragraph
split, report privacy, editing/save/export/reopen and serialized comparison
sessions passed. No Retry or Build was used by the new automatic-recovery session.

Across its source and packaged sessions, warm edits around the undefined command
were 19–23 ms, remote edits 24–32 ms, command correction 18/26 ms, and subsequent
healthy typing 17/17 ms. Remote edits around unchanged math with a missing closer
were 32–35 ms in continuous page output. Both runs stayed warm across one-second
pauses, cleared the corrected error locally, saved exactly, exported corrected
source strictly and automatically verified the structural correction. Both also
recorded a refused smaller block patch (`Continuous block ink exceeds its bounds`)
before continuing successfully through the existing fallback; proof refusals are
not disabled. The separate definition-based correction required an automatic
canonical publication, taking 456/507 ms. Initial idle-fixture updates were
105–197 ms; subsequent warm words were 12–21 ms.

These are small hidden-renderer synthetic observations, not physical-screen or
BaKoMa parity measurements, a paired overall version comparison, or an arbitrary
document guarantee. Newly encountered errors, unsupported active repaired regions,
structural changes and definition changes can still require a full check or new
preparation. Document mode retains its verification policy. No new broad TeX Live
matrix or complex TikZ campaign was run; the TeX WASM is unchanged. All builds,
GUI tests and packaging ran in the cloud, without benchmarking the user's
manuscript locally or interacting with their running 0.117 app.

Nineteen packaged runtime assets matched the build; version/licensing, private
path and development-file exclusions passed. All 385 tracked source files passed
the private-data audit. The verified portable is 119,507,062 bytes, SHA-256:

```text
d81a664792a39be6c5b7872f8460e08c0637f0fc1d52a3892cc1f12b983c62f3
```

The trial, checksum and provenance are staged on Kingston with the existing
profile, normal flags and external temporary storage. The duplicate portable
download archive was removed after staged-byte verification. Bulk evidence stays
on Kingston. This remains a draft-branch trial without a main merge, tag or new
public binary release, pending a convenient normal restart.

## 0.119: earlier-page text and display-math editing

The user's existing 0.118 diagnostics recorded a 612 ms affected-pages update:
about 455 ms in the compiler, including 417 ms typesetting, and 1,641 source
bytes reprocessed. This was an already-ready local lane, not a cold preamble
or solely a renderer delay. Only timing metadata was read; the user's window
and source were not edited or benchmarked, and their manuscript was not uploaded.

Synthetic `amsart` fixtures reproduced an early/late distinction without errors.
A failed opportunistic two-paragraph raster proof retained a page lane that
processed roughly 5.3 KB and three pages for each word, while the late paragraph
processed about 80 bytes. Lecture mode now retries the actual paragraph on the
same warm worker before accepting that broader fallback. Document mode keeps
its previous policy.

Display paragraphs exposed another limitation: page-builder stretch gives the
same paragraph several vertical translations. A constant translation cannot
reconstruct its baseline. Lecture/continuous preparation can now propose up to
64 separated vertical slices, with constant horizontal placement and bounded
vertical spread. Overlapping ink groups, reordered groups, invalid geometry,
multiple source pages and fixed-paragraph use refuse this proposal. Glyphs only
propose the cuts: the composed original must still pass the complete baseline
raster, native-fragment ink and independent tile checks. Unrecorded rule/drawing
ink cut or moved incorrectly therefore prevents acceptance. New live output
uses the existing flowing-block renderer; saved source and strict export do not
inherit these provisional layout rules.

At low display density, an independently matched tiny math glyph can contain
only gray pixels. The existing dark-core rule refused it despite identical vector
outlines; at 2.5x density the complete proof passed. That specific matched-vector
failure may now request a complete proof at 2.5x density, within the existing
16-million-pixel/32,768-dimension limits. Both complete rasters, fragment ink and
tile must pass; dark-core, color/alpha, geometry and coverage thresholds are
unchanged. The displayed-density ink and tile checks remain required. This work
is preparation, not a new denser raster on every typed character.

A deliberately rejected local frame also exposed two recovery issues. Lecture
mode's ordinary idle-verification suppression could suppress the required full
fallback itself; that fallback now explicitly requests verification. Separately,
a failed translation consensus could discard independently matched vector glyphs
at the unchanged native origin. An origin-preserving witness now requires at
least three matched outlines; it cannot move the patch, and the full raster/ink/
tile proof still decides acceptance. The new regression requires automatic full
recovery and subsequent flowing output, with no Retry or Build.

Validation for runtime/test commit `5b4b7b6f3e0cd916783c68af3229ee07c0ef08bb`
passed in [the source and packaged cloud run](https://github.com/complexzeta/TeXquisite/actions/runs/41150890855):
78 focused guards, the separate native ownership guard, and all 66 integration
and package result records. Forty new position records cover ten scenarios at
normal and 2.5x display density in both source and packaged apps. Ordinary
single-page text/math must use flowing output; warm words must not trigger full
publications between pauses. The deliberately rejected frame must recover
automatically and subsequent words must return to flowing output.

Across the source/packaged samples, earlier short-paragraph edits were 18–29 ms,
late edits 25–33 ms, earlier display-math edits 24–42 ms and the same display
paragraph with a remote error 27–43 ms. Explicit ragged-page controls were
23–62 ms. Text separated from a later drawing was 20–49 ms. These are small
ordered hidden-renderer samples, not physical-screen or arbitrary-document
guarantees, nor a controlled overall version speedup. Eight complete denser
proofs succeeded. No raster, ink, geometry or dark-core threshold was relaxed.

The forced internal frame failure recovered through an automatic full preview
in 119–160 ms. Its first subsequent word included preparation/handoff and took
296–452 ms, then the next word took 20–23 ms. Thus this pass does not establish
consistent sub-300-ms transition latency. Definition-based corrections requiring
canonical verification took 521/524 ms in the existing recovery session.
Paragraphs spanning pages still used page output, 67–101 ms here; an attached
drawing remained in that path at 202–275 ms. Those bounded fixtures do not make
the remaining page path fast for arbitrary complicated diagrams or manuscripts.

Existing automatic error correction, two-way navigation, privacy, paragraph
splits, normal/high-density cases, editing, exact saving, strict export/reopen
and serialized baseline comparisons passed. Nineteen runtime assets matched the
packaged build; version/licensing, private paths and development-file exclusions
passed. All 387 tracked source files passed the UTF-8/UTF-16 private-data audit.
No fresh broad compatibility matrix or complex TikZ campaign was run; the TeX
engine and WASM are unchanged. All builds, editor tests and packaging ran in the
cloud, without interacting with or benchmarking the user's manuscript locally.

The verified portable is 119,534,943 bytes, SHA-256:

```text
d25888fa8b86e014fef575a210ac551c131ccddfe4bcf35d4cb528669a4ae7c8
```

The executable, normal-profile launcher, checksum and provenance are staged on
Kingston. The duplicate portable ZIP was removed after checking the staged bytes;
bounded results/logs remain on Kingston. This is a draft-branch trial without a
main merge, tag or new public binary release. The user's 0.118 session remains
open pending a convenient normal restart.

## 0.120 — quiet scrolling and permanent error status (2026-10-30)

Automatic preview notices now occupy a fixed 28 CSS pixel bottom bar. A red
indicator counts reported errors, updates as errors clear, and remains visible
even when an older session hid the status bar. The View menu and toolbar toggle
now control only optional timing details. Full advice is available on hover or
through Details; Go to error and Check now remain explicit actions. Backup
failures also use this bar. Unchanged status does not rewrite its live region
while scrolling.

Blank source padding, gutters and scroll releases no longer request PDF
navigation. Actual text clicks still navigate with Follow typing off. Explicit
unmapped requests use a compact informational message without inventing a TeX
error; scrolling clears that transient message while retaining real errors.

[Cloud validation](https://github.com/complexzeta/TeXquisite/actions/runs/41169994984)
passed for runtime commit `81fe6affa4c30b6ac6470f017e267ed7aabd59e6`: 78 focused
tests, one native retained test, all 70 integration/package result records and
19 matching runtime assets. Both source and packaged status checks verified
2 → 1 → 0 errors without automatic dialogs, pane resizing or source-selection
changes; errors clear without a manual retry, and saved source stays exact.
Compact-control checks covered timing preference persistence, native menus,
fit width, panel/window resizing, live-text retention and paged navigation.
The disposable cloud profile is kept outside its project snapshot. Error and
healthy screenshots were visually inspected. Existing typing, recovery and
privacy checks passed; all 388 tracked files passed the private-data audit.

All builds, tests and packaging ran in the cloud, using synthetic documents.
No local manuscript benchmark, fresh broad TeX Live matrix or complex TikZ
campaign was run. The TeX engine and WASM are unchanged. These checks do not
promise arbitrary-document or physical-display latency.

The verified portable is 119,535,357 bytes, SHA-256:

```text
dd0cfdb737180f1eab507415ae97ec4a5d9b49a2ced05db57062d6170d3dd159
```

The executable, normal-profile launcher, checksum and provenance are staged on
Kingston. The duplicate portable ZIP was removed after verifying the staged
bytes. This remains a draft-branch trial without a main merge, tag or new public
binary release.
