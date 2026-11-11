#!/bin/bash
# Prueba del paquete instalado dentro del contenedor de pruebas.
#   docker build -t lmde7-test tests/
#   make deb
#   docker run -d --name mm-test -v "$PWD":/repo lmde7-test sleep infinity
#   docker exec mm-test apt-get install -y /repo/dist/mintmotion_*_all.deb
#   docker exec -u neo mm-test bash /repo/tests/start-session.sh
#   docker exec -u neo mm-test bash /repo/tests/smoke-test.sh
set -u
. /tmp/session-env
export DISPLAY=:1
fail=0
check() { if [ "$2" = "$3" ]; then echo "OK   $1"; else echo "FALLO $1 (esperado '$3', obtenido '$2')"; fail=1; fi; }
estado() { LANGUAGE=es mintmotion --status | sed -n 's/^estado: //p'; }
mpvpid() { pgrep -x mpv | head -1; }
ventanas() { xdotool search --class mintmotion-renderer 2>/dev/null | wc -l; }
ipc() {  # ipc <propiedad>: valor actual en mpv
    python3 - "$1" <<'EOF'
import json, socket, sys, os
path = open(os.path.join(os.environ["XDG_RUNTIME_DIR"], "mintmotion.socket")).read().strip()
s = socket.socket(socket.AF_UNIX); s.settimeout(1); s.connect(path)
s.sendall(json.dumps({"command": ["get_property", sys.argv[1]]}).encode() + b"\n")
print(json.loads(s.recv(4096).decode().splitlines()[0]).get("data"))
EOF
}
config() {  # config clave=valor ...: cambia claves ocultas de la configuración
    python3 - "$@" <<'EOF'
import json, os, sys
p = os.path.expanduser("~/.config/mintmotion/config.json")
c = json.load(open(p))
for kv in sys.argv[1:]:
    k, v = kv.split("=", 1); c[k] = json.loads(v)
json.dump(c, open(p + ".tmp", "w")); os.replace(p + ".tmp", p)
EOF
}
brillo() {  # brillo medio (0-1) de una zona de la pantalla
    import -window root -crop 400x300+760+390 +repage /tmp/zona.png 2>/dev/null
    convert /tmp/zona.png -format "%[fx:mean>0.08?1:0]" info:
}
pkill -x xmessage 2>/dev/null; sleep 1   # restos de una ejecución anterior

ffmpeg -v error -y -f lavfi -i testsrc2=s=1920x1080:r=30:d=60 -pix_fmt yuv420p /tmp/prueba.mp4
mintmotion --video /tmp/prueba.mp4 --fit rellenar --quality alta --pause-when-covered si --enable
for i in $(seq 1 20); do sleep 1; [ "$(estado)" = "reproduciendo" ] && break; done
check "reproduce al activar (en ≤20 s)" "$(estado)" "reproduciendo"
# Idiomas: la salida de --status en cada catálogo y en uno sin traducción (→ inglés)
check "idioma en"    "$(LANGUAGE=en    mintmotion --status | tail -1)" "state: playing"
check "idioma fr"    "$(LANGUAGE=fr    mintmotion --status | tail -1)" "état : lecture"
check "idioma zh_CN" "$(LANGUAGE=zh_CN mintmotion --status | tail -1)" "状态：播放中"
check "idioma de (sin catálogo → inglés)" "$(LANGUAGE=de mintmotion --status | tail -1)" "state: playing"
check "un solo mpv" "$(pgrep -c -x mpv)" "1"
check "no queda ningún proceso de Python" "$(pgrep -fc mintmotion-renderer)" "0"
check "una sola ventana de vídeo" "$(ventanas)" "1"
sleep 2
check "el vídeo se ve en el fondo" "$(brillo)" "1"

# Ventana pequeña: el escritorio sigue visible → sigue reproduciendo
xmessage -geometry 300x100+50+50 "pequeña" & small=$!
sleep 4
check "ventana pequeña no pausa" "$(estado)" "reproduciendo"
kill $small

