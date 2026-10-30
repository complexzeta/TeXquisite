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
