# macOS and Linux preview

Native macOS and Linux preview packages passed the cloud checks below in [PR #3](https://github.com/complexzeta/TeXquisite/pull/3). The public 0.122.0 release remains Windows-only. This work does not change an existing Windows installation.

## Platforms and packages

| Platform | Architectures | Package formats |
| --- | --- | --- |
| macOS | Apple Silicon (arm64), Intel (x64) | DMG, ZIP |
| Linux | x64, arm64 | Debian package, AppImage |

The cloud matrix uses macOS 15 and Ubuntu 24.04. A successful build alone does not establish support for other operating-system versions or distributions. Results below must distinguish source tests from tests of the actual packaged application.

## TeX installation

Install TeX separately, including `pdflatex`, `kpsewhich` and `latexmk`. TeXquisite does not contain a full TeX distribution. The desktop app needs no Node.js installation or account.

On macOS, TeXquisite searches the MacTeX/BasicTeX `/Library/TeX/texbin` location even when launched outside a terminal. BasicTeX is a small installation; add `latexmk` and the packages required by your documents using `tlmgr`. A full MacTeX installation includes more document packages.

On Linux, discovery checks PATH, system executable directories and versioned TeX Live trees under `/usr/local/texlive` and `/opt/texlive`. A selected folder takes precedence; an invalid selection reports a problem rather than silently choosing another installation. Use Build Settings to select an installation or its executable directory when necessary.

Fast local preview requires an indexed TeX Live package tree and matching LaTeX inputs. When offered, choose **Prepare matching fast preview**, wait for **Prepared**, then **Apply**. This preparation is cached; it is not repeated for each edit. A native-compilation fallback must leave preparation available for eligible installations. A distribution without the required index or inputs can still use native compilation, with a visible explanation.

## Preview installation

After a successful matrix run, its `desktop-build-<platform>` artifacts contain packages and a `SHA256SUMS.txt` manifest. These are short-lived development artifacts, not a stable public release. Choose the package matching the computer's CPU architecture.

On macOS, open the DMG and copy TeXquisite to Applications. Preview bundles use an ad-hoc signature, not an Apple Developer ID signature, and are not notarized. The cloud signature check cannot establish that a freshly downloaded app will pass Gatekeeper. Developer ID signing, notarization and a real downloaded-app installation check remain release work.

On Ubuntu/Debian, install the local `.deb` with `sudo apt install ./<package-name>.deb`. The installer configures Chromium's user-namespace sandbox or its setuid helper as appropriate, including an AppArmor profile on supported Ubuntu systems. The tests do not disable Electron's sandbox. AppImage is also a build target; producing the file does not establish that launching through FUSE works on every distribution.

## Build from source

Use Node.js 24 and npm, with TeX installed separately:

```sh
npm ci
npm run build
npm start
```

Electron may download its native runtime on first use. `npm run package:mac` and `npm run package:linux` explicitly install that runtime before packaging. Build macOS packages on macOS and Linux packages on Linux. The macOS icon build uses the operating system's `sips` and `iconutil` tools. Linux Debian packaging uses `fpm`; the cloud workflow installs its prerequisites. Windows packaging remains available through `npm run package:win`.

## Validation scope

The native matrix exercises automatic TeX discovery, format preparation, prose/math/TikZ rendering, automatic saving and editing, the platform Save shortcut, native menus, source-to-second-page navigation, verified PDF export, rejection of an erroneous export without overwriting a good PDF, automatic error recovery, restart/cache reuse and rejection of an invalid installation folder. It repeats these functional checks against the mounted macOS DMG or installed Linux Debian package.

Package reports record SHA-256 checksums. macOS checks the bundle signature; Linux checks the installed sandbox helper's ownership and permissions. Both source and packaged launches require sandboxed renderers, and Linux also verifies the renderer's kernel Seccomp filter and NoNewPrivs status. The macOS source test deliberately removes TeX from PATH to exercise Finder-style discovery. Windows unit and functional regression controls run separately. All tests use synthetic documents and disposable cloud profiles, not a user's documents.

The Unix tests use TeX Live/BasicTeX, not MiKTeX. These checks do not establish latency parity with the Windows build, inverse navigation coverage, accessibility, every package manager, AppImage/FUSE behavior, notarization, or support for arbitrary TeX installations.

## Recorded results

The [native matrix run](https://github.com/complexzeta/TeXquisite/actions/runs/41391886992) passed on 2026-11-02 UTC, at functional/test commit `5feaf13102623ae53ac54b3dae9f4c9e0163cf92`. Later documentation changes do not change the tested application.

| Cloud target | TeX installation | Source app | Packaged app | Built assets |
| --- | --- | --- | --- | --- |
| macOS 15 Apple Silicon | BasicTeX 2026 + fixture packages | Pass | Mounted DMG: pass | DMG, ZIP |
| macOS 15 Intel | BasicTeX 2026 + fixture packages | Pass | Mounted DMG: pass | DMG, ZIP |
| Ubuntu 24.04 x64 | TeX Live 2026 + fixture packages | Pass | Installed DEB: pass | DEB, AppImage |
| Ubuntu 24.04 ARM64 | TeX Live 2026 + fixture packages | Pass | Installed DEB: pass | DEB, AppImage |

All twelve result records passed: source, packaged functional run and package verification for each target. Every functional run prepared a matching format and reused its cache after restart. All four Linux launches verified kernel Seccomp filtering and NoNewPrivs. The installed Debian sandbox helper was root-owned and mode 0755, using the supported user-namespace path rather than requiring a setuid helper.

The eight asset hashes are recorded in [DESKTOP-PREVIEW-SHA256SUMS.txt](DESKTOP-PREVIEW-SHA256SUMS.txt) and in each build artifact. The ZIP and AppImage files were built and hashed; functional launches used the DMG and DEB. Download preview artifacts from the run above while retained; no stable macOS/Linux GitHub release has been published.

The [Windows source regression control](https://github.com/complexzeta/TeXquisite/actions/runs/41390733046) passed 81 unit checks, one native preparation check and seven UI scenarios at `124584b8ad8fcb4af260698bf69189416d72b420`. Subsequent changes through the native matrix commit affected only the new desktop test scripts and workflow. Windows platform guards also passed in the final native matrix.

The tests exposed and corrected a disabled preparation button after native fallback, macOS-only window-menu API misuse and an Electron runtime installation ordering problem on Linux. Test-harness fixes wait for the application DOM and explicitly enable Playwright's Chromium sandbox. No sandbox-disabling launch flag or global kernel-security relaxation is used by the final tests.
