import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

// Ruta del client pm3 (Iceman). Sobrescribible con la variable PM3_BIN.
export const PM3_BIN = process.env.PM3_BIN || '/opt/homebrew/bin/pm3'

interface Job {
  cmd: string
  cwd: string
  onLine: (line: string) => void
  resolve: (code: number | null) => void
}

/**
 * Ejecuta comandos pm3 de a uno (el dispositivo es un solo hilo de hardware)
 * y emite las líneas de salida en vivo.
 */
export class Pm3Runner extends EventEmitter {
  private queue: Job[] = []
  private busy = false
  private child: ReturnType<typeof spawn> | null = null

  get isBusy(): boolean {
    return this.busy
  }

  run(cmd: string, onLine: (line: string) => void, cwd?: string): Promise<number | null> {
    return new Promise((resolve) => {
      this.queue.push({ cmd, cwd: cwd ?? process.cwd(), onLine, resolve })
      this.pump()
    })
  }

  /** Mata el comando en curso (útil para sniff interactivo). */
  cancel(): void {
    if (this.child) this.child.kill('SIGTERM')
  }

  private pump(): void {
    if (this.busy || this.queue.length === 0) return
    this.busy = true
    this.emit('busy', true)
    const job = this.queue.shift() as Job
    const child = spawn(PM3_BIN, ['-c', job.cmd], { cwd: job.cwd })
    this.child = child

    let buf = ''
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const l of lines) job.onLine(l)
    })
    child.stderr.on('data', (d: Buffer) => job.onLine(d.toString()))

    child.on('close', (code) => {
      if (buf) job.onLine(buf)
      this.child = null
      this.busy = false
      this.emit('busy', false)
      job.resolve(code)
      this.pump()
    })
    child.on('error', (err) => {
      job.onLine(`ERROR: ${err.message}`)
      this.child = null
      this.busy = false
      this.emit('busy', false)
      job.resolve(null)
      this.pump()
    })
  }
}
