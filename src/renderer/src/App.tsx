import { useEffect, useRef, useState } from 'react'
import { specFor, buildCommand, type CommandSpec } from '../../shared/commands'
import type { CatalogEntry } from '../../shared/catalog'
import type { CommandProfile } from '../../shared/profiles'
import AiPanel from './AiPanel'
import FirmwareModal from './FirmwareModal'
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
    const off = window.pm3.onOutput((line) => setOut((p) => [...p, line]))
    return off
  }, [])

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

  useEffect(() => {
    outRef.current?.scrollTo(0, outRef.current.scrollHeight)
  }, [out])

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
    setBusy(true)
    if (clear) setOut([])
    try {
      await window.pm3.run(cmd, cwd)
    } finally {
      setBusy(false)
    }
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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="logo">Proxmark Desktop</span>
          <input
            className="search"
            placeholder="Buscar comando…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="small" title="Recargar catálogo de comandos" onClick={refreshCatalog}>
            ⟳ Recargar catálogo
          </button>
          <button className="small" title="Actualizar firmware Iceman" onClick={() => setShowFw(true)}>
            ⚡ Firmware
          </button>
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
      </aside>

      <main className="main">
        <div className="quick-bar">
          {profiles.map((p) => (
            <button key={p.label} disabled={busy} onClick={() => quickAction(p)}>
              {p.label}
            </button>
          ))}
          <button
            className="small"
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
                    {p.label}
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
            <button disabled={!selected || busy} onClick={help}>
              Ayuda
            </button>
            {busy && <button onClick={cancel}>Cancelar</button>}
            <button className="primary" disabled={!selected || busy} onClick={runSelected}>
              {busy ? 'Ejecutando…' : 'Ejecutar'}
            </button>
            <button disabled={out.length === 0} onClick={() => setOut([])}>
              Limpiar
            </button>
          </div>
          {spec && <div className="preview">$ pm3 -c "{currentCmd()}"</div>}
        </div>

        <div className="output" ref={outRef}>
          {out.length === 0 && <span className="placeholder">La salida del pm3 aparecerá aquí</span>}
          {out.map((l, i) => (
            <div key={i} className="line">
              {l || '\u00A0'}
            </div>
          ))}
        </div>

        <footer className="statusbar">
          <span>{busy ? '● ocupado' : '○ listo'}</span>
          <span>{bin}</span>
        </footer>
      </main>

      <AiPanel />
      {showFw && <FirmwareModal onClose={() => setShowFw(false)} run={(cmd) => execute(cmd)} />}
    </div>
  )

  async function help() {
    if (!selected) return
    await execute(`${selected} -h`)
  }
}
