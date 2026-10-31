# Mixed lecture editing

## Page-baseline verification (0.109)

Profiling separated native typesetting, page extraction and viewer verification.
In one slow two-page case those stages took about 111, 2 and 859 ms respectively.
The full-page comparison now runs as one serialized PDF-worker job instead of
returning each raster to a large renderer callback for a byte-by-byte loop.
An aligned RGBA buffer is compared four bytes at a time in a small helper; odd
offsets and trailing bytes retain an exact byte comparison. This changes no
pixel tolerance, color/alpha criterion or source/continuation check. Only copies
of immutable accepted rasters are transferred. Leases remain held until the
check finishes, and obsolete proofs are rejected before publishing results.

An intermediate two-page verification fell from about 859 to 175 ms, with native
typesetting still about 110 ms. Ten zoom/DPI combinations and five output cases
give 50 differential checks against the old byte loop: unchanged synthetic and
native TeX pages, altered middle pages, reordered pages and altered native pages.
Malformed input is refused, later valid checks still work, and accepted rasters
remain usable. Unit tests cover aligned/unaligned views, trailing bytes and every
RGBA channel. These checks retain exact whole-page equality.

The final development mixed session completed 132 actions / 183 complete frames:
90 ms median, 309 ms at the 95th percentile and 676 ms maximum. A fresh control
using the unchanged public 0.108 runtime and the same harness completed 186
frames: 106/306/1,037 ms. Thus the new run improved the median and maximum but
did not improve that control's 95th percentile. The earlier packaged 0.108 run
was 96/376/1,482 ms. Sequential local runs vary; this is not a universal speedup
or a claim that the 300 ms consistency target has been achieved.

The packaged 0.109 run completed 132 actions / 183 complete frames: 81 ms
median, 306 ms at the 95th percentile and 698 ms maximum. Typing bursts took
289 ms median / 698 ms maximum; paragraph pastes 83/304 ms and deleting those
pastes 81/631 ms. Autosave, strict PDF export containing the latest text and
normal close/reopen passed. These are synthetic hidden-window timings to a
matching canvas, not measurements of physical display latency or BaKoMa parity.
Packaged cross-page navigation, file switching and ten-case math recovery also
passed; the latter updated in 42–75 ms without full rebuilds or moving the source
pane. Seventeen focused guards passed in both source checkouts, and 16 packaged
runtime assets matched the independent builds.

The remaining stalls include preparing an unfamiliar paragraph and rendering
multiple affected pages. Paragraph-check batching was also investigated but
reverted because it did not consistently help typing. The shipped change is
limited to full-page verification, exact pixel comparison and earlier refusal
of obsolete proof work. Native TeX, saved source, export and lecture layout
semantics are unchanged.

## Live page scheduling (0.108)

Multi-page live updates now submit their whole page band before yielding and
use the same high-priority PDFium lane as live flow fragments. Queued baseline
proofs/lazy pages cannot slip between every live page. PDFium operations remain
serialized, including document teardown; all existing source, raster, navigation
and continuation guards remain. Failed partial batches release every completed
canvas before retiring their document. Strict PDF output is unchanged.

A 12-round development run with corrected timing collection measured 184 frames:
93 ms median, 337 ms at the 95th percentile and 1,167 ms maximum. The comparable
0.107 packaged baseline, recounted from its complete records, measured 93/381/
1,203 ms. This is a modest improvement in sequential synthetic runs, not proof
of a universal speedup. In the new worst typing case, 1,123 ms elapsed before
the candidate reached the renderer; page rendering then took 43 ms. The 300 ms
consistency target remains unmet. Extra placement preflights and focused text
checkpoint captures were tried and reverted because their overhead regressed
the session. The remaining preparation bottleneck needs a broader change.

The packaged 0.108 repeat completed 132 actions / 185 recorded frames, with
latest-text strict export and normal reopen. Compare the complete packaged runs:

| Measure | 0.107, corrected | 0.108 |
|---|---:|---:|
| Typing burst median | 413 ms | 276 ms |
| Typing burst maximum | 1,203 ms | 738 ms |
| All-frame median | 93 ms | 96 ms |
| All-frame 95th percentile | 381 ms | 376 ms |
| All-frame maximum | 1,203 ms | 1,482 ms |

The new largest outlier was deletion of a large paste requiring full recovery.
Thus the typing-burst improvement does not establish a general reduction in
worst-case latency. Packaged cross-page navigation, Follow typing, stale clicks,
ten-case math recovery, unchanged surrounding pixels and source-pane stability
passed. Fifteen queue/raster/recovery guards passed in both independent builds;
16 packaged runtime assets matched both builds.

The timing collector now unions observed intermediate frames with all confirmed
current-source/action frames, and asserts that its maximum includes every
confirmed slow action. The corrected 0.107 counts below supersede the original
observer-only percentiles.

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
including strict export and reopen. Across 362 observed intermediate/final frames,
median latency was 96 ms, the 95th percentile was 366 ms and the maximum was
1,258 ms. Most pastes/deletions stayed local (22/24 each), but page-boundary and
paragraph-preparation cases still caused slow updates. Ordinary typing therefore
does **not** yet consistently meet the 300 ms target. No slower sample is omitted.

The packaged 0.107 runtime passed a further 12 rounds / 132 actions. Its 182
observed frames measured 93 ms median, 381 ms at the 95th percentile and 1,203 ms
maximum. Paste/deletion medians were 113/100 ms, with 10/12 local updates each.
Autosave, strict export containing both document ends and the latest edited word,
normal close/reopen, cross-page two-way navigation, passive following, highlight
expiry and stale-click rejection passed. Development math-recovery/unchanged-pixel
regression also passed all ten error cases; 12 focused raster/recovery guards
passed in both builds. Packaged runtime assets matched independent builds.

These counts/percentiles were corrected during 0.108 testing. A full-frame
canvas can acquire timing metadata before DOM attachment, so the mutation
observer missed some updates. The harness now merges its observations with
every source-hash/edit-ID-confirmed action. Previously reported worst-case
action times remain valid; the initial observer-only percentiles understated
the slow tail. The retained raw reports permit this recount without rerunning
or discarding any slow samples.

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
