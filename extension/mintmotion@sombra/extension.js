// MintMotion — extensión de Cinnamon (sesión X11)
// Copyright (C) 2026  José Antonio Ramos Miralles «Sombra» <hola@joseantonioramos.es>
// Licencia: GPL-3.0-or-later (véase LICENSE)
//
// Cómo funciona:
//  1. Lanza mintmotion-renderer (Python, de un solo uso), que crea una ventana
//     X11 de tipo escritorio sin región de entrada (ratón y teclado la
//     atraviesan) y termina. La extensión lanza mpv dentro de esa ventana y lo
//     vigila: no queda ningún proceso intermedio en memoria.
//  2. Oculta el actor real de esa ventana y coloca clones suyos (uno por
//     monitor) como hijos de los actores del fondo de pantalla de Muffin. El
//     vídeo se pinta donde se pinta el fondo: por debajo de los iconos de Nemo,
//     de los desklets, de los paneles y de todas las ventanas.
//  3. Pausa el vídeo cuando el escritorio queda tapado por completo en todos
//     los monitores (por una ventana o por la suma de varias), con el
//     salvapantallas activo o en la vista Expo. Si se ve aunque sea un trozo
//     del escritorio, sigue reproduciéndose. Si sigue tapado más de
//     «sleep_after» segundos, cierra mpv para liberar toda su memoria; la
//     ventana conserva el último fotograma y, al destaparse, mpv vuelve a
//     abrirse en el mismo punto sin parpadeo.
//  4. Vigila mpv: si deja de responder o su memoria crece de forma anormal
//     (fugas de algunos drivers en reproducción continua), lo reinicia en el
//     mismo punto.
//
// La configuración la escribe la aplicación «MintMotion» en
// ~/.config/mintmotion/config.json; la extensión la vigila y se adapta sola.

const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const RENDERER_CLASS = "mintmotion-renderer";
const SYSTEM_RENDERER = "/usr/lib/mintmotion/mintmotion-renderer";
const POLL_SECONDS = 2;
const RESTART_LIMIT = 3;                         // relanzamientos por fallo permitidos...
const RESTART_WINDOW_US = 600 * GLib.USEC_PER_SEC; // ...cada 10 minutos
const STARTUP_TIMEOUT_MS = 8000;  // tiempo para que mpv conteste al arrancar
const HEALTH_EVERY_S = 10;        // después, una comprobación cada 10 s
const RAM_EVERY_S = 60;           // memoria de mpv: una lectura por minuto
const RAM_BASELINE_AFTER_S = 120; // referencia tomada a los 2 min de arrancar
const RAM_FACTOR = 1.5;           // reinicio si crece un 50 %...
const RAM_MIN_GROWTH_KB = 100 * 1024; // ...y al menos 100 MB

const DEFAULTS = {
    video: "",
    fit: "rellenar",          // rellenar | ajustar | estirar
    quality: "alta",          // ahorro | alta | maxima
    hwdec: true,
    pause_when_covered: true,
    sleep_after: 120,   // s tapado antes de cerrar mpv (0 = no cerrarlo nunca)
    ram_watchdog: true,
    ram_limit_mb: 0,    // límite fijo opcional (0 = automático)
    gpu_env: true,      // en equipos solo NVIDIA, no cargar los drivers de Mesa
};

// Ventanas que, si tapan el escritorio, cuentan como «tapado».
const COVERING_TYPES = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG,
                        Meta.WindowType.MODAL_DIALOG, Meta.WindowType.UTILITY];

let extensionMeta = null;
let wallpaper = null;

function log_(msg) {
    global.log("[mintmotion] " + msg);
}

function configDir() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), "mintmotion"]);
}

function readConfig() {
    let cfg = Object.assign({}, DEFAULTS);
    try {
        let [ok, bytes] = GLib.file_get_contents(GLib.build_filenamev([configDir(), "config.json"]));
        if (ok) {
            let text = (typeof TextDecoder !== "undefined")
                ? new TextDecoder().decode(bytes)
                : imports.byteArray.toString(bytes);
            Object.assign(cfg, JSON.parse(text));
        }
    } catch (e) {
        // sin configuración todavía, o JSON a medio escribir: valores por defecto
    }
    return cfg;
}

