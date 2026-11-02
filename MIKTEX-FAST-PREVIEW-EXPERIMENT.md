# MiKTeX fast-preview feasibility experiment

This is a cloud-only prototype, not an enabled application feature or a new portable release. Production compiler, lookup, format-integrity and TeX Live paths remain unchanged. The installed/public 0.122 application still uses native compilation with MiKTeX.

## What is being tested

The existing persistent preview compiler can load an in-memory format prepared from the selected installation's LaTeX inputs. MiKTeX lacks the TeX Live `ls-R` index assumed by the current integration. Its utility supports multiple filenames, but the adapter must account for sparse missing-file output, aliases, explicit file-type fallback and its missing-file exit status.

The experiment creates a temporary index inside a disposable cloud MiKTeX tree, copies the compiled workers and compiler assets into its test directory, and adapts lookup calls in those copies only. Its initial version used single-file native queries with an explicit TeX-file search fallback; the optimized version batches them. Each positive lookup must resolve to an existing absolute file. Missing lookups tolerate only the two observed runner warnings and the expected missing-file exit status; other failures remain failures. Format input hashes, native lookup precedence for the format dependencies, and the document self-test remain checked. The temporary index is removed afterward; original initialization inputs are checked for unchanged bytes on successful completion.

This filesystem layout and process shim are experiment scaffolding. A production implementation needs a proper MiKTeX resource backend in the application cache, without writing an index into users' installations or patching compiled workers.

The test document loads amsmath and TikZ and contains ordinary text and inline math. Three repeated text edits exercise an already prepared local region. They measure compiler response, not renderer acknowledgment or physical screen latency. They do not establish cold-picture speed, arbitrary-preamble compatibility, native-PDF equivalence or complete UI/navigation support with MiKTeX.

## Initial prototype

