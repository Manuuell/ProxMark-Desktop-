import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  readdirSync,
  unlinkSync
} from 'node:fs'
import { Pm3Runner, PM3_BIN } from './pm3'
import { parseHelp, stripAnsi, type CatalogEntry } from '../shared/catalog'
import { chat, type AiSettings } from './ai'
import { AI_PROVIDERS, isAiProvider, type AiProvider } from '../shared/ai'
import type { CommandProfile, ProfilesResult } from '../shared/profiles'
import * as fw from './firmware'
import * as dumps from './dumps'
import * as scripts from './scripts'

// Nombre de la app (menú de macOS, notificaciones, userData). Debe ir antes de
// que la app esté lista.
app.setName('ProxMark Desktop')

const runner = new Pm3Runner()
const catalogCache = new Map<string, CatalogEntry[]>()

// Icono de la app. En desarrollo vive en build/ del repo; empaquetado, junto a
// los recursos. Devuelve '' si no se encuentra (Electron usa el suyo).
function iconPath(): string {
  const candidates = [
    join(app.getAppPath(), 'build', 'icons', '512x512.png'),
    join(process.resourcesPath ?? '', 'icon.png'),
    join(__dirname, '../../build/icons/512x512.png')
  ]
  return candidates.find((p) => p && existsSync(p)) ?? ''
}

// El estado busy del runner se transmite a TODAS las ventanas para que la UI
// principal se bloquee también durante operaciones de firmware/IA.
runner.on('busy', (b: boolean) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('pm3:busy-changed', b)
  }
})

function createWindow(): void {
  const icon = iconPath()
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    title: 'ProxMark Desktop',
    backgroundColor: '#101418',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // En macOS sin empaquetar el Dock muestra el icono de Electron: lo sustituimos
  // en caliente. Empaquetado manda el .icns del bundle.
  if (process.platform === 'darwin' && !app.isPackaged) {
    const icon = iconPath()
    if (icon) app.dock?.setIcon(icon)
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Ejecuta un comando pm3; la salida se streamea al renderer.
// cwd opcional (expandimos ~) para que los dumps caigan donde quieras.
ipcMain.handle('pm3:run', async (event, cmd: string, cwd?: string) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const dir = cwd ? cwd.replace(/^~(?=$|\/)/, homedir()) : undefined
  return runner.run(String(cmd), (line) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('pm3:output', stripAnsi(line))
    }
  }, dir)
})

// Mata el comando en curso.
ipcMain.handle('pm3:cancel', () => {
  runner.cancel()
})

// Catálogo de comandos para un nivel dado ('' = raíz).
// Se cachea en memoria y en disco (userData/catalog) para arranque rápido.
const catalogDiskDir = join(app.getPath('userData'), 'catalog')
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function catalogDiskKey(path: string): string {
  return (path.trim() || 'root').replace(/[^a-zA-Z0-9_-]/g, '_') + '.json'
}

function readCatalogDisk(path: string): CatalogEntry[] | null {
  try {
    const f = join(catalogDiskDir, catalogDiskKey(path))
    if (!existsSync(f)) return null
    if (Date.now() - statSync(f).mtimeMs > CACHE_MAX_AGE_MS) return null
    const entries = JSON.parse(readFileSync(f, 'utf8'))
    if (Array.isArray(entries)) return entries
  } catch {
    /* cache corrupta: se regenera */
  }
  return null
}

function writeCatalogDisk(path: string, entries: CatalogEntry[]): void {
  try {
    mkdirSync(catalogDiskDir, { recursive: true })
    writeFileSync(join(catalogDiskDir, catalogDiskKey(path)), JSON.stringify(entries))
  } catch {
    /* best effort */
  }
}

