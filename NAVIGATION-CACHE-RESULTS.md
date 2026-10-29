# Navigation preparation follow-up

This is a development follow-up to 0.109, not a new portable release.
The existing 0.109 executable remains the recommended local build.

The compositor parsed the same immutable compiler navigation transcript for
paragraph-page matching, placement, caret lookup and each affected page's source
locations. It also rebuilt the same exact anchor index during preparation.
Those reads now share a bounded cache keyed by the complete transcript string.
It retains at most four entries and four million transcript characters; inputs
over two million characters or 50,000 glyph rows bypass it. Cache entries contain
only parsed navigation and a lazily built anchor index, not compiler state,
PDF documents, canvases or authorization to display an edit. Page/file identity,
ambiguous-anchor refusal and every existing visual proof remain unchanged.

In a repeated 12,890-glyph, 639,588-character navigation lookup, interleaved
measurements gave about 10.8 ms before and 1.7 ms after. This isolated saving
does not establish a comparable improvement in complete edit latency.

All three longer runs below used 132 synthetic editing actions. The first
added timing diagnostics to unchanged 0.109 behavior; the second used the
unchanged public 0.109 runtime; the third used the cache plus shared anchor index.

| Run | Complete frames | Median | 95th percentile | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Instrumented control | 181 | 135 ms | 376 ms | 663 ms |
| Fresh unchanged 0.109 control | 184 | 110 ms | 309 ms | 685 ms |
| Navigation and anchor cache | 178 | 91 ms | 374 ms | 704 ms |

Typing-burst median/maximum was 271/650 ms in the fresh control and 270/597 ms
with the cache. The cached run's worst action was deleting a pasted paragraph.
The lower overall median is encouraging, but the tail did not reliably improve.
Sequential hidden-window measurements to a matching canvas vary with system
load; these are not physical-display timings or a BaKoMa comparison. The
consistent 300 ms target remains unmet. No new portable was made for this pass.

Detailed paragraph-proof diagnostics now separate document loading, raster
reads, pixel comparison, crop parity and placement correction. One failed check
took about 188 ms: 1 ms loading, 84 ms reads, 15 ms comparison and 87 ms correction.
Other checks spent 56–68 ms loading before 91–111 ms of reads. A correction may
require another full check, followed by page-band preparation if paragraph
composition still fails. Reducing these transitions is more consequential than
optimizing another small pixel loop.

Two other experiments were rejected. Disabling two-paragraph preparation made
some typing outliers shorter but worsened deletion and median typing in a short
comparison. A packed equal-pixel fast path cut an isolated paragraph comparison
from about 3.0 to 1.3 ms, but the editing run did not consistently improve. Its
3,000 differential cases agreed with the original implementation; the production
change was nevertheless reverted. Neither experiment changes the shipped defaults.

The final cache passed 23 focused guards, including exact revision identity,
derived-output mutation isolation, page/file filtering, entry/count/text limits,
oversized bypass, failed parses and repeated ambiguous-anchor refusal. The
mixed editing run passed autosave, strict export containing the latest text,
normal close/reopen and error correction. Two-way cross-page navigation, Follow
without highlighting, highlight expiry and stale-click refusal also passed.
The guards passed in an independent source checkout as well. Disposable projects, profiles and
temporary build data were kept on the external test drive.
