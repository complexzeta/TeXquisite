# Temporary-error recovery in 0.124

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
