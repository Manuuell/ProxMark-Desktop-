import { useEffect, useState } from 'react'
import type { ScriptInfo } from '../../main/scripts'

interface Props {
  run: (cmd: string) => Promise<void>
  busy: boolean
}

export default function ScriptsPanel({ run, busy }: Props) {
  const [scripts, setScripts] = useState<ScriptInfo[]>([])
  const [selected, setSelected] = useState<ScriptInfo | null>(null)
  const [content, setContent] = useState('')
  const [name, setName] = useState('')
  const [isNew, setIsNew] = useState(false)
  const [dirty, setDirty] = useState(false)

  async function reload() {
    try {
      setScripts(await window.pm3.scripts.list())
    } catch {
      setScripts([])
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function open(script: ScriptInfo) {
    try {
      setContent(await window.pm3.scripts.read(script.path))
    } catch {
      setContent('')
    }
    setName(script.name)
    setSelected(script)
    setIsNew(false)
    setDirty(false)
  }

  function newScript() {
    setSelected(null)
    setContent('-- Tu script Lua\n')
    setName('')
    setIsNew(true)
    setDirty(false)
  }

  async function save() {
    const path = await window.pm3.scripts.save(name, content)
    setSelected({ name: name.endsWith('.lua') ? name : `${name}.lua`, path, user: true })
    setIsNew(false)
    setDirty(false)
    await reload()
  }

  async function runScript() {
    const target = selected?.name ?? (name ? name : null)
    if (!target) return
    if (isNew || dirty) await save()
    await run(`script run ${target}`)
  }

  const userScripts = scripts.filter((s) => s.user)
  const sysScripts = scripts.filter((s) => !s.user)

  return (
    <>
      <div className="scripts-panel">
        <div className="scripts-actions">
          <button className="ghost small" onClick={reload}>
            ⟳
          </button>
          <button className="small primary" onClick={newScript}>
            + Nuevo
          </button>
        </div>
        <div className="scripts-list">
          {userScripts.length > 0 && <div className="scripts-section">Tus scripts</div>}
          {userScripts.map((s) => (
            <div
              key={s.path}
              className={`script-row ${selected?.path === s.path ? 'selected' : ''}`}
              onClick={() => open(s)}
            >
              <span className="name">{s.name}</span>
            </div>
          ))}
          {sysScripts.length > 0 && <div className="scripts-section">Iceman</div>}
          {sysScripts.map((s) => (
            <div
              key={s.path}
              className={`script-row ${selected?.path === s.path ? 'selected' : ''}`}
              onClick={() => open(s)}
            >
              <span className="name">{s.name}</span>
            </div>
          ))}
          {scripts.length === 0 && <div className="scripts-empty">Sin scripts detectados.</div>}
        </div>
      </div>

      {(selected || isNew) && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal modal-script" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="glyph">📜</div>
              <b>{isNew ? 'Nuevo script' : selected?.name}</b>
              <button onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="modal-body">
              <label className="script-name-field">
                Nombre (sin ruta, en ~/.proxmark3/luascripts/)
                <input
                  value={name}
                  placeholder="mi_script.lua"
                  onChange={(e) => {
                    setName(e.target.value)
                    setDirty(true)
                  }}
                />
              </label>
              <textarea
                className="script-editor"
                spellCheck={false}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  setDirty(true)
                }}
              />
            </div>
            <div className="modal-foot script-foot">
              <span>{dirty || isNew ? '● sin guardar' : '○ guardado'}</span>
              <span className="grow" />
              <button className="ghost" disabled={busy || !name.trim()} onClick={save}>
                💾 Guardar
              </button>
              <button className="primary" disabled={busy || !name.trim()} onClick={runScript}>
                ▶ Ejecutar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
