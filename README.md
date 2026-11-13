# MintMotion

**Video wallpaper for Linux Mint and LMDE (Cinnamon and Xfce).** *by Sombra*

[Versión en español](README.es.md) · [Developer guide](docs/DEVELOPERS.md) · [▶ Video](https://youtu.be/W-0gZbKyELo)

MintMotion plays a video as your desktop background, below the desktop icons,
the panels and every window. It never takes mouse clicks or keyboard input.

- In **Cinnamon** the video is drawn inside Cinnamon's own background layer
  (also below the desklets).
- In **Xfce** it goes in a window of its own, right above the desktop, and the
  icons are painted again on top of it with their real transparency. See
  [In Xfce](#in-xfce).

- **Pauses by itself** when the desktop is completely covered: a maximized or
  fullscreen window, several windows that cover it together, Cinnamon's Expo
  view, or the screensaver. It keeps playing while any part of the desktop is visible.
  Paused, it uses almost no CPU.
- **Sleeps** when the desktop stays covered for 2 minutes. The player is closed
  and all its memory (including the graphics driver's share) is freed. The last
  frame stays on screen, and when the desktop is uncovered the video continues
  from the same point, without a black flash.
- **Hardware decoding** (VA-API, VDPAU or NVDEC) when the system has it. There is
  no sound. In Cinnamon one decoder is shared by all monitors; in Xfce there is
  one per monitor, and each monitor pauses on its own.
- **Repairs itself.** If the player hangs or its memory grows abnormally, it is
  restarted at the same point.
- **Its own window** to choose the video and the options, with **Apply**,
  **Remove video** and **Uninstall** buttons and live CPU/RAM bars.
- **Available in** English, Spanish, French and Simplified Chinese. It follows
  the system language; any other language gets English.

> **Project status.** In Cinnamon it works, and it has been measured on one real
> computer (NVIDIA) and in a test container. **Xfce support is new in version
> 1.5.0** and so far has only been tested in a virtual Xfce 4.18 session, without
> a graphics card. It has **not** been tested with AMD or Intel graphics, on
> several real monitors, or on other desktops and distributions. See
> [What is tested](#what-is-tested) and [What is not tested yet](#what-is-not-tested-yet).
> Reports and contributions are welcome.

## Requirements

- Linux Mint 22.x or LMDE 6/7, in the **X11** session (the default one). Wayland
  is not supported. With one of these desktops:
  - **Cinnamon 6.0 or newer**, or
  - **Xfce 4.18** with its window manager (xfwm4) and its desktop (xfdesktop),
    which is what Linux Mint 22.x Xfce ships.
- The package pulls in what it needs: `mpv python3-gi python3-xlib gir1.2-gtk-3.0 ffmpeg`.

## Install

From the `.deb` package:

```bash
sudo apt install ./mintmotion_1.6.0_all.deb
```

Open **MintMotion** from the menu (Preferences in Cinnamon, Settings in Xfce).
You do not need to restart the desktop. When **updating** from an earlier
version, log out and back in afterwards so that Cinnamon loads the new extension
(or, in Xfce, so that the new supervisor starts).

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
player and, in Xfce, its supervisor too), updated every 2 seconds. The bars are
proportional to the value: 2 % of the RAM is 2 % of the bar.

- **CPU:** percentage of the whole computer and of one core.
- **RAM:** the player's own memory (PSS), in MB and as a percentage of the total.

The work the desktop (Cinnamon, or the Xfce compositor) does to compose the video
on screen is not included, because it cannot be separated from the desktop itself.

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

## In Xfce

Xfce does not allow drawing inside its desktop background, so MintMotion works
in a different way there:

- **Your desktop background is changed while the video is on, then put back.**
  To tell the icons apart, MintMotion sets a plain, almost black colour as the
  Xfce background while the video is set. Your image, its style and your colour
  are saved and come back by themselves when you press **Remove video**, when
  you log out and when the package is uninstalled. If you change the background
  in the Xfce settings while the video is on, your choice is remembered and is
  what comes back afterwards.
- **Icons look as they do over a static background** (since version 1.6.0):
  smoothed edges, label shadows and the translucent selection rectangle. This
  needs the Xfce compositor to be on (Window Manager Tweaks → Compositor),
  which is the default, or another compositor (picom, Compton). MintMotion
  measures the transparency of each pixel by setting the xfdesktop background
  to black and to white for an instant, under the video, where it cannot be
  seen. When something changes on the desktop (selecting, dragging, a new
  icon), the transparency of what changed is approximate for a few tenths of a
  second.
- **Without a compositor**, icons are cut out as in version 1.5.0: they show a
  thin dark edge and soft shadows become hard. If the compositor is turned on
  or off while the video is set, MintMotion switches mode by itself.
- **One more process stays running:** the `mintmotion-xfce` supervisor, which
  does what the extension does in Cinnamon. It starts by itself at login when a
  video is set.
- **One player per monitor.** Each monitor pauses and sleeps on its own; in
  exchange, with two monitors in view the video is decoded twice.
- If something fails, the log is in `~/.cache/mintmotion/mintmotion.log`.

## How much it uses

In Cinnamon, MintMotion keeps **a single process running: mpv**. The helper that
creates the window exits at once, so no Python stays in memory. While the desktop
is covered for more than 2 minutes, **nothing** of MintMotion is running.

In Xfce the supervisor (Python) also stays: **about 32 MB** of RAM (PSS) with one
1920×1080 monitor and the compositor on (23 MB plus 8 MB for the icon layer of
each monitor; 22–23 MB without a compositor), measured in the test session, and no CPU while nothing changes on the desktop (0 hundredths
of a second of CPU in 10 seconds). When the desktop is covered for more than 2
minutes mpv is closed just the same; the supervisor keeps running.

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

- **Xfce test session** with the Ubuntu 24.04 packages, which are the base of
  Linux Mint 22.x (xfwm4 4.18.0, xfdesktop 4.18.1, xfce4-panel 4.18.4, mpv 0.37),
  on a virtual X server (Xvfb) with software rendering:
  `tests/smoke-test-xfce.sh` (46 checks) passes with the xfwm4 compositor on and
  off. With the compositor, the desktop over a still-frame video was compared
  pixel by pixel with that same frame set as a static background: 99.95 % of
  the pixels are identical and the rest differ by 1 level out of 255. Turning
  the compositor on and off while the video is set was tested too. It covers the same as the Cinnamon test and also that the icons show over
  the video pixel by pixel, that a right click reaches the desktop, an xfdesktop
  restart, the death of the supervisor, and that the Xfce background ends up as
  it was. `tests/multimonitor-test-xfce.sh` (14 checks) tests two virtual
  monitors with independent pause.
- **Cinnamon 6.0.4** (Ubuntu 24.04 packages) on Xvnc: the Cinnamon test (28
  checks) passes with version 1.5.0.

## What is not tested yet

- **Xfce on a real computer:** everything about Xfce was tested without a
  graphics card. Hardware decoding, real monitors and an installed Linux Mint
  Xfce are still to be checked.
- **Xfce 4.20** (LMDE 7 with Xfce, the coming Linux Mint 23) and **Xfce 4.16**
  (Linux Mint 21). The xfdesktop 4.20 code was reviewed and uses the same
  settings and window scheme, but it was not run.
- **Pause with the screen off or the session inactive** in Xfce (locking with
  light-locker, switching user): it is implemented, but the test server cannot
  exercise it.

- **AMD and Intel graphics** (VA-API decoding). It should work, because mpv
  chooses the decoder, but nobody has measured it yet.
- **Laptops with two graphics cards** (for example Intel + NVIDIA).
- **Several monitors.**
- **Cinnamon 6.8.**
- **Other desktops** (GNOME, KDE, MATE…): not supported.
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