function readText(path) {
    try {
        let [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return null;
        return (typeof TextDecoder !== "undefined")
            ? new TextDecoder().decode(bytes)
            : imports.byteArray.toString(bytes);
    } catch (e) {
        return null;
    }
}

function encode(text) {
    return (typeof TextEncoder !== "undefined")
        ? new TextEncoder().encode(text)
        : imports.byteArray.fromString(text);
}

// PSS (memoria real, en KB) de un proceso; 0 si no se puede leer.
function processPssKb(pid) {
    let text = readText(`/proc/${pid}/smaps_rollup`);
    let m = text && text.match(/^Pss:\s+(\d+)/m);
    return m ? parseInt(m[1]) : 0;
}

// ¿setpriv admite --pdeathsig? (util-linux ≥ 2.33). Con él, mpv muere si
// muere Cinnamon y nunca quedan reproductores huérfanos.
let _setpriv;
function setprivPath() {
    if (_setpriv !== undefined)
        return _setpriv;
    _setpriv = null;
    let path = GLib.find_program_in_path("setpriv");
    if (path) {
        try {
            // (GJS recoge siempre stdout y stderr: no se puede pedir STDERR_TO_DEV_NULL)
            let [ok, out, err, status] = GLib.spawn_sync(null, [path, "--pdeathsig", "KILL", "true"],
                                                         null, GLib.SpawnFlags.DEFAULT, null);
            if (ok && status === 0)
                _setpriv = path;
        } catch (e) { }
    }
    return _setpriv;
}

// Variables de entorno para mpv solo en equipos con una única GPU y que sea
// NVIDIA (driver propietario): mpv no carga además los drivers de Mesa
// (llvmpipe, LLVM…), que ocupan memoria y no se usan. En equipos híbridos,
// Intel o AMD no se toca nada.
function nvidiaOnlyEnv() {
    if (!GLib.file_test("/proc/driver/nvidia/version", GLib.FileTest.EXISTS))
        return [];
    let vendors = new Set();
    try {
        let dir = Gio.File.new_for_path("/sys/class/drm");
        let en = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null))) {
            let name = info.get_name();
            if (!/^card\d+$/.test(name))
                continue;
            let v = readText(`/sys/class/drm/${name}/device/vendor`);
            if (v)
                vendors.add(v.trim().toLowerCase());
        }
    } catch (e) {
        return [];
    }
    if (vendors.size !== 1 || !vendors.has("0x10de"))
        return [];
    let env = [];
    let icd = ["/usr/share/vulkan/icd.d/nvidia_icd.json", "/etc/vulkan/icd.d/nvidia_icd.json"]
        .find(f => GLib.file_test(f, GLib.FileTest.EXISTS));
    if (icd)
        env.push(["VK_DRIVER_FILES", icd], ["VK_ICD_FILENAMES", icd]);
    let egl = ["/usr/share/glvnd/egl_vendor.d/10_nvidia.json", "/etc/glvnd/egl_vendor.d/10_nvidia.json"]
        .find(f => GLib.file_test(f, GLib.FileTest.EXISTS));
    if (egl)
        env.push(["__EGL_VENDOR_LIBRARY_FILENAMES", egl]);
    return env;
}

// Procesos mpv que pintan en la ventana X «xid» (huérfanos de otra instancia).
function mpvPidsForWindow(xid) {
    let pids = [];
    try {
        let en = Gio.File.new_for_path("/proc").enumerate_children("standard::name",
                                                                  Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null))) {
            let name = info.get_name();
            if (!/^\d+$/.test(name))
                continue;
            let cmd = readText(`/proc/${name}/cmdline`);
            if (cmd && cmd.split("\0").includes(`--wid=${xid}`) &&
                (readText(`/proc/${name}/comm`) || "").trim() === "mpv")
                pids.push(parseInt(name));
        }
    } catch (e) { }
    return pids;
}

function getBackgroundActors() {
    // Cinnamon ≥ 6.8: un actor por monitor. Versiones anteriores: uno solo.
    if (typeof global.get_background_actors === "function")
        return global.get_background_actors() || [];
    return global.background_actor ? [global.background_actor] : [];
}

// Resta el rectángulo b a cada rectángulo de la lista (todo en enteros).
function subtractRect(rects, b) {
    let out = [];
    for (let a of rects) {
        let ax2 = a.x + a.w, ay2 = a.y + a.h, bx2 = b.x + b.w, by2 = b.y + b.h;
        if (b.x >= ax2 || bx2 <= a.x || b.y >= ay2 || by2 <= a.y) {
            out.push(a);           // no se tocan
            continue;
        }
        if (b.y > a.y) out.push({ x: a.x, y: a.y, w: a.w, h: b.y - a.y });            // arriba
        if (by2 < ay2) out.push({ x: a.x, y: by2, w: a.w, h: ay2 - by2 });            // abajo
        let top = Math.max(a.y, b.y), bottom = Math.min(ay2, by2);
        if (b.x > a.x) out.push({ x: a.x, y: top, w: b.x - a.x, h: bottom - top });   // izquierda
        if (bx2 < ax2) out.push({ x: bx2, y: top, w: ax2 - bx2, h: bottom - top });   // derecha
    }
    return out;
}

