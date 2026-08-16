import { useEffect, useRef, useState } from 'react'
import type { UiMsg } from './types'
import ColoredLines from './ColoredLines'
import './types'

const MODELS = ['deepseek-chat', 'deepseek-reasoner']

export default function AiPanel() {
  const [msgs, setMsgs] = useState<UiMsg[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('deepseek-chat')
  const [hasKey, setHasKey] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.pm3.ai
      .getSettings()
      .then((s) => {
        setApiKey(s.apiKey)
        setModel(s.model || 'deepseek-chat')
        setHasKey(Boolean(s.apiKey))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [msgs, thinking])

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
    await window.pm3.ai.setSettings({ apiKey: apiKey.trim(), model })
    setHasKey(Boolean(apiKey.trim()))
    setShowSettings(false)
  }

  return (
    <aside className="ai-panel">
      <div className="ai-head">
        <div className="glyph">✦</div>
        <div className="att">
          Proxmark Assistant<small>DeepSeek · {model}</small>
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
            API key de DeepSeek
            <input
              type="password"
              value={apiKey}
              placeholder="sk-…"
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <label>
            Modelo
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <div className="ai-settings-note">
            La key se guarda cifrada en este equipo (nunca sale de la app salvo para llamar a DeepSeek).
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
              : 'Configura tu API key de DeepSeek con el botón ⚙ para empezar.'}
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
