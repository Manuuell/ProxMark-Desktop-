import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { Pm3Runner, PM3_BIN } from './pm3'
import { parseHelp, stripAnsi, type CatalogEntry } from '../shared/catalog'
import { chat, type AiSettings } from './ai'
import type { CommandProfile, ProfilesResult } from '../shared/profiles'
import * as fw from './firmware'

const runner = new Pm3Runner()
const catalogCache = new Map<string, CatalogEntry[]>()

// El estado busy del runner se transmite a TODAS las ventanas para que la UI
// principal se bloquee también durante operaciones de firmware/IA.
runner.on('busy', (b: boolean) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('pm3:busy-changed', b)
  }
})

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    title: 'Proxmark Desktop',
    backgroundColor: '#101418',
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
  writeCatalogDisk(key, entries)
  return entries
})

ipcMain.handle('pm3:catalog-clear', () => {
  catalogCache.clear()
  return true
})

ipcMain.handle('pm3:busy', () => runner.isBusy)
ipcMain.handle('pm3:bin', () => PM3_BIN)

// ---------- Panel IA (DeepSeek) ----------

const settingsPath = join(app.getPath('userData'), 'settings.json')

function loadAiSettings(): AiSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath, 'utf8'))
    let apiKey = ''
    if (raw.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
      apiKey = safeStorage.decryptString(Buffer.from(raw.apiKeyEnc, 'base64'))
    } else if (typeof raw.apiKey === 'string') {
      apiKey = raw.apiKey
    }
    return { apiKey, model: raw.model ?? 'deepseek-chat' }
  } catch {
    return { apiKey: '', model: 'deepseek-chat' }
  }
}

function saveAiSettings(s: AiSettings): void {
  const out: Record<string, unknown> = { model: s.model || 'deepseek-chat' }
  if (safeStorage.isEncryptionAvailable() && s.apiKey) {
    out.apiKeyEnc = safeStorage.encryptString(s.apiKey).toString('base64')
  } else {
    out.apiKey = s.apiKey
  }
  writeFileSync(settingsPath, JSON.stringify(out, null, 2))
}

ipcMain.handle('ai:getSettings', () => loadAiSettings())
ipcMain.handle('ai:setSettings', (_e, s: AiSettings) => {
  saveAiSettings({ apiKey: String(s.apiKey ?? ''), model: String(s.model ?? 'deepseek-chat') })
  return true
})
ipcMain.handle('ai:chat', async (event, messages) => {
  const settings = loadAiSettings()
  if (!settings.apiKey) throw new Error('Configura tu API key de DeepSeek primero (botón ⚙ en el panel IA).')
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
