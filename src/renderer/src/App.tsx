import { useEffect, useRef, useState } from 'react'
import { specFor, buildCommand, riskFor, type CommandSpec } from '../../shared/commands'
import type { CatalogEntry } from '../../shared/catalog'
import type { CommandProfile } from '../../shared/profiles'
import AiPanel from './AiPanel'
import FirmwareModal from './FirmwareModal'
import { lineClass } from './highlight'
import './types'

interface Entry extends CatalogEntry {}

function matches(entry: Entry, search: string): boolean {
  if (!search) return true
  const s = search.toLowerCase()
  return entry.name.toLowerCase().includes(s) || entry.description.toLowerCase().includes(s)
}

interface NodeProps {
  path: string
  entry: Entry
  depth: number
  open: Set<string>
  tree: Record<string, Entry[]>
  selected: string
  search: string
  onToggle: (path: string) => void
  onSelect: (path: string, entry: Entry) => void
}

function TreeNode({ path, entry, depth, open, tree, selected, search, onToggle, onSelect }: NodeProps) {
  const children = tree[path] ?? []
  const isOpen = open.has(path)
  const visibleChildren = children.filter((c) => matches(c, search))
  return (
    <div>
      <div
        className={`tree-row ${selected === path ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (entry.isGroup ? onToggle(path) : onSelect(path, entry))}
      >
        {entry.isGroup && <span className="arrow">{isOpen ? '▾' : '▸'}</span>}
        <span className="name">{entry.name}</span>
      </div>
      {entry.isGroup &&
        isOpen &&
        visibleChildren.map((c) => (
          <TreeNode
            key={c.name}
            path={`${path} ${c.name}`.trim()}
            entry={c}
            depth={depth + 1}
            open={open}
            tree={tree}
            selected={selected}
            search={search}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </div>
  )
}

export default function App() {
  const [root, setRoot] = useState<Entry[]>([])
  const [tree, setTree] = useState<Record<string, Entry[]>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState('')
  const [selEntry, setSelEntry] = useState<Entry | null>(null)
  const [spec, setSpec] = useState<CommandSpec | null>(null)
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [freeArgs, setFreeArgs] = useState('')
  const [out, setOut] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [bin, setBin] = useState('')
  const [profiles, setProfiles] = useState<CommandProfile[]>([])
  const [profilesPath, setProfilesPath] = useState('')
  const [showFw, setShowFw] = useState(false)
  const [dev, setDev] = useState<{ connected: boolean | null; version: string; port: string }>({
    connected: null,
    version: '',
    port: ''
  })
  const [elapsed, setElapsed] = useState('')
  const outRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.pm3.catalog('').then(setRoot).catch(() => setRoot([]))
    window.pm3.bin().then(setBin).catch(() => setBin(''))
    window.pm3.profiles
      .get()
      .then((r) => {
        setProfiles(r.profiles)
        setProfilesPath(r.path)
      })
      .catch(() => {})
    probe()
    const off = window.pm3.onOutput((line) => setOut((p) => [...p, line]))
    const offBusy = window.pm3.onBusy(setBusy)
    const offDevice = window.pm3.onDevice(setDev)
    return () => {
      off()
      offBusy()
      offDevice()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    outRef.current?.scrollTo(0, outRef.current.scrollHeight)
  }, [out])

  useEffect(() => {
    if (!busy) {
      setElapsed('')
      return
    }
    const t0 = Date.now()
    const iv = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000)
      setElapsed(
        `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
      )
    }, 1000)
    return () => clearInterval(iv)
  }, [busy])

  async function probe() {
    try {
      setDev(await window.pm3.probe())
    } catch {
      setDev({ connected: false, version: '', port: '' })
    }
  }

  async function reloadProfiles() {
    const r = await window.pm3.profiles.reload()
    setProfiles(r.profiles)
    setProfilesPath(r.path)
  }

  async function refreshCatalog() {
    await window.pm3.catalogClear()
    setTree({})
    setOpen(new Set())
    setRoot(await window.pm3.catalog(''))
  }

  async function toggle(path: string) {
    const next = new Set(open)
    if (next.has(path)) {
      next.delete(path)
      setOpen(next)
      return
    }
    next.add(path)
    setOpen(next)
    if (!tree[path]) {
      const entries = await window.pm3.catalog(path)
      setTree((t) => ({ ...t, [path]: entries }))
    }
  }

  function select(path: string, entry: Entry) {
    setSelected(path)
    setSelEntry(entry)
    const s = specFor(path) ?? null
    setSpec(s)
    const init: Record<string, string | boolean> = {}
    for (const p of s?.params ?? []) {
      init[p.flag] = p.kind === 'flag' ? false : ''
    }
    setValues(init)
    setFreeArgs('')
  }

  function currentCmd(): string {
    if (spec) return buildCommand(selected, spec, values)
    return `${selected} ${freeArgs}`.trim()
  }

  async function execute(cmd: string, cwd?: string, clear = true) {
    if (clear) setOut([])
    await window.pm3.run(cmd, cwd)
  }

  async function runSelected() {
    const cmd = currentCmd()
    if (!cmd) return
    await execute(cmd)
  }

  async function quickAction(profile: CommandProfile) {
    setOut([])
    for (const cmd of profile.commands) {
      await execute(cmd, profile.cwd, false)
    }
  }

  async function cancel() {
    await window.pm3.cancel()
  }

  const visibleRoot = root.filter((c) => matches(c, search))
  const risk = selected ? riskFor(selected) : null

  return (
    <div className="appwin">
      <div className="titlebar">
        <div className="lights">
          <i />
          <i />
          <i />
        </div>
        <span className="wtitle">Proxmark Desktop</span>
        <span className="grow" />
        <span className={`devpill ${dev.connected === false ? 'off' : ''}`}>
          <span className="pulse" />
          {dev.connected === null ? (
            <b>Detectando…</b>
          ) : dev.connected ? (
            <>
              <b>Proxmark3</b>
              <span>{dev.port}</span>
              <span className="fw">{dev.version}</span>
            </>
          ) : (
            <b>Sin dispositivo</b>
          )}
        </span>
      </div>

      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-head">
            <div className="brand">
              <div className="glyph">P</div>
              <div className="bt">
                Proxmark<small>Desktop</small>
              </div>
            </div>
            <input
              className="search"
              placeholder="Buscar comando…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="tree">
            {visibleRoot.map((c) => (
              <TreeNode
                key={c.name}
                path={c.name}
                entry={c}
                depth={0}
                open={open}
                tree={tree}
                selected={selected}
                search={search}
                onToggle={toggle}
                onSelect={select}
              />
            ))}
          </div>
          <div className="side-foot">
            <button className="ghost" title="Recargar catálogo de comandos" onClick={refreshCatalog}>
              ⟳ Catálogo
            </button>
            <button className="sig" title="Actualizar firmware Iceman" onClick={() => setShowFw(true)}>
              ⚡ Firmware
            </button>
          </div>
        </aside>

        <main className="main">
          <div className="quick-bar">
            {profiles.map((p, i) => (
              <button
                key={p.label}
                className={`qa ${i === 0 ? 'accent' : ''}`}
                disabled={busy}
                onClick={() => quickAction(p)}
              >
                {p.label}
              </button>
            ))}
            <button
              className="qa more"
              disabled={busy}
              title={`Editar perfiles en: ${profilesPath}`}
              onClick={reloadProfiles}
            >
              ↻ Perfiles
            </button>
          </div>

          <div className="cmd-bar">
            <div className="cmd-info">
              <strong>{selected || 'Selecciona un comando'}</strong>
              {selEntry && <span className="desc">{selEntry.description}</span>}
              {risk && (
                <span className={`risk ${risk}`}>{risk === 'write' ? 'ESCRITURA' : 'SOLO LECTURA'}</span>
              )}
            </div>
            {spec?.note && <div className="note">{spec.note}</div>}

            {spec && spec.params.length > 0 && (
              <div className="form">
                {spec.params.map((p) =>
                  p.kind === 'flag' ? (
                    <label key={p.flag} className="field flag">
                      <input
                        type="checkbox"
                        checked={Boolean(values[p.flag])}
                        disabled={busy}
                        onChange={(e) => setValues((v) => ({ ...v, [p.flag]: e.target.checked }))}
                      />
                      {p.label} <code>{p.flag}</code>
                    </label>
                  ) : p.kind === 'select' ? (
                    <label key={p.flag} className="field">
                      {p.label} <code>{p.flag}</code>
                      <select
                        value={String(values[p.flag] ?? '')}
                        disabled={busy}
                        onChange={(e) => setValues((v) => ({ ...v, [p.flag]: e.target.value }))}
                      >
                        <option value="">—</option>
                        {(p.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label key={p.flag} className="field grow">
                      {p.label} <code>{p.flag}</code>
                      <input
                        type="text"
                        placeholder={p.placeholder}
                        value={String(values[p.flag] ?? '')}
                        disabled={busy}
                        onChange={(e) => setValues((v) => ({ ...v, [p.flag]: e.target.value }))}
                      />
                    </label>
                  )
                )}
              </div>
            )}

            <div className="run-box">
              {!spec && (
                <input
                  className="args"
                  placeholder="argumentos (texto libre)"
                  value={freeArgs}
                  disabled={!selected || busy}
                  onChange={(e) => setFreeArgs(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSelected()}
                />
              )}
              {spec && <div className="preview">$ pm3 -c "<b>{currentCmd()}</b>"</div>}
              <button className="ghost" disabled={!selected || busy} onClick={() => execute(`${selected} -h`)}>
                Ayuda
              </button>
              <button className="primary" disabled={!selected || busy} onClick={runSelected}>
                {busy ? 'Ejecutando…' : '▶ Ejecutar'}
              </button>
            </div>
          </div>

          <div className="term">
            <div className="term-head">
              <span className="tt">Salida</span>
              {busy && (
                <span className="running">
                  <span className="sp" /> ejecutando · {elapsed}
                </span>
              )}
              <span className="thbtns">
                {busy && (
                  <button className="ghost" onClick={cancel}>
                    Cancelar
                  </button>
                )}
                <button className="ghost" disabled={out.length === 0} onClick={() => setOut([])}>
                  Limpiar
                </button>
              </span>
            </div>
            <div className="output" ref={outRef}>
              {out.length === 0 && (
                <span className="placeholder">La salida del pm3 aparecerá aquí</span>
              )}
              {out.map((l, i) => (
                <div key={i} className={`line ${lineClass(l)}`}>
                  {l || '\u00A0'}
                </div>
              ))}
            </div>
          </div>

          <footer className="statusbar">
            <span className={`st-ok ${busy ? 'busy' : ''}`}>
              <i />
              {busy ? 'ocupado' : dev.connected === false ? 'sin dispositivo' : 'listo'}
            </span>
            <span className="grow" />
            <span>{out.length} líneas</span>
            <span className="bin">{bin}</span>
          </footer>
        </main>

        <AiPanel />
      </div>

      {dev.connected === false && (
        <div className="overlay">
          <div className="offcard">
            <div className="oglyph">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#f2705c" strokeWidth="1.8">
                <path d="M2 8.5a15 15 0 0 1 20 0" />
                <path d="M5 12a10 10 0 0 1 14 0" />
                <path d="M8.5 15.5a5 5 0 0 1 7 0" />
                <circle cx="12" cy="19" r="1.2" fill="#f2705c" />
                <path d="m3 3 18 18" stroke="#f2705c" />
              </svg>
            </div>
            <h3>Conecta tu Proxmark3</h3>
            <p>
              No se detecta ningún dispositivo en los puertos USB. Conéctalo y pulsa detectar, o
              revisa que el client <span style={{ fontFamily: 'monospace', color: 'var(--sig)' }}>pm3</span>{' '}
              esté instalado.
            </p>
            <div className="oactions">
              <button className="primary" onClick={probe}>
                ↻ Buscar dispositivo
              </button>
              <button className="ghost" onClick={() => setShowFw(true)}>
                Instalar client
              </button>
            </div>
          </div>
        </div>
      )}

      {showFw && (
        <FirmwareModal onClose={() => setShowFw(false)} run={(cmd) => execute(cmd, undefined, false)} />
      )}
    </div>
  )
}