ipcMain.handle('pm3:catalog', async (_event, path: string) => {
  const key = String(path).trim()
  const cached = catalogCache.get(key)
  if (cached) return cached
  const fromDisk = readCatalogDisk(key)
  if (fromDisk) {
    catalogCache.set(key, fromDisk)
    return fromDisk
  }
  const lines: string[] = []
  const cmd = key ? `${key} help` : 'help'
  await runner.run(cmd, (l) => lines.push(l))
  const entries = parseHelp(lines.join('\n'))
  catalogCache.set(key, entries)
  // No cacheamos un catálogo vacío: suele significar un fallo transitorio
  // (puerto ocupado por otra instancia, dispositivo desconectado, etc.). Así el
  // siguiente arranque reintenta en vez de quedarse con una lista vacía.
  if (entries.length > 0) writeCatalogDisk(key, entries)
  return entries
})

ipcMain.handle('pm3:catalog-clear', () => {
  catalogCache.clear()
  try {
    if (existsSync(catalogDiskDir)) {
      for (const f of readdirSync(catalogDiskDir)) {
        try {
          unlinkSync(join(catalogDiskDir, f))
        } catch {
          /* best effort */
        }
      }
    }
  } catch {
    /* best effort */
  }
  return true
})

ipcMain.handle('pm3:busy', () => runner.isBusy)
ipcMain.handle('pm3:bin', () => PM3_BIN)

// Sonda silenciosa del dispositivo (sin ensuciar la terminal).
interface DeviceState {
  connected: boolean
  version: string
  port: string
}

async function doProbe(): Promise<DeviceState> {
  const lines: string[] = []
  try {
    await runner.run('hw version', (l) => lines.push(l), undefined, true)
  } catch {
    /* sin dispositivo */
  }
  let version = ''
  const clean = lines.map((l) => stripAnsi(l).replace(/\[[=+!?]\]\s*/, '').trim())
  for (let i = 0; i < clean.length; i++) {
    if (clean[i].toLowerCase().includes('client')) {
      for (let j = i + 1; j < Math.min(clean.length, i + 4); j++) {
        const m = clean[j].match(/Iceman\/[^\s]+/)
        if (m) {
          version = m[0]
          break
        }
      }
    }
  }
  const pl: string[] = []
  await runner.runBinary(PM3_BIN, ['--list'], (l) => pl.push(l), undefined, undefined, true)
  let port = ''
  for (const l of pl) {
    const m = stripAnsi(l).match(/\/dev\/(?:cu|tty)\.[A-Za-z0-9_-]+|\/dev\/ttyACM\d+/)
    if (m) {
      port = m[1]
      break
    }
  }
  // fallback: si --list no dio puerto, buscar usbmodem en /dev
  if (!port && version) port = findUsbmodem() ?? ''
  return { connected: version !== '', version, port }
}

let currentPort: string | null = null
let lastAutoProbe = 0
let autoProbeCooldown = 8000

function broadcastDevice(state: DeviceState): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('pm3:device-changed', state)
  }
}

function findUsbmodem(): string | null {
  try {
    const names = readdirSync('/dev')
    const found =
      names.find((n) => n.startsWith('tty.usbmodem')) ??
      names.find((n) => n.startsWith('cu.usbmodem')) ??
      names.find((n) => n.startsWith('ttyACM')) ??
      null
    return found ? `/dev/${found}` : null
  } catch {
    return null
  }
}

// Vigila conecta/desconecta del puerto USB (sin consumir el runner).
setInterval(() => {
  if (currentPort && !existsSync(currentPort)) {
    currentPort = null
    autoProbeCooldown = 8000
    broadcastDevice({ connected: false, version: '', port: '' })
    return
  }
  if (!currentPort && Date.now() - lastAutoProbe > autoProbeCooldown) {
    if (findUsbmodem()) {
      lastAutoProbe = Date.now()
      doProbe().then((state) => {
        if (state.connected) {
          currentPort = state.port || findUsbmodem()
          autoProbeCooldown = 8000
          broadcastDevice(state)
        } else {
          // reintenta cada vez menos seguido hasta un tope de 60 s
          autoProbeCooldown = Math.min(autoProbeCooldown * 2, 60000)
        }
      })
    }
  }
}, 2000)

