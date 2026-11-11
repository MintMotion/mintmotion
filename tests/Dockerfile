# Entorno de pruebas: Debian trixie + paquetes de LMDE 7 "gigi" (Cinnamon 6.6).
#   docker build -t lmde7-test tests/
FROM debian:trixie
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg && \
    echo "deb [trusted=yes] http://packages.linuxmint.com gigi main upstream import backport" > /etc/apt/sources.list.d/lmde.list && \
    printf 'Package: *\nPin: origin packages.linuxmint.com\nPin-Priority: 700\n' > /etc/apt/preferences.d/mint && \
    apt-get update && apt-get install -y linuxmint-keyring && \
    apt-get install -y cinnamon cinnamon-screensaver nemo mpv python3-xlib python3-gi gir1.2-gtk-3.0 \
      xvfb xdotool x11-utils x11-xserver-utils imagemagick dbus-x11 ffmpeg libgl1-mesa-dri sudo locales procps \
      fonts-dejavu-core adwaita-icon-theme tigervnc-standalone-server xserver-xorg-core xserver-xorg-video-dummy \
      mesa-utils mint-themes mint-x-icons mint-y-icons && \
    sed -i 's/# es_ES.UTF-8/es_ES.UTF-8/' /etc/locale.gen && locale-gen && \
    useradd -m -s /bin/bash neo && echo 'neo ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/neo && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
