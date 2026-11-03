# lumen-virtual-display

Dev-only macOS tool. It creates virtual displays that macOS treats as real monitors, so you can test Lumen's native audience outputs on a Mac with one screen. A virtual display appears in `NSScreen.screens`, `CGGetActiveDisplayList`, System Settings > Displays and tao's monitor list, which Lumen's `list_displays` reads.

It is a standalone Cargo package. It is not a member of the `apps/studio/src-tauri` workspace and is never linked into the app.

> **Private API.** The tool uses `CGVirtualDisplay`, an undocumented CoreGraphics SPI (the one DeskPad and BetterDisplay use). Apple can change or remove it in any macOS release. The tool looks the classes up at runtime and exits with a clear error if they are missing. Never ship this code in Lumen.

## Usage

From the repository root:

```bash
pnpm display:virtual                                   # one 1920x1080 @ 60 Hz display
pnpm display:virtual --width 1280 --height 720 --hidpi # Retina: 1280x720 pt, 2560x1440 px
pnpm display:virtual --count 2                         # two displays for multi-screen tests
pnpm display:virtual --mirror                          # plus a preview window per display
pnpm display:virtual --list                            # print active displays and exit
```

Or `cargo run --release --manifest-path tools/virtual-display/Cargo.toml -- <flags>`.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--width`, `--height` | 1920, 1080 | Mode size in points |
| `--hz` | 60 | Refresh rate |
| `--name` | `Lumen Virtual Display` | Display name; with `--count`, later displays get ` 2`, ` 3`, ... |
| `--hidpi` | off | Retina mode, backing store 2x the mode size |
| `--count` | 1 | Number of displays (1 to 8) |
| `--mirror` | off | Window that shows each display's content, about 10 fps |
| `--list` | | Print active displays (id, name, origin, size, pixels, vendor, model, serial) and exit |

The displays stay until Ctrl+C or SIGTERM. Then the tool releases them and checks that macOS removed them. If the process is killed, WindowServer removes them anyway.

## Identity

Lumen keeps a screen assignment by display name plus position, so each display slot has a stable identity across runs:

- vendor `0x4c4d`, product `0x4c56 + slot` (19542, 19543, ...), serial `0x4c000001 + slot`;
- HiDPI displays add `0x100` to the serial. macOS remembers HiDPI on or off per vendor/product/serial and ignores later `hiDPI` settings, so the two kinds need separate serials.

macOS chooses each display's origin (usually right of the main display, sometimes left) and remembers the arrangement. Drag it in System Settings > Displays > Arrange to move it. After creation the tool selects the requested mode, because macOS otherwise restores the last mode it saw for that display.

Lumen, through tao, names macOS monitors `Monitor #<model number>`, and the model number is the product id. So the first virtual display shows as `Monitor #19542` in Lumen, not as `Lumen Virtual Display`.

## `--mirror`

The mirror window shows the display's content scaled down. It uses ScreenCaptureKit (`SCScreenshotManager`, macOS 14+), because `CGDisplayStream` is obsolete since macOS 15. It needs Screen Recording permission for the app that runs the tool (Terminal, iTerm, VS Code, ...): System Settings > Privacy & Security > Screen & System Audio Recording, then restart that app. Without permission the tool prints a message, and the virtual displays still work.

## Tested

- macOS 27.0.1 (26A434), Apple M1 Pro: display creation, 1x and HiDPI modes, `--count 2`, `--mirror` and removal on Ctrl+C.