ipcMain.handle('pm3:probe', async () => {
  const state = await doProbe()
  currentPort = state.connected ? state.port || findUsbmodem() : null
  autoProbeCooldown = 8000
  lastAutoProbe = Date.now()
  return state
})

// ---------- Panel IA (DeepSeek) ----------

const settingsPath = join(app.getPath('userData'), 'settings.json')

function loadAiSettings(): AiSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const provider: AiProvider = isAiProvider(raw.provider) ? raw.provider : 'deepseek'
    const info = AI_PROVIDERS[provider]
    let apiKey = ''
    if (raw.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
      apiKey = safeStorage.decryptString(Buffer.from(raw.apiKeyEnc, 'base64'))
    } else if (typeof raw.apiKey === 'string') {
      apiKey = raw.apiKey
    }
    return {
      apiKey,
      model: typeof raw.model === 'string' && raw.model ? raw.model : info.defaultModel,
      provider,
      baseUrl: typeof raw.baseUrl === 'string' && raw.baseUrl ? raw.baseUrl : info.baseUrl
    }
  } catch {
    return {
      apiKey: '',
      model: AI_PROVIDERS.deepseek.defaultModel,
      provider: 'deepseek',
      baseUrl: AI_PROVIDERS.deepseek.baseUrl
    }
  }
}

function saveAiSettings(s: AiSettings): void {
  const provider = isAiProvider(s.provider) ? s.provider : 'deepseek'
  const info = AI_PROVIDERS[provider]
  const out: Record<string, unknown> = {
    provider,
    model: s.model || info.defaultModel,
    baseUrl: s.baseUrl || info.baseUrl
  }
  if (safeStorage.isEncryptionAvailable() && s.apiKey) {
    out.apiKeyEnc = safeStorage.encryptString(s.apiKey).toString('base64')
  } else {
    out.apiKey = s.apiKey
  }
  writeFileSync(settingsPath, JSON.stringify(out, null, 2))
}

ipcMain.handle('ai:getSettings', () => loadAiSettings())
ipcMain.handle('ai:setSettings', (_e, s: AiSettings) => {
  saveAiSettings({
    apiKey: String(s.apiKey ?? ''),
    model: String(s.model ?? ''),
    provider: isAiProvider(s.provider) ? s.provider : 'deepseek',
    baseUrl: String(s.baseUrl ?? '')
  })
  return true
})
ipcMain.handle('ai:chat', async (event, messages) => {
  const settings = loadAiSettings()
  if (!settings.apiKey && AI_PROVIDERS[settings.provider]?.needsKey) {
    throw new Error('Configura tu API key primero (botón ⚙ en el panel IA).')
  }
  const win = BrowserWindow.fromWebContents(event.sender)
  const send = (line: string): void => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('pm3:output', stripAnsi(line))
    }
  }
  return chat(messages, settings, runner, {
    onLine: send,
    onActivity: (label) => send(`── [IA] ${label} ──`)
  })
})

// ---------- Perfiles de comandos (profiles.json editable por el usuario) ----------

const profilesPath = join(app.getPath('userData'), 'profiles.json')

const DEFAULT_PROFILES: CommandProfile[] = [
  { label: '🔍 Detectar', commands: ['hf search', 'hf mf info'] },
  { label: '🖥 Estado dispositivo', commands: ['hw version', 'hw status', 'hw list'] },
  { label: '💾 Dump 1K', cwd: '~/Documents/mifare', commands: ['hf mf dump --1k'] },
  { label: '💾 Dump 4K', cwd: '~/Documents/mifare', commands: ['hf mf dump --4k'] },
  { label: '🔑 Claves default', commands: ['hf mf chk --1k --dump'] },
  {
    label: '🔑 Claves TransCaribe',
    commands: [
      'hf mf chk --1k --dump -k FFFFFFFFFFFF -k A75102F8BC34 -k 881F0E5883F6 -k 7110B1923D5A -k C72991CA1DF9 -k 2F879CA8E6F7 -k 3CABAA3B1B20 -k 000000000000'
    ]
  },
  { label: '👃 Sniff', commands: ['hf 14a sniff -c -r -i'] },
  { label: '🛠 Autopwn', commands: ['hf mf autopwn'] }
]

