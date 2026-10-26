# Trying TeXquisite on another Windows PC

This is an early Windows x64 test release. Copy the latest TeXquisite portable executable. Your own TeX distribution supplies packages and fonts; TeXquisite does not install or download a distribution or missing packages.

On first launch, Build Settings shows the detected installation. Discovery checks PATH and common Windows TeX Live and MiKTeX locations. If your installation is elsewhere, choose its installation folder or executable folder. Check installation reports whether the selected engine, kpsewhich and latexmk run successfully, and whether article.cls, amsmath.sty, graphicx.sty and tikz.sty can be found. A failing latexmk can indicate a missing Perl runtime; its error appears in the details. Other packages and external processors depend on the document and can produce additional build errors.

Choose Apply to remember the folder. The selected folder is added to this app's child-process PATH; Windows' system PATH is not changed. Tools are checked together within the selected installation, so a missing latexmk is not silently borrowed from a different TeX distribution. A custom latexmk executable remains available for advanced native compilation.

Windows with TeX Live is the initial supported setup. MiKTeX native compilation is experimental and has not been validated on a clean MiKTeX machine.

The bundled fast-preview format must match the selected installation's LaTeX files. Settings distinguishes compatible fast preview from native compilation only. If incompatible, native compilation is still available when its tools are ready, but updates can be slower; a notice remains visible. This release does not yet generate a new fast-preview format for arbitrary TeX Live versions. Selecting XeLaTeX, LuaLaTeX, the PostScript pipeline or a custom latexmk command also uses native compilation.

The compiler no longer prefers paths from the developer's machine. Installation selection is remembered locally; source documents remain ordinary TeX files. Report your Windows version, TeX distribution/year, the Build Settings check result, and the build error or slow-edit timing when reporting a problem. No diagnostic is uploaded automatically.