class VideoWallpaper {
    constructor(meta) {
        this._dir = meta.path;
        this._helper = null;      // mintmotion-renderer (crea la ventana y termina)
        this._mpv = null;         // proceso mpv
        this._metaWindow = null;  // ventana X donde pinta mpv
        this._token = null;       // marca de la ventana de esta instancia
        this._argv = null;        // opciones de mpv preparadas por el renderer
        this._stopping = false;
        this._restartTimes = [];
        this._asleep = false;     // mpv cerrado porque el escritorio sigue tapado
        this._resumePos = 0;
        this._sleepTimer = 0;
        this._hwdec = null;       // método de decodificación elegido para este vídeo
        this._statePath = GLib.build_filenamev([GLib.get_user_runtime_dir(), "mintmotion.state"]);
        this._sourceActor = null;
        this._containers = [];
        this._paused = null;
        this._screensaverActive = false;
        this._signals = [];
        this._timeouts = new Set();
        this._updateId = 0;
        // Cada renderizador usa su propio socket: así el que se está cerrando
        // nunca puede borrar el del que acaba de arrancar. La ruta vigente se
        // publica en «mintmotion.socket» para la aplicación de configuración.
        this._socketPath = null;
        this._socketSeq = 0;
        this._socketPointer = GLib.build_filenamev([GLib.get_user_runtime_dir(), "mintmotion.socket"]);
        this._config = readConfig();

        // Vigilancia de la configuración
        GLib.mkdir_with_parents(configDir(), 0o755);
        this._monitor = Gio.File.new_for_path(configDir()).monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        // Con WATCH_MOVES, una escritura atómica (archivo temporal + rename)
        // llega como RENAMED con el nombre nuevo en «other».
        this._monitorId = this._monitor.connect("changed", (m, file, other) => {
            if ((file && file.get_basename() === "config.json") ||
                (other && other.get_basename() === "config.json"))
                this._scheduleConfigReload();
        });

        // Señales que pueden cambiar la visibilidad del escritorio
        this._connect(global.display, "window-created", (d, w) => this._onWindowCreated(w));
        this._connect(global.display, "restacked", () => this._queueUpdate());
        this._connect(global.display, "grab-op-end", () => this._queueUpdate());
        for (let sig of ["switch-workspace", "minimize", "unminimize", "size-change",
                         "size-changed", "map", "destroy"])
            this._connect(global.window_manager, sig, () => this._queueUpdate());
        this._connect(Main.layoutManager, "monitors-changed",
                      () => this._timeout(1000, () => this._restart()));
        if (Main.expo) {
            this._connect(Main.expo, "showing", () => this._queueUpdate());
            this._connect(Main.expo, "hidden", () => this._queueUpdate());
        }

        this._screensaverSub = Gio.DBus.session.signal_subscribe(
            "org.cinnamon.ScreenSaver", "org.cinnamon.ScreenSaver", "ActiveChanged",
            "/org/cinnamon/ScreenSaver", null, Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                this._screensaverActive = params.deep_unpack()[0];
                this._queueUpdate();
            });

