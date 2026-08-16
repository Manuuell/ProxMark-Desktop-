import { contextBridge, ipcRenderer } from 'electron'
import type { CatalogEntry } from '../shared/catalog'
import type { AiSettings, ChatInputMsg, ChatOutputMsg } from '../main/ai'
import type { ProfilesResult } from '../shared/profiles'

const api = {
  run: (cmd: string, cwd?: string): Promise<number | null> =>
    ipcRenderer.invoke('pm3:run', cmd, cwd),
  cancel: (): Promise<void> => ipcRenderer.invoke('pm3:cancel'),
  catalog: (path: string): Promise<CatalogEntry[]> =>
    ipcRenderer.invoke('pm3:catalog', path),
  catalogClear: (): Promise<boolean> => ipcRenderer.invoke('pm3:catalog-clear'),
  busy: (): Promise<boolean> => ipcRenderer.invoke('pm3:busy'),
  bin: (): Promise<string> => ipcRenderer.invoke('pm3:bin'),
  profiles: {
    get: (): Promise<ProfilesResult> => ipcRenderer.invoke('profiles:get'),
    reload: (): Promise<ProfilesResult> => ipcRenderer.invoke('profiles:reload')
  },
  fw: {
    listPorts: (): Promise<string[]> => ipcRenderer.invoke('fw:list-ports'),
    checkBinaries: (): Promise<{ ok: boolean; missing: { name: string; hint: string }[] }> =>
      ipcRenderer.invoke('fw:check-binaries'),
    checkStatus: (): Promise<{
      client: string
      bootrom: string
      os: string
      upToDate: boolean
      detected: boolean
    }> => ipcRenderer.invoke('fw:check-status'),
    flashAll: (): Promise<{ ok: boolean; tooBig: boolean; output: string }> =>
      ipcRenderer.invoke('fw:flash-all'),
    installClient: (): Promise<number | null> => ipcRenderer.invoke('fw:install-client'),
    compileTrimmed: (): Promise<number | null> => ipcRenderer.invoke('fw:compile-trimmed'),
    trimmedBuilt: (): Promise<{ bootrom: boolean; fullimage: boolean }> =>
      ipcRenderer.invoke('fw:trimmed-built'),
    flashImage: (opts: {
      port: string
      image: 'bootrom' | 'fullimage'
      unlock: boolean
    }): Promise<number | null> => ipcRenderer.invoke('fw:flash-image', opts)
  },
  onOutput: (cb: (line: string) => void): (() => void) => {
    const handler = (_e: unknown, line: string): void => cb(line)
    ipcRenderer.on('pm3:output', handler)
    return () => {
      ipcRenderer.removeListener('pm3:output', handler)
    }
  },
  onBusy: (cb: (busy: boolean) => void): (() => void) => {
    const handler = (_e: unknown, busy: boolean): void => cb(busy)
    ipcRenderer.on('pm3:busy-changed', handler)
    return () => {
      ipcRenderer.removeListener('pm3:busy-changed', handler)
    }
  },
  ai: {
    getSettings: (): Promise<AiSettings> => ipcRenderer.invoke('ai:getSettings'),
    setSettings: (s: AiSettings): Promise<boolean> => ipcRenderer.invoke('ai:setSettings', s),
    chat: (messages: ChatInputMsg[]): Promise<ChatOutputMsg[]> =>
      ipcRenderer.invoke('ai:chat', messages)
  }
}

contextBridge.exposeInMainWorld('pm3', api)

export type Pm3Api = typeof api
