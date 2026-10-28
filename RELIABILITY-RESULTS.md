# Reliability checks: TeXquisite 0.96.0

On 27 October 2026, the published Windows x64 portable passed the workflows below using isolated generated projects. The application runtime was unchanged. The source changes from this pass improve regression tests and their artifact handling; no new binary release was needed.

Environment: Windows 11 Pro build 26200, Node.js 24.15.0 for the test tools, and installed TeX Live 2025 (pdfTeX 1.40.28). Test profiles, projects, extracted runtime and temporary files were placed on the external test drive.

## Results

| Area | Checked behavior | Result |
| --- | --- | --- |
| Saving, backups, roots and diagnostics | 25 functional guards, including CRLF preservation, edits during saving, temporary file locks, external changes, corrupted backups and source identities | Passed |
| Test artifact policy | Three guards for missing/ambiguous external drives, explicit artifact roots and bounded fixture labels | Passed |
| Whole-document paste | Stale clean session adopts disk; approximately 38 KB replacement saves and produces a matching-source preview; another project opens while an old tab is conflicted | Passed |
| Conflict recovery | Reload preserves the draft in recovery; Save copy protects external disk contents and resumes saving | Passed |
| Close and crash handling | Conflict, cancelled close and crashed renderer preserve drafts; a nonterminating compiler does not prevent closing | Passed |
| Backup interface | Periodic paused drafts, disable/restart, manual backup, cancelled restore and restore to a new copy; existing destination remains protected | Passed |
| Diagnostics | Incomplete math retains the last good preview; included-file locations, stale-location rejection, repair and restart recovery | Passed |
| Document tabs | Standalone roots, included chapters, delayed edits from previous tabs, Build and restart preserve the correct selected project | Passed |
| Editing session | 24 cycles across two TikZ pictures, prose changes, two undo/redo pairs and two incomplete-formula repairs; all edits saved | Passed |
| Path and restart handling | Project directory `Lecture notes café`, file `lecture notes.tex`; both fully rendered pages exactly match before and after normal restart | Passed |

One additional real-symlink backup fixture was **not exercised**: the selected exFAT artifact filesystem cannot create file symlinks. A separate portable metadata-injection test verifies rejection and retention behavior, but does not replace operating-system symlink coverage on a supporting filesystem.

The repeatable runner was additionally smoke-tested with its unit and backup suites, including successful fixture cleanup and reporting of the skipped filesystem case. The eight application workflows above were run separately against the checksum-verified published portable.

## Scope and limits

These are local reliability checks on one Windows/TeX installation, not a new cross-machine compatibility matrix, a multi-hour soak or a physical-display latency benchmark. Existing cross-machine evidence remains documented in [COMPATIBILITY-RESULTS.md](COMPATIBILITY-RESULTS.md). No reproducible application defect was found in the covered workflows; this does not establish that all documents or failure modes are covered.

The pass corrected older test artifact destinations and a synchronization issue in the paste test. The strengthened test waits for the newly active document and checks its exact source and preview hash, rather than accepting a status message or an early root-label update.

## Repeating the checks

After installing dependencies and TeX, run `npm run test:reliability`. Windows campaigns require Kingston or an explicit `PERSISTENT_TEX_TEST_ARTIFACTS` location. `PERSISTENT_TEX_EXECUTABLE` selects an extracted portable; otherwise the development runtime is used. Successful fixture payloads are cleaned after their small reports are copied and byte-verified. Failed fixtures are retained for diagnosis. The runner records filesystem skips and selected suites separately from passing checks.
