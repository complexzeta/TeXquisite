# Lecture-document trial

The experimental paragraph cache was tested on a fresh, isolated copy of a
four-page lecture document with its existing preamble and support files. The
normal document and application profile were preserved. All projects, profiles
and temporary files were on external storage. No document or private diagnostic
is included here.

These measurements used the formatter/navigation code at `f3dec6e`, Lecture mode,
Continuous scroll, fit-width and display ratio 2.5. The matched control used the
same runtime with the experimental cache disabled. They are sequential samples
to a matching canvas intersecting the preview viewport, not physical-screen
latency or a universal bound. Initial document loading is separate.

| Operation | Experimental cache | Cache disabled |
| --- | ---: | ---: |
| First move to another compatible paragraph | 404 ms | 890 ms |
| Nine subsequent returns, median | 77 ms | 789 ms |
| Subsequent return range | 71–88 ms | 734–880 ms |

Each accepted retained update preserved the other edited paragraph's pixels.
Restoring all text reproduced both edited pages with zero differing pixels
against the original PDF raster.

A separate mixed editing run observed:

| Operation | First matching visible canvas |
| --- | ---: |
| First word / undo | 107 / 78 ms |
| Typing after a pause | 83 ms; observed revision ages up to 180 ms |
| Move into a mathematical paragraph | 1874 ms |
| Move back into another text region | 561 ms |
| New paragraph | 75 ms |
| Delete / restore text | 55 / 53 ms |
| Paste / delete / restore a section | 64 / 67 / 60 ms |

Ten neighboring-leading-strip checks passed without differing pixels. Automatic
saving passed and the original document's bytes were unchanged after each run.
The mathematical paragraph and other incompatible contexts retain the broader
layout path; those delays have not been eliminated. The first uncached move
also remains above the 300 ms goal. Coalesced typing can show a smaller age for
a later revision than the delay from the first key; the table reports the first
visible update rather than substituting that smaller number.

## Packaged 0.101 verification

The optional portable reproduced the result: the first new compatible paragraph
took 390 ms, followed by returns of 65–87 ms. Both restored pages again had
zero differing pixels. In its mixed run, deletion/restoration took 58/61 ms,
and section paste/delete/restore took 64/66/64 ms. The mathematical transition
still took 1875 ms; the other text transition took 495 ms. No general 300 ms
bound is claimed.

The packaged navigation/invalidation suite and save/export/reopen checks passed.
Thirty-six packaged runtime/source assets matched the independent source build;
the package contained no private projects, profiles or diagnostics. The actual
portable launcher also opened the correct document, activated the experimental
cache, saved a test edit and closed normally in a disposable hidden profile.
The local user trial uses its own profile and a private example outside the
portable. No public 0.101 release or main-branch merge was made.

The result supports an **optional 0.101 test build**, with the paragraph cache
enabled by a separate launcher and an isolated profile. The normal published
application remains 0.100. The experiment is still off by default and has not
been merged into the main branch. Broader macro-state, cancellation, memory,
math/float and reflow coverage remains necessary.

To try a locally prepared portable, keep `experimental-launcher.cmd` beside
`TeXquisite-0.101.0-Windows.exe` and run the launcher. Its profile and temporary
runtime stay beside it. Open a copy of a document, use Lecture mode and
Continuous scroll, and retain the stable application for ordinary use. A local
trial folder may already have a private example prepared; that example and its
profile are separate from the portable and are not part of the public source.