[Experiment run 41322753629](https://github.com/complexzeta/TeXquisite/actions/runs/41322753629), source `4dccb3629282c0bd9ac3ca4b4d62bf1ecb54561b`, completed successfully on both Windows Server runners with MiKTeX 26.5. Both result records explicitly report `fastPossible: true`, a prepared format, a resident document, three local edit outputs and unchanged original initialization inputs. Each disposable index contained 8,850 installed files.

| Runner | Format preparation | Three warm compiler updates |
| --- | ---: | --- |
| Windows Server 2022 | 227,681 ms | 28, 19, 21 ms |
| Windows Server 2025 | 212,225 ms | 26, 19, 18 ms |

These six samples demonstrate feasibility, not an end-to-end latency guarantee. The initial approximately 3.5–3.8 minute preparation cost was dominated by repeatedly launching native lookup processes. The optimization below retains the file/hash/precedence checks rather than skipping validation.

Earlier experiments established that an index alone was insufficient: format generation and its math self-test reached batch lookup verification, which failed. After isolated lookup adaptation, format preparation passed; a missing copied asset directory in the test harness was corrected before the final successful run.

## Preparation optimization

The experimental adapter supports up to 240 requested names per batch with a conservative 20,000-character command budget; its default remains 80. Each request is followed by two distinct, already resolved LaTeX filenames. Their returned paths frame the optional result, so missing files and aliases cannot shift subsequent answers. An alias resolving to either delimiter is still unambiguous. Changed delimiter precedence or malformed output refuses validation. Framed answers need no redundant alias queries. Only files absent from the default search receive the explicit TeX-file fallback. Without delimiter hints, sparse responses are conservatively subdivided and unexpected basenames receive individual verification. Every validation obtains fresh native resolution; there is no cross-validation positive or negative lookup cache that could hide an override or newly available input.

This follows the ordered lookup loop and missing-file output in [MiKTeX's lookup implementation](https://github.com/MiKTeX/miktex/blob/next/Libraries/MiKTeX/KPathSeaEmulation/test/kpsewhich/source/kpsewhich.c). The tests cover full/partial batches, alias collisions, duplicates, reordered responses, changed overrides, newly available files, bounded requests, failed processes, unexpected diagnostics, unsafe names, delimiter collisions and stale delimiter hints. The real-MiKTeX probe compares the optimized result with the previous single-file method and verifies cache reuse without rebuilding, refusal of corrupted format bytes and refusal of a negative lookup contradicted by a present package.

[Final preparation run 41328162409](https://github.com/complexzeta/TeXquisite/actions/runs/41328162409), source `bea707cff9b59ebf74f17768c4950ea725822938`, passed on both Windows Server runners with MiKTeX 26.5:

| Runner | Initial prototype preparation | Optimized preparation | Cached format reuse | First resident initialization | Three warm compiler updates |
| --- | ---: | ---: | ---: | ---: | --- |
| Windows Server 2022 | 227,681 ms | 28,252 ms | 2,824 ms | 3,727 ms | 25, 18, 17 ms |
| Windows Server 2025 | 212,225 ms | 28,109 ms | 2,910 ms | 3,843 ms | 31, 22, 20 ms |

Preparation was approximately **7.6–8.1 times faster** in these samples. The preparation timer covers format generation and validation, excluding installation, resource discovery and the test-only reference-lookup comparison. Cached reuse includes fresh integrity and native resolution checks and was verified not to rebuild the format. First resident initialization is a separate measurement that includes another validation and loading the test document's preamble. Local region preparation after that took 5–6 ms.

Each runner passed **41 focused tests**: 16 adapter cases, seven existing format-cache guards, 12 toolchain/footer cases and six diagnostics cases. Both real probes confirmed lookup equivalence, unchanged original initialization inputs, valid local output, cache reuse without rebuilding and refusal of corrupted or contradicted cached state. Cached validation now uses six native processes; format generation and validation use 40. The earlier plain-batch experiment still needed 69 processes for cached validation on its measured runner.

That pass still had a noticeable one-time cost: its profiles attributed approximately 16.6–16.9 seconds to native lookup processes, with the remainder in format generation, self-test and other validation work. These results do not establish a hard lower bound or an end-to-end app latency guarantee. Production integration remains separate work. TeX Live's runtime code and the installed application were not changed.

A transient official-installer connection failure occurred in an intermediate run before compilation. The cloud installer now retries transport failures up to three times and still requires the pinned installer checksum. The final run completed successfully on both systems. All bulk installations/builds remained on cloud machines; only bounded evidence was saved locally.

## Fresh validation sessions and extensionless inputs

[Follow-up run 41385683346](https://github.com/complexzeta/TeXquisite/actions/runs/41385683346), source `314599f2d3ec6d9c0a706fb0cc0f631861795767`, passed both Windows runners with MiKTeX 26.5. This follow-up rebuilds only disposable experimental worker copies from the unchanged runtime sources, with narrowly checked hooks for lookup sessions, larger verification batches, timing and indexed TeX extension handling.

Each format validation resolves its complete positive/negative name list in one fresh native lookup session. The original validator's groups then share that result only for that function call. The next validation always queries MiKTeX again. Existing compiler/format/input hashes, native resolution comparisons and negative-lookup rejection remain active.

Ten format inputs were requested without `.tex`, including Cyrillic hyphenation helpers and glyph-to-Unicode data. The experimental index now tries the `.tex` candidate after an exact filename and after any established native override. The original native canonical-resolution check still verifies every loaded input and repeats preparation with an override if its bytes differ. Explicit extensions and font names do not gain an extra `.tex` suffix. A speculative optional-file precheck showed no hits in profiling and was removed.

| Runner | Prior preparation | Updated preparation | Prior cached reuse | Updated cached reuse | First resident initialization | Three warm compiler updates |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Windows Server 2022 | 28,252 ms | 17,461 ms | 2,824 ms | 1,074 ms | 1,693 ms | 18, 14, 12 ms |
| Windows Server 2025 | 28,109 ms | 21,929 ms | 2,910 ms | 1,100 ms | 2,037 ms | 26, 15, 17 ms |

Cached validation uses **two native processes instead of six**; generation plus final validation uses 24 instead of 40. Both runners passed **48 focused tests**: 23 lookup/session/index cases, seven existing format-cache guards, 12 toolchain/footer cases and six diagnostics cases. Both real probes verified unchanged original initialization inputs, equivalence with single-file lookup, no-rebuild cache reuse, corrupted-format rejection and contradicted-negative rejection. They also created a genuinely new previously missing input in the disposable registered TeX tree: validation refused the old format, then recovered after removal and a filename-database refresh. This exercises fresh native state between validations, beyond mocked lookup tests.

The remaining cold cost is concentrated in kernel generation and optional-input/font probing. The kernel stage took 11.4–15.6 seconds and the document self-test about 3.8–3.9 seconds, **including** native calls within those stages. Total native process time was about 9.6–9.8 seconds; these overlapping figures must not be added together. Further cold-start improvement remains possible, but these measurements are not a hard lower bound or an end-to-end screen-latency guarantee. Warm edits still reuse the existing compiler. No production MiKTeX fast path, portable release or local application update is enabled by this experiment.

## Next implementation boundary

Implement a MiKTeX-specific resource and lookup backend, selected only for a positively identified MiKTeX installation. Keep TeX Live's current indexed lookup path and existing formats intact. Store generated indexes/formats in the application cache, validate selection and overrides, and retain native compilation as the fallback. Then verify actual app rendering, navigation, recovery, export and representative package/document cases before enabling it. No production fast-preview support is enabled by this experiment.

## TeX Live control

[Control run 41321266680](https://github.com/complexzeta/TeXquisite/actions/runs/41321266680), source `7bac39fdde2274ae28e0886f34a1cb8c47bfa8a9`, used TeX Live 2026 on a separate Windows cloud runner. It passed 81 focused guards, one real native retained integration test, and all seven source-app result records: performance report, recovery navigation, status bar, compact fit, recovery idle, automatic recovery and retained layout.

Subsequent changes are confined to MiKTeX experiment scripts, their tests, workflow test steps and documentation. This control is evidence for the unchanged TeX Live path, not certification of a future production MiKTeX backend.

## Repeating it

Dispatch **TeX Live compatibility**, suite `miktex-fast`, with packaging disabled. It invokes separate Windows Server 2022 and 2025 MiKTeX jobs. Inspect each result's `fastPossible`, `stage` and `error`: the probe deliberately records an unsuccessful feasibility result without failing the entire workflow. A green workflow alone does not prove fast preview works.

The scripts require GitHub CI and a disposable installation under `RUNNER_TEMP`. Only bounded result JSON and logs are uploaded; installed distributions, copied workers and compiler assets remain on the cloud machines.
