import { useEffect, useRef, useState } from 'react'
import type { UiMsg } from './types'
import { AI_PROVIDERS, AI_PROVIDER_IDS, type AiProvider } from '../../shared/ai'
import ColoredLines from './ColoredLines'
import './types'

export default function AiPanel() {
  const [msgs, setMsgs] = useState<UiMsg[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(AI_PROVIDERS.deepseek.defaultModel)
  const [provider, setProvider] = useState<AiProvider>('deepseek')
  const [baseUrl, setBaseUrl] = useState(AI_PROVIDERS.deepseek.baseUrl)
  const [hasKey, setHasKey] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const info = AI_PROVIDERS[provider]

  useEffect(() => {
    window.pm3.ai
      .getSettings()
      .then((s) => {
        setApiKey(s.apiKey)
        setProvider(s.provider ?? 'deepseek')
        setBaseUrl(s.baseUrl ?? AI_PROVIDERS[s.provider ?? 'deepseek'].baseUrl)
        setModel(s.model || AI_PROVIDERS[s.provider ?? 'deepseek'].defaultModel)
        setHasKey(!AI_PROVIDERS[s.provider ?? 'deepseek'].needsKey || Boolean(s.apiKey))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [msgs, thinking])

  function applyProvider(p: AiProvider): void {
    const inf = AI_PROVIDERS[p]
    setProvider(p)
    setBaseUrl(inf.baseUrl)
    setModel(inf.defaultModel)
    setHasKey(!inf.needsKey || Boolean(apiKey))
  }

  async function send() {
    const text = input.trim()
    if (!text || thinking) return
    setInput('')
    setThinking(true)
    setMsgs((m) => [...m, { kind: 'user', content: text }])
    try {
      const history = msgs
        .filter((m): m is Extract<UiMsg, { kind: 'user' | 'assistant' }> =>
          m.kind === 'user' || m.kind === 'assistant')
        .map((m) => ({ role: m.kind, content: m.content }))
      history.push({ role: 'user', content: text })
      const reply = await window.pm3.ai.chat(history)
      setMsgs((m) => [...m, ...reply])
    } catch (e) {
      setMsgs((m) => [...m, { kind: 'assistant', content: `⚠ ${String(e)}` }])
    } finally {
      setThinking(false)
    }
  }

  async function saveSettings() {
    await window.pm3.ai.setSettings({
      apiKey: apiKey.trim(),
      model: model.trim() || info.defaultModel,
      provider,
      baseUrl: baseUrl.trim() || info.baseUrl
    })
    setHasKey(!info.needsKey || Boolean(apiKey.trim()))
    setShowSettings(false)
  }

  return (
    <aside className="ai-panel">
      <div className="ai-head">
        <div className="glyph">✦</div>
        <div className="att">
          Proxmark Assistant<small>{info.label} · {model}</small>
        </div>
        <div className="hbtn">
          <button title="Configuración" onClick={() => setShowSettings((s) => !s)}>
            ⚙
          </button>
          <button title="Nueva conversación" onClick={() => setMsgs([])}>
            ↺
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="ai-settings">
          <label>
            Proveedor
            <select
              value={provider}
              onChange={(e) => applyProvider(e.target.value as AiProvider)}
            >
              {AI_PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {AI_PROVIDERS[id].label}
                </option>
              ))}
            </select>
          </label>
          {info.needsKey && (
            <label>
              API key
              <input
                type="password"
                value={apiKey}
                placeholder={provider === 'openai' ? 'sk-…' : 'sk-…'}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
          )}
          <label>
            URL del endpoint
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </label>
          <label>
            Modelo
            {info.models.length > 0 ? (
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {info.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input value={model} onChange={(e) => setModel(e.target.value)} />
            )}
          </label>
          <div className="ai-settings-note">
            {info.needsKey
              ? 'La key se guarda cifrada en este equipo (nunca sale de la app salvo para llamar al proveedor).'
              : 'Ollama es local: no requiere API key y tus datos no salen de tu máquina.'}
          </div>
          <button className="primary" onClick={saveSettings}>
            Guardar
          </button>
        </div>
      )}

      <div className="ai-msgs" ref={scrollRef}>
        {msgs.length === 0 && (
          <div className="ai-empty">
            {hasKey
              ? 'Pregúntame, por ejemplo: "detecta la tarjeta que está en el lector" o "prueba las claves por defecto".'
              : 'Configura tu proveedor y API key con el botón ⚙ para empezar.'}
          </div>
        )}
        {msgs.map((m, i) =>
          m.kind === 'user' ? (
            <div key={i} className="bub user">
              {m.content}
            </div>
          ) : m.kind === 'assistant' ? (
            <div key={i} className="bub bot">
              {m.content}
            </div>
          ) : (
            <details key={i} className="toolcard">
              <summary>
                🔧 {m.tool} · {m.label} <span className="ran">✓ ejecutado</span>
              </summary>
              <pre>
                <ColoredLines text={m.output} />
              </pre>
            </details>
          )
        )}
        {thinking && <div className="bub bot thinking">Pensando…</div>}
      </div>

      <div className="ai-input">
        <input
          type="text"
          placeholder="Escribe tu petición…"
          value={input}
          disabled={!hasKey || thinking}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button className="send" disabled={!hasKey || thinking || !input.trim()} onClick={send}>
          Enviar
        </button>
      </div>
    </aside>
  )
}
