import { dialog, type BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'

// Parseador de dumps MIFARE (.json de Iceman, .eml y .bin).

export interface DumpBlock {
  block: number
  data: string
  empty: boolean
  keyA?: string
  keyB?: string
  access?: string
}

export interface DumpSector {
  sector: number
  blocks: DumpBlock[]
  keyA?: string
  keyB?: string
  access?: string
}

export interface DumpCard {
  uid?: string
  sak?: string
  atqa?: string
  type?: string
}

export interface DumpData {
  source: string
  path: string
  kind: string
  card: DumpCard
  sectors: DumpSector[]
  totalBlocks: number
  sizeLabel: string
}

const HEX = /^[0-9a-fA-F]+$/

function sectorSizes(totalBlocks: number): number[] {
  if (totalBlocks <= 64) return new Array(totalBlocks / 4).fill(4)
  if (totalBlocks <= 128) return new Array(totalBlocks / 4).fill(4)
  // 4K: 32 sectores de 4 bloques + 4 sectores de 16 bloques.
  return [...new Array(32).fill(4), ...new Array(4).fill(16)]
}

function parseTrailer(data: string): { keyA?: string; keyB?: string; access?: string } {
  if (!data || data.length < 32 || !HEX.test(data)) return {}
  return {
    keyA: data.slice(0, 12),
    access: data.slice(12, 20),
    keyB: data.slice(20, 32)
  }
}

function buildSectors(blocks: { block: number; data: string }[]): DumpSector[] {
  if (blocks.length === 0) return []
  const sizes = sectorSizes(blocks.length)
  const byIndex = new Map<number, string>()
  for (const b of blocks) byIndex.set(b.block, b.data)

  const sectors: DumpSector[] = []
  let cursor = 0
  sizes.forEach((size, i) => {
    const secBlocks: DumpBlock[] = []
    for (let j = 0; j < size; j++) {
      const block = cursor + j
      const data = (byIndex.get(block) ?? '').toUpperCase()
      const isTrailer = j === size - 1
      const tr = isTrailer ? parseTrailer(data) : {}
      secBlocks.push({
        block,
        data,
        empty: /^0*$/.test(data),
        keyA: tr.keyA,
        keyB: tr.keyB,
        access: tr.access
      })
    }
    const trailer = secBlocks[secBlocks.length - 1]
    sectors.push({
      sector: i,
      blocks: secBlocks,
      keyA: trailer.keyA,
      keyB: trailer.keyB,
      access: trailer.access
    })
    cursor += size
  })
  return sectors
}

function sizeLabel(totalBlocks: number): string {
  const bytes = totalBlocks * 16
  if (bytes >= 4096) return '4K'
  if (bytes >= 2048) return '2K'
  if (bytes >= 1024) return '1K'
  if (bytes >= 320) return 'Mini'
  return `${bytes} B`
}

function parseJson(raw: string): { card: DumpCard; blocks: { block: number; data: string }[] } {
  const data = JSON.parse(raw)
  const cardRaw = data.Card ?? data.card ?? {}
  const card: DumpCard = {
    uid: cardRaw.UID ?? cardRaw.uid,
    sak: cardRaw.SAK ?? cardRaw.sak,
    atqa: cardRaw.ATQA ?? cardRaw.atqa,
    type: cardRaw.CardType ?? cardRaw.type
  }
  const blocksObj = data.blocks ?? {}
  const blocks: { block: number; data: string }[] = []
  if (Array.isArray(blocksObj)) {
    blocksObj.forEach((v, i) => {
      const s = typeof v === 'string' ? v : v?.data
      if (typeof s === 'string' && s.length >= 32) blocks.push({ block: i, data: s })
    })
  } else {
    for (const k of Object.keys(blocksObj)) {
      const n = Number(k)
      if (Number.isNaN(n)) continue
      const v = blocksObj[k]
      const s = typeof v === 'string' ? v : v?.data
      if (typeof s === 'string' && s.length >= 32) blocks.push({ block: n, data: s })
    }
  }
  blocks.sort((a, b) => a.block - b.block)
  return { card, blocks }
}

function parseEml(raw: string): { block: number; data: string }[] {
  const blocks: { block: number; data: string }[] = []
  let i = 0
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    if (t.length < 32 || !HEX.test(t.slice(0, 32))) continue
    blocks.push({ block: i, data: t.slice(0, 32) })
    i++
  }
  return blocks
}

export function parseDump(path: string, buf: Buffer): DumpData {
  const ext = extname(path).toLowerCase()
  let card: DumpCard = {}
  let blocks: { block: number; data: string }[] = []

  if (ext === '.json') {
    const parsed = parseJson(buf.toString('utf8'))
    card = parsed.card
    blocks = parsed.blocks
  } else if (ext === '.eml') {
    blocks = parseEml(buf.toString('utf8'))
  } else {
    // .bin (o cualquiera): 16 bytes por bloque.
    const hex = buf.toString('hex')
    for (let i = 0; i < buf.length; i += 16) {
      blocks.push({ block: i / 16, data: hex.slice(i * 2, i * 2 + 32) })
    }
  }

  return {
    source: basename(path),
    path,
    kind: ext.replace('.', '').toUpperCase(),
    card,
    sectors: buildSectors(blocks),
    totalBlocks: blocks.length,
    sizeLabel: sizeLabel(blocks.length)
  }
}

/** Abre el diálogo de archivo y devuelve el dump parseado (null si se cancela). */
export async function openDump(win: BrowserWindow): Promise<DumpData | null> {
  const res = await dialog.showOpenDialog(win, {
    title: 'Abrir dump MIFARE',
    properties: ['openFile'],
    filters: [
      { name: 'Dumps MIFARE', extensions: ['json', 'eml', 'bin'] },
      { name: 'Todos los archivos', extensions: ['*'] }
    ]
  })
  if (res.canceled || res.filePaths.length === 0) return null
  const path = res.filePaths[0]
  return parseDump(path, readFileSync(path))
}

export function parseDumpPath(path: string): DumpData {
  return parseDump(path, readFileSync(path))
}

/** Flag de tamaño para `hf mf restore` según el número de bloques. */
export function sizeFlag(dump: DumpData): string {
  if (dump.totalBlocks <= 20) return '--mini'
  if (dump.totalBlocks <= 64) return '--1k'
  if (dump.totalBlocks <= 128) return '--2k'
  return '--4k'
}

function hexBytes(h: string): Buffer {
  const clean = (h || '').replace(/[^0-9a-fA-F]/g, '')
  const out = Buffer.alloc(6)
  for (let i = 0; i < 6; i++) {
    const byte = clean.slice(i * 2, i * 2 + 2)
    out[i] = byte.length === 2 ? parseInt(byte, 16) : 0
  }
  return out
}

/** Genera el archivo de claves que espera `hf mf restore`: primera mitad key A
 *  de todos los sectores, segunda mitad key B de todos (ver `loadFileBinaryKey`). */
export function buildKeyFile(sectors: DumpSector[]): Buffer {
  const n = sectors.length
  const out = Buffer.alloc(n * 12)
  sectors.forEach((s, i) => hexBytes(s.keyA || 'FFFFFFFFFFFF').copy(out, i * 6))
  sectors.forEach((s, i) => hexBytes(s.keyB || 'FFFFFFFFFFFF').copy(out, n * 6 + i * 6))
  return out
}