        // Red de seguridad: revisión periódica muy barata
        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, POLL_SECONDS, () => {
            this._updatePlayback();
            return GLib.SOURCE_CONTINUE;
        });
        this._healthId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, HEALTH_EVERY_S, () => {
            this._checkHealth();
            return GLib.SOURCE_CONTINUE;
        });
        this._ramId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, RAM_EVERY_S, () => {
            this._checkRam();
            return GLib.SOURCE_CONTINUE;
        });

        // Renderizadores huérfanos de una sesión anterior de Cinnamon
        for (let a of global.get_window_actors())
            this._onWindowCreated(a.meta_window);

        this._start();
    }

    // ---------- utilidades ----------

    _connect(obj, sig, cb) {
        try {
            this._signals.push([obj, obj.connect(sig, cb)]);
        } catch (e) {
            // la señal no existe en esta versión de Cinnamon: se ignora
        }
    }

    _timeout(ms, cb) {
        let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            cb();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
        return id;
    }

    _rendererPath() {
        let local = GLib.build_filenamev([this._dir, "mintmotion-renderer"]);
        return GLib.file_test(local, GLib.FileTest.EXISTS) ? local : SYSTEM_RENDERER;
    }

    // ---------- configuración ----------

    _scheduleConfigReload() {
        if (this._configTimer)
            return;
        this._configTimer = this._timeout(300, () => {
            this._configTimer = 0;
            let old = this._config;
            this._config = readConfig();
            let c = this._config;
            if (c.video !== old.video || c.fit !== old.fit || c.quality !== old.quality ||
                c.hwdec !== old.hwdec || c.gpu_env !== old.gpu_env) {
                this._restart();
            } else {
                this._layoutClones();
                this._paused = null;
                this._queueUpdate();
            }
        });
    }

    // ---------- ventana y proceso mpv ----------

    _start() {
        let video = this._config.video;
        if (!video || !GLib.file_test(video, GLib.FileTest.IS_REGULAR)) {
            log_("no video configured, or it does not exist: " + video);
            return;
        }

        // Se renderiza a la resolución del monitor más grande: un único
        // decodificador sirve a todos los monitores.
        let w = 0, h = 0;
        for (let m of Main.layoutManager.monitors) {
            if (m.width * m.height > w * h) {
                w = m.width;
                h = m.height;
            }
        }
        if (!w || !h)
            return;
        this._renderW = w;
        this._renderH = h;
        this._socketSeq++;
        this._socketPath = GLib.build_filenamev([GLib.get_user_runtime_dir(),
            `mintmotion-${GLib.get_monotonic_time()}-${this._socketSeq}.sock`]);
        try {
            GLib.file_set_contents(this._socketPointer, this._socketPath);
        } catch (e) { }
        this._token = `${GLib.get_monotonic_time()}-${this._socketSeq}`;
        this._argv = null;
        this._metaWindow = null;
        this._asleep = false;
        this._resumePos = 0;
        this._hwdec = this._config.hwdec ? "auto-safe" : "no";
        this._hwdecTried = false;
        this._stopping = false;
        this._paused = null;
        this._writeState("arrancando");

        let argv = ["/usr/bin/python3", this._rendererPath(),
                    "--video", video,
                    "--width", String(w), "--height", String(h),
                    "--token", this._token,
                    "--fit", this._config.fit,
                    "--quality", this._config.quality];
        let token = this._token;
        try {
            let helper = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE);
            this._helper = helper;
            helper.communicate_utf8_async(null, null, (proc, res) => {
                let out = null;
                try {
                    [, out] = proc.communicate_utf8_finish(res);
                } catch (e) { }
                if (this._helper === helper)
                    this._helper = null;
                if (token !== this._token || this._stopping)
                    return; // se ha detenido o reiniciado mientras tanto
                let info = null;
                try {
                    info = JSON.parse((out || "").trim().split("\n").pop());
                } catch (e) { }
                if (!info || !info.argv) {
                    log_("the renderer could not create the window");
                    this._onFailure();
                    return;
                }
                this._argv = info.argv;
                this._launchMpv(0);
            });
        } catch (e) {
            log_("could not launch the renderer: " + e.message);
        }
    }

    _launchMpv(startPos) {
        if (!this._argv || this._stopping)
            return;
        let argv = this._argv.slice();
        let dd = argv.indexOf("--");
        let extra = [`--hwdec=${this._hwdec}`, `--input-ipc-server=${this._socketPath}`];
        if (startPos > 0)
            extra.push(`--start=${startPos.toFixed(3)}`);
        argv.splice(dd < 0 ? argv.length : dd, 0, ...extra);
        let sp = setprivPath();
        if (sp)
            argv = [sp, "--pdeathsig", "KILL", "--", ...argv];
        try {
            GLib.unlink(this._socketPath);
        } catch (e) { }

        let launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
        if (this._config.gpu_env)
            for (let [k, v] of nvidiaOnlyEnv())
                launcher.setenv(k, v, true);
        try {
            let proc = launcher.spawnv(argv);
            this._mpv = proc;
            this._mpvStarted = GLib.get_monotonic_time();
            this._healthy = false;
            this._failures = 0;
            this._ramBaseline = 0;
            this._asleep = false;
            proc.wait_async(null, () => this._onMpvExit(proc));
        } catch (e) {
            log_("could not launch mpv: " + e.message);
        }
    }

    _onMpvExit(proc) {
        if (proc !== this._mpv)
            return; // cierre previsto (dormir, reinicio o parada)
        this._mpv = null;
        if (this._stopping)
            return;
        log_("mpv exited unexpectedly");
        this._onFailure();
    }

    // Fallo de mpv o del renderizador: se reintenta con límite.
    _onFailure() {
        let now = GLib.get_monotonic_time();
        this._restartTimes = this._restartTimes.filter(t => now - t < RESTART_WINDOW_US);
        if (this._restartTimes.length >= RESTART_LIMIT) {
            log_("mpv failed several times in a row; giving up");
            this._writeState("error");
            return;
        }
        this._restartTimes.push(now);
        if (this._argv && this._metaWindow) {
            // la ventana sigue: basta con volver a abrir mpv en el mismo punto
            this._timeout(1000, () => { if (!this._mpv && !this._stopping) this._launchMpv(this._resumePos); });
        } else {
            this._timeout(2000, () => { if (!this._mpv && !this._stopping) this._restart(true); });
        }
    }

    // Cierra mpv (SIGTERM y, si no obedece en 3 s, SIGKILL) y llama a «done».
    _killMpv(done) {
        let proc = this._mpv;
        this._mpv = null;
        if (!proc) {
            if (done) done();
            return;
        }
        let finished = false;
        proc.wait_async(null, () => {
            finished = true;
            if (done) done();
        });
        proc.send_signal(15);
        // Temporizador propio (no de this._timeouts): debe cumplirse aunque la
        // extensión se desactive mientras tanto.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
            if (!finished) proc.force_exit();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stop() {
        this._stopping = true;
        this._token = null;
        this._cancelSleep();
        if (this._helper) {
            try { this._helper.force_exit(); } catch (e) { }
            this._helper = null;
        }
        let socket = this._socketPath;
        this._socketPath = null;
        this._killMpv(() => {
            if (socket) {
                try { GLib.unlink(socket); } catch (e) { }
            }
        });
        // La ventana se destruye cuando mpv ya no pinta en ella
        let w = this._metaWindow;
        this._metaWindow = null;
        this._dropSource();
        if (w)
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3500, () => {
                try { w.kill(); } catch (e) { }
                return GLib.SOURCE_REMOVE;
            });
        this._writeState(null);
    }

    _restart(keepCounters) {
        this._stop();
        if (!keepCounters)
            this._restartTimes = [];
        this._timeout(300, () => { if (!this._mpv && !this._helper) this._start(); });
    }

    _writeState(state) {
        try {
            if (state)
                GLib.file_set_contents(this._statePath, state);
            else
                GLib.unlink(this._statePath);
        } catch (e) { }
    }

    // ---------- comunicación con mpv (socket IPC) ----------

    // Envía una orden y entrega la respuesta («data») o null si falla o tarda.
    _ipc(command, callback, timeoutMs = 1000) {
        let path = this._socketPath;
        if (!path) {
            if (callback) callback(null, false);
            return;
        }
        let msg = JSON.stringify({ command: command }) + "\n";
        let cancel = new Gio.Cancellable();
        let done = false;
        let finish = (data, ok) => {
            if (done)
                return;
            done = true;
            if (callback) callback(data, ok);
        };
        let tid = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
            cancel.cancel();
            finish(null, false);
            return GLib.SOURCE_REMOVE;
        });
        let client = new Gio.SocketClient();
        client.connect_async(Gio.UnixSocketAddress.new(path), cancel, (c, res) => {
            let conn;
            try {
                conn = c.connect_finish(res);
                conn.get_output_stream().write_all(encode(msg), null);
            } catch (e) {
                GLib.source_remove(tid);
                finish(null, false);
                return;
            }
            // Se lee la respuesta antes de cerrar (si no, mpv anota «Broken pipe»).
            conn.get_input_stream().read_bytes_async(4096, GLib.PRIORITY_DEFAULT, cancel, (st, r) => {
                let data = null, ok = false;
                try {
                    let bytes = st.read_bytes_finish(r).get_data();
                    let text = (typeof TextDecoder !== "undefined")
                        ? new TextDecoder().decode(bytes) : imports.byteArray.toString(bytes);
                    for (let line of text.split("\n")) {
                        if (!line.trim())
                            continue;
                        let m = JSON.parse(line);
                        if ("error" in m) {
                            ok = m.error === "success";
                            data = ok ? m.data : null;
                            break;
                        }
                    }
                } catch (e) { }
                try { conn.close(null); } catch (e) { }
                try { GLib.source_remove(tid); } catch (e) { }
                finish(data, ok);
            });
        });
    }

    // ---------- vigilancia de mpv ----------

    _checkHealth() {
        if (!this._mpv || this._stopping)
            return;
        let mpv = this._mpv;
        this._ipc(["get_property", "pid"], (data, ok) => {
            if (mpv !== this._mpv)
                return;
            let now = GLib.get_monotonic_time();
            if (ok) {
                this._failures = 0;
                if (!this._healthy) {
                    this._healthy = true;
                    this._checkHwdec();
                }
                return;
            }
            let hung;
            if (!this._healthy)
                hung = now - this._mpvStarted > STARTUP_TIMEOUT_MS * 1000;
            else
                hung = ++this._failures >= 2;
            if (hung) {
                log_("mpv is not responding; restarting it");
                this._killMpv(() => this._onFailure());
            }
        });
    }

    // Si mpv decodifica por hardware copiando cada fotograma a la RAM y hay un
    // modo directo, se prueba el directo una vez; si no funciona, se vuelve.
    _checkHwdec() {
        if (this._hwdec === "no")
            return;
        this._ipc(["get_property", "hwdec-current"], (cur, ok) => {
            if (!ok || typeof cur !== "string")
                return;
            if (!this._hwdecTried && cur.endsWith("-copy")) {
                this._hwdecTried = true;
                this._hwdec = cur.slice(0, -5);
                log_(`decoding with ${cur}: trying the direct mode ${this._hwdec}`);
                this._relaunchAtCurrentPos();
            } else if (this._hwdecTried && this._hwdec !== "auto-safe" && (cur === "no" || cur === "")) {
                log_(`direct mode ${this._hwdec} does not work; going back to auto-safe`);
                this._hwdec = "auto-safe";
                this._relaunchAtCurrentPos();
            }
        });
    }

    _checkRam() {
        if (!this._mpv || !this._healthy || !this._config.ram_watchdog || this._stopping)
            return;
        let pid = parseInt(this._mpv.get_identifier());
        let pss = pid ? processPssKb(pid) : 0;
        if (!pss)
            return;
        let limit;
        if (this._config.ram_limit_mb > 0) {
            limit = this._config.ram_limit_mb * 1024;
        } else {
            let age = (GLib.get_monotonic_time() - this._mpvStarted) / GLib.USEC_PER_SEC;
            if (!this._ramBaseline) {
                if (age >= RAM_BASELINE_AFTER_S)
                    this._ramBaseline = pss;
                return;
            }
            limit = Math.max(this._ramBaseline * RAM_FACTOR, this._ramBaseline + RAM_MIN_GROWTH_KB);
        }
        if (pss > limit) {
            log_(`mpv uses ${Math.round(pss / 1024)} MB (limit ${Math.round(limit / 1024)} MB): restarting it`);
            this._relaunchAtCurrentPos();
        }
    }

    _relaunchAtCurrentPos() {
        if (!this._mpv)
            return;
        let paused = this._paused;
        this._ipc(["get_property", "time-pos"], (pos) => {
            this._resumePos = typeof pos === "number" ? pos : 0;
            this._killMpv(() => {
                if (this._stopping || this._mpv)
                    return;
                this._launchMpv(this._resumePos);
                this._paused = null; // se reaplica la pausa si hace falta
                this._queueUpdate();
            });
        });
    }

    // ---------- ventana y clones ----------

    _onWindowCreated(metaWindow) {
        if (!metaWindow || metaWindow.get_wm_class() !== RENDERER_CLASS)
            return;

        let title = metaWindow.get_title() || "";
        let ours = this._token && title === `MintMotion ${this._token}`;
        if (!ours) {
            this._retire(metaWindow);
            return;
        }
        this._metaWindow = metaWindow;
        this._adopt(metaWindow, 0);
    }

    // Ventana que no es de esta instancia: de una sesión anterior de Cinnamon,
    // de una versión antigua o de una instancia que se está cerrando. Se cierra
    // el reproductor que pinte en ella y después se destruye la ventana.
    _retire(metaWindow) {
        let xid = 0;
        try { xid = metaWindow.get_xwindow(); } catch (e) { }
        let pids = xid ? mpvPidsForWindow(xid) : [];
        // Versiones ≤ 1.2: un renderizador de Python que sigue vivo
        let pid = metaWindow.get_pid();
        if (pid > 0 && (readText(`/proc/${pid}/cmdline`) || "").includes("mintmotion-renderer"))
            pids.push(pid);
        for (let p of pids) {
            try { GLib.spawn_command_line_async(`kill -TERM ${p}`); } catch (e) { }
        }
        let gone = false;
        let sigId = 0;
        try {
            sigId = metaWindow.connect("unmanaged", () => { gone = true; });
        } catch (e) { }
        this._timeout(pids.length ? 3500 : 0, () => {
            if (sigId) {
                try { metaWindow.disconnect(sigId); } catch (e) { }
            }
            if (!gone) {
                try { metaWindow.kill(); } catch (e) { }
            }
        });
    }

    _adopt(metaWindow, tries) {
        let actor = metaWindow.get_compositor_private();
        if (!actor) {
            if (tries < 20)
                this._timeout(50, () => this._adopt(metaWindow, tries + 1));
            return;
        }
        this._dropSource();
        this._sourceActor = actor;

        // El actor real nunca se pinta: opacidad 0 (Clutter no pinta nada con
        // opacidad 0, así que no cuesta nada) y solo se ven sus clones en el
        // fondo. No se oculta con hide(): Muffin deja de actualizar la textura
        // de las ventanas ocultas y el clon se vería negro.
        // Este manejador sigue vivo hasta que la ventana se destruye, para que
        // no asome ni un fotograma mientras se cierra.
        this._muteActor(actor);
        actor.connect("notify::opacity", () => {
            if (actor.opacity !== 0)
                this._muteActor(actor);
        });
        actor.connect("notify::visible", () => {
            if (!actor.visible)
                actor.show();
        });
        actor.connect("destroy", () => {
            if (this._sourceActor === actor) {
                this._sourceActor = null;
                this._destroyClones();
            }
        });

        // Los clones se muestran cuando mpv ya pinta (la ventana no tiene
        // fondo y, hasta el primer fotograma, su contenido no está definido).
        this._waitFirstFrame(actor, 0);
    }

    _waitFirstFrame(actor, tries) {
        if (actor !== this._sourceActor)
            return;
        this._ipc(["get_property", "estimated-frame-number"], (n, ok) => {
            if (actor !== this._sourceActor)
                return;
            if ((ok && typeof n === "number" && n > 1) || tries >= 50) {
                this._buildClones();
                this._paused = null;
                this._updatePlayback();
            } else {
                this._timeout(200, () => this._waitFirstFrame(actor, tries + 1));
            }
        }, 500);
    }

    _muteActor(actor) {
        actor.opacity = 0;
        // La superficie con opacidad < 255 no se considera opaca: así Muffin no
        // la usa para descartar (cull) lo que queda debajo, como los iconos.
        for (let child of actor.get_children()) {
            if (child.opacity === 255)
                child.opacity = 254;
        }
    }

    _dropSource() {
        this._destroyClones();
        this._sourceActor = null;
    }

    _buildClones() {
        this._destroyClones();
        if (!this._sourceActor)
            return;

        let bgs = getBackgroundActors();
        if (bgs.length === 0) {
            log_("background actor not found (Wayland session?)");
            return;
        }

        for (let m of Main.layoutManager.monitors) {
            let cx = m.x + m.width / 2, cy = m.y + m.height / 2;
            let bg = bgs.find(a => cx >= a.x && cx < a.x + a.width &&
                                   cy >= a.y && cy < a.y + a.height) || bgs[0];

            // Un contenedor del tamaño del monitor que recorta lo que sobresale
            let box = new Clutter.Actor({ reactive: false, clip_to_allocation: true });
            box.set_position(m.x - bg.x, m.y - bg.y);
            box.set_size(m.width, m.height);
            let clone = new Clutter.Clone({ source: this._sourceActor, reactive: false });
            box.add_child(clone);
            box._mmClone = clone;
            box._mmMonitor = m;
            bg.add_child(box); // encima de la imagen de fondo, debajo de todo lo demás
            box.connect("destroy", () => {
                this._containers = this._containers.filter(c => c !== box);
            });
            this._containers.push(box);
        }
        this._layoutClones();
    }

    // Coloca cada clon según el modo de ajuste. En el monitor más grande el
    // clon coincide píxel a píxel con el renderizado (sin reescalar).
    _layoutClones() {
        let rw = this._renderW, rh = this._renderH;
        for (let box of this._containers) {
            let m = box._mmMonitor, clone = box._mmClone;
            if (!rw || !rh || this._config.fit === "estirar" ||
                (m.width === rw && m.height === rh)) {
                clone.set_position(0, 0);
                clone.set_size(m.width, m.height);
                continue;
            }
            let s = this._config.fit === "ajustar"
                ? Math.min(m.width / rw, m.height / rh)
                : Math.max(m.width / rw, m.height / rh);
            let w = Math.round(rw * s), h = Math.round(rh * s);
            clone.set_size(w, h);
            clone.set_position(Math.round((m.width - w) / 2), Math.round((m.height - h) / 2));
        }
    }

    _destroyClones() {
        let boxes = this._containers;
        this._containers = [];
        for (let b of boxes)
            b.destroy();
    }

    // ---------- pausa automática ----------

    _queueUpdate() {
        if (this._updateId)
            return;
        this._updateId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._updateId = 0;
            this._updatePlayback();
            return GLib.SOURCE_REMOVE;
        });
    }

    // true si en TODOS los monitores el área del escritorio queda tapada por
    // completo (por una ventana o por la suma de varias).
    _desktopHidden() {
        let ws = global.workspace_manager.get_active_workspace();
        let monitors = Main.layoutManager.monitors;
        let uncovered = monitors.map((m, i) => {
            let wa = ws.get_work_area_for_monitor(i);
            return [{ x: wa.x, y: wa.y, w: wa.width, h: wa.height }];
        });

        for (let a of global.get_window_actors()) {
            let w = a.meta_window;
            if (!w || w.minimized || !COVERING_TYPES.includes(w.get_window_type()))
                continue;
            if (!w.showing_on_its_workspace() || !w.located_on_workspace(ws))
                continue;
            if (a.opacity < 255 || !a.visible)
                continue; // ventana translúcida u oculta: deja ver el fondo
            let r = w.get_frame_rect();
            let rect = { x: r.x, y: r.y, w: r.width, h: r.height };
            for (let i = 0; i < uncovered.length; i++)
                if (uncovered[i].length)
                    uncovered[i] = subtractRect(uncovered[i], rect);
            if (uncovered.every(u => u.length === 0))
                return true;
        }
        return uncovered.every(u => u.length === 0);
    }

    _shouldPause() {
        if (this._screensaverActive)
            return true;
        if (Main.expo && Main.expo.visible)
            return true;
        return !!this._config.pause_when_covered && this._desktopHidden();
    }

    _updatePlayback() {
        if (!this._sourceActor)
            return;
        this._muteActor(this._sourceActor); // por si Muffin recreó la superficie
        let pause = this._shouldPause();
        if (pause === this._paused)
            return;
        this._paused = pause;
        if (pause) {
            if (this._mpv)
                this._ipc(["set_property", "pause", true]);
            this._writeState(this._asleep ? "dormido" : "pausado");
            this._scheduleSleep();
        } else {
            this._cancelSleep();
            if (this._asleep) {
                // La ventana sigue mostrando el último fotograma: se vuelve a
                // abrir mpv justo donde se quedó.
                this._launchMpv(this._resumePos);
            } else if (this._mpv) {
                this._ipc(["set_property", "pause", false], (d, ok) => {
                    if (!ok)
                        this._paused = null; // se reintenta en la próxima revisión
                });
            }
            this._writeState("reproduciendo");
        }
    }

    // Escritorio tapado durante «sleep_after» segundos: se cierra mpv y se
    // libera toda su memoria.
    _scheduleSleep() {
        let secs = Number(this._config.sleep_after) || 0;
        if (secs <= 0 || this._sleepTimer || this._asleep || !this._mpv)
            return;
        this._sleepTimer = this._timeout(secs * 1000, () => {
            this._sleepTimer = 0;
            if (!this._paused || !this._mpv || this._stopping)
                return;
            this._ipc(["get_property", "time-pos"], (pos) => {
                if (!this._paused || !this._mpv || this._stopping)
                    return;
                this._resumePos = typeof pos === "number" ? pos : 0;
                this._asleep = true;
                this._writeState("dormido");
                this._killMpv(null);
            });
        });
    }

    _cancelSleep() {
        if (this._sleepTimer) {
            GLib.source_remove(this._sleepTimer);
            this._timeouts.delete(this._sleepTimer);
            this._sleepTimer = 0;
        }
    }

    // ---------- cierre ----------

    destroy() {
        this._stop();
        for (let [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
        for (let id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        if (this._updateId)
            GLib.source_remove(this._updateId);
        for (let id of [this._pollId, this._healthId, this._ramId])
            if (id)
                GLib.source_remove(id);
        this._monitor.disconnect(this._monitorId);
        this._monitor.cancel();
        Gio.DBus.session.signal_unsubscribe(this._screensaverSub);
        GLib.unlink(this._socketPointer);
    }
}

function init(metadata) {
    extensionMeta = metadata;
}

function enable() {
    wallpaper = new VideoWallpaper(extensionMeta);
}

function disable() {
    if (wallpaper) {
        wallpaper.destroy();
        wallpaper = null;
    }
}
