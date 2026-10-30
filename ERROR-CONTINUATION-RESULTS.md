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
