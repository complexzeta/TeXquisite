# LaTeX error recovery in preview builds

## Fast, quiet local recovery (0.105)

A supported root-source error inside a prepared region now retries that region
on its existing worker, instead of sending every keystroke through whole-document
recovery. The repaired result remains explicitly approximate, has no navigation
map, never becomes a retained neutral block, and does not start redundant idle
full builds. Repairs outside the region, included-file errors, carried edits,
fatal worker failures and exhausted repair attempts retain the full fallback.

Length-preserving full repairs can also prepare local editing after opening an
already-broken file. That local baseline describes the exact repaired bytes the
engine compiled, separately from the editor text. The bundle keeps its recovered
flag; source/region/proof checks remain required. Offset-changing full repairs
cannot seed this path. Repaired sources never certify the unmodified editor file
or permit verified PDF export. A legacy-preamble compatibility retry now routes a
subsequent source error through recovery instead of bypassing it for native TeX.

Automatic errors update the Problems badge/list and guarded gutter marker. The
top error banner stays closed, and explicitly opened Problems has a fixed height.
Notifications do not change source selection, focus, or pane geometry.

An isolated copy of a lecture with an integral-command typo measured 116–138 ms
for local repair/continued edits; opening it already broken then editing measured
111–126 ms after initial loading/preparation. A further Follow typing run measured
118–128 ms with matching canvases intersecting the preview viewport. Source-pane
geometry, scroll, caret and focus remained stable, including with Problems open.
These are matching-canvas timings in hidden test windows, not physical-screen
latency guarantees. Initial whole-document loading remains separate.

The packaged 0.105 app passed the already-broken lecture test at 111–139 ms,
with stable source editing both with Problems closed and open. Correcting the
error and fully verifying restored whole-document navigation. The original
lecture file remained byte-identical. Strict export, unsupported-error recovery,
runaway cancellation and reopen regression checks also passed.

Automatic pdfLaTeX previews now attempt a small set of temporary repairs instead
of silently leaving Lecture mode on an old image. A local source error requests
required full recovery even though ordinary Lecture verification is deferred.

Supported repairs are deliberately specific: skip the undefined command at an
exact reported root-source prefix; ignore a reported extra closing brace;
escape a text underscore/caret when TeX requests math at that symbol; close
unterminated math at a reported blank paragraph or document end; and insert a
reported missing group, right delimiter, or environment closure at document end.
There are at most three repair attempts with a four-second recovery budget.
Expanded macro errors, ambiguous/truncated contexts, included/package source,
missing files and arbitrary runaway arguments are not guessed.

Repairs affect only the compilation copy. Autosave keeps exactly what the user
typed, errors remain listed against that source, and output is labelled
**Recovered preview**. Repaired glyph positions are not offered for navigation
or visual editing. Any local baseline from a length-preserving repair describes
only the actually compiled repaired source, never the unmodified editor source.
The recovery flag is saved with preview history and restored with its label.
Build/Export still performs strict verification; the artifact store also rejects
export of a recovered bundle as a verified PDF.

Unsupported errors retain the preceding usable image, show the error, stop the
busy indication and automatically retry on the next edit. Obsolete automatic
typesetting is cancelled once a newer revision is waiting and it has consumed
one second, so a corrected draft is not trapped behind an old runaway worker.
Manual work and the publication stage retain their existing ownership rules.

Validation uses disposable projects/profiles on external test storage. The
native integration harness checks a local undefined command, continued typing
while it remains, actual new text in the repaired PDF, strict export rejection,
normal output after correction, missing math, text symbols, an unclosed
environment, a hard error and correction, and superseding a runaway expansion.
Unit guards cover exact source-prefix matching, persistent labels and export.
The existing core/diagnostics/flow-window guards also exercise cancellation,
publication, include identities and worker ownership.

The packaged 0.104 integration passed all these cases plus normal close/reopen
with the recovered label intact. The recovered PDF contained the newly typed
tail text while the broken command remained in the saved source. In that run,
initial/continued undefined-command recovery took about 1.0/0.96 seconds and
correcting an obsolete runaway worker took 3.8 seconds. These are error-path
measurements, not ordinary typing latency or a general performance guarantee.
