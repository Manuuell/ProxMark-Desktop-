import type { CatalogEntry } from '../../shared/catalog'
import type { CommandProfile, ProfilesResult } from '../../shared/profiles'

export interface AiApi {
  getSettings(): Promise<{ apiKey: string; model: string }>
  setSettings(s: { apiKey: string; model: string }): Promise<boolean>
  chat(messages: { role: 'user' | 'assistant'; content: string }[]): Promise<
    (
      | { kind: 'assistant'; content: string }
      | { kind: 'tool'; tool: string; label: string; output: string }
    )[]
  >
}

export interface Pm3Api {
  run(cmd: string, cwd?: string): Promise<number | null>
  cancel(): Promise<void>
  catalog(path: string): Promise<CatalogEntry[]>
  catalogClear(): Promise<boolean>
  busy(): Promise<boolean>
  bin(): Promise<string>
  probe(): Promise<{ connected: boolean; version: string; port: string }>
  profiles: {
    get(): Promise<ProfilesResult>
    reload(): Promise<ProfilesResult>
  }
  fw: {
    listPorts(): Promise<string[]>
    checkBinaries(): Promise<{ ok: boolean; missing: { name: string; hint: string }[] }>
    checkStatus(): Promise<{
      client: string
      bootrom: string
      os: string
      upToDate: boolean
      detected: boolean
    }>
    flashAll(): Promise<{ ok: boolean; tooBig: boolean; output: string }>
    installClient(): Promise<number | null>
    compileTrimmed(): Promise<number | null>
    trimmedBuilt(): Promise<{ bootrom: boolean; fullimage: boolean }>
    flashImage(opts: {
      port: string
      image: 'bootrom' | 'fullimage'
      unlock: boolean
    }): Promise<number | null>
  }
  onOutput(cb: (line: string) => void): () => void
  onBusy(cb: (busy: boolean) => void): () => void
  onDevice(cb: (state: { connected: boolean; version: string; port: string }) => void): () => void
  ai: AiApi
}

export type UiMsg =
  | { kind: 'user'; content: string }
  | { kind: 'assistant'; content: string }
  | { kind: 'tool'; tool: string; label: string; output: string }

declare global {
  interface Window {
    pm3: Pm3Api
  }
}
