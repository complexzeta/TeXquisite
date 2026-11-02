#!/usr/bin/env bash
set -euo pipefail
[[ "${CI:-}" == true && -n "${RUNNER_TEMP:-}" ]] || { echo 'Cloud-only installer'; exit 1; }
work="$RUNNER_TEMP/texquisite-unix"
mkdir -p "$work/installer"
repo='https://mirrors.mit.edu/CTAN/systems/texlive/tlnet'
if [[ "$(uname -s)" == Darwin ]]; then
  brew install --cask basictex
  bin=/Library/TeX/texbin
  export PATH="$bin:$PATH"
  sudo "$bin/tlmgr" --repository "$repo" update --self
  sudo "$bin/tlmgr" --repository "$repo" install latexmk amscls amsmath tools graphics pgf xcolor geometry hyperref babel-english ec luatexbase tex-ini-files
else
  curl -fL --retry 3 --retry-all-errors --connect-timeout 30 --max-time 300 "$repo/install-tl-unx.tar.gz" -o "$work/installer.tar.gz"
  curl -fL --retry 3 --retry-all-errors "$repo/install-tl-unx.tar.gz.sha512" -o "$work/installer.sha512"
  node -e 'const fs=require("fs"),c=require("crypto"),p=process.argv[1];const expected=fs.readFileSync(p+"/installer.sha512","utf8").match(/[a-f0-9]{128}/i)?.[0].toLowerCase();if(c.createHash("sha512").update(fs.readFileSync(p+"/installer.tar.gz")).digest("hex")!==expected)throw Error("Installer checksum mismatch")' "$work"
  tar -xzf "$work/installer.tar.gz" -C "$work/installer"
  cat > "$work/profile" <<EOF
selected_scheme scheme-basic
TEXDIR $work/texlive
TEXMFLOCAL $work/texlive/texmf-local
TEXMFSYSCONFIG $work/texlive/texmf-config
TEXMFSYSVAR $work/texlive/texmf-var
TEXMFCONFIG $work/config
TEXMFVAR $work/var
TEXMFHOME $work/home
instopt_adjustpath 0
instopt_adjustrepo 0
instopt_portable 1
tlpdbopt_install_docfiles 0
tlpdbopt_install_srcfiles 0
tlpdbopt_desktop_integration 0
tlpdbopt_file_assocs 0
EOF
  for installer in "$work"/installer/install-tl-*/install-tl; do perl "$installer" -no-gui -portable -profile "$work/profile" -repository "$repo"; done
  bin=''
  for candidate in "$work"/texlive/bin/*; do if [[ -x "$candidate/pdflatex" ]]; then bin="$candidate"; break; fi; done
  # The LaTeX collection also supplies the pdfLaTeX command alias.
  if [[ -z "$bin" ]]; then for candidate in "$work"/texlive/bin/*; do if [[ -x "$candidate/tlmgr" ]]; then bin="$candidate"; break; fi; done; fi
  [[ -n "$bin" ]] || { echo 'No native TeX binary directory'; exit 1; }
  export PATH="$bin:$PATH"
  "$bin/tlmgr" --repository "$repo" install collection-latex latexmk amscls amsmath tools graphics pgf xcolor geometry hyperref babel-english ec luatexbase tex-ini-files
fi
"$bin/pdflatex" --version
"$bin/latexmk" --version
for input in latex.ltx expl3.ltx ltluatex.tex pdftexconfig.tex language.dat hyphen.cfg; do "$bin/kpsewhich" "$input"; done
echo "TEXQUISITE_TEST_TEX_BIN=$bin" >> "$GITHUB_ENV"
echo "$bin" >> "$GITHUB_PATH"
