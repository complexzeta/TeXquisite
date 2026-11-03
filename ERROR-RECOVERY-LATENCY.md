# Temporary-error recovery

## 0.125: theorem math and memory pressure

Deleting a closing dollar inside a theorem produces a different LaTeX error:
the theorem end is invalid in math mode. The bounded local repair recognizes
that error and can insert a temporary math closer before the literal environment
end. When both dollars are removed, familiar argument-free math symbols can be
wrapped in `\ensuremath` and text-mode subscripts escaped in the compilation
copy. Explicit valid math remains untouched. The engine must accept the repair;
the saved source and strict export requirements remain unchanged.

Below 1 GiB available memory, automatic verification now waits instead of
reclaiming the local compiler or starting another worker. Failed local edits
still report a status-bar diagnostic immediately. Rejected provisional frames
retain the last good image and checkpoint. Healthy page/paragraph checks also
account for the already-established obsolete TikZ-loader compatibility change;
a guard verifies that this does not normalize away an unrelated real error.

[Windows run 41531926875](https://github.com/complexzeta/TeXquisite/actions/runs/41531926875)
tested source `92cfa77cf4da8a01b9fea1a35a9aed94deeb8b71`. All 17 source and
packaged integration reports passed. A synthetic theorem fixture with amsmath,
amssymb, amsthm, TikZ and xcolor separately removes each dollar, keeps typing,
and corrects a relation chain back to plain text. It simulates 256 MiB available
memory by replacing the app's OS reading, without allocating memory to create
real pressure. Both test forms retained the local compiler with zero automatic
reclaims and saved exactly the original edited source.

Across source and packaged runs, the first error frame took 288–300 ms;
continued typing took 63–112 ms, and correcting the relation chain to plain text
took 73–75 ms. The separate existing correction fixture measured 32–143 ms.
These are hidden-window cloud canvas measurements, not physical-screen timings
or guarantees for arbitrary documents. Actual memory exhaustion can still slow
the operating system; unsupported edits and explicit Build/Export may require
full compilation.

## 0.124: preserving the warm local compiler

A temporary local TeX error could trigger whole-document verification that
reclaimed the only prepared local compiler. Correcting the error then waited
behind that build instead of resuming the paragraph checkpoint.

The failed local slot now retains its checkpoint while verification uses a
separate worker, provided at least 1 GiB of system memory is available. A newer
accepted local edit cancels obsolete automatic verification. Explicit Build and
Export requests remain intact. Superseded failures cannot publish late error
messages after an asynchronous log read, and a proved local correction clears
the corresponding stale build-failure status.

## Windows cloud validation

[Run 41493349896](https://github.com/complexzeta/TeXquisite/actions/runs/41493349896)
tested source commit `1e2651c761abc2c959f68995da2e16f92fc10bd7` on Windows
Server 2025 with an isolated TeX Live 2026 installation. All 15 integration
reports passed, including the packaged Windows application, navigation,
status-bar suggestions, typing beside persistent errors, automatic correction,
exact source saving, and strict export checks.

The added nine-page synthetic fixture uses amsmath, TikZ and xcolor, plus 100
paragraphs. It inserts an unfinished formatting argument, an undefined command,
or an unmatched math delimiter, then corrects the source after short pauses.
Corrections add unique text to prevent a cached earlier frame from satisfying
the test.

| Error and pause | Earlier source build | Packaged 0.124 |
| --- | ---: | ---: |
| Unfinished argument, 100 ms | 96 ms | 65 ms |
| Unfinished argument, 700 ms | 279 ms | 24 ms |
| Undefined command, 100 ms | 38 ms | 24 ms |
| Undefined command, 900 ms | 225 ms | 32 ms |
| Unmatched math, 150 ms | 189 ms | 19 ms |
| Unmatched math, 900 ms | 207 ms | 19 ms |

The earlier [baseline run](https://github.com/complexzeta/TeXquisite/actions/runs/41491325341)
reclaimed the local compiler three times. The candidate retained it throughout.
A separate source-only candidate run measured 36–175 ms. These are independent
cloud runs with hidden windows, measuring correction through canvas update;
they are not physical-screen timings or guarantees for arbitrary documents.

The error counter cleared in 26–70 ms in five packaged cases. One unlocated
runaway-argument error required a full check and cleared in 1,073 ms, while its
corrected preview was already visible in the canvas after 24 ms. An error whose
location is unknown is deliberately not dismissed solely because one paragraph
compiled successfully.

## Remaining limits

Unsafe or unsupported errors retain the last good preview until a correction
can compile; the saved source is never silently repaired. Preamble changes,
new dependencies, broader layout changes, and low-memory fallback can still
require more work. Temporary repaired previews do not qualify for strict PDF
export. The timing test also checks that subsequent edits retry automatically,
the local worker stays available, and the exact edited source reaches disk.
