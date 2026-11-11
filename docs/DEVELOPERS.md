# MintMotion — developer guide

This document explains how MintMotion works, how it uses memory and CPU, what
has been measured and tested, what has not, and how to build, test and translate
it. It is meant for anyone who takes the code from GitHub and wants to fix,
extend or port it.

User documentation: [README.md](../README.md) (English) ·
[README.es.md](../README.es.md) (Spanish).

> The comments in the source code are written in Spanish, and so are a few
> internal names (`rellenar`, `dormido`…). User-visible texts are in English in
> the code and translated with gettext. Log messages are in English.

## Contents

- [Repository layout](#repository-layout)
- [Architecture](#architecture)
- [Files at run time](#files-at-run-time)
- [Settings](#settings)
- [The mpv command line](#the-mpv-command-line)
- [Watchdogs and recovery](#watchdogs-and-recovery)
- [Memory](#memory)
- [CPU](#cpu)
- [Usage bars in the window](#usage-bars-in-the-window)
- [Translations](#translations)
- [Building](#building)
- [Testing](#testing)
- [What is tested and what is not](#what-is-tested-and-what-is-not)
- [Limitations and porting notes](#limitations-and-porting-notes)
- [Ideas for future work](#ideas-for-future-work)
- [Version history](#version-history)
- [Contributing](#contributing)

## Repository layout

| Path | What it is |
|---|---|
| `src/mintmotion` | Settings application (Python 3 + GTK 3) and command-line interface. |
| `src/mintmotion-renderer` | One-shot helper (Python 3 + python-xlib): creates the X11 window and prints the mpv options, then exits. |
| `extension/mintmotion@sombra/` | Cinnamon extension (GJS): starts and supervises mpv and places the video in the background layer. |
| `data/` | Desktop launcher (translated) and icon. |
| `po/` | Translation template (`mintmotion.pot`) and catalogs (`es.po`, `fr.po`, `zh_CN.po`). `translations.py` and `make-po.py` were used to create the first catalogs. |
| `packaging/` | `build-deb.sh`, Debian `control` template, `postinst`, `postrm`. |
| `tests/` | Docker image with the LMDE 7 packages, session start script and the automatic test. |
| `Makefile` | `make`, `install`, `uninstall`, `deb`, `pot`, `update-po`, `clean`. |

## Architecture

```
 MintMotion window / CLI  ──writes──▶  ~/.config/mintmotion/config.json
        (src/mintmotion)                          │ watched
                                                  ▼
                              Cinnamon extension mintmotion@sombra (GJS, inside Cinnamon)
                                 │ 1. runs once                     │ 2. spawns and supervises
                                 ▼                                  ▼
                   mintmotion-renderer (Python)             mpv --wid=<window>
                   creates an X11 window, prints            (only process left running)
                   {wid, argv} as JSON and exits                    │ JSON IPC socket
                                                                    ▼
                   Muffin actor of that window ──cloned──▶ one clone per monitor inside
                   (kept at opacity 0)                     Cinnamon's background actors
```

1. **Window.** `mintmotion-renderer` opens an X11 window of type
   `_NET_WM_WINDOW_TYPE_DESKTOP`, with an empty input region (clicks and keys
   pass through it), `background_pixmap=None` and the title
   `MintMotion <token>`. It sets `RetainPermanent`, so the window survives when
   the helper exits. It prints a JSON object with the window id and the mpv
   options, and exits. No Python process stays in memory.
2. **Player.** The extension starts mpv through `setpriv --pdeathsig KILL`,
   so if Cinnamon dies, mpv dies with it. It adds `--hwdec=…`,
   `--input-ipc-server=…` and, when resuming, `--start=<position>`.
3. **Placement.** When Muffin creates the window's actor, the extension keeps
   that actor at opacity 0 and puts **clones** of it, one per monitor (each in a
   container that clips it to the monitor), inside Cinnamon's background actors.
   The window is rendered at the size of the largest monitor, so on that monitor
   the clone matches it pixel for pixel. The video is drawn where the wallpaper is
   drawn: below Nemo's desktop icons, desklets, panels and windows. Clones are
   created only after mpv has drawn its second frame, so an undefined window
   content is never shown.
4. **Pause.** On every relevant window-manager event (and every 2 s), the
   extension checks whether any part of the desktop is visible on any monitor.
   The windows that count are `NORMAL`, `DIALOG`, `MODAL_DIALOG` and `UTILITY`.
   The screensaver and the Expo view also pause. Pausing is done through mpv's
   IPC (`set_property pause`).
5. **Sleep.** If the desktop stays covered for `sleep_after` seconds (120 by
   default), the extension saves the position and kills mpv. The X window keeps
   its last frame. When the desktop becomes visible again, mpv is started in the
   same window with `--start=<position>`.
6. **Instance token.** Each start uses a new token in the window title. A
   window with the MintMotion class but another token (from a previous Cinnamon
   session, an older version, or an instance that is closing) is retired: the
   mpv processes that draw in it are found in `/proc` by `--wid=<xid>` and
   terminated, then the window is destroyed. Renderers of versions ≤ 1.2, which
   stayed alive, are terminated too.

## Files at run time

| Path | Written by | Contents |
|---|---|---|
| `~/.config/mintmotion/config.json` | Application / CLI (atomic write) | Settings (see below). |
| `~/.local/share/mintmotion/` | Application | Videos created with “Optimize for my screen”. |
| `~/.cache/mintmotion/preview.png` | Application | Thumbnail shown in the window. |
| `$XDG_RUNTIME_DIR/mintmotion.socket` | Extension | Path of the current mpv IPC socket (a pointer file, not the socket). |
| `$XDG_RUNTIME_DIR/mintmotion-<time>-<n>.sock` | mpv | IPC socket of each player instance. |
| `$XDG_RUNTIME_DIR/mintmotion.state` | Extension | `reproduciendo`, `pausado`, `dormido`, `error` or `arrancando`. Used by the window when mpv is not running. |
| `/usr/share/locale/<lang>/LC_MESSAGES/mintmotion.mo` | Package | Compiled translations. |

Logs go to Cinnamon's log (`~/.xsession-errors`), prefixed with `[mintmotion]`.

## Settings

`~/.config/mintmotion/config.json`. The extension watches the file and applies
changes without restarting Cinnamon.

| Key | Default | Shown in the window | Meaning |
|---|---|---|---|
| `video` | `""` | yes | Absolute path of the video. |
| `fit` | `rellenar` | yes | `rellenar` (fill, crop), `ajustar` (fit, black bars), `estirar` (stretch). |
| `quality` | `alta` | yes | Scaling filters: `alta`, `maxima`, `ahorro`. |
| `hwdec` | `true` | yes | Hardware decoding (`auto-safe`) or `no`. |
| `pause_when_covered` | `true` | yes | Pause when the desktop is fully covered. |
| `sleep_after` | `120` | no | Seconds covered before mpv is closed. `0` = never close it. |
| `ram_watchdog` | `true` | no | Restart mpv if its memory grows abnormally. |
| `ram_limit_mb` | `0` | no | Fixed memory limit for mpv in MB. `0` = automatic (see below). |
| `gpu_env` | `true` | no | On computers whose only graphics card is NVIDIA, stop mpv from loading the Mesa drivers. |

The hidden keys have to be edited by hand. The application keeps them when it
saves.

## The mpv command line

Built by `build_mpv_args()` in `src/mintmotion-renderer`. Options that the
installed mpv does not know are removed (`mpv --list-options`), because they
change between versions.

| Options | Why |
|---|---|
| `--no-config`, `--load-scripts=no`, `--load-select=no`, `--load-console=no`, `--load-stats-overlay=no`, `--load-auto-profiles=no`, `--load-positioning=no`, `--ytdl=no`, `--osc=no` | Ignore the user's mpv configuration and do not load built-in scripts that a wallpaper never uses. Each script costs memory. |
| `--vo=gpu,x11` | OpenGL output; `x11` (software) only if there is no OpenGL. |
| `--no-audio`, `--sid=no` | No sound and no subtitles. |
| `--loop-file=inf` | Endless loop. |
| `--cache=no`, `--demuxer-max-bytes=8MiB`, `--demuxer-max-back-bytes=0`, `--demuxer-readahead-secs=1`, `--demuxer-donate-buffer=no` | The video is a local file, so nothing needs to be buffered. The kernel's page cache already holds it. |
| `--vd-lavc-threads=2` (videos up to 1920×1088) | Fewer software-decoding threads means fewer frames kept in memory. Measured without dropped frames at 1080p30 and 1080p60. It only matters when decoding in software. |
| `--framedrop=vo`, `--deband=no`, `--hdr-compute-peak=no` | Lighter rendering. |
| `--stop-screensaver=no`, `--x11-bypass-compositor=never`, input options | A wallpaper must not block the screensaver or take input. |
| Quality profile | `alta`: `spline36`/`mitchell`. `maxima`: `ewa_lanczossharp`. `ahorro`: `bilinear`. Without scaling (video at the exact screen resolution) none of them costs anything. |
| Fit | `--keepaspect` and `--panscan`. |

**Hardware decoding.** The extension starts mpv with `--hwdec=auto-safe`. When
mpv reports a copy mode (`hwdec-current` ending in `-copy`, for example
`nvdec-copy`), the extension tries the direct mode once (`nvdec`), because the
copy mode moves every frame through system RAM. If the direct mode results in
no hardware decoding at all, it goes back to `auto-safe`.

**NVIDIA-only environment (`gpu_env`).** Applied only when
`/proc/driver/nvidia/version` exists **and** every `/sys/class/drm/card*/device/vendor`
is `0x10de`. It sets `VK_DRIVER_FILES`, `VK_ICD_FILENAMES` (NVIDIA's Vulkan ICD)
and `__EGL_VENDOR_LIBRARY_FILENAMES` (NVIDIA's EGL vendor file), so mpv does not
load Mesa's drivers, which are useless on such a computer. Computers with Intel
or AMD graphics, and hybrid laptops, are not affected.

## Watchdogs and recovery

All of them are in `extension.js`.

| Watchdog | How it works |
|---|---|
| Start-up | mpv must answer an IPC request within 8 s of being started. |
| Health | Every 10 s an IPC request (`get_property pid`). Two failures in a row: mpv is considered hung, killed and restarted. |
| Unexpected exit | If mpv exits on its own, it is started again (after 1 s) in the same window at the last position. |
| Failure limit | At most 3 restarts for failures in 10 minutes. After that, the state becomes `error` and it stops retrying. |
| Memory | Once a minute the mpv PSS is read from `/proc/<pid>/smaps_rollup`. The reference is taken 2 minutes after start. mpv is restarted at the same position if it grows beyond `max(1.5 × reference, reference + 100 MB)`, or beyond `ram_limit_mb` if that is set. It is a guard against leaks in some drivers during continuous playback. |
| Kill | `SIGTERM`, then `SIGKILL` after 3 s. |
| Cinnamon crash | `setpriv --pdeathsig KILL` kills mpv. On the next start, leftover windows and processes are retired (see *Instance token*). |

## Memory

### Measuring

Use **PSS** (proportional set size): shared library pages are divided among the
processes that use them, so the sum over processes is the real total.

```bash
P=$(pgrep -x mpv | head -1)
awk '/^Pss:/{print int($2/1024) " MB"}' /proc/$P/smaps_rollup
# breakdown by mapping:
awk '/^[0-9a-f]+-/{f=$6?$6:"[anon]"} /^Pss:/{s[f]+=$2} END{for(k in s) if(s[k]>2048) printf "%6d MB  %s\n",s[k]/1024,k}' /proc/$P/smaps | sort -rn | head -15
# decoder in use:
python3 -c "import socket,json,os;s=socket.socket(socket.AF_UNIX);s.connect(open(os.environ['XDG_RUNTIME_DIR']+'/mintmotion.socket').read().strip());s.sendall(b'{\"command\":[\"get_property\",\"hwdec-current\"]}\n');print(s.recv(4096).decode())"
```

### Real computer: NVIDIA

LMDE 7, NVIDIA GeForce GTX 1650, driver 550.163.01, mpv 0.40.0, 12 logical
cores, 15.5 GB of RAM, monitor 1920×1080 at 60 Hz. Video: 1920×1080, H.264,
24 fps. Decoder reported by mpv: `nvdec` (direct mode). Each figure was taken
60 s after (re)starting mpv.

| `gpu_env` | Round | mpv PSS | Mesa mappings in mpv | CPU (one core) |
|---|---|---|---|---|
| on | 1 | 315 MB | 10 | 2.6 % |
| off | 1 | 337 MB | 18 | 3.8 % |
| on | 2 | 314 MB | 10 | 3.2 % |
| off | 2 | 339 MB | 18 | 3.4 % |

“Mesa mappings” = lines of `/proc/<pid>/maps` matching `LLVM|gallium|mesa|lvp`.
`gpu_env` saves about 23 MB, the same in both rounds, so it stays on by default.

Breakdown of the 315 MB (`gpu_env` on):

| Mapping | PSS |
|---|---|
| `/dev/nvidiactl` | 154 MB |
| anonymous memory | 63 MB |
| `[heap]` | 19 MB |
| `/dev/zero` | 10 MB |
| `libcuda.so.550.163.01` | 8 MB |
| `libplacebo.so.349` | 7 MB |
| `libnvidia-glcore.so.550.163.01` | 6 MB |
| `libnvidia-gpucomp.so.550.163.01` | 5 MB |
| `libavcodec.so.61` | 4 MB |
| `libnvidia-glvkspirv.so.550.163.01`, `libavformat`, `libavfilter`, `mpv` | 2 MB each |

About 175 MB are the NVIDIA driver: `/dev/nvidiactl` is system memory that the
kernel driver maps into the process for the graphics card, plus the driver's
libraries. The exact contents of that 154 MB (decoder surfaces, OpenGL buffers…)
have not been broken down further. A possible line of work is to measure whether
fewer reserved decoder frames (`--hwdec-extra-frames`) or a shorter swap chain
(`--swapchain-depth`) reduce it without dropped frames; it has not been tried.

With the desktop covered for more than 2 minutes: `pgrep -c -x mpv` gives `0`
and the state is `dormido` (sleeping). Verified on this computer. MintMotion
then uses no memory at all; the last frame is held by the X server (a 1920×1080
frame at 4 bytes per pixel is about 8 MB; calculated, not measured).

### Test container: software decoding

Debian trixie with the LMDE 7 packages, no graphics card (Mesa llvmpipe), same
1080p video, three repetitions each:

| Version | mpv | Python renderer | Total |
|---|---|---|---|
| 1.2.0 | 194 MB | 13 MB | ~207 MB |
| 1.3.0 | 168–169 MB | — | ~169 MB |
| 1.3.0, desktop covered > 2 min | 0 | — | 0 |

These figures cannot be compared with the NVIDIA ones: with software decoding
the decoded frames live in mpv's own memory, and there is no GPU driver.

## CPU

On the NVIDIA computer above: 2.6–3.8 % of one core while playing the 1080p24
video (the window showed 0.2 % of the whole CPU and 2.0 % of one core). Paused,
almost nothing; asleep, zero (no process). The CPU work Cinnamon does to compose
the clones is not included and cannot be separated from Cinnamon.

The window computes CPU from `/proc/<pid>/stat` (`utime + stime`) over the 2 s
between samples. In the container it matched `top` (35.6 % against 34.7 % of
one core in software decoding).

## Usage bars in the window

`Gtk.LevelBar` in continuous mode, 0–100. Some themes give the filled block a
minimum width (Mint-Y and Adwaita: `levelbar block { min-width: 32px }`), which
made 0.2 % look like about 18 % of a 185 px bar. The application adds this CSS,
only for its own bars (style class `mintmotion-meter`):

```css
levelbar.mintmotion-meter block { min-width: 0; min-height: 0; }
```

Measured with Mint-Y in the test image (green pixels of the filled block in a
185 px bar):

| Value | Before | After |
|---|---|---|
| 0.2 % | 30 px | 2 px (only the 1 px borders) |
| 1.9 % | 30 px | 3 px |
| 50 % | 85 px | 85 px |
| 100 % | 175 px | 175 px |

## Translations

- Texts in the code are in English and marked with `_()`, `ngettext()` or
  `N_()`. Placeholders use named braces (`{app}`, `{n}`…) so translators can
  reorder them. A literal `%` in a text needs a `# xgettext: no-python-format`
  comment on the line before the call.
- Catalogs: `po/es.po`, `po/fr.po`, `po/zh_CN.po`. Language without a catalog
  → English.
- The application looks for compiled catalogs in `build/locale` (when run from
  the source tree), `<prefix>/share/locale`, `/usr/share/locale` and
  `/usr/local/share/locale`.
- Decimal separator: taken from the system locale (`2,0` / `2.0`).
- The desktop launcher (`data/mintmotion.desktop`) has its own translated
  `GenericName`, `Comment` and `Keywords` lines.
- The extension shows no texts to the user; its `metadata.json` description is
  in English.

Workflow:

```bash
make pot          # after changing texts in src/mintmotion
make update-po    # merges the new template into every po/*.po
# translate with a text editor or Poedit, then:
make              # compiles to build/locale (msgfmt -c checks placeholders)
LANGUAGE=fr python3 src/mintmotion          # try it from the source tree
```

New language: `msginit -i po/mintmotion.pot -l de -o po/de.po`, translate, and
`make`. The Makefile picks up every `po/*.po` automatically.

The French and Simplified Chinese catalogs were written without review by a
native speaker.

## Building

Build dependencies: `make`, `gettext`, `dpkg-deb`.

```bash
make deb          # → dist/mintmotion_<version>_all.deb
```

The version is set in `Makefile`, `packaging/build-deb.sh` and
`extension/mintmotion@sombra/metadata.json`.

## Testing

The test environment is a Docker image with Debian trixie and the LMDE 7 “gigi”
packages (Cinnamon 6.6.9, Muffin 6.6.3, Nemo 6.6.3, mpv 0.40). It runs a real
Cinnamon session on Xvnc with software rendering.

```bash
docker build -t lmde7-test tests/
make deb
docker run -d --init --name mm-test -v "$PWD":/repo lmde7-test sleep infinity
docker exec mm-test sh -c 'mkdir -p /run/dbus && dbus-daemon --system --fork && apt-get install -y /repo/dist/mintmotion_*_all.deb'
docker exec -u neo mm-test bash /repo/tests/start-session.sh
docker exec -u neo mm-test bash /repo/tests/smoke-test.sh
docker rm -f mm-test
```

Use `--init`: without an init process, zombie processes accumulate in the
container and the process counts in the test are wrong.

`tests/smoke-test.sh` makes 28 checks:

- Playback: starts within 20 s, a single mpv, no Python process left, a single
  window, the background is not black.
- Languages: `--status` in English, French, Chinese, and German (no catalog →
  English).
- Pause: a small window does not pause; a maximized one does; after 6 s covered
  (with `sleep_after` lowered) mpv is closed; uncovering resumes at the same
  position without a black frame.
- Recovery: hung mpv is restarted; memory above `ram_limit_mb` restarts it at
  the same position; `kill -9` of Cinnamon kills its mpv, and after Cinnamon
  restarts there is one mpv and one window.
- Disabling leaves no processes or windows.

What cannot be tested in the container: hardware decoding, the effect of
`gpu_env`, real GPU drivers, several physical monitors.

## What is tested and what is not

| Area | Status |
|---|---|
| LMDE 7, Cinnamon 6.6, X11 | Tested (container and real computer). |
| NVIDIA (GTX 1650, driver 550) | Tested on a real computer: `nvdec` direct, memory, CPU, `gpu_env`, sleep and resume. |
| Software decoding | Tested in the container. |
| Intel / AMD (VA-API) | **Not tested.** |
| Hybrid graphics (Optimus, PRIME) | **Not tested.** `gpu_env` is not applied there by design. |
| Several monitors | **Not tested** (the code makes one clone per monitor). |
| Linux Mint 22.x (Ubuntu base) | **Not tested** on real hardware. |
| Cinnamon 6.0, 6.2, 6.4, 6.8 | Declared in `metadata.json`; **only 6.6 tested.** |
| Other distributions with Cinnamon | **Not tested.** |
| Other desktops | **Not supported.** |
| Wayland | **Not supported.** |
| HiDPI / fractional scaling | **Not tested.** |
| Translations fr, zh_CN | Work (tested by `--status`); wording not reviewed by native speakers. |

Useful information in a report: distribution and version, `cinnamon --version`,
`mpv --version | head -1`, graphics card and driver, `mintmotion --status`, the
mpv PSS and `hwdec-current` (commands in [Memory](#measuring)), and the
`[mintmotion]` lines of `~/.xsession-errors`.

## Limitations and porting notes

- **Cinnamon only.** Placing the video below the desktop icons relies on
  Cinnamon internals: the background actors (`global.get_background_actors()`
  in Cinnamon ≥ 6.8, `global.background_actor` before; see
  `getBackgroundActors()` in `extension.js`), `Main.layoutManager.monitors`,
  window actors (`get_compositor_private()`), `Clutter.Clone`, and Cinnamon's
  extension system. Another desktop would need its own way to put a window under
  the icons; the renderer and the mpv supervision could be reused.
- **X11 only.** The renderer creates an X11 window and mpv draws into it with
  `--wid`. Wayland has no equivalent.
- **Debian package only.** Other distributions would need their own packaging;
  the `Makefile` installs with `PREFIX` and `DESTDIR`.
- **Cinnamon Spices.** Publishing the extension on cinnamon-spices.linuxmint.com
  would need changes: Spices extensions must keep their settings through the
  xlet settings system (`settings-schema.json`), while MintMotion uses its own
  JSON file and a separate GTK application. External programs (mpv, ffmpeg) can
  be installed by the user from the distribution, but nothing precompiled may be
  bundled.
- **Uninstall from the window** uses `pkexec apt-get purge`, so it only works
  for the Debian package. For source installs it shows the `make uninstall`
  command.

## Ideas for future work

- Measure and document Intel and AMD (VA-API) results.
- Test several monitors and HiDPI.
- Look into the NVIDIA driver's 154 MB (`--hwdec-extra-frames`,
  `--swapchain-depth`), measuring dropped frames.
- A playlist or a different video per monitor.
- Packaging for other distributions.

## Version history

- **1.4.0** — Interface in English, Spanish, French and Simplified Chinese
  (gettext); English for any other language. Usage bars proportional to the
  value in every theme. Author data. Documentation for developers. Log messages
  in English. `--hwdec` and `--pause-when-covered` also accept `yes`.
- **1.3.0** — No resident Python process (one-shot renderer). Sleep mode: mpv
  is closed after 2 minutes covered and resumed at the same position. Health and
  memory watchdogs. Hardware-decoding direct-mode check. NVIDIA-only environment
  (`gpu_env`). Leaner mpv options. Cleanup of windows and processes left by
  earlier instances or versions.
- **1.2.0** — CPU and RAM usage bars in the window.
- Earlier versions were called “Fondo de vídeo”; MintMotion migrates their
  settings and videos automatically.

## Contributing

- Open an issue with the information listed in
  [What is tested and what is not](#what-is-tested-and-what-is-not).
- Keep changes small and measured: if a change is about memory or CPU, include
  the numbers before and after, taken as described in [Memory](#measuring).
- Run `tests/smoke-test.sh` before sending a change.
- New user-visible texts go through `_()` and `make update-po`.

Author: José Antonio Ramos Miralles, “Sombra” — <hola@joseantonioramos.es>.
License: GPL-3.0-or-later.
