# MintMotion

**Video wallpaper for Linux Mint and LMDE (Cinnamon).** *by Sombra*

[Versión en español](README.es.md) · [Developer guide](docs/DEVELOPERS.md)

MintMotion plays a video as your desktop background. The video is drawn inside
Cinnamon's own background layer: below the desktop icons, desklets, panels and
every window. It never takes mouse clicks or keyboard input.

- **Pauses by itself** when the desktop is completely covered: a maximized or
  fullscreen window, several windows that cover it together, the Expo view, or
  the screensaver. It keeps playing while any part of the desktop is visible.
  Paused, it uses almost no CPU.
- **Sleeps** when the desktop stays covered for 2 minutes. The player is closed
  and all its memory (including the graphics driver's share) is freed. The last
  frame stays on screen, and when the desktop is uncovered the video continues
  from the same point, without a black flash.
- **Hardware decoding** (VA-API, VDPAU or NVDEC) when the system has it. There is
  no sound, and one decoder is shared by all monitors.
- **Repairs itself.** If the player hangs or its memory grows abnormally, it is
  restarted at the same point.
- **Its own window** to choose the video and the options, with **Apply**,
  **Remove video** and **Uninstall** buttons and live CPU/RAM bars.
- **Available in** English, Spanish, French and Simplified Chinese. It follows
  the system language; any other language gets English.

> **Project status.** It works, and it has been measured on one real computer
> (NVIDIA) and in a test container. It has **not** been tested with AMD or Intel
> graphics, on several monitors, or on other desktops and distributions. See
> [What is tested](#what-is-tested) and [What is not tested yet](#what-is-not-tested-yet).
> Reports and contributions are welcome.

## Requirements

- Linux Mint 22.x or LMDE 6/7 with **Cinnamon 6.0 or newer**, in the **X11**
  session (the default one). Wayland is not supported.
- The package pulls in what it needs: `mpv python3-gi python3-xlib gir1.2-gtk-3.0 ffmpeg`.

## Install

From the `.deb` package:

```bash
sudo apt install ./mintmotion_1.4.0_all.deb
```

Open **MintMotion** from the menu (Preferences). You do not need to restart
Cinnamon. When **updating** from an earlier version, log out and back in
afterwards so that Cinnamon loads the new extension.

From the source code (needs `gettext` to compile the translations):

```bash
make
sudo make install          # PREFIX=/usr by default
sudo make uninstall
make deb                   # builds dist/mintmotion_<version>_all.deb
```

## Use

1. **Choose video…** and set the options.
2. **Apply.** Nothing changes until you press it.

| Button | What it does |
|---|---|
| **Apply** | Sets the video as background with the chosen options. |
| **Remove video** | Stops the video and goes back to your previous static background. If that image no longer exists, it asks for another one. |
| **Uninstall…** | Removes the program, its extension and all its settings (asks for your password). It asks whether to keep or delete the videos created with “Optimize”. Your original videos are never touched. |

| Option | What it does |
|---|---|
| Screen fit | **Fill** (crops the excess), **Fit** (black bars) or **Stretch**. |
| Scaling quality | **High** (recommended), **Maximum** or **Saver**. |
| Pause when the desktop is fully covered | On by default. |
| Hardware decoding | On by default. |

Under the status line, two bars show the **real usage of MintMotion** (the mpv
player, the only process left running), updated every 2 seconds. The bars are
proportional to the value: 2 % of the RAM is 2 % of the bar.

- **CPU:** percentage of the whole computer and of one core.
- **RAM:** the player's own memory (PSS), in MB and as a percentage of the total.

The work Cinnamon does to compose the desktop is not included, because it cannot
be separated from Cinnamon.

**Optimize for my screen** creates a copy of the video at the exact resolution
of your monitor (H.264, at most 30 fps, no audio), which is the lightest thing
to play. Copies are saved in `~/.local/share/mintmotion/`.

### Command line

```bash
mintmotion --video ~/Videos/waves.mp4    # choose and apply
mintmotion --fit ajustar --quality alta  # fit: rellenar|ajustar|estirar · quality: alta|maxima|ahorro
mintmotion --hwdec yes                   # yes|no (also accepts "si")
mintmotion --status
mintmotion --disable                     # remove the video
```

The option values (`rellenar`, `alta`…) are the internal names stored in the
settings file and are the same in every language.

### Uninstall without the window

```bash
mintmotion --disable
sudo apt purge mintmotion
```

## How much it uses

MintMotion keeps **a single process running: mpv**. The helper that creates the
window exits at once, so no Python stays in memory. While the desktop is covered
for more than 2 minutes, **nothing** of MintMotion is running.

Measured on the author's computer (LMDE 7, NVIDIA GeForce GTX 1650, driver
550.163.01, mpv 0.40.0, 12 logical cores, 15.5 GB of RAM, 1920×1080 monitor) with
a 1920×1080 H.264 video at 24 fps:

| State | mpv RAM (PSS) | CPU |
|---|---|---|
| Playing (`nvdec` decoding) | 314–315 MB | 2.6–3.2 % of one core (about 0.2 % of the whole CPU) |
| Desktop covered for more than 2 minutes | 0 MB (mpv closed) | 0 % |

About 175 MB of those 315 MB belong to the **NVIDIA driver**, not to MintMotion:
`/dev/nvidiactl` (154 MB of memory the driver reserves for the graphics card)
plus its libraries. Any player that uses an NVIDIA card pays that cost. The
player's own working memory is about 92 MB. The full breakdown is in the
[developer guide](docs/DEVELOPERS.md#memory).

In the test container, which has no graphics card and decodes in software, mpv
uses 168–169 MB for the same kind of video. Figures from different machines are
not comparable: they depend on the graphics driver and on the decoding mode.

## What is tested

- **Real computer (NVIDIA):** playback with hardware decoding (`nvdec`, direct
  mode without copies), memory and CPU, the NVIDIA memory setting (−23 MB, same
  result in two rounds), sleep after 2 minutes covered (mpv closed, state
  “sleeping”) and resume at the same point without a black flash.
- **Test container** with the LMDE 7 packages (Cinnamon 6.6.9, Muffin 6.6.3,
  Nemo 6.6.3, mpv 0.40) on a real X server (Xvnc) with software rendering: the
  automatic test `tests/smoke-test.sh` (28 checks) covers playback, pause and
  sleep, recovery from a hung player and from a memory limit, a forced Cinnamon
  crash, clean uninstall, and the four languages. The window, its buttons, the
  uninstall variants and the usage bars were also tested there.

## What is not tested yet

- **AMD and Intel graphics** (VA-API decoding). It should work, because mpv
  chooses the decoder, but nobody has measured it yet.
- **Laptops with two graphics cards** (for example Intel + NVIDIA).
- **Several monitors.**
- **Cinnamon 6.8.**
- **Other desktops** (GNOME, KDE, Xfce, MATE…): not supported. The program
  depends on Cinnamon's compositor (Muffin) to place the video under the icons.
- **Other distributions** with Cinnamon (Fedora, Arch, Ubuntu Cinnamon…): not
  tested. The `.deb` package is for Debian-based systems; `make install`
  should work elsewhere if the dependencies are present.
- **Wayland:** not supported.

If you try it on any of these, please open an issue with the result of
`mintmotion --status` and, if possible, the measurements described in the
developer guide.

## Translations

The interface texts are in `po/`. To add a language, see
[Translations](docs/DEVELOPERS.md#translations). The French and Chinese
translations were made without a native speaker's review; corrections are welcome.

## Author and license

José Antonio Ramos Miralles, **“Sombra”** — <hola@joseantonioramos.es>

GPL-3.0-or-later. See `LICENSE`.
