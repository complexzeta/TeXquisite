# TeXquisite 0.132: keep paragraph joins warm

In Lecture mode with Continuous scroll, joining nearby paragraphs can now keep
the existing compiler instead of handing the next word to a full-document build
and another round of preparation. This covers Delete from the preceding
paragraph and Backspace from the following paragraph. Subsequent splits and
typing within the proved window retain that context.

This addresses a specific preparation stall. It does not eliminate all long
updates or establish a 300 ms worst-case guarantee for arbitrary documents.

## Packaged Windows comparison

The cloud test alternates the same 0.132 executable with this feature disabled
and enabled, A/B/A/B, on pages 1 and 10 of a synthetic ten-page lecture. Each
trial starts with one deliberately narrow prepared paragraph and performs twelve
join/type/undo cycles. Every cycle restores exactly the same source.

| Join direction | Page | Next-word maximum, control | Next-word maximum, enabled | First joins, enabled |
| --- | ---: | ---: | ---: | --- |
| Delete from preceding paragraph | 1 | 592 ms | 59 ms | 147, 129 ms |
| Delete from preceding paragraph | 10 | 644 ms | 61 ms | 126, 138 ms |
| Backspace from following paragraph | 1 | 614 ms | 53 ms | 169, 143 ms |
| Backspace from following paragraph | 10 | 560 ms | 50 ms | 153, 154 ms |

The first join takes somewhat longer because the small page window is proved
immediately. Control first joins took 69–128 ms; enabled first joins took
126–169 ms. This prevents the much larger pause on the next edit.

Steady next-word medians were 35–40 ms for control and 35.5–46 ms enabled. This is
a transition-tail improvement, not a claim that every ordinary character is
faster. Each control trial needed one full handoff, then could reuse its wider
context; enabled trials needed none. Each table cell pools two trials and 24
next-word edits, so maxima are observations from a small controlled workload.

The fixture uses 640 x 400 bp paper, 36 bp margins, fit width, output above source,
a 1428 x 755 window, and display scaling 2.5. Timings end at a completed hidden
canvas, not physical display paint. Source-run results are reported separately
in [the numeric evidence](PARAGRAPH-WINDOW-RESULTS.json).

## Correctness and rapid input

The source and packaged-app checks include forward and reverse navigation,
temporary undefined commands, typing elsewhere in the window, automatic
correction, and exact autosaving. The actual viewer pixels are compared both
with a fresh full raster and with the corresponding page of a normal complete
ten-page build of the joined source. All comparisons passed with zero differing
channels.

A separate twelve-case cloud test types ten milliseconds after the join and
then sends 24 characters at 20 ms intervals. It covers both directions and both
page positions. Enabled maximum edit-to-canvas delays were 96–140 ms, compared
with 180–214 ms for control. Frames may coalesce multiple inputs; every observed
frame matched its independently reconstructed exact source revision, and every
final input appeared and was saved. Deliberate edits outside the active window
took the normal full route and completed correctly.

Release validation passed 105 unit checks plus the native layout check, 63
bounded integration reports, 28 existing raster/cache cases, 24 existing cached
canvas viewer comparisons, and 32 paragraph viewer/full-build comparisons.

## What remains

The final mixed stress run contains another 8192 edits: typing, region switches,
paragraph changes, temporary errors, correction, and changes directly after
document start. Both ten-page fixtures completed without censored final inputs;
their observed frame hashes and saved source were verified.

| Stress fixture | Median | p95 | p99 | Empirical p99.9 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Smaller lecture paper | 429 ms | 1228 ms | 1578 ms | 1774 ms | 1965 ms |
| Standard paper | 457 ms | 1221 ms | 1570 ms | 1725 ms | 1886 ms |

These deliberately mixed workloads still include full-build fallbacks and do
not show a general tail-latency solution. They are not measurements of steady
typing. Their correlated, coalesced samples provide empirical percentiles, not
a statistical guarantee. Document growth and different cloud hosts also prevent
a causal comparison with the earlier 0.131 stress run.

Changes to the first body line can still invalidate TeX's consumed/read-ahead
checkpoint prefix. Edits outside the bounded window, large or expensive regions,
and recovered/included contexts can require full verification. These remain
separate optimization targets.

## Implementation boundaries and provenance

The optimization selects an immediate neighboring paragraph within a 1200
character window, retains the same warm worker, and prepares against its
immutable converged baseline. Every new window still requires the complete
native page-baseline proof and the existing exact source/dependency checks.
An active window cannot grow repeatedly. A whole-document replacement without
an actual paragraph join uses the normal full route. Unsupported preparation
cannot leave an accepted edit pending indefinitely.

The native compiler, fonts, format, output resolution, cache limits, strict
Build/Export rules, and saved source behavior are unchanged. Tests used only
synthetic cloud projects; no private documents or profiles were uploaded, and
no local application benchmark was run.

* Exact binary source: `d83684e69710e9150de3493981d6989f53ad25b5`.
* [Source and packaged validation](https://github.com/complexzeta/TeXquisite/actions/runs/41712794390).
* [Rapid input and outside-window fallback](https://github.com/complexzeta/TeXquisite/actions/runs/41713014091).
* [Long mixed lecture stress](https://github.com/complexzeta/TeXquisite/actions/runs/41713069363).

The numeric report is committed permanently. Raw bounded reports are retained
on Kingston; temporary Actions artifacts are not the release distribution.
