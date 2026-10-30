# Retained lecture layout integration

Work in progress. The integration is opt-in with both
`PERSISTENT_TEX_MULTI_BLOCK=1` and `PERSISTENT_TEX_RETAINED_FLOW=1`.
The recommended executable remains 0.111. There is no new public release.

The native preview now carries independently proved ordinary-text paragraphs
through height changes, using the retained compositor introduced in
RETAINED-LAYOUT-RESULTS.md. Pixel placement and source navigation share the
same immutable baseline layout. Normal full output remains responsible for
export, document mode and unsupported edits. Inline math is deliberately
excluded by the existing native character witness; unsupported math must
fall back with the complete current source, including other carried edits.

Local checks passed for native text growth/contraction and checkpoint switching,
complete-source math fallback, glyph coordinate projection, unchanged-pixel
preservation, source-pixel scroll anchoring, device scale, bounded allocation and
disposal. A same-bundle full publication now retires patched strips instead of
returning early merely because the bundle ID and scale are unchanged. A normal
single-block fallback retires the obsolete retained compositor.

The initial live editor test reached cross-page two-way navigation, unchanged
source navigation, stale-click rejection, undo/redo and display handoffs. It did
not pass its whole sequence: one fixture assumption was invalid after a large
paragraph became a multi-page canonical paragraph; a later run timed out after
layout changes. These are incomplete runs, not performance wins. The test now
records rejection diagnostics and checks that a canonical frame is a nonzero
full raster, rather than a provisional strip with cleared metadata.

The local machine reached severe memory pressure during these experiments.
Longer tests are being moved to a manual GitHub workflow, with serialized
candidate/control runs against the exact 0.111 source commit. Test harnesses
refuse low-memory startup and stop their own disposable app under severe
pressure. They do not close user applications. Fixtures and profiles remain
isolated from user documents.

End-to-end comparison, the full handoff sequence and packaging remain pending.
The earlier 33–41 ms component timings must not be reported as editor latency.

The first cloud run, 40999401341, passed the build, 33 focused guards and isolated
canvas integration check. Its installer mirror timed out before any native or
live-editor test ran. The installer now tries alternate HTTPS CTAN mirrors and
validates the ZIP before promoting a partial download. Using another specific
mirror follows the [TeX Live installation guidance](https://www.tug.org/texlive/acquire-netinstall.html).
