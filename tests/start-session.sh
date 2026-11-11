#!/bin/bash
# Arranca una sesión Cinnamon real (usuario neo) sobre Xvnc dentro del contenedor.
# Cinnamon se reinicia una vez al final: en servidores X virtuales la primera
# instancia a veces no llega a pintar nada.
export DISPLAY=:1 XDG_SESSION_TYPE=x11 XDG_CURRENT_DESKTOP=X-Cinnamon \
       XDG_SESSION_DESKTOP=cinnamon DESKTOP_SESSION=cinnamon LANG=es_ES.UTF-8
export XDG_RUNTIME_DIR=/tmp/rt-neo; mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
Xvnc :1 -geometry "${GEOM:-1920x1080}" -depth 24 -SecurityTypes None -localhost yes >/tmp/xserver.log 2>&1 &
sleep 2
eval "$(dbus-launch --sh-syntax)"
echo "export DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR" > /tmp/session-env
mkdir -p ~/Desktop; touch ~/Desktop/documento.txt; mkdir -p ~/Desktop/Carpeta
start_cinnamon() {
    cinnamon --replace >/tmp/cinnamon.log 2>&1 &
    sleep 8
    nemo-desktop >/tmp/nemo.log 2>&1 &
    sleep 4
}
start_cinnamon
pkill -x nemo-desktop; pkill -x cinnamon; sleep 1
start_cinnamon
echo "sesión lista en :1"
