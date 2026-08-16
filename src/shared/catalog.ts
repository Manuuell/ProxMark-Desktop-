// Tipos compartidos y parser del catálogo de comandos de pm3.

export interface CatalogEntry {
  name: string
  description: string
  isGroup: boolean
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

const SKIP_PREFIXES = ['[=]', '[+]', '[!]', '[?]', '[#]', '[usb', '[\\', 'pm3 -->']

export function parseHelp(output: string): CatalogEntry[] {
  const entries: CatalogEntry[] = []
  for (const raw of output.split('\n')) {
    const line = stripAnsi(raw).trimEnd()
    const t = line.trim()
    if (!t) continue
    if (t.includes('------')) continue
    if (SKIP_PREFIXES.some((p) => t.startsWith(p))) continue
    const m = line.match(/^(\S+)\s+(.+)$/)
    if (!m) continue
    const name = m[1]
    let desc = m[2].trim()
    if (name === 'help' || name === 'quit' || name === 'exit') continue
    const isGroup = desc.startsWith('{') && desc.endsWith('}')
    if (isGroup) desc = desc.slice(1, -1).trim()
    if (!desc) continue
    entries.push({ name, description: desc, isGroup })
  }
  return entries
}
