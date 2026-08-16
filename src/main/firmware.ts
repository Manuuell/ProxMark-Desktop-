// Asistente de actualización de firmware Iceman (Proxmark3 Easy / macOS).
// Implementa el procedimiento de la guía TransCaribe V2:
//   pm3-flash-all -> si "too big" (bootloader viejo 256K): compilar recortado,
//   flashear bootrom en modo bootloader (botón), flashear recortado y re-flashear completo.

import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { Pm3Runner, PM3_BIN } from './pm3'

export const BIN_DIR = dirname(PM3_BIN)
export const SRC_DIR = join(homedir(), 'proxmark3-src')
export const BOOTROM_ELF = join(SRC_DIR, 'bootrom/obj/bootrom.elf')
export const FULLIMAGE_ELF = join(SRC_DIR, 'armsrc/obj/fullimage.elf')

const MAKEFILE_PLATFORM = `PLATFORM=PM3GENERIC
PLATFORM_SIZE=256
STANDALONE=
SKIP_LF=1
SKIP_HITAG=1
SKIP_EM4x50=1
SKIP_EM4x70=1
SKIP_ZX8211=1
SKIP_ISO15693=1
SKIP_LEGICRF=1
SKIP_ISO14443b=1
SKIP_ICLASS=1
SKIP_FELICA=1
SKIP_NFCBARCODE=1
SKIP_HFSNIFF=1
SKIP_HFPLOT=1
`

export interface FlashResult {
  ok: boolean
  tooBig: boolean
  output: string
}

export interface FirmwareStatus {
  client: string
  bootrom: string
  os: string
  upToDate: boolean
  detected: boolean
}

function extractVer(line: string): string {
  const m = line.match(/Iceman\/[^\s]+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+[0-9a-f]+/)
  return m ? m[1] : ''
}

function gitHash(ver: string): string {
  const m = ver.match(/([0-9a-f]{7,})/)
  return m ? m[1] : ''
}

/** Detecta si el firmware del dispositivo coincide con el client instalado. */
export async function checkStatus(
  runner: Pm3Runner,
  onLine: (l: string) => void
): Promise<FirmwareStatus> {
  const lines: string[] = []
  await runner.run('hw version', (l) => {
    lines.push(l)
    onLine(l)
  })
  const clean = lines.map((l) => l.replace(/\[[=+]\]\s*/, '').trim())
  let client = ''
  let bootrom = ''
  let os = ''
  for (let i = 0; i < clean.length; i++) {
    const l = clean[i]
    if (l === 'Client' || l === 'Client:') {
      for (let j = i + 1; j < Math.min(clean.length, i + 3); j++) {
        if (clean[j].includes('Iceman/')) {
          client = extractVer(clean[j])
          break
        }
      }
    } else if (l.startsWith('Bootrom')) {
      bootrom = extractVer(l)
    } else if (l.startsWith('OS')) {
      os = extractVer(l)
    }
  }
  const detected = Boolean(client && os)
  const upToDate = detected && gitHash(client) === gitHash(os) && gitHash(client) !== ''
  return { client, bootrom, os, upToDate, detected }
}

export function bin(name: string): string {
  return join(BIN_DIR, name)
}

/** Lista los puertos del Proxmark (pm3 --list). */
export async function listPorts(runner: Pm3Runner, onLine: (l: string) => void): Promise<number | null> {
  return runner.runBinary(PM3_BIN, ['--list'], onLine)
}

/** Flashea bootrom + firmware completo con pm3-flash-all. */
export async function flashAll(runner: Pm3Runner, onLine: (l: string) => void): Promise<FlashResult> {
  const lines: string[] = []
  const code = await runner.runBinary(bin('pm3-flash-all'), [], (l) => {
    lines.push(l)
    onLine(l)
  })
  const output = lines.join('\n')
  const tooBig = /too big|256K of flash|256k of flash/i.test(output)
  const ok = code === 0 && /all done|success/i.test(output)
  return { ok, tooBig, output }
}

/** Instala el client Iceman con Homebrew (macOS). Lento (compila --HEAD). */
export async function installClient(runner: Pm3Runner, onLine: (l: string) => void): Promise<number | null> {
  const brew = bin('brew')
  const steps: string[][] = [
    [brew, 'tap', 'RfidResearchGroup/proxmark3'],
    [brew, 'trust', 'rfidresearchgroup/proxmark3'],
    [brew, 'install', '--HEAD', '--with-generic', 'proxmark3']
  ]
  let code: number | null = 0
  for (const s of steps) {
    onLine(`\n── [Firmware] $ ${s.join(' ')} ──`)
    code = await runner.runBinary(s[0], s.slice(1), onLine)
  }
  return code
}

/** Clona el repo y compila el firmware recortado (HF-only, cabe en 256K). */
export async function compileTrimmed(runner: Pm3Runner, onLine: (l: string) => void): Promise<number | null> {
  let code: number | null = 0
  if (!existsSync(join(SRC_DIR, 'Makefile'))) {
    mkdirSync(SRC_DIR, { recursive: true })
    onLine(`\n── [Firmware] $ git clone --depth 1 RfidResearchGroup/proxmark3 ${SRC_DIR} ──`)
    code = await runner.runBinary(
      '/usr/bin/git',
      ['clone', '--depth', '1', 'https://github.com/RfidResearchGroup/proxmark3.git', SRC_DIR],
      onLine
    )
    if (code !== 0) return code
  }

  writeFileSync(join(SRC_DIR, 'Makefile.platform'), MAKEFILE_PLATFORM)

  // El toolchain ARM (arm-none-eabi-gcc) viene de Homebrew en Apple Silicon.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${BIN_DIR}:${process.env.PATH ?? ''}`
  }

  for (const target of [
    ['clean'],
    ['-j4', 'bootrom', 'fullimage', 'recovery']
  ]) {
    onLine(`\n── [Firmware] $ make ${target.join(' ')} (${SRC_DIR}) ──`)
    code = await runner.runBinary('/usr/bin/make', target, onLine, SRC_DIR, env)
    if (code !== 0) return code
  }
  return code
}

/** Flashea una imagen concreta con el client proxmark3. */
export async function flashImage(
  runner: Pm3Runner,
  port: string,
  image: 'bootrom' | 'fullimage',
  unlockBootloader: boolean,
  onLine: (l: string) => void
): Promise<number | null> {
  const elf = image === 'bootrom' ? BOOTROM_ELF : FULLIMAGE_ELF
  const args = [port, '--flash']
  if (unlockBootloader) args.push('--unlock-bootloader')
  args.push('--image', elf)
  onLine(`\n── [Firmware] $ proxmark3 ${args.join(' ')} ──`)
  return runner.runBinary(bin('proxmark3'), args, onLine)
}

/** Verifica si el firmware recortado ya está compilado. */
export function trimmedBuilt(): { bootrom: boolean; fullimage: boolean } {
  return { bootrom: existsSync(BOOTROM_ELF), fullimage: existsSync(FULLIMAGE_ELF) }
}
