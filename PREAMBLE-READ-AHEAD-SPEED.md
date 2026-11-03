# Preamble input read-ahead experiment

This is an **opt-in compiler experiment**, not an installed TeXquisite update.
The Windows release remains 0.132.0. The bundled compiler assets have not been
replaced, and `PERSISTENT_TEX_PREAMBLE_READAHEAD=1` is used only in the isolated
cloud experiments with the rebuilt compiler.

## What causes this particular pause?

TeX reads a complete physical input line before processing its remaining tokens.
The existing preamble checkpoint therefore includes unread body text when it
shares the line containing `\begin{document}`. Changing that text invalidates the
checkpoint and repeats preamble setup, even though the preamble is unchanged.

The experimental compiler identifies the unique root file frame, verifies its
original line buffer against the original source, and records the position of
the consumed prefix. On restoration it rereads the physical line, preserving
the consumed position and the actual end-of-line character of that line.
Every consumed source byte must still match. Preamble, dependency, auxiliary,
resource, and local-output validation remain in force. A failed reload guard
takes the normal full rebuild once with the shortcut suppressed.

No newlines are inserted into the source and no TeX commands are rewritten.
This matters for tokenization, changed catcodes, macros, and `\inputlineno`.

## Controlled native measurements

The [Linux and Windows correctness run](https://github.com/complexzeta/TeXquisite/actions/runs/41725897902)
used application/test source `eb0d9aefaf36cd025d10fdd33b1d1fafa4ef6e79`.
It rebuilt the compiler using Emscripten 3.1.46 from the bundled corresponding
source and the repository's native patches. The same compiler hashes were
verified on both platforms. Linux used its distribution TeX Live; Windows used
an isolated TeX Live 2026 installation. Each had an installation-matched format.

The alternating control/candidate/control/candidate trials compare the feature
disabled and enabled on the same experimental compiler. Initial cold builds
are excluded from the following medians.

| Synthetic edit | Windows control | Windows candidate | Linux control | Linux candidate |
| --- | ---: | ---: | ---: | ---: |
| Inline first-body text | 135.3 ms | 14.5 ms | 125.1 ms | 12.5 ms |
| Inline text, several packages | 400.7 ms | 27.1 ms | 374.3 ms | 23.5 ms |
| Text starting on the following line | 14.8 ms | 15.0 ms | 12.7 ms | 12.0 ms |
| Inline section and converged reference | 201.3 ms | 63.0 ms | 170.6 ms | 49.0 ms |

These are compiler round trips, not displayed-frame or physical-paint times.
The inline and following-line text cases each have eight measured edits per
platform/cohort; each package/reference case has four.
The complete numeric report records the sample counts individually.

After an undefined command and unmatched math error, the two Windows repair
round trips were 149.6/129.9 ms in the control and 14.7/22.0 ms in the candidate.
The saved source was never repaired by this compiler shortcut.

## Complete Windows edit-to-canvas measurement

A separate one-page synthetic lecture fixture loaded the same six packages and
put its first paragraph directly after `\begin{document}` on the same physical
line. Four fresh hidden app profiles alternated control/candidate/control/candidate.
Each trial performed eight fixed-size word insertions and undo operations.
Every one of the 64 completed frames matched the expected complete-source hash;
autosaved source returned exactly to the original.

| Trial | Median edit to completed canvas | Maximum |
| --- | ---: | ---: |
| Control 1 | 445.0 ms | 485.2 ms |
| Candidate 1 | 63.1 ms | 67.3 ms |
| Control 2 | 418.6 ms | 475.3 ms |
| Candidate 2 | 61.4 ms | 74.6 ms |

Both variants published 16 full-document commits in each trial. This is an
improvement to the full-update fallback, not a conversion to partial rendering.
The hidden-canvas endpoint excludes physical display paint. These are cloud
measurements, not measurements on the user's computer or ten-page lecture.

## Correctness and limits

Each platform passed 148 full-output comparisons, four repaired-output
comparisons, and six local-page comparisons against independently compiled
native pdfLaTeX: **316 comparisons across the two platforms**. Page pixels,
extracted text, page count, and geometry matched. Additional retained-preview,
error-recovery, navigation, and paragraph-window tests passed on both systems.

The fixtures cover changed consumed preambles, begin-document macros, changed
end-line characters, line-number-sensitive text, references, ordinary math, and
TeX's `^^` input transformation. A transformed consumed line declines the
shortcut and takes the ordinary rebuild. A changed consumed preamble correctly
invalidates its checkpoint.

This does not accelerate all editing: the normal following-line fixture was
already fast. It does not remove the need for full typesetting after a real
preamble change, prove long-session behavior, or establish a 99.9th-percentile
latency guarantee. Broader release and installation checks are still required
before changing the normal app's compiler or enabling the shortcut by default.
