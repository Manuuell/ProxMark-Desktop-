import { useEffect, useState } from 'react'
import type { DumpData } from '../../main/dumps'

interface Props {
  onClose: () => void
}

function chunk(s: string, n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n))
  return out
}

export default function DumpViewer({ onClose }: Props) {
  const [dump, setDump] = useState<DumpData | null>(null)
  const [error, setError] = useState('')
  const [useKeys, setUseKeys] = useState(false)
  const [force, setForce] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [cloning, setCloning] = useState(false)

  useEffect(() => {
    window.pm3.dumps
      .open()
      .then((d) => {
        if (!d) onClose()
        else setDump(d)
      })
      .catch((e) => setError(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function clone() {
    if (!dump || cloning) return
    setCloning(true)
    try {
      await window.pm3.dumps.clone({ dump, useKeys, force })
    } catch (e) {
      setError(String(e))
    } finally {
      setCloning(false)
      setConfirming(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-dump" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="glyph">💾</div>
          <b>Visor de dump</b>
          {dump && <span className="dump-meta">{dump.source} · {dump.kind}</span>}
          <button onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {error && <div className="dump-error">No se pudo abrir el dump: {error}</div>}
          {!dump && !error && <div className="dump-loading">Abriendo…</div>}

          {dump && (
            <>
              <div className="dump-card">
                {dump.card.uid && <span>UID <b>{dump.card.uid}</b></span>}
                {dump.card.sak && <span>SAK <b>{dump.card.sak}</b></span>}
                {dump.card.atqa && <span>ATQA <b>{dump.card.atqa}</b></span>}
                {dump.card.type && <span>Tipo <b>{dump.card.type}</b></span>}
                <span className="dump-size">{dump.sizeLabel} · {dump.totalBlocks} bloques</span>
              </div>

              <div className="dump-table">
                {dump.sectors.map((s) => (
                  <div key={s.sector} className="dump-sector">
                    <div className="dump-sector-head">
                      <span className="dump-sector-num">Sector {s.sector}</span>
                      <span className="grow" />
                      <span className="dump-key">A: <b>{s.keyA || '————'}</b></span>
                      <span className="dump-key">B: <b>{s.keyB || '————'}</b></span>
                      {s.access && <span className="dump-acc">AC: {s.access}</span>}
                    </div>
                    {s.blocks.map((b) => (
                      <div key={b.block} className={`dump-block ${b.empty ? 'empty' : ''}`}>
                        <span className="dump-block-num">{String(b.block).padStart(2, '0')}</span>
                        {b.keyA ? (
                          <span className="dump-trailer">
                            <b className="ka">{b.keyA}</b>
                            <span className="ac">{b.access}</span>
                            <b className="kb">{b.keyB}</b>
                          </span>
                        ) : (
                          <span className="dump-data">
                            {chunk(b.data, 2).map((h, i) => (
                              <i key={i}>{h}</i>
                            ))}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {dump && (
          <div className="modal-foot clone-foot">
            {confirming ? (
              <>
                <span className="clone-warn">
                  ⚠ Se ESCRIBIRÁ en la tarjeta del lector (operación irreversible). ¿Continuar?
                </span>
                <span className="grow" />
                <button className="ghost" disabled={cloning} onClick={() => setConfirming(false)}>
                  Cancelar
                </button>
                <button className="primary danger" disabled={cloning} onClick={clone}>
                  {cloning ? 'Escribiendo…' : 'Sí, clonar ahora'}
                </button>
              </>
            ) : (
              <>
                <label className="clone-opt">
                  <input
                    type="checkbox"
                    checked={useKeys}
                    onChange={(e) => setUseKeys(e.target.checked)}
                  />
                  Autenticar con claves del dump (--ka)
                </label>
                <label className="clone-opt">
                  <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                  Forzar ACL (--force)
                </label>
                <span className="grow" />
                <button className="sig" disabled={cloning} onClick={() => setConfirming(true)}>
                  ⚠ Clonar a tarjeta
                </button>
              </>
            )}
          </div>
        )}
        {dump && (
          <div className="clone-note">
            Usa una tarjeta MIFARE Classic <b>en blanco</b> (claves de fábrica <code>FFFFFFFFFFFF</code>).
            Marca <code>--ka</code> solo si la tarjeta destino ya tiene las claves del dump.
          </div>
        )}
      </div>
    </div>
  )
}
