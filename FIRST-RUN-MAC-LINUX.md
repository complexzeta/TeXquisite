# TeXquisite 0.123.0 — Mac and Linux preview

Download from the [permanent release page](https://github.com/complexzeta/TeXquisite/releases/tag/v0.123.0). Release downloads do not use Actions artifact expiry and do not require a GitHub account. Verify your file against `SHA256SUMS-0.123.0.txt` on that page.

| Computer | Download |
| --- | --- |
| Apple Silicon Mac | `TeXquisite-0.123.0-macOS-arm64.dmg` (or `.zip`) |
| Intel Mac | `TeXquisite-0.123.0-macOS-x64.dmg` (or `.zip`) |
| x64/AMD64 Linux | `TeXquisite-0.123.0-Linux-amd64.deb` |
| ARM64 Linux | `TeXquisite-0.123.0-Linux-arm64.deb` |

This is a prerelease. Tests cover macOS 15 and Ubuntu 24.04 on both architectures, not every operating-system version or distribution. The existing [Windows 0.122.0 release](https://github.com/complexzeta/TeXquisite/releases/tag/v0.122.0) remains available separately.

## Mac

1. Install TeX Live/MacTeX separately, including `latexmk` and the packages your documents require. TeXquisite is a standalone app and needs no VS Code or Node.js at runtime.
2. Open the DMG and drag TeXquisite to Applications, or extract the ZIP and copy its app there.
3. These previews are ad-hoc signed and **not notarized**. Gatekeeper rejection has been confirmed. If you deliberately trust the verified download, follow [Apple's per-app approval instructions](https://support.apple.com/en-us/102445): after trying to open it, use System Settings → Privacy & Security → Open Anyway. Do not disable Gatekeeper globally. The graphical approval flow has not been automated in our tests.
4. Open Build Settings, confirm the detected TeX installation, and choose Apply. If offered, choose Prepare matching fast preview, wait for Prepared, then Apply. This setup is cached across restarts.
5. Open a `.tex` document. Automatic saving and preview are enabled by default. Lecture mode and Continuous scroll are available for teaching.

Developer membership is not required to try a trusted preview. Developer ID signing and notarization remain necessary release work for a smoother first launch.

## Linux

On the tested Ubuntu/Debian package path, install the downloaded file with:

```sh
sudo apt install ./TeXquisite-0.123.0-Linux-amd64.deb
```

Use the `arm64` filename on ARM64. Install TeX separately, including `pdflatex`, `kpsewhich`, `latexmk` and your document packages. Launch TeXquisite from the applications menu, confirm Build Settings and prepare matching fast preview if offered.

The Debian installer configures the Chromium sandbox and supported AppArmor policy. Do not add `--no-sandbox` or weaken system-wide user-namespace restrictions. Earlier AppImage previews were withdrawn after their launcher disabled sandboxing; they are not part of this release.

## Tested behavior and limits

Fresh downloads passed format preparation, prose/math/TikZ preview, automatic saving/building, platform Save shortcut, menus, source navigation, verified PDF export, protection of a good export during an error, automatic recovery and restart/cache reuse. Both Linux renderers passed kernel sandbox checks. Mac ZIP and DMG copies passed functional tests separately from the failing first-launch Gatekeeper assessment.

Human usability, graphical Finder/desktop approval flows, file associations, inverse navigation on these platforms, other OS versions and latency parity remain outside these tests. No universal per-keystroke timing is promised. Native compilation is not a security sandbox for untrusted TeX.

`PROVENANCE-0.123.0.json` identifies the exact source, successful build and fresh-download test runs. Source is available at tag `v0.123.0`; the app and bundled engine are distributed under the repository's documented AGPL and third-party licenses. Documents remain local and ordinary TeX files. No diagnostic is uploaded automatically.
