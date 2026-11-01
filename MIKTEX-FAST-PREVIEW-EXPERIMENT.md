# MiKTeX fast-preview feasibility experiment

This is a cloud-only prototype, not an enabled application feature or a new portable release. Production compiler, lookup, format-integrity and TeX Live paths remain unchanged. The installed/public 0.122 application still uses native compilation with MiKTeX.

## What is being tested

The existing persistent preview compiler can load an in-memory format prepared from the selected installation's LaTeX inputs. MiKTeX lacks the TeX Live `ls-R` index assumed by the current integration, and its lookup behavior cannot simply be treated as Kpathsea's batch/exit-code contract.

The experiment creates a temporary index inside a disposable cloud MiKTeX tree, copies the compiled workers and compiler assets into its test directory, and adapts lookup calls in those copies only. It uses single-file native queries with an explicit TeX-file search fallback. Each positive lookup must resolve to an existing absolute file. Missing lookups tolerate only the two observed runner warnings and the expected missing-file exit status; other failures remain failures. Format input hashes, native lookup precedence for the format dependencies, and the document self-test remain checked. The temporary index is removed afterward; original initialization inputs are checked for unchanged bytes on successful completion.

This filesystem layout and process shim are experiment scaffolding. A production implementation needs a proper MiKTeX resource backend in the application cache, without writing an index into users' installations or patching compiled workers.

The test document loads amsmath and TikZ and contains ordinary text and inline math. Three repeated text edits exercise an already prepared local region. They measure compiler response, not renderer acknowledgment or physical screen latency. They do not establish cold-picture speed, arbitrary-preamble compatibility, native-PDF equivalence or complete UI/navigation support with MiKTeX.

## Results

[Experiment run 41322753629](https://github.com/complexzeta/TeXquisite/actions/runs/41322753629), source `4dccb3629282c0bd9ac3ca4b4d62bf1ecb54561b`, completed successfully on both Windows Server runners with MiKTeX 26.5. Both result records explicitly report `fastPossible: true`, a prepared format, a resident document, three local edit outputs and unchanged original initialization inputs. Each disposable index contained 8,850 installed files.

| Runner | Format preparation | Three warm compiler updates |
| --- | ---: | --- |
| Windows Server 2022 | 227,681 ms | 28, 19, 21 ms |
| Windows Server 2025 | 212,225 ms | 26, 19, 18 ms |

These six samples demonstrate feasibility, not an end-to-end latency guarantee. The approximately 3.5–3.8 minute preparation cost is unacceptable for routine initialization. The prototype repeatedly launches native lookup processes to verify input resolution. A production backend must improve that setup and validation path while retaining the file/hash/precedence checks; simply weakening those checks is not an acceptable optimization.

Earlier experiments established that an index alone was insufficient: format generation and its math self-test reached batch lookup verification, which failed. After isolated lookup adaptation, format preparation passed; a missing copied asset directory in the test harness was corrected before the final successful run.

## Next implementation boundary

Implement a MiKTeX-specific resource and lookup backend, selected only for a positively identified MiKTeX installation. Keep TeX Live's current indexed lookup path and existing formats intact. Store generated indexes/formats in the application cache, validate selection and overrides, and retain native compilation as the fallback. Then verify actual app rendering, navigation, recovery, export and representative package/document cases before enabling it. No production fast-preview support is enabled by this experiment.

## TeX Live control

[Control run 41321266680](https://github.com/complexzeta/TeXquisite/actions/runs/41321266680), source `7bac39fdde2274ae28e0886f34a1cb8c47bfa8a9`, used TeX Live 2026 on a separate Windows cloud runner. It passed 81 focused guards, one real native retained integration test, and all seven source-app result records: performance report, recovery navigation, status bar, compact fit, recovery idle, automatic recovery and retained layout.

Subsequent changes are confined to the MiKTeX experiment script. This control is evidence for the unchanged TeX Live path, not certification of a future production MiKTeX backend.

## Repeating it

Dispatch **TeX Live compatibility**, suite `miktex-fast`, with packaging disabled. It invokes separate Windows Server 2022 and 2025 MiKTeX jobs. Inspect each result's `fastPossible`, `stage` and `error`: the probe deliberately records an unsuccessful feasibility result without failing the entire workflow. A green workflow alone does not prove fast preview works.

The scripts require GitHub CI and a disposable installation under `RUNNER_TEMP`. Only bounded result JSON and logs are uploaded; installed distributions, copied workers and compiler assets remain on the cloud machines.
