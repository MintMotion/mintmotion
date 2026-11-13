# MintMotion

**Vídeo como fondo de escritorio para Linux Mint y LMDE (Cinnamon y Xfce).** *by Sombra*

[English version](README.md) · [Guía para desarrolladores (en inglés)](docs/DEVELOPERS.md) · [▶ Vídeo](https://youtu.be/W-0gZbKyELo)

MintMotion reproduce un vídeo como fondo de escritorio, por debajo de los iconos
del escritorio, los paneles y todas las ventanas. No roba clics ni teclado.

- En **Cinnamon** el vídeo se dibuja dentro de la capa de fondo del propio
  Cinnamon (también por debajo de los desklets).
- En **Xfce** va en una ventana propia, justo encima del escritorio, y los
  iconos se vuelven a pintar encima con su transparencia real. Véase
  [En Xfce](#en-xfce).

- **Se pausa solo** cuando el escritorio queda tapado del todo: una ventana
  maximizada o a pantalla completa, varias ventanas que entre todas lo cubren, la
  vista Expo de Cinnamon o el salvapantallas. Sigue reproduciéndose mientras se vea aunque
  sea un trozo. En pausa apenas usa CPU.
- **Entra en reposo** si el escritorio sigue tapado 2 minutos: cierra el
  reproductor y libera toda su memoria, incluida la que reserva el driver de la
  gráfica. En pantalla queda el último fotograma y, al destapar el escritorio, el
  vídeo sigue en el mismo punto, sin pantallazo negro.
- **Decodificación por hardware** (VA-API, VDPAU o NVDEC) cuando el equipo la
  tiene. Sin sonido. En Cinnamon, un solo decodificador para todos los monitores;
  en Xfce, uno por monitor, y cada monitor se pausa por separado.
- **Se repara solo.** Si el reproductor se cuelga o su memoria crece de forma
  anormal, lo reinicia en el mismo punto.
- **Ventana propia** para elegir el vídeo y las opciones, con los botones
  **Aplicar**, **Quitar vídeo** y **Desinstalar** y barras de CPU y RAM en directo.
- **Idiomas:** español, inglés, francés y chino simplificado. Sigue el idioma del
  sistema; con cualquier otro idioma sale en inglés.

> **Estado del proyecto.** En Cinnamon funciona, y está medido en un equipo real
> (NVIDIA) y en un contenedor de pruebas. El soporte de **Xfce es nuevo en la
> versión 1.5.0** y de momento solo está probado en una sesión Xfce 4.18 virtual,
> sin tarjeta gráfica. **No** está probado con gráficas AMD o Intel, con varios
> monitores reales ni en otros escritorios o distribuciones. Véase
> [Qué está probado](#qué-está-probado) y [Qué falta por probar](#qué-falta-por-probar).
> Se agradecen informes y colaboraciones.

## Requisitos

- Linux Mint 22.x o LMDE 6/7, en la sesión **X11** (la normal). No funciona en
  Wayland. Con uno de estos escritorios:
  - **Cinnamon 6.0 o superior**, o
  - **Xfce 4.18** con su gestor de ventanas (xfwm4) y su escritorio (xfdesktop),
    que es lo que trae Linux Mint 22.x Xfce.
- El paquete instala lo que necesita: `mpv python3-gi python3-xlib gir1.2-gtk-3.0 ffmpeg`.

## Instalación

Con el paquete `.deb`:

```bash
sudo apt install ./mintmotion_1.6.0_all.deb
```

Abre **MintMotion** desde el menú (Preferencias en Cinnamon, Configuración en
Xfce). No hace falta reiniciar el escritorio. Si **actualizas** desde una versión
anterior, cierra la sesión y vuelve a entrar después, para que Cinnamon cargue la
extensión nueva (o, en Xfce, para que arranque el supervisor nuevo).

Desde el código fuente (hace falta `gettext` para compilar las traducciones):

```bash
make
sudo make install          # PREFIX=/usr por defecto
sudo make uninstall
make deb                   # genera dist/mintmotion_<versión>_all.deb
```

## Uso

1. **Elegir vídeo…** y ajusta las opciones.
2. **Aplicar.** No cambia nada hasta que lo pulsas.

| Botón | Qué hace |
|---|---|
| **Aplicar** | Pone el vídeo de fondo con las opciones elegidas. |
| **Quitar vídeo** | Para el vídeo y vuelve a tu fondo estático anterior. Si esa imagen ya no existe, te pide otra. |
| **Desinstalar…** | Quita el programa, su extensión y toda su configuración (pide tu contraseña). Pregunta si borras o conservas los vídeos creados con «Optimizar». Tus vídeos originales nunca se tocan. |

| Opción | Qué hace |
|---|---|
| Ajuste a la pantalla | **Rellenar** (recorta lo que sobre), **Ajustar** (bandas negras) o **Estirar**. |
| Calidad de escalado | **Alta** (recomendada), **Máxima** u **Ahorro**. |
| Pausar cuando el escritorio queda tapado por completo | Activado por defecto. |
| Decodificación por hardware | Activado por defecto. |

Debajo del estado hay dos barras con el **consumo real de MintMotion** (el
reproductor mpv y, en Xfce, también su supervisor), actualizadas cada 2
segundos. Las barras son proporcionales al valor: un 2 % de la RAM ocupa un 2 % de
la barra.

- **CPU:** porcentaje del total del equipo y de un núcleo.
- **RAM:** memoria propia del reproductor (PSS), en MB y en porcentaje del total.

No incluye el trabajo que hace el escritorio (Cinnamon, o el compositor de Xfce)
para componer el vídeo en pantalla, porque no se puede separar del propio
escritorio.

**Optimizar para mi pantalla** crea una copia del vídeo a la resolución exacta de
tu monitor (H.264, 30 fps como máximo, sin audio), que es lo más ligero de
reproducir. Las copias se guardan en `~/.local/share/mintmotion/`.

### Línea de órdenes

```bash
mintmotion --video ~/Vídeos/olas.mp4     # elige y aplica
mintmotion --fit ajustar --quality alta  # ajuste: rellenar|ajustar|estirar · calidad: alta|maxima|ahorro
mintmotion --hwdec si                    # si|no (también acepta «yes»)
mintmotion --status
mintmotion --disable                     # quita el vídeo
```

Los valores de las opciones (`rellenar`, `alta`…) son los nombres internos que se
guardan en la configuración y son iguales en todos los idiomas.

### Desinstalar sin la ventana

```bash
mintmotion --disable
sudo apt purge mintmotion
```

## En Xfce

Xfce no permite dibujar dentro de su fondo de escritorio, así que MintMotion
trabaja de otra manera:

- **Tu fondo de escritorio se cambia mientras hay vídeo y luego se devuelve.**
  Para distinguir los iconos, MintMotion pone como fondo de Xfce un color liso
  casi negro mientras el vídeo está puesto. Tu imagen, su estilo y tu color se
  guardan y vuelven solos al pulsar **Quitar vídeo**, al cerrar la sesión y al
  desinstalar el paquete. Si cambias el fondo en los ajustes de Xfce con el vídeo
  puesto, se recuerda tu elección y es la que vuelve después.
- **Los iconos se ven como con un fondo estático** (desde la versión 1.6.0), con
  sus bordes suavizados, las sombras de los textos y el rectángulo de selección
  translúcido. Para ello hace falta el compositor de Xfce activado (Ajustes del
  gestor de ventanas → Compositor), que es lo normal, u otro compositor (picom,
  Compton). MintMotion mide la transparencia de cada píxel poniendo un instante
  el fondo de xfdesktop en negro y en blanco, por debajo del vídeo, sin que se
  vea. Al cambiar algo en el escritorio (seleccionar, arrastrar, un icono
  nuevo), la transparencia de lo que ha cambiado es aproximada durante unas
  décimas de segundo.
- **Sin compositor**, los iconos se recortan como en la versión 1.5.0: se ven
  con un borde oscuro fino y las sombras suaves quedan duras. Si activas o
  desactivas el compositor con el vídeo puesto, MintMotion cambia de un modo a
  otro solo.
- **Queda un proceso más en marcha:** el supervisor `mintmotion-xfce`, que hace
  lo que en Cinnamon hace la extensión. Arranca solo al iniciar sesión si hay un
  vídeo puesto.
- **Un reproductor por monitor.** Cada monitor se pausa y entra en reposo por
  separado; a cambio, con dos monitores a la vista se decodifica el vídeo dos
  veces.
- Si algo falla, el registro está en `~/.cache/mintmotion/mintmotion.log`.

## Cuánto consume

En Cinnamon, MintMotion deja **un solo proceso en marcha: mpv**. El ayudante que
crea la ventana termina al momento, así que no queda Python en memoria. Mientras
el escritorio lleva más de 2 minutos tapado, no queda **nada** de MintMotion en
marcha.

En Xfce queda además el supervisor (Python): **unos 32 MB** de RAM (PSS) con un
monitor de 1920×1080 y el compositor activado (23 MB más 8 MB por la capa de
iconos de cada monitor; 22-23 MB sin compositor), medidos en la sesión de pruebas, y sin consumo de CPU mientras no cambia nada en el
escritorio (0 centésimas de segundo de CPU en 10 segundos). Con el escritorio
tapado más de 2 minutos mpv se cierra igual; el supervisor sigue en marcha.

Medido en el equipo del autor (LMDE 7, NVIDIA GeForce GTX 1650, driver
550.163.01, mpv 0.40.0, 12 núcleos lógicos, 15,5 GB de RAM, monitor de
1920×1080) con un vídeo H.264 de 1920×1080 a 24 fps:

| Estado | RAM de mpv (PSS) | CPU |
|---|---|---|
| Reproduciendo (decodificación `nvdec`) | 314-315 MB | 2,6-3,2 % de un núcleo (un 0,2 % del total) |
| Escritorio tapado más de 2 minutos | 0 MB (mpv cerrado) | 0 % |

Unos 175 MB de esos 315 MB son del **driver de NVIDIA**, no de MintMotion:
`/dev/nvidiactl` (154 MB de memoria que el driver reserva para la gráfica) más sus
librerías. Cualquier reproductor que use una gráfica NVIDIA paga ese coste. La
memoria de trabajo propia del reproductor es de unos 92 MB. El reparto completo
está en la [guía para desarrolladores](docs/DEVELOPERS.md#memory).

En el contenedor de pruebas, sin tarjeta gráfica y con decodificación por
software, mpv ocupa 168-169 MB con el mismo tipo de vídeo. Las cifras de equipos
distintos no son comparables: dependen del driver de la gráfica y del modo de
decodificación.

## Qué está probado

- **Equipo real (NVIDIA):** reproducción con decodificación por hardware (`nvdec`,
  modo directo sin copias), memoria y CPU, el ajuste de memoria para NVIDIA
  (−23 MB, mismo resultado en dos rondas), reposo a los 2 minutos de tapar el
  escritorio (mpv cerrado, estado «dormido») y reanudación en el mismo punto sin
  pantallazo negro.
- **Contenedor de pruebas** con los paquetes de LMDE 7 (Cinnamon 6.6.9,
  Muffin 6.6.3, Nemo 6.6.3, mpv 0.40) sobre un servidor X real (Xvnc) con gráficos
  por software: la prueba automática `tests/smoke-test.sh` (28 comprobaciones)
  cubre reproducción, pausa y reposo, recuperación con el reproductor colgado y
  con límite de memoria, cierre de Cinnamon a la fuerza, desinstalación limpia y
  los cuatro idiomas. También se probaron allí la ventana, sus botones, las
  variantes de la desinstalación y las barras de consumo.

- **Sesión Xfce de pruebas** con los paquetes de Ubuntu 24.04, que son la base de
  Linux Mint 22.x (xfwm4 4.18.0, xfdesktop 4.18.1, xfce4-panel 4.18.4, mpv 0.37),
  sobre un servidor X virtual (Xvfb) con gráficos por software:
  `tests/smoke-test-xfce.sh` (46 comprobaciones) pasa con el compositor de xfwm4
  activado y desactivado. Con el compositor, el escritorio con un vídeo de
  fotograma fijo se ha comparado píxel a píxel con ese mismo fotograma puesto
  como fondo estático: el 99,95 % de los píxeles son idénticos y el resto
  difiere en 1 nivel de 255. También se ha probado a activar y desactivar el
  compositor con el vídeo puesto. Cubre lo mismo que la prueba de Cinnamon y, además, que
  los iconos se ven sobre el vídeo píxel a píxel, que el clic derecho llega al
  escritorio, el reinicio de xfdesktop, la muerte del supervisor y que el fondo
  de Xfce vuelve a quedar como estaba. `tests/multimonitor-test-xfce.sh` (14
  comprobaciones) prueba dos monitores virtuales con pausa independiente.
- **Cinnamon 6.0.4** (paquetes de Ubuntu 24.04) sobre Xvnc: la prueba de Cinnamon
  (28 comprobaciones) pasa con la versión 1.5.0.

## Qué falta por probar

- **Xfce en un equipo real:** todo lo de Xfce se ha probado sin tarjeta gráfica.
  Falta comprobarlo con decodificación por hardware, con monitores reales y en un
  Linux Mint Xfce instalado.
- **Xfce 4.20** (LMDE 7 con Xfce, futuro Linux Mint 23) y **Xfce 4.16** (Linux
  Mint 21). El código de xfdesktop 4.20 se ha revisado y usa el mismo esquema de
  ajustes y de ventanas, pero no se ha ejecutado.
- **Pausa con la pantalla apagada o con la sesión inactiva** en Xfce (bloqueo con
  light-locker, cambio de usuario): está programada, pero el servidor de pruebas
  no permite comprobarla.

- **Gráficas AMD e Intel** (decodificación VA-API). Debería funcionar, porque el
  decodificador lo elige mpv, pero nadie lo ha medido todavía.
- **Portátiles con dos gráficas** (por ejemplo Intel + NVIDIA).
- **Varios monitores.**
- **Cinnamon 6.8.**
- **Otros escritorios** (GNOME, KDE, MATE…): no están soportados.
- **Otras distribuciones** con Cinnamon (Fedora, Arch, Ubuntu Cinnamon…): sin
  probar. El paquete `.deb` es para sistemas basados en Debian; `make install`
  debería funcionar en otras si están las dependencias.
- **Wayland:** no está soportado.

Si lo pruebas en alguno de estos casos, abre una incidencia con la salida de
`mintmotion --status` y, si puedes, las mediciones que explica la guía para
desarrolladores.

## Traducciones

Los textos de la interfaz están en `po/`. Para añadir un idioma, véase
[Translations](docs/DEVELOPERS.md#translations). Las traducciones al francés y al
chino no las ha revisado un hablante nativo; se agradecen correcciones.

## Autor y licencia

José Antonio Ramos Miralles, **«Sombra»** — <hola@joseantonioramos.es>

GPL-3.0-or-later. Véase `LICENSE`.
