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

The second run, 40999774762, installed TeX successfully, but its updated LaTeX
kernel did not match the bundled format. The application correctly selected
native compilation; the fixtures had incorrectly assumed resident preview was
already available. The test setup now generates an installation-matched format
with the existing self-test and dependency/fingerprint checks, then seeds each
fresh test profile with that preparation. The baseline and candidate use the
same installed inputs and engine identity. Compatibility checks remain enabled.

The third run, 41000490096, passed the native retained ownership test and all four
baseline/candidate sessions, including saving, strict export and normal reopen.
Its navigation test stopped at a click helper that assumed every page was 612
points wide; that assumption is being replaced with the view's actual scale.
The plain-text candidate recorded median 56 / p95 154 / maximum 850 ms, versus
56 / 318 / 398 ms for 0.111. Its maximum was an error-recovery action, so this is
not an overall speedup claim. Mixed-math results were 131 / 361 / 376 ms versus
140 / 351 / 381 ms. These cloud timings are not local physical-display timings.

The next comparison explicitly specifies PDF paper dimensions in both fixtures,
so an installation's default format paper size does not silently change the
workload. Earlier page-output geometry rejections remain genuine fallbacks and
are not suppressed. Neighboring retained paragraphs also leave preceding-line
ink and crop bleed with their original owner, instead of sharing a vertical
slice that could restore stale descenders.
