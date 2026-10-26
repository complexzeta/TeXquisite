# TeX Live compatibility pass

The manually triggered **TeX Live compatibility** GitHub Actions workflow tests TeX Live 2024, 2025 and current 2026 on Windows Server 2022 and 2025 runners. Jobs use ephemeral runner storage, at most two jobs run together, and only small diagnostic results are uploaded for seven days. It does not publish builds or upload local user documents. The UI test uses the checksum-verified published 0.85.0 portable payload, not a newly packaged build.

For local campaigns, `scripts/install-test-texlive.ps1` and `scripts/prepare-portable-test.ps1` require a dedicated `-WorkRoot` on a volume labelled Kingston. They redirect temporary storage and install portable TeX trees without persistent PATH, file-association or desktop changes. Historical versions use frozen TUG archive mirrors; 2026 uses the current CTAN tree and records its actual version. Documentation/source packages are omitted. A completed installation is recorded in `installation.json`; reuse its bin folder rather than reinstalling it.

Run the ordinary application build before the tests. Set these variables only in the test process:

```powershell
$env:PERSISTENT_TEX_TEST_ARTIFACTS = '<Kingston campaign>/results'
$env:TEMP = '<Kingston campaign>/temporary'
$env:TMP = $env:TEMP
$env:TEXQUISITE_TEST_TEX_BIN = '<isolated installation>/texlive/bin/windows'
$env:TEXQUISITE_TEST_TEX_YEAR = '2024'
node scripts/texlive-compatibility-test.cjs
$env:PERSISTENT_TEX_EXECUTABLE = '<verified published payload>/TeXquisite.exe'
node scripts/texlive-compatibility-ui-test.cjs
```

The comparison test checks actual selected-installation resolution, one-time format preparation and cache reuse, then native/resident output for math, a custom preamble and TikZ. Page dimensions and extracted text must match exactly. Raster comparisons report exact identity separately; they admit only sparse low-amplitude antialiasing differences (at most 0.02% changed channels, maximum channel delta 64, mean delta 0.01 at 72 dpi). Larger differences fail. This is a small compatibility corpus, not proof for arbitrary packages or documents.

The UI test uses its own profile and a project path containing spaces. It checks fast-format activation, current-source preview, automatic saving, cache/session reuse after restart, and rejection of an invalid explicitly selected installation. Both tests fail if fast preview is unavailable rather than counting native fallback as a fast-mode pass. Timings are recorded, with no desktop responsiveness guarantee inferred from cloud runners.

Local installations and useful small reports may be retained on Kingston for a later pass. Close all test processes before removing their owned payloads, profiles, caches or temporary files. Never remove user documents, ordinary recovery backups, another campaign's files, or a running portable app's extracted runtime.
