# Check large contractions before proving the old band (0.111)

A slow deletion in 0.110 spent almost 300 ms preparing and proving its old
two-page paragraph, then rejected the edited band because its page span had
contracted without a verified continuation. A full build followed anyway.

For a queued plain-text deletion of at least 256 characters in a foreground
continuous paragraph with exact anchors on multiple pages, 0.111 computes the
edited page band first. If it omits a required original page and has no checked
continuation, the idle compiler returns to full verification immediately. No
local result is displayed and the old-band raster proof is skipped.

This optimization excludes included inputs, transformed compiler source,
retained neutral blocks, drawing/family regions, recorded baseline costs above
200 ms and background preparation.
The probe retains the normal one-second local deadline. An unavailable probe
returns to ordinary page verification. If the probe remains a possible local
result, the original baseline must still pass its complete raster proof; only
then can the computed response be consumed. Exact source and region identity,
disk-input checks, page-span and continuation checks still apply. A newer draft
cannot consume an older response. Native compiler behavior is unchanged.

Two 132-action synthetic sessions compared the change with the same runtime
using `PERSISTENT_TEX_DISABLE_CONTRACTION_PROBE=1`:

| Run | Complete frames | Median | 95th percentile | Maximum | Delete-paste median / maximum | Typing median / maximum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Probe enabled | 187 | 131 ms | 311 ms | 489 ms | 136 / 421 ms | 273 / 489 ms |
| Probe disabled | 193 | 100 ms | 338 ms | 630 ms | 110 / 630 ms | 291 / 451 ms |

The early-rejection branch ran twice in the enabled session. This supports a
narrower deletion-tail improvement, not a speedup for every action or percentile.
Sequential local measurements vary. The consistent 300 ms target remains unmet;
these hidden-window timings end at a matching canvas, not physical display.

The packaged 0.111 run completed 132 actions / 185 complete frames: 92 ms
median, 294 ms at the 95th percentile and 436 ms maximum. Delete-paste actions
took 92 ms median / 436 ms maximum; typing took 294/410 ms. The prior packaged
0.110 run's overall maximum was 573 ms. These sequential runs support the
targeted improvement, while individual timings still vary.

Twenty-five focused guards passed. The new regression checks early rejection
without publishing or old-page proof, reuse only after baseline proof, refusal
after a failed proof, invalidation on a newer source, matching-continuation
handling and recovery when the speculative computation is unavailable. The
editing session also passed autosave, strict export containing the latest text
and normal close/reopen.
The guards passed independently in both source checkouts, and 16 packaged
runtime assets matched both builds. Packaged cross-page navigation, file
switching and ten-case math recovery also passed. A real native-engine reuse
fixture made exactly two page calls (edited probe, then original baseline),
performed the original page proof, reused the computed response and matched
every pixel on both output pages against an independent full compile. That
fixture is reproducible with `scripts/contraction-probe-test.cjs`.
