import { useState } from 'react'

interface Props {
  onClose: () => void
  run: (cmd: string) => Promise<void>
}

export default function FirmwareModal({ onClose, run }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [tooBig, setTooBig] = useState(false)
  const [flashed, setFlashed] = useState(false)
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
    if (ports.length === 1) setPort(ports[0])
    else if (ports.length > 1) setPort(ports[0])
  }

  async function checkState() {
    await guard('estado', async () => {
      setFlashed(false)
      const st = await window.pm3.fw.checkStatus()
      setStatus(st)
      const bins = await window.pm3.fw.checkBinaries()
      setMissing(bins.missing)
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
    })
  }

  async function flashTrimmed() {
    await guard('flasheando recortado', async () => {
      await window.pm3.fw.flashImage({ port, image: 'fullimage', unlock: false })
    })
  }

  async function verify() {
    await guard('verificando', async () => {
      await run('hw version')
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>⚡ Actualización de firmware Iceman</span>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <p className="modal-note">
            Procedimiento (Proxmark3 Easy, macOS): flasheo completo; si el bootloader viejo
            reporta 256K y rechaza la imagen, se compila un firmware recortado, se flashea el
            bootrom en modo bootloader (botón) y se re-flashea el completo. Todo se ve en la
            terminal central.
          </p>

          <div className="step">
            <button disabled={Boolean(busy)} onClick={checkState}>
              🖥 Ver estado (versión, flash, puertos)
            </button>
            {status && status.detected && (
              <div className="status-block">
                <span className="hint">Client: {status.client}</span>
                <span className="hint">Firmware: {status.os}</span>
                <span className={status.upToDate ? 'ok' : 'warn'}>
                  {status.upToDate
                    ? 'Firmware al día ✔ — no hace falta flashear.'
                    : 'El firmware difiere del client: se recomienda flashear.'}
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
          </div>

          <div className="step">
            <button disabled={Boolean(busy)} onClick={flashFull}>
              ⚡ Flashear firmware completo (pm3-flash-all)
            </button>
            {status?.upToDate && (
              <button className="small" disabled={Boolean(busy)} onClick={forceFlash}>
                Forzar flasheo de todas formas
              </button>
            )}
            {tooBig && (
              <span className="warn">
                Bootloader viejo detectado ("firmware too big"): sigue con el plan B de abajo.
              </span>
            )}
            {flashed && <span className="ok">Firmware al día ✔</span>}
          </div>

          <div className="step">
            <button disabled={Boolean(busy)} onClick={() => guard('brew', () => window.pm3.fw.installClient().then(() => {}))}>
              🍺 Instalar client Iceman (Homebrew, macOS)
            </button>
            <span className="hint">Solo si `pm3` no está instalado. Compila --HEAD: tarda bastante.</span>
          </div>

          {tooBig && (
            <div className="planb">
              <h4>Plan B — bootloader viejo (256K)</h4>
              <div className="step">
                <button disabled={Boolean(busy)} onClick={compile}>
                  🔨 Compilar firmware recortado (HF-only)
                </button>
                {built && (
                  <span className="hint">
                    bootrom: {built.bootrom ? '✔' : '✘'} · fullimage: {built.fullimage ? '✔' : '✘'}
                  </span>
                )}
              </div>

              <div className="step bootloader-instructions">
                <strong>Modo bootloader:</strong>
                <ol>
                  <li>Desconecta el USB del Proxmark.</li>
                  <li>Mantén pulsado el botón de la placa.</li>
                  <li>Sin soltarlo, conecta el USB. Espera ~10 s y suelta (LEDs fijos = bootloader).</li>
                </ol>
                <button className="small" disabled={Boolean(busy)} onClick={() => guard('puertos', detectPort)}>
                  🔎 Detectar puerto (pm3 --list)
                </button>
                <label>
                  Puerto:
                  <input value={port} onChange={(e) => setPort(e.target.value)} />
                </label>
              </div>

              <div className="step">
                <button disabled={Boolean(busy)} onClick={flashBootrom}>
                  🧱 Flashear bootrom (--unlock-bootloader)
                </button>
              </div>

              <div className="step">
                <button disabled={Boolean(busy)} onClick={flashTrimmed}>
                  📦 Flashear firmware recortado
                </button>
                <span className="hint">Tras esto el equipo ya arranca Iceman; el puerto puede renumerarse.</span>
              </div>

              <div className="step">
                <button disabled={Boolean(busy)} onClick={flashFull}>
                  ⚡ Re-flashear firmware completo (512K)
                </button>
              </div>
            </div>
          )}

          <div className="step">
            <button disabled={Boolean(busy)} onClick={verify}>
              ✅ Verificar (hw version)
            </button>
          </div>
        </div>

        <div className="modal-foot">{busy ? `⏳ ${busy}…` : '○ listo'}</div>
      </div>
    </div>
  )
}
