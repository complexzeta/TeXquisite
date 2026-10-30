# Continuing to type through an undefined command

The preview already repairs some errors in a disposable compilation copy. A
literal undefined root command can be replaced by spaces, preserving source
offsets. The original diagnostic remains visible, the editor and saved source
remain unchanged, and strict export still requires a successful compilation of
the actual source.

The remaining avoidable work was detecting the same undefined command again on
every edit. After a repaired local compilation succeeds, the prepared region
now remembers that particular skip. Further typing after the same command can
compile the repaired copy immediately rather than fail first and retry.

## Boundaries

- A hint belongs to one prepared compiler slot. It cannot cross projects or
  checkpoints and is discarded with that slot.
- Every source character through the failed command must still match. Editing
  earlier definitions, correcting the command, or changing its name requires a
  fresh check. Ordinary region and dependency validation still run.
- Only confirmed literal undefined-command skips are remembered. Expanded
  macro errors and structural repairs do not acquire this shortcut.
- A new failure clears the hint. Supersession, cancellation, bounded retries,
  approximate-preview labels and recovery-navigation restrictions still apply.

This removes one failed compilation and checkpoint restoration from subsequent
edits in the common case. It does not eliminate detection of a new error, make
arbitrary invalid TeX executable, or promise that errors outside a prepared local
region will compile as quickly as healthy local typing.

## Verification

The focused tests cover reuse, unchanged editor/baseline source, correction,
preceding definitions, slot ownership, outside-region changes, supersession and
fatal worker failures. Eight local recovery tests and TypeScript checking passed.

The first cloud run passed 48 focused guards, native ownership/recovery,
navigation through repaired output, report/menu checks, display handoffs and six
editing sessions. Actual editor logs recorded 16 reused skips in each candidate
text/math recovery session. These sessions enabled experimental retained layout;
they establish execution of the shortcut, not a normal-mode speed comparison.

The [final source and packaged run](https://github.com/complexzeta/TeXquisite/actions/runs/41082313389)
passed on Windows Server 2025 / TeX Live 2026 at exact runtime/source commit
`db864a450ef0477094df50c8911f0238d9f3811a`. It includes 48 focused guards, native
ownership/recovery, source and packaged recovery/navigation and report/menu
checks, eight source editing sessions and 132 packaged editing actions with
saving, strict current-source export and normal reopen. All 18 result records
passed. Nineteen packaged runtime assets match the build; metadata/AGPL,
development-file exclusion and private-host-path checks passed. The broad
OS/TeX-version compatibility and TikZ matrices were not rerun.

Two normal-mode source sessions disabled both experimental layout flags. They
recorded 8 reused skips each and passed 22 actions each. The packaged normal-mode
sessions passed 66 actions each, recording 24 reused skips for text and 21 for
math. Selected packaged action timings were:

| Action | Plain text | Inline math |
| --- | ---: | ---: |
| Introduce an undefined command | 19–24 ms | 52–138 ms |
| Continue typing with that error | 54–55 ms | 55–210 ms |
| First frame after correcting the command | 41–43 ms | 40–117 ms |

These action samples capture the matching frame after each operation, not every
intermediate character. Across all observed packaged frames, plain text recorded
109 frames with median/p95/max **54/88/137 ms**, and math recorded 103 frames at
**97/218/269 ms**. The first packaged math error used a full publication; not
every error stayed on the local path. A corrected local frame based on repaired
output may retain its approximate/error notice until complete verification.

These are hidden-window renderer acknowledgements, not physical-display or
user-machine measurements. They show that this workload can continue quickly
through an error and that the shortcut executed in normal mode. They do not
establish a general speedup over 0.113: the old comparison control is 0.111,
candidate layout modes and session lengths differ, and no paired 0.113/0.114
normal-mode timing comparison was run. The first encounter with an error still
requires detection and retry.

The verified 0.114 portable is 119,624,027 bytes, SHA-256:

```text
12d11c6b4e0033e03dc798983ede6d61f82923088961673c68b73027ba659a62
```

The trial launcher keeps extraction temporaries on external storage, uses the
existing app profile and disables experimental retained layout. This is a draft
branch trial, not a new public release, main-branch merge or tag.

An older local recovery harness timed out before its first recorded frame; it
is not counted as a successful local benchmark. Another local session stopped at
its memory guard before launching. Disposable profiles and projects were removed
from the external test campaign, retaining small logs/results. Cloud measurements
do not establish physical-display latency on the user's computer.