# Ventana que tapa todo → pausa; si sigue tapado, mpv se cierra (reposo)
config sleep_after=6
sleep 1
xmessage -geometry 1920x1080+0+0 "grande" & big=$!
sleep 2
wid=$(timeout 10 xdotool search --sync --onlyvisible --class xmessage | tail -1)
xdotool windowactivate --sync "$wid" key alt+F10
sleep 3
check "ventana maximizada pausa" "$(estado)" "pausado"
pos=$(ipc time-pos)
sleep 7
check "tapado más de 6 s: mpv cerrado" "$(pgrep -c -x mpv)" "0"
check "estado en reposo" "$(estado)" "dormido"
kill $big; sleep 0.3
check "al destapar no hay negro (último fotograma)" "$(brillo)" "1"
sleep 4
check "reanuda al cerrarla" "$(estado)" "reproduciendo"
nuevo=$(ipc time-pos)
check "sigue donde iba (≥ $pos s)" "$(python3 -c "print(int($nuevo >= $pos - 0.5))")" "1"
check "el vídeo se ve tras el reposo" "$(brillo)" "1"
config sleep_after=120

# mpv colgado → la extensión lo reinicia
viejo=$(mpvpid); kill -STOP "$viejo"
for i in $(seq 1 40); do sleep 1; p=$(mpvpid); [ -n "$p" ] && [ "$p" != "$viejo" ] && break; done
check "mpv colgado se reinicia" "$( [ -n "$(mpvpid)" ] && [ "$(mpvpid)" != "$viejo" ] && echo si)" "si"
kill -KILL "$viejo" 2>/dev/null
for i in $(seq 1 20); do sleep 1; [ "$(estado)" = "reproduciendo" ] && break; done
check "reproduce tras el reinicio" "$(estado)" "reproduciendo"

# Memoria por encima del límite → reinicio en el mismo punto
viejo=$(mpvpid)
config ram_limit_mb=40
for i in $(seq 1 90); do sleep 1; p=$(mpvpid); [ -n "$p" ] && [ "$p" != "$viejo" ] && break; done
check "límite de memoria: mpv se reinicia" "$( [ -n "$(mpvpid)" ] && [ "$(mpvpid)" != "$viejo" ] && echo si)" "si"
config ram_limit_mb=0
check "un solo mpv tras los reinicios" "$(pgrep -c -x mpv)" "1"
check "una sola ventana tras los reinicios" "$(ventanas)" "1"

# Cinnamon se cae: su mpv muere con él (sin esperar a nadie) y, al volver,
# la ventana vieja se retira y queda un solo reproductor
vivo() { s=$(ps -o stat= -p "$1" 2>/dev/null | cut -c1); [ -n "$s" ] && [ "$s" != Z ] && echo vivo || echo muerto; }
mpvviejo=$(mpvpid)
pkill -9 -x cinnamon; sleep 3
check "Cinnamon caído: su mpv muere" "$(vivo "$mpvviejo")" "muerto"
(XDG_SESSION_TYPE=x11 XDG_CURRENT_DESKTOP=X-Cinnamon XDG_SESSION_DESKTOP=cinnamon DESKTOP_SESSION=cinnamon \
    nohup cinnamon --replace >/tmp/cinnamon2.log 2>&1 &)
for i in $(seq 1 40); do sleep 1; [ "$(estado)" = "reproduciendo" ] && break; done
sleep 6
check "Cinnamon de vuelta: un solo mpv" "$(ps -eo stat=,comm= | grep -v '^Z' | grep -c ' mpv$')" "1"
check "Cinnamon de vuelta: una sola ventana" "$(ventanas)" "1"
check "Cinnamon de vuelta: reproduce" "$(estado)" "reproduciendo"

mintmotion --disable; sleep 5
check "desactivar no deja mpv" "$(ps -eo stat=,comm= | grep -v '^Z' | grep -c ' mpv$')" "0"
check "desactivar no deja la ventana" "$(ventanas)" "0"

[ $fail = 0 ] && echo "TODO OK" || { echo "HAY FALLOS"; exit 1; }
