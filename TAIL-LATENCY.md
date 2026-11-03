# Preview tail latency: 0.126.0

Version 0.126.0 fixes a restart loop that could keep the preview stale during continued typing. It improves the measured tail substantially, but **does not yet meet a 300 ms 99.9th-percentile target**.

## Controlled campaign

Both versions received 4,096 edits in each of six scenarios: 24,576 edits per version, 49,152 total. The same synthetic fixtures and input schedule were used. Input was offered every 65 ms, with 900 ms pauses between 64-edit bursts and an additional 2.5 s pause every 512 edits. Tests did not wait for compiler readiness or the preceding preview between edits.

The sequence includes ordinary typing and deletion, moving between paragraphs/pages, joining and splitting paragraphs, changing leading body newlines, temporarily placing body text on the same line as `\begin{document}`, unfinished math, and undefined commands. Errors remain while further edits are made before correction. Follow typing and a visible window are enabled.

Latency runs from the scheduled input time to a completed preview frame for that revision or a newer coalesced revision. Display completion is recorded on the stable preview host, including full builds and continuous-scroll patches, at the renderer's existing completion endpoint. Visible full/flow/page/paragraph paths allow a paint opportunity; this is not a physical display measurement. Input queue delays are included. Failed or unobserved updates remain in the report as censored observations rather than being discarded. Neither final campaign contained censored observations.

| Scenario | 0.125 p99.9 | 0.126 p99.9 | 0.125 worst | 0.126 worst |
| --- | ---: | ---: | ---: | ---: |
| Body boundaries and paragraph changes | 16,652 ms | 1,052 ms | 16,912 ms | 1,187 ms |
| Nine-page document and distant edits | 12,928 ms | 1,393 ms | 13,188 ms | 1,487 ms |
| Theorem/math document | 13,106 ms | 1,076 ms | 13,201 ms | 1,185 ms |
| Low-memory policy | 1,693 ms | 1,017 ms | 1,774 ms | 1,069 ms |
| High pixel density (2.5) | 38,278 ms | 971 ms | 38,538 ms | 1,029 ms |
| CPU contention | 1,588 ms | 1,055 ms | 1,616 ms | 1,064 ms |

These are separate Windows 2025 GitHub runner sessions with TeX Live 2026, not a timing guarantee on every machine. The low-memory scenario mocks the application's free-memory reading to 256 MiB; it does not reproduce operating-system paging. Contention uses two duty-cycled CPU workers. The long-document scenario deliberately changes editing location frequently. The campaign does not cover arbitrary TikZ programs or all preambles. No private manuscript, profile, or user source was uploaded.

The median is not uniformly improved: the low-memory policy scenario went from 101 to 212 ms, and its fraction over 300 ms increased. Separate runner variability and broader fallback work still matter. The table supports a substantial tail improvement, not a claim that every edit is faster.

## Fixes

- A one-second obsolete-draft timer previously killed an in-flight resident compiler. Startup slightly beyond that deadline could repeatedly lose the preamble checkpoint during continued input. Resident work now completes once before consuming the newest pending revision; its own timeout still bounds execution. Obsolete native fallback remains interruptible, as does explicit cancellation.
- Obsolete resident error repairs are skipped between compiler calls instead of destroying the warm worker when newer source arrives.
- Rapid edit/reversal RPCs compare against the newest queued text. An acknowledgement of earlier text cannot suppress a required correction.
- Local paragraph selection starts at the verified native body boundary. Removing leading blank lines cannot accidentally select the preamble as part of a paragraph. Inline body text inside TeX's input read-ahead remains guarded and can require a full update.

## Evidence and remaining work

[Baseline campaign](https://github.com/complexzeta/TeXquisite/actions/runs/41550648921), [candidate campaign](https://github.com/complexzeta/TeXquisite/actions/runs/41551170166), and [source/package verification](https://github.com/complexzeta/TeXquisite/actions/runs/41551005271) are tied to exact source commits in the permanent release's `TAIL-LATENCY-RESULTS.json` and provenance. Release downloads preserve the summary after temporary Actions artifacts expire. Source/package verification passed 90 selected unit/native checks and 17 integration/package reports. Additional queue and startup-deadline regression tests passed in the tail workflow.

The tail workflow runs in measurement mode by default: a successful workflow means the fixture, source preservation and reporting checks passed, **not** that the latency target passed. The permanent result explicitly records `targetsMet: false` for every scenario. A stricter optional `TAIL_ENFORCE=1` check remains available in the harness.

The next bottleneck is the full-update fallback after changes cross a prepared region or the begin-document input buffer, and after paragraph structure changes. Those cases still produced roughly one-second pauses, including ordinary typing queued behind them. Improving that path must preserve checkpoint, raster, navigation and strict-export checks. A fast isolated edit is insufficient evidence of reliability; future changes should repeat the open-loop tail campaign and inspect the worst inputs.
