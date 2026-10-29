# Reuse a prepared window for verified page output (0.110)

A traced 744 ms typing update spent about 245 ms attempting a two-paragraph
baseline, then 396 ms preparing and checking a narrower paragraph, before
rendering the edit. Repeating paragraph preparation was a larger cost than
the final typesetting (44 ms) or page rendering (25 ms).

In continuous preview, a foreground window whose paragraph raster fails now
tries the existing complete-page proof with the same warm compiler context.
It no longer immediately repeats preparation for a smaller paragraph. Exact
page pixels, source identity, page-span and continuation checks still authorize
every update. A failed page proof still retries the narrower paragraph as
before. Background preparation and paged preview retain their old policy.
Native compiler behavior and strict PDF export are unchanged.

The new path was used seven times in the first 132-action session:

| Run | Complete frames | Median | 95th percentile | Maximum | Typing-burst median / maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Reuse the window | 183 | 93 ms | 293 ms | 558 ms | 286 / 451 ms |
| Fresh control, optimization disabled | 181 | 101 ms | 302 ms | 551 ms | 302 / 551 ms |

The two matched runs' worst overall edits were deletions, at 558 and 550 ms
respectively: this change improved the measured typing tail without improving
every worst case. Sequential synthetic hidden-window measurements vary; these
are timings to a matching canvas, not physical-display latency or BaKoMa parity.
The consistent 300 ms target remains unmet.

The packaged 0.110 session completed 132 actions / 181 complete frames, at
135 ms median, 307 ms at the 95th percentile and 573 ms maximum. Typing bursts
took 280 ms median / 440 ms maximum. The slowest action was deleting a paste;
that class took 135 ms median / 573 ms maximum. Autosave, strict PDF export
containing the latest text and normal close/reopen passed. These numbers support
a narrower typing-tail improvement, not an improvement in every latency metric.

The internal performance query can optionally return the existing bounded
64-event routing timeline. The synthetic session harness captures it for slow
actions, helping distinguish preparation, engine work and final display.

A large-replacement routing heuristic was also investigated and fully reverted.
Its first apparent deletion improvement also occurred with the heuristic
disabled, and its trace showed the branch had not run. It is not credited with
any performance gain and is not part of the final implementation.
The earlier 744 ms trace was taken during this discarded routing experiment,
so it is a diagnostic example, not the matched control in the table above.

The focused regression constructs a real PDF paragraph baseline and verifies
that a failed window raster uses page proof without preparing a second region;
it also verifies that a failed page proof still narrows and cannot mark the
context ready or publish output. All 24 focused guards passed.
They also passed in the independent checkout, and 16 packaged runtime assets
matched both builds. The packaged navigation, file-switching and ten-case math
recovery suites passed, including stable source position and preserved pixels.
