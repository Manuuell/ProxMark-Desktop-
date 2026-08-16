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
  profiles: {
    get(): Promise<ProfilesResult>
    reload(): Promise<ProfilesResult>
  }
  onOutput(cb: (line: string) => void): () => void
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
