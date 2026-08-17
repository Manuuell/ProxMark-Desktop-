// Tipos y configuración compartida del asistente IA (proveedores OpenAI-compatibles).

export type AiProvider = 'deepseek' | 'openai' | 'ollama'

export interface AiSettings {
  apiKey: string
  model: string
  provider: AiProvider
  baseUrl: string
}

export interface ChatInputMsg {
  role: 'user' | 'assistant'
  content: string
}

export type ChatOutputMsg =
  | { kind: 'assistant'; content: string }
  | { kind: 'tool'; tool: string; label: string; output: string }

export interface AiProviderInfo {
  label: string
  baseUrl: string
  defaultModel: string
  models: string[]
  needsKey: boolean
}

export const AI_PROVIDERS: Record<AiProvider, AiProviderInfo> = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    needsKey: true
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    needsKey: true
  },
  ollama: {
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1/chat/completions',
    defaultModel: 'llama3.1',
    models: [],
    needsKey: false
  }
}

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProvider[]

export function isAiProvider(v: unknown): v is AiProvider {
  return typeof v === 'string' && v in AI_PROVIDERS
}
