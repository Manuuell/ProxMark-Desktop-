import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, relative } from 'node:path'
import { PM3_BIN, type Pm3Runner } from './pm3'

// Scripts Lua de pm3: lista (dir de usuario + dir del sistema), lee, guarda y ejecuta.

export interface ScriptInfo {
  name: string
  path: string
  user: boolean
}

function userScriptsDir(): string {
  return join(homedir(), '.proxmark3', 'luascripts')
}

function systemScriptsDir(): string {
  try {
    const real = realpathSync(PM3_BIN)
    return join(dirname(real), '..', 'share', 'proxmark3', 'luascripts')
  } catch {
    return ''
  }
}

function walkLua(dir: string, user: boolean, out: ScriptInfo[]): void {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      walkLua(full, user, out)
    } else if (e.name.endsWith('.lua')) {
      const root = user ? userScriptsDir() : systemScriptsDir()
      const name = root ? relative(root, full) : e.name
      out.push({ name, path: full, user })
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
}

export function listScripts(): ScriptInfo[] {
  const out: ScriptInfo[] = []
  const sys = systemScriptsDir()
  if (sys && existsSync(sys)) walkLua(sys, false, out)
  const usr = userScriptsDir()
  if (existsSync(usr)) walkLua(usr, true, out)
  return out
}

export function readScript(path: string): string {
  return readFileSync(path, 'utf8')
}

/** Guarda (o crea) un script en el directorio del usuario y devuelve su ruta. */
export function saveScript(name: string, content: string): string {
  const safe = name.trim().replace(/[^a-zA-Z0-9_.-]/g, '_')
  if (!safe) throw new Error('Nombre de script inválido.')
  const dir = userScriptsDir()
  mkdirSync(dir, { recursive: true })
  const path = join(dir, safe.endsWith('.lua') ? safe : `${safe}.lua`)
  writeFileSync(path, content)
  return path
}

export function runScript(
  runner: Pm3Runner,
  name: string,
  onLine: (line: string) => void
): Promise<number | null> {
  return runner.run(`script run ${name}`, onLine)
}
