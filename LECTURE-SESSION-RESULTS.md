# Mixed lecture editing (0.107)

The new disposable lecture-session harness uses a five-page, 100-paragraph
mathematical document. It types character bursts with 85 ms spacing, pastes and
deletes 80-word spans, performs undo/redo, moves between four distant paragraphs,
types with a misspelled command present, corrects it, and pastes/deletes sections.
Each measurement requires a fresh edit ID and matching complete-source hash.
Intermediate character frames are observed separately. Final saving, strict
Build/Export and normal close/reopen are checked. No user document is used.

## Targeted improvement

A slightly overfull line exceeded the nominal crop by about one pixel. Rejecting
that crop sent the entire document through verification and then repeated local
preparation. The checked live-flow raster can now capture actual rightmost ink
within a bounded 12 bp margin. It still checks the whole raster, rejects vertical
or left overflow and ink reaching the page edge, and rejects a tile exceeding its
destination canvas. The extra pixels are copied from the same checked raster.
Strict baseline proofs keep their original bounds. The compiler and saved TeX
are unchanged.

Two six-round development runs showed the specific improvement:

| Action | 0.106 median | Updated median | Updated local updates |
|---|---:|---:|---:|
| Paragraph paste | 292 ms | 116 ms | 5/6 |
| Delete paste | 672 ms | 60 ms | 5/6 |

These small sequential runs are observations, not controlled system-wide speed
guarantees. A shorter proof timeout was also tried and reverted because it made
error paths worse; it is not part of the update.

## Longer run and remaining limits

The updated development runtime completed 24 rounds / 264 confirmed actions,
including strict export and reopen. Across 334 observed intermediate/final frames,
median latency was 90 ms, the 95th percentile was 345 ms and the maximum was
1,258 ms. Most pastes/deletions stayed local (22/24 each), but page-boundary and
paragraph-preparation cases still caused slow updates. Ordinary typing therefore
does **not** yet consistently meet the 300 ms target. No slower sample is omitted.

The packaged 0.107 runtime passed a further 12 rounds / 132 actions. Its 164
observed frames measured 84 ms median, 345 ms at the 95th percentile and 1,203 ms
maximum. Paste/deletion medians were 113/100 ms, with 10/12 local updates each.
Autosave, strict export containing both document ends and the latest edited word,
normal close/reopen, cross-page two-way navigation, passive following, highlight
expiry and stale-click rejection passed. Development math-recovery/unchanged-pixel
regression also passed all ten error cases; 12 focused raster/recovery guards
passed in both builds. Packaged runtime assets matched independent builds.

Private committed memory across the app's processes grew while warming from about
848 MiB to 1,318 MiB, then fluctuated around 1,244–1,345 MiB for the rest of this
run, ending at 1,288 MiB. Main-process JavaScript heap fluctuated between about
19 and 61 MiB. This run showed a plateau rather than continued linear growth;
it is not proof against leaks in multi-hour sessions or arbitrary documents.

Timings end at matching canvases in hidden test windows, not physical monitor
scanout. Initial loading is excluded from edit measurements. All large fixtures,
profiles and package staging live on external test storage and are removed after
the small reports are verified. The remaining priority is preparation and
multi-page raster cost during typing at a page boundary.
