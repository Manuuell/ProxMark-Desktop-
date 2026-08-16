import { useState } from 'react'

interface Props {
  onClose: () => void
  run: (cmd: string) => Promise<void>
}

interface StepDef {
  key: string
  title: string
  done: boolean
  active: boolean
  desc?: React.ReactNode
  act?: React.ReactNode
}

export default function FirmwareModal({ onClose, run }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [tooBig, setTooBig] = useState(false)
  const [flashed, setFlashed] = useState(false)
  const [bootromFlashed, setBootromFlashed] = useState(false)
  const [trimmedFlashed, setTrimmedFlashed] = useState(false)
  const [port, setPort] = useState('/dev/tty.usbmodemiceman1')
  const [built, setBuilt] = useState<{ bootrom: boolean; fullimage: boolean } | null>(null)
  const [status, setStatus] = useState<{
    client: string
    bootrom: string
    os: string
    upToDate: boolean
    detected: boolean
  } | null>(null)
  const [missing, setMissing] = useState<{ name: string; hint: string }[]>([])

  async function guard(label: string, fn: () => Promise<void>) {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      setBusy(null)
      throw e
    }
    setBusy(null)
  }

  async function detectPort() {
    const ports = await window.pm3.fw.listPorts()
    if (ports.length >= 1) setPort(ports[0])
  }

  async function checkState() {
    await guard('estado', async () => {
      setFlashed(false)
      setTooBig(false)
      setBootromFlashed(false)
      setTrimmedFlashed(false)
      const st = await window.pm3.fw.checkStatus()
      setStatus(st)
      setMissing((await window.pm3.fw.checkBinaries()).missing)
      await run('hw status')
      await detectPort()
      setBuilt(await window.pm3.fw.trimmedBuilt())
    })
  }

  async function flashFull() {
    await guard('pm3-flash-all', async () => {
      const st = status ?? (await window.pm3.fw.checkStatus())
      setStatus(st)
      if (st.detected && st.upToDate) {
        setFlashed(true)
        setTooBig(false)
        return
      }
      const r = await window.pm3.fw.flashAll()
      if (r.tooBig) setTooBig(true)
      else if (r.ok) setFlashed(true)
    })
  }

  async function forceFlash() {
    await guard('pm3-flash-all', async () => {
      const r = await window.pm3.fw.flashAll()
      if (r.tooBig) setTooBig(true)
      else if (r.ok) setFlashed(true)
    })
  }

  async function compile() {
    await guard('compilando', async () => {
      await window.pm3.fw.compileTrimmed()
      setBuilt(await window.pm3.fw.trimmedBuilt())
    })
  }

  async function flashBootrom() {
    await guard('flasheando bootrom', async () => {
      await window.pm3.fw.flashImage({ port, image: 'bootrom', unlock: true })
      setBootromFlashed(true)
    })
  }

  async function flashTrimmed() {
    await guard('flasheando recortado', async () => {
      await window.pm3.fw.flashImage({ port, image: 'fullimage', unlock: false })
      setTrimmedFlashed(true)
    })
  }

  async function verify() {
    await guard('verificando', async () => {
      await run('hw version')
      const st = await window.pm3.fw.checkStatus()
      setStatus(st)
    })
  }

  const builtBoth = Boolean(built?.bootrom && built?.fullimage)

  const steps: StepDef[] = [
    {
      key: 'estado',
      title: 'Estado del dispositivo',
      done: Boolean(status),
      active: !status,
      desc: 'Versión, flash y puertos detectados.',
      act: (
        <>
          <button disabled={Boolean(busy)} onClick={checkState}>
            🖥 Ver estado
          </button>
          {status?.detected && (
            <div className="status-block">
              <span className="hint">Client: {status.client}</span>
              <span className="hint">Firmware: {status.os}</span>
              <span className={status.upToDate ? 'ok' : 'warn'}>
                {status.upToDate ? 'Firmware al día ✔' : 'El firmware difiere del client.'}
              </span>
            </div>
          )}
          {missing.length > 0 && (
            <div className="status-block">
              {missing.map((m) => (
                <span key={m.name} className="warn">
                  Falta <code>{m.name}</code>: {m.hint}
                </span>
              ))}
            </div>
          )}
        </>
      )
    },
    {
      key: 'flash',
      title: 'Flasheo completo (pm3-flash-all)',
      done: flashed || tooBig,
      active: Boolean(status) && !flashed && !tooBig,
      desc: tooBig ? (
        <span className="warn">Bootloader viejo (256 K) detectado → plan B.</span>
      ) : flashed ? (
        <span className="ok">Firmware flasheado ✔</span>
      ) : undefined,
      act: (
        <>
          <button disabled={Boolean(busy)} onClick={flashFull}>
            ⚡ Flashear firmware completo
          </button>
          {status?.upToDate && (
            <button className="ghost" disabled={Boolean(busy)} onClick={forceFlash}>
              Forzar flasheo de todas formas
            </button>
          )}
        </>
      )
    },
    ...(tooBig
      ? [
          {
            key: 'compile',
            title: 'Compilar firmware recortado (HF-only)',
            done: builtBoth,
            active: !builtBoth,
            desc: built
              ? `bootrom ${built.bootrom ? '✓' : '✘'} · fullimage ${built.fullimage ? '✓' : '✘'}`
              : 'Genera una imagen que cabe en el rango de 256 K.',
            act: (
              <button disabled={Boolean(busy)} onClick={compile}>
                🔨 Compilar firmware recortado
              </button>
            )
          } as StepDef,
          {
            key: 'bootrom',
            title: 'Modo bootloader → flashear bootrom',
            done: bootromFlashed,
            active: builtBoth && !bootromFlashed,
            desc: 'Mantén el botón pulsado al conectar el USB.',
            act: (
              <>
                <div className="bootloader-instructions">
                  <ol>
                    <li>Desconecta el USB del Proxmark.</li>
                    <li>Mantén pulsado el botón de la placa.</li>
                    <li>Sin soltarlo, conecta el USB. Espera ~10 s y suelta.</li>
                  </ol>
                  <button className="ghost" disabled={Boolean(busy)} onClick={() => guard('puertos', detectPort)}>
                    🔎 Detectar puerto (pm3 --list)
                  </button>
                  <label>
                    Puerto:
                    <input value={port} onChange={(e) => setPort(e.target.value)} />
                  </label>
                </div>
                <button disabled={Boolean(busy)} onClick={flashBootrom}>
                  🧱 Flashear bootrom (--unlock-bootloader)
                </button>
              </>
            )
          } as StepDef,
          {
            key: 'trimmed',
            title: 'Flashear firmware recortado',
            done: trimmedFlashed,
            active: bootromFlashed && !trimmedFlashed,
            desc: 'El equipo ya arranca Iceman; el puerto puede renumerarse.',
            act: (
              <button disabled={Boolean(busy)} onClick={flashTrimmed}>
                📦 Flashear firmware recortado
              </button>
            )
          } as StepDef
        ]
      : []),
    {
      key: 'verify',
      title: 'Verificar (hw version)',
      done: flashed,
      active: !flashed && (tooBig ? trimmedFlashed : Boolean(status)),
      desc: flashed ? <span className="ok">Confirma que arranca Iceman ✔</span> : 'Confirma que arranca Iceman.',
      act: (
        <button disabled={Boolean(busy)} onClick={verify}>
          ✅ Verificar
        </button>
      )
    }
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="glyph">⚡</div>
          <b>Actualizar firmware Iceman</b>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <p className="modal-note">
            Proxmark3 Easy · macOS. Si el bootloader viejo reporta 256 K, el asistente activa el{' '}
            <b>plan B</b> (firmware recortado) automáticamente. Todo se ve en la terminal central.
          </p>

          <div className="steps">
            {steps.map((s, i) => (
              <div key={s.key} className={`fstep ${s.done ? 'done' : s.active ? 'active' : 'pending'}`}>
                <div className="num">{s.done ? '✓' : i + 1}</div>
                <div>
                  <div className="stitle">{s.title}</div>
                  {s.desc && <div className="sdesc">{s.desc}</div>}
                  {s.act && <div className="sact">{s.act}</div>}
                </div>
              </div>
            ))}
          </div>

          <div className="fstep pending">
            <div className="num">·</div>
            <div>
              <div className="stitle">Instalar client Iceman (Homebrew)</div>
              <div className="sdesc">Solo si `pm3` no está instalado. Compila --HEAD: tarda bastante.</div>
              <div className="sact">
                <button
                  disabled={Boolean(busy)}
                  onClick={() => guard('brew', () => window.pm3.fw.installClient().then(() => {}))}
                >
                  🍺 Instalar client
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-foot">{busy ? `⏳ ${busy}…` : '○ listo'}</div>
      </div>
    </div>
  )
}
