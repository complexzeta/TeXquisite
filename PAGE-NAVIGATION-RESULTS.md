# Local page preview navigation

Version 0.102 fixes a Lecture/Continuous scroll navigation gap. Checked local
page previews previously disabled inverse navigation and kept the old source
hash for forward navigation. Lecture mode can defer full verification, leaving
both directions unavailable even though the edited output is visible.

Local page output now carries native glyph positions mapped to the current
editor source. Compiler compatibility preambles are handled only through exact
matching source prefixes/suffixes. Positions in rewritten source are omitted.
Maps are bound to the root, file, baseline, edit revision, complete source text
and actual painted canvases. They authorize navigation, not preview editing.

Unchanged pages outside the verified replacement span keep their baseline
geometry and remap offsets only within exactly matching source. Generated
document-end footer locations are excluded. Page-band markers use the actual
canvas position, including multiple canvases within one continuous wrapper.

Validation: an isolated native two-page mathematical paragraph passed real
source-to-preview and preview-to-source clicks on both pages, plus rejection of
a click on stale output. A separate copy of a current four-page lecture passed
both directions across its three-page replacement band and an unchanged earlier
page, including the compatibility-preamble case. Original user documents and
the running session were not modified. This does not claim that unsupported
compiler-expanded source has an exact map or that paged local previews gained
the same mapping support.

The packaged 0.102 runtime passed the copied-lecture navigation test, including
the unchanged earlier page and stale-click rejection. Eleven navigation unit
guards passed. The existing retained-paragraph integration suite also passed
navigation, undo/redo, zoom, fit width, panel/layout/mode changes, file switching
and export preservation. Packaged runtime assets matched independent builds;
the archive contained no private projects, profiles or source maps.
