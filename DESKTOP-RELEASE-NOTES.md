Mac and Linux preview packages are now available as permanent GitHub release assets, without the seven-day Actions artifact expiry.

| Platform | Architecture | Formats |
| --- | --- | --- |
| macOS | Apple Silicon, Intel | DMG, ZIP |
| Linux | x64/AMD64, ARM64 | Debian package |

**Mac first launch:** these builds are ad-hoc signed, not notarized. Gatekeeper blocks the initial launch until a tester deliberately approves the trusted app through Apple's per-app Open Anyway flow. Developer ID signing/notarization remain pending. Do not disable Gatekeeper globally.

**Linux:** tested on Ubuntu 24.04. Debian packages retain Chromium sandboxing. AppImage is intentionally excluded because its earlier launcher disabled the sandbox.

Install TeX Live/MacTeX separately, including latexmk and your document packages. Read the attached `FIRST-RUN-MAC-LINUX.md`. No VS Code, Node.js or GitHub account is needed to run a downloaded app. The existing [Windows 0.122.0 release](https://github.com/complexzeta/TeXquisite/releases/tag/v0.122.0) is unchanged.

Validated on native macOS 15 and Ubuntu 24.04 runners, both x64 and ARM64: automatic TeX discovery, matching-format preparation, prose/math/TikZ preview, automatic saving/building, Save shortcut, menus, source navigation, verified PDF export, erroneous-export protection, automatic error recovery and restart/cache reuse. Six fresh downloaded installation paths passed functional tests. The Mac graphical approval flow was not automated; human usability, other OS versions, inverse navigation and performance parity are not established.

These exact packages come from [successful build 41395773737](https://github.com/complexzeta/TeXquisite/actions/runs/41395773737), source `58cd4b517a4e5fceff6d2205426365501a315c4b`, and passed [fresh-download tests 41396774165](https://github.com/complexzeta/TeXquisite/actions/runs/41396774165). `SHA256SUMS-0.123.0.txt` and `PROVENANCE-0.123.0.json` identify the published bytes. Release assets are retained unless explicitly removed; they are separate from temporary CI reports.