function loadProfiles(): ProfilesResult {
  try {
    if (!existsSync(profilesPath)) {
      writeFileSync(profilesPath, JSON.stringify(DEFAULT_PROFILES, null, 2))
    }
    const data = JSON.parse(readFileSync(profilesPath, 'utf8'))
    const profiles: CommandProfile[] = Array.isArray(data) ? data : (data.profiles ?? [])
    return { path: profilesPath, profiles }
  } catch {
    return { path: profilesPath, profiles: DEFAULT_PROFILES }
  }
}

ipcMain.handle('profiles:get', () => loadProfiles())
ipcMain.handle('profiles:reload', () => loadProfiles())

// ---------- Actualización de firmware Iceman ----------

function senderFor(event: Electron.IpcMainInvokeEvent): (line: string) => void {
  const win = BrowserWindow.fromWebContents(event.sender)
  return (line: string): void => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('pm3:output', stripAnsi(line))
    }
  }
}

ipcMain.handle('fw:list-ports', (event) => fw.listPorts(runner, senderFor(event)))
ipcMain.handle('fw:check-binaries', () => fw.checkBinaries())
ipcMain.handle('fw:check-status', (event) => fw.checkStatus(runner, senderFor(event)))
ipcMain.handle('fw:flash-all', (event) => fw.flashAll(runner, senderFor(event)))
ipcMain.handle('fw:install-client', (event) => fw.installClient(runner, senderFor(event)))
ipcMain.handle('fw:compile-trimmed', (event) => fw.compileTrimmed(runner, senderFor(event)))
ipcMain.handle('fw:trimmed-built', () => fw.trimmedBuilt())
ipcMain.handle(
  'fw:flash-image',
  (event, opts: { port: string; image: 'bootrom' | 'fullimage'; unlock: boolean }) =>
    fw.flashImage(runner, opts.port, opts.image, opts.unlock, senderFor(event))
)

// ---------- Visor de dumps ----------

ipcMain.handle('dumps:open', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win ? dumps.openDump(win) : null
})
ipcMain.handle('dumps:parse', (_event, path: string) => dumps.parseDumpPath(String(path)))

// Copia un dump a la tarjeta que está en el lector (hf mf restore).
ipcMain.handle(
  'dumps:clone',
  async (event, opts: { dump: dumps.DumpData; useKeys: boolean; force: boolean }) => {
    const send = senderFor(event)
    const dump = opts.dump
    if (!dump?.path) throw new Error('No hay dump cargado.')
    const keyBuf = dumps.buildKeyFile(dump.sectors)
    const keyPath = join(tmpdir(), `pm3-restore-${Date.now()}.key.bin`)
    writeFileSync(keyPath, keyBuf)
    send(`── [Clonado] archivo de claves temporal: ${keyPath} ──`)
    const flags = [dumps.sizeFlag(dump), '-f', dump.path, '-k', keyPath]
    if (opts.useKeys) flags.push('--ka')
    if (opts.force) flags.push('--force')
    send(`── [Clonado] hf mf restore ${flags.join(' ')} ──`)
    return runner.run(`hf mf restore ${flags.join(' ')}`, send)
  }
)

// ---------- Scripts Lua ----------

ipcMain.handle('scripts:list', () => scripts.listScripts())
ipcMain.handle('scripts:read', (_event, path: string) => scripts.readScript(String(path)))
ipcMain.handle('scripts:save', (_event, name: string, content: string) =>
  scripts.saveScript(String(name), String(content))
)
ipcMain.handle('scripts:run', (event, name: string) =>
  scripts.runScript(runner, String(name), senderFor(event))
)
