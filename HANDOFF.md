# Proxmark Desktop — Handoff

Estado del proyecto al 16/08/2026 para retomar en otro chat.

## Qué es
App de escritorio (Electron + React + TypeScript) que envuelve el client
`pm3` (firmware Iceman) en una GUI sin terminal, con asistente IA (DeepSeek).
Repo: `https://github.com/Manuuell/ProxMark-Desktop-` (branch `main`).

## Stack y entorno
- Electron 33 + electron-vite 2 + Vite 5 + React 18 + TypeScript 5.
- Node 26 / npm 11 en macOS (Apple Silicon). `pm3` en `/opt/homebrew/bin/pm3`
  (Homebrew). Puerto del PM3: `/dev/tty.usbmodemiceman1`.
- Carpeta del proyecto: `~/Library/Mobile Documents/com~apple~CloudDocs/proyectos/ProxmarkStudio`
  (ojo: está en iCloud; `node_modules` pesa ~600 MB y se sincroniza).

## Cómo correr
```bash
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/proyectos/ProxmarkStudio
npm run dev      # desarrollo
npm run build && npm start   # producción
```
Nota: si `npm install` no baja el binario de Electron (npm 11 + allow-scripts),
ejecutar `node node_modules/electron/install.js` (ya quedó resuelto).

## Estructura
```
src/
├── main/
│   ├── pm3.ts        # Pm3Runner: cola de 1 job, streaming, cancel, modo silent
│   ├── ai.ts         # cliente DeepSeek + agente (function calling, tools pm3_run/pm3_catalog)
│   ├── firmware.ts   # asistente firmware Iceman (flash-all, plan B recortado, checkStatus, checkBinaries)
│   └── index.ts      # ventana, IPC, settings IA (safeStorage), perfiles, cache catálogo, sonda USB
├── preload/index.ts  # contextBridge: pm3.* (run, cancel, catalog, profiles, fw, ai, onOutput/onBusy/onDevice, probe)
├── shared/
│   ├── catalog.ts    # parseHelp (catálogo desde 'pm3 help'), stripAnsi
│   ├── commands.ts   # COMMAND_SCHEMAS (formularios tipados), riskFor
│   └── profiles.ts   # tipos de perfiles de comandos
└── renderer/src/
    ├── App.tsx       # 3 paneles + titlebar + pill dispositivo + overlay offline
    ├── AiPanel.tsx   # chat IA (burbujas, toolcards)
    ├── FirmwareModal.tsx  # stepper de firmware
    ├── ColoredLines.tsx / highlight.ts  # resaltado por tipo de línea
    └── App.css       # design system "liquid glass" (tokens en :root)
```

## Features implementadas
1. Catálogo de comandos auto-descubierto (parsea `pm3 help`), con cache a disco
   (7 días, `userData/catalog/`) y botón "⟳ Catálogo".
2. Formularios tipados para comandos principales + chips de riesgo
   (SOLO LECTURA / ESCRITURA) + vista previa del comando.
3. Perfiles de comandos editables (`userData/profiles.json`, botón "↻ Perfiles").
4. Terminal con colores por tipo de línea (key found verde, errores rojo, [=] azul,
   [IA] violeta, [Firmware] naranja) + spinner + contador mm:ss + cancelar/limpiar.
5. Proxmark Assistant: chat con DeepSeek (`deepseek-chat`/`deepseek-reasoner`),
   API key cifrada con `safeStorage` en `userData/settings.json`. El agente usa
   tools `pm3_run` y `pm3_catalog`, stream su actividad a la terminal central.
   System prompt con playbook de recuperación de claves + reglas de seguridad.
6. Asistente de firmware (stepper): ver estado, pm3-flash-all, detección de
   "firmware too big" (bootloader viejo 256K) → plan B (compilar recortado,
   bootrom en modo bootloader, recortado, re-flash completo), instalar client
   con brew, verificar. Detección "firmware al día" por git hash client vs OS.
7. Detección de dispositivo en vivo: sonda silenciosa `hw version` + `pm3 --list`,
   watchdog del puerto USB cada 2s (desconexión al instante, reconexión con
   backoff 8s→60s), pill de estado en titlebar + overlay "Conecta tu Proxmark3".

## Bugs recientes ya corregidos (no reintroducir)
- Parser de `[ Client ]` con ANSI/corchetes → usar `stripAnsi` + `includes('client')`.
- `findUsbmodem()` debe devolver `/dev/<nombre>` (con prefijo), no el nombre solo.
- Las sondas de fondo deben ser `silent` (no emitir `pm3:busy-changed`) para no
  parpadear "ejecutando".
- El estado `busy` de la UI es event-driven (runner emite `busy`), no local por
  operación, para que firmware/IA bloqueen la UI principal también.

## IPC (canales)
`pm3:run`, `pm3:cancel`, `pm3:catalog`, `pm3:catalog-clear`, `pm3:busy`,
`pm3:bin`, `pm3:probe`, `profiles:get`, `profiles:reload`, `ai:getSettings`,
`ai:setSettings`, `ai:chat`, `fw:list-ports`, `fw:check-binaries`,
`fw:check-status`, `fw:flash-all`, `fw:install-client`, `fw:compile-trimmed`,
`fw:trimmed-built`, `fw:flash-image`.
Eventos → renderer: `pm3:output` (línea), `pm3:busy-changed` (bool),
`pm3:device-changed` ({connected, version, port}).

## Roadmap pendiente
- Visor de dumps (sectores/bloques/claves) integrado.
- Historial de comandos (↑/↓) y autocompletado en el campo args.
- Pestaña de Scripts (Lua).
- Empaquetado: instaladores (dmg / AppImage / msi) con electron-builder.
- Más proveedores de IA (OpenAI, Ollama local).

## Contexto de investigación (TransCaribe / SondaPay)
Otros activos fuera de este repo:
- Scripts en `~/proxmark-dumps/`: `saldo_transcar.py`, `fingerprint_transcar.py`,
  `pentest_sondapay.py`, `gen_tarjetas.py`, `pm3_api.py` (+ `.sh` de análisis).
- API configurable: `~/.config/proxmark/api.json` (endpoint de saldo SondaPay).
- Dumps MIFARE en `~/Documents/mifare/` y `~/proxmark-dumps/`.
- Setup opencode para Proxmark en `~/...proyectos/Proxmark3/` (agente/skill/comandos).
- Hallazgos de seguridad ya documentados: endpoint de saldo sin auth, PII expuesta,
  saldo en backend (no en la tarjeta), claves MIFARE del sistema, riesgo de clonado
  de UID. La app NO debe incluir enumeración masiva de cuentas (política).

## Git
Últimos commits (main): `7bd95af` base → `9842b88` IA → `f8be434` firmware+fixes →
`580b138` colores → `71ccc73` rediseño → `89f6cb7`/`6169626`/`4387dac` detección USB →
`31def39` sin traffic lights → `78493cb` liquid glass → `24dc7a7` sondas silent →
`61aa8d1` fix /dev/ prefix. Todo pusheado; sin cambios pendientes.
