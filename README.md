# Proxmark Desktop

> Interfaz de escritorio para **Proxmark3** sin terminal, con **asistente IA integrado**.

**Proxmark Desktop** envuelve el client `pm3` (firmware Iceman) en una app de
escritorio moderna (Electron + React): navegas el árbol de comandos con clics,
ejecutas acciones rápidas con un botón, ves la salida en vivo y puedes pedirle
al **Proxmark Assistant** (DeepSeek) que opere el dispositivo por ti con
lenguaje natural.

---

## ✨ Características

- **Árbol de comandos auto-descubierto**: el catálogo se genera solo leyendo
  `pm3 help` en cada nivel. Si actualizas el firmware y aparecen comandos
  nuevos, aparecen en la app sin cambiar código (cache a disco de 7 días,
  recargable con un clic).
- **Formularios tipados** para los comandos principales (`hf mf chk`, `dump`,
  `rdbl`, `wrbl`, `hardnested`, `sniff`, tarjetas mágicas…) con vista previa
  del comando. El resto se ejecuta con argumentos libres.
- **Perfiles de comandos editables** (`profiles.json`): define tus propios
  botones de acción rápida sin tocar código.
- **Terminal integrada**: salida en vivo del pm3, cola de 1 comando a la vez
  (el dispositivo es un solo hilo), botón Cancelar y Limpiar.
- **Proxmark Assistant (IA)**: chat lateral con tu API key de DeepSeek. El
  agente ejecuta comandos pm3 mediante herramientas (`pm3_run`,
  `pm3_catalog`), lo ves todo en la terminal central y en el chat. Incluye
  playbooks (p. ej. recuperación de claves: chk → diccionario → autopwn →
  hardnested) y reglas de seguridad.
- **Detección de tarjetas mágicas, sniffing, emulación y más**: todo el set de
  comandos Iceman disponible sin tocar la terminal.

---

## 🖥 Capturas

<!-- TODO: añadir capturas -->

---

## ⚙️ Arquitectura

```
src/
├── main/       Electron main (Node)
│   ├── pm3.ts      ejecuta `pm3 -c "<comando>"` con cola y streaming
│   ├── ai.ts       cliente DeepSeek + agente con herramientas (function calling)
│   └── index.ts    ventana, IPC, settings, perfiles, cache del catálogo
├── preload/    Puente seguro de IPC (contextBridge)
├── shared/     Parser del catálogo, esquemas de comandos, tipos
└── renderer/   React: árbol de comandos, terminal, formularios, chat IA
```

- **CLI passthrough real**: se ejecuta el binario `pm3` de Iceman, no una
  reimplementación. Compatible con cualquier firmware.
- **Seguridad**: `contextIsolation`, la API key de DeepSeek se guarda cifrada
  con `safeStorage`, y las llamadas a la API se hacen desde el proceso main.

---

## 📦 Requisitos

- Node.js 20+ y npm
- Proxmark3 con el client **Iceman** instalado (`pm3` en el PATH; o define
  `PM3_BIN=/ruta/a/pm3`)

### Instalar el client Iceman (resumen)

- **macOS**: `brew install proxmark3`
- **Linux**: clona `RfidResearchGroup/proxmark3`, compila `client/` y copia
  las reglas udev de `driver/`.

---

## 🚀 Instalación y uso

```bash
git clone https://github.com/Manuuell/ProxMark-Desktop-.git
cd ProxMark-Desktop-
npm install
npm run dev        # desarrollo con hot reload
```

Build de producción:

```bash
npm run build      # compila a out/
npm start          # ejecuta la build
```

> Nota: si `npm install` no descarga el binario de Electron (npm 11 con
> allow-scripts), ejecuta `node node_modules/electron/install.js`.

---

## 🎮 Uso

1. Conecta el Proxmark3 y abre la app.
2. **Acciones rápidas**: 🔍 Detectar, 🖥 Estado, 💾 Dump 1K/4K, 🔑 claves,
   👃 Sniff, 🛠 Autopwn… (editables en `profiles.json`).
3. **Árbol de comandos**: busca, expande, elige un comando; los principales
   tienen formulario; pulsa **Ejecutar** o **Ayuda**.
4. **Proxmark Assistant**: ⚙ → pega tu API key de DeepSeek → escribe, p. ej.
   *"detecta la tarjeta y dime qué claves usa"*. Todo lo que ejecuta aparece
   en la terminal central.

### Archivos de configuración

| Qué | Dónde |
|---|---|
| Perfiles de comandos | `~/Library/Application Support/proxmark-desktop/profiles.json` (macOS) |
| Settings IA (API key cifrada) | mismo directorio, `settings.json` |
| Cache del catálogo | mismo directorio, `catalog/` |

---

## 🗺 Roadmap

- [x] Runner pm3 + catálogo auto-descubierto + UI básica
- [x] Acciones rápidas y perfiles editables
- [x] Formularios tipados por comando
- [x] Asistente IA con herramientas (DeepSeek)
- [x] Estado de dispositivo y cache a disco
- [ ] Visor de dumps (sectores/bloques/claves) integrado
- [ ] Historial de comandos y autocompletado
- [ ] Pestaña de Scripts (Lua)
- [ ] Empaquetado: instaladores (dmg / AppImage / msi)
- [ ] Soporte de otros proveedores de IA (OpenAI, Ollama local)

---

## ⚠️ Uso responsable

Esta herramienta opera con hardware de investigación en seguridad RFID.
Úsala **solo con dispositivos y tarjetas de tu propiedad o con autorización
explícita**. No la uses para acceder a sistemas de terceros, clonar tarjetas
ajenas ni fabricar saldo. Las reglas equivalentes están integradas en el
system prompt del asistente IA.

---

## 🧰 Stack

- [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)
- [React](https://react.dev/) + TypeScript
- Proxmark3 client [Iceman/RRG](https://github.com/RfidResearchGroup/proxmark3)
- DeepSeek API (OpenAI-compatible)

## 📄 Licencia

MIT — ver [LICENSE](LICENSE).
