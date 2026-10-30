# Performance follow-up after 0.111

This pass did not establish a reliable whole-app speedup. All runtime prototypes
were reverted, and 0.111 remains the recommended executable. No 0.112 runtime
or binary was promoted. The source remains functionally unchanged from the
0.111 implementation.

Three approaches were investigated:

- An edit-arrival-dependent page hint attempted to skip original paragraph
  extraction for large contractions. It depended on when the edit arrived and
  produced worse outliers, including a confirmed 735 ms action.
- A source-matched letter/page hint narrowed cross-page windows earlier and
  selected verified page output directly for multi-page paragraphs. It removed
  a real paragraph extraction and saved about 50 ms in one deletion trace.
  Its packaged whole-session result did not retain an overall improvement.
- A cost-based route returned an idle compiler directly to full verification
  for eligible large contractions when a recent full build took at most 350 ms.
  Reused/prefetched jobs could not supply that timing, and recovered baselines
  were excluded. The matched development deletion maximum was 395 ms versus
  434 ms with the route disabled; the overall 95th percentile was essentially
  unchanged at 321 versus 319 ms. This modest targeted gain was insufficient
  to establish a reliable packaged improvement.

Each packaged mixed session below used 132 actions. Complete-frame statistics
include intermediate frames and every source-hash/edit-ID-confirmed action.

| Packaged run | Frames | Median | 95th percentile | Maximum | Delete-paste maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Existing 0.111 | 185 | 92 ms | 294 ms | 436 ms | 436 ms |
| Rejected page-hint prototype | 191 | 99 ms | 344 ms | 522 ms | 466 ms |
| Rejected cost-route prototype | 190 | 130 ms | 327 ms | 459 ms | 427 ms |

Sequential local runs vary; this table does not establish that every prototype
is inherently slower. It shows why none justified replacing 0.111. These are
synthetic hidden-window timings to a matching canvas, not physical-display
measurements or a comparison with BaKoMa. Consistently staying below 300 ms
remains unproven.

Correctness was checked separately from performance. Native page-output and
warm-owner fixtures matched both pages and page counts against independent full
compiles. The controller/routing suite passed 44 guards, and the packaged
navigation, file-switching, math-recovery, save/export and reopen checks passed.
Sixteen packaged assets matched independent builds. Those checks established
correctness of the tested paths, not a speed benefit. After restoration, the
original 25 focused guards passed again in both source checkouts.

The remaining slow cases still combine preparation, native execution and full
viewer/storage publication. Substantial further progress likely needs a larger
change to persistent preparation or the live-preview pipeline, accompanied by
measurements that separate CPU work, waiting and data movement. This pass does
not establish a hard lower bound or show that the 300 ms goal is impossible.

Disposable projects, profiles, temporary engines and package staging were kept
on the external test drive and removed after retaining small verified reports.
User documents, settings and existing trial installations were untouched.
