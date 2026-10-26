# TeXquisite 0.85.0 compatibility results

Completed 26 October 2026. [Full GitHub Actions run](https://github.com/complexzeta/TeXquisite/actions/runs/40389115883) at source commit `514daca6f736a4e16f81cdf75044280b04ba0bda`. The packaged tests used the checksum-verified published 0.85.0 portable payload. No application runtime changes were needed.

| Clean GitHub-hosted Windows VM | TeX Live 2024 final | TeX Live 2025 final | TeX Live 2026 current |
| --- | --- | --- | --- |
| Windows Server 2022 | Passed | Passed | Passed |
| Windows Server 2025 | Passed | Passed | Passed |

Each of the six jobs passed 22 focused compatibility/integrity guards, native-versus-resident comparisons for math, a custom preamble and TikZ, and the published portable app smoke test. The app checks covered matching-format preparation, current-source fast preview, automatic saving, restart/cache reuse, and rejection of an invalid explicitly selected installation. Native fallback was not counted as a fast-mode pass.

The output comparison required exact page dimensions and extracted text. Exact raster identity was recorded separately; sparse low-amplitude antialiasing differences were allowed under the documented bounds in [the test procedure](COMPATIBILITY-TESTING.md). This is a small fixture corpus, not universal package compatibility.

Three additional portable TeX installations on the local Kingston drive passed the same compiler and published-app checks. They left persistent user/machine PATH unchanged.

| Local isolated version | One-time app format preparation | One sampled prose insertion to preview |
| --- | ---: | ---: |
| 2024 | 24.2 s | 48 ms |
| 2025 | 40.5 s | 62 ms |
| 2026 | 26.4 s | 38 ms |

These single-insertion timings are smoke measurements, not a sustained typing benchmark or a guarantee for other hardware/documents. Reusable local TeX trees and small reports remain on Kingston; disposable test payloads, profiles and formats were cleaned up.

Not covered by this pass: physical Windows 10/11 desktops and their graphics/input behavior, MiKTeX, or broad real-world package/document collections. The workflow is manual-only and uploads bounded diagnostics for seven days; it does not schedule recurring installations.
