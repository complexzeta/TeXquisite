# MiKTeX native compatibility

Verified on 2026-11-01 in [cloud run 41319437137](https://github.com/complexzeta/TeXquisite/actions/runs/41319437137), source commit `78a5af9e13983b39ffc52051184aecf359d7cc58`.

Both Windows Server 2022 and Windows Server 2025 passed. Each fresh runner installed basic MiKTeX 25.12, verified its official installer checksum, applied available package updates, and used **MiKTeX-pdfTeX 4.27 / MiKTeX 26.5**. The installation was private to the runner user, in a custom folder containing spaces. Required packages, command links, font maps and formats were prepared before app testing. Missing transitive dependencies were fetched during a one-time setup compile. Perl was supplied by the runner, and the test child PATH excluded other TeX distributions.

No MiKTeX installation or application testing ran on the user's computer. Only bounded results and logs were saved to Kingston; distribution installers and installed trees remained on the disposable runners.

## What passed

Each runner passed 18 focused discovery, navigation and diagnostic guards, then three real-distribution/application records: native compilation, the development source app **0.123.0**, and the checksum-verified public **0.122.0** portable. All six records passed across the two runners.

- PATH discovery and manual installation-root selection, including paths with spaces.
- Explicit native-only status and disabled fast-format preparation for MiKTeX.
- Actionable failure when Perl is removed from the test PATH: MiKTeX's latexmk wrapper requires Perl.
- Missing-package failure without a hidden prompt when installation is disabled; successful on-demand installation of `cancel` when explicitly enabled.
- A two-page document containing prose, amsmath, graphicx, hyperref and TikZ; subsequent native text edits.
- Native SyncTeX forward and inverse queries on page two; source-to-page-two navigation in both app builds.
- Automatic saving and preview updates, verified PDF export, nonmodal missing-package errors, refusal to replace a valid export with broken source, and automatic recovery after correction.
- Restart restoring source without reopening setup, and rejection of an invalid selected installation rather than borrowing a PATH installation.

## Observed timings

Milliseconds, one synthetic sample per case and runner:

| Runner | Native initial build | Native text edit | Development app edit | Public 0.122 app edit |
| --- | ---: | ---: | ---: | ---: |
| Windows Server 2022 | 2806 | 1649 | 1989 | 1990 |
| Windows Server 2025 | 2977 | 1776 | 1983 | 1988 |

Native measurements cover build request to accepted publication. App measurements cover the scripted edit through renderer preview acknowledgment, not the physical display. These are smoke-test samples, not latency guarantees or representative distributions.

## Limits and a discovered fix

**MiKTeX remains an experimental native backend.** The persistent local lecture-preview pipeline currently requires an indexed TeX Live tree; this campaign does not add that capability to MiKTeX. Approximately two-second native updates are substantially slower than TeXquisite's warm local TeX Live updates.

A subsequent [isolated fast-preview experiment](MIKTEX-FAST-PREVIEW-EXPERIMENT.md) successfully used MiKTeX inputs with the existing persistent compiler. Its preparation was reduced from 212–228 seconds to approximately 28 seconds, with cached reuse taking 2.8–2.9 seconds and six warm local compiler updates taking 17–31 ms. It is not an enabled app feature: production resource lookup and UI integration still need implementation and validation. TeX Live's production paths were unchanged and its separate control passed.

Public 0.122 can show a generic **Emergency stop** for a missing package even though the build log contains the actual missing filename. Both public-app tests explicitly recorded that limitation, then verified export protection and recovery. The development 0.123 parser now keeps the earlier concrete TeX error when a later located message is only a generic stop. It preserves the captured file/line checks and refuses arbitrary file aliases. Both development-app tests verified the specific missing-package message. This fix has not been published as a new portable release or installed locally by this campaign.

This is not a matrix of all MiKTeX releases or user configurations. Shared/admin installations, portable MiKTeX, default Ask-to-install dialogs, consumer Windows 10/11 images, proxies, bibliography processors, XeLaTeX, LuaLaTeX, PostScript workflows and macOS/Linux were not covered. Package versions can change between runs because the campaign applies current repository updates. Its package-manager setup and explicit Yes/No installation policies should not be confused with untouched first-run defaults.

## Repeating the campaign

The manually dispatched **TeX Live compatibility** workflow accepts the `miktex` suite and calls the dedicated MiKTeX matrix. Installation and test scripts refuse local execution; the installer additionally requires a destination inside `RUNNER_TEMP`. Artifacts contain result JSON and bounded logs, not installed distributions, user profiles or manuscripts. The public portable's version and checksum are pinned in `scripts/prepare-portable-test.ps1`.

Installer and package-management commands follow the [official MiKTeX setup documentation](https://docs.miktex.org/manual/setupwiz.html), [package manager](https://docs.miktex.org/manual/miktex-packages.html), and [executable-link utility](https://docs.miktex.org/manual/miktex-links.html).
