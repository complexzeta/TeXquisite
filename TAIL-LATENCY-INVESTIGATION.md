# Preview tail-latency investigation

This investigation measured 32,768 synthetic stress edits on Windows cloud
runners against TeXquisite 0.131.0. It did not change the installed application,
use private lecture documents, or run a local application benchmark.

The prepared local path remains fast, but structural edits and switches between
regions can fall back to full-document work and preparation. These transitions
remain a useful optimization target. This pass does **not** establish that the
300 ms target is met reliably.

## Measurements

Milliseconds from applied editor change to the first completed canvas containing
that revision or a later revision. Intermediate edits can be coalesced. These
are completed-canvas timings, not physical screen-paint measurements.

| Scenario | Median | p95 | p99 | Empirical p99.9 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Paragraph boundaries | 228 | 901 | 1025 | 1141 | 1205 |
| CPU contention | 252 | 962 | 1111 | 1244 | 1373 |
| High display scaling | 229 | 879 | 975 | 1101 | 1231 |
| Long document | 402 | 1061 | 1261 | 1344 | 1478 |
| Simulated memory pressure | 92 | 474 | 589 | 772 | 989 |
| Theorem editing | 90 | 825 | 966 | 1017 | 1071 |
| Ten pages, smaller lecture paper | 358 | 1141 | 1602 | 1823 | 1954 |
| Ten pages, standard paper | 445 | 1245 | 1620 | 1873 | 2016 |

Every scenario contains 4096 edits. Full distributions and phase breakdowns are
included in the [numeric report](TAIL-LATENCY-RESULTS.json). The general campaign
uses 65 ms input cadence; the ten-page comparison uses 100 ms. Both deliberately
mix ordinary typing, paragraph joins/splits, edits immediately after document
start, missing math closers, undefined commands, and automatic correction.
These figures must not be presented as the latency of uninterrupted typing.

Both lecture fixtures had ten actually rendered pages at initial measurement,
used display scaling 2.5 and fit width, and edited beginning, middle, and end
regions. The smaller fixture uses 640 x 400 bp paper with 36 bp margins. All
observed lecture frames matched independently reconstructed source hashes, all
final edits appeared, and the final source was saved exactly.

For the displayed local page updates, compiler round-trip median/p95 was
17.3/28.2 ms on smaller paper and 19.6/33.7 ms on standard paper. Renderer
load/display preparation median/p95 was 34.4/46.6 and 55.8/94.7 ms respectively.
These stage distributions exclude full updates and cannot be summed to obtain
the overall percentile. They show why faster TeX execution alone will not remove
the observed transition delays.

## Findings and next targets

* Repeated full-update handoffs and re-preparation follow changes to paragraph
  boundaries and moves outside the active prepared region. Ordinary typing
  immediately after those changes inherits the wait.
* Changing the first source line at document start can invalidate the resident
  checkpoint's exact consumed/read-ahead prefix. Reusing it requires a safe
  native input-buffer mechanism, not relaxing source identity checks.
* The simulated low-memory case suppresses some background scheduling and is
  faster here. It does not prove that actual memory pressure helps performance.
* The general long run did not get slower in its last quarter. The ten-page
  fixtures did; their source also grows during the run, so this does not isolate
  long-session overhead. A fixed-size edit/undo experiment is needed for that.

The next substantial targets are safe checkpoint reuse across paragraph changes
and reducing full-update/preparation handoffs. Preserve native output, navigation
and recovery checks while evaluating them. Do not revive the withdrawn
whole-paragraph redraw experiment merely because its compiler stage was faster.

## Withheld scheduling experiment

A separate cloud A/B/A/B experiment kept the first locally repaired error warm
instead of scheduling its usual idle full verification. Each trial measured 12
next-word edits following a typo and a one-second pause. Control medians were
25.5 and 25 ms; candidate medians were 16.5 and 16.5 ms. Maxima were 30/29 ms versus
24/28 ms. All four trials confirmed local repair, automatic correction, exact
source saving, and rejection of export while the source remained broken.

The same typo was repeatedly inserted and corrected. Each control trial had
only one idle full commit; its recovered basis could recognize subsequent
repairs. This does not isolate repeated fresh-error transitions.

This narrow gain did not reproduce or fix the one-second tail problem. The
experimental runtime hook and active experiment entry point were removed. No
new installer or release was made. The installed version remains 0.131.0.

## Reproduction and evidence

* [General campaign](https://github.com/complexzeta/TeXquisite/actions/runs/41703208929), source `411860a2ccfa5b1ddd3f7eb95e6f79a2e930fe06`.
* [Ten-page comparison](https://github.com/complexzeta/TeXquisite/actions/runs/41704175179), source `c0171576deb72c1025de471c5199094d1cbb21fb`.
* [Withheld scheduling experiment](https://github.com/complexzeta/TeXquisite/actions/runs/41705563826), historical source `4ec80110286b8e499e744897438ba861a97081fa`.

Use the manual TeX Live compatibility workflow, suite `lecture-tail`, with
`tail_samples=4096` to repeat the ten-page comparison. This uses isolated
synthetic cloud profiles only. Production application code in the first two
runs matches the 0.131.0 release; differences are test/workflow code.

The numeric report is committed permanently. Raw bounded reports are retained
on Kingston; Actions artifacts have their normal short retention. Percentiles
are empirical results from correlated synthetic inputs, not a confidence bound
or a guarantee for private lectures, other machines, or real low-memory systems.
