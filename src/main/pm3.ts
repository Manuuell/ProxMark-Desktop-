import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

// Ruta del client pm3 (Iceman). Sobrescribible con la variable PM3_BIN.
export const PM3_BIN = process.env.PM3_BIN || '/opt/homebrew/bin/pm3'

interface Job {
  bin: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  onLine: (line: string) => void
  resolve: (code: number | null) => void
}

/**
 * Ejecuta comandos de a uno (el dispositivo es un solo hilo de hardware)
 * y emite las líneas de salida en vivo.
 */
export class Pm3Runner extends EventEmitter {
  private queue: Job[] = []
  private busy = false
  private child: ReturnType<typeof spawn> | null = null

  get isBusy(): boolean {
    return this.busy
  }

  /** Ejecuta un comando del client pm3: `pm3 -c "<cmd>"`. */
  run(cmd: string, onLine: (line: string) => void, cwd?: string): Promise<number | null> {
    return this.enqueue(PM3_BIN, ['-c', cmd], cwd, undefined, onLine)
  }

  /** Ejecuta un binario arbitrario con argumentos (pm3-flash-all, proxmark3, brew...). */
  runBinary(
    bin: string,
    args: string[],
    onLine: (line: string) => void,
    cwd?: string,
    env?: NodeJS.ProcessEnv
  ): Promise<number | null> {
    return this.enqueue(bin, args, cwd, env, onLine)
  }

  /** Mata el comando en curso (útil para sniff interactivo). */
  cancel(): void {
    if (this.child) this.child.kill('SIGTERM')
  }

  private enqueue(
    bin: string,
    args: string[],
    cwd: string | undefined,
    env: NodeJS.ProcessEnv | undefined,
    onLine: (line: string) => void
  ): Promise<number | null> {
    return new Promise((resolve) => {
      this.queue.push({ bin, args, cwd: cwd ?? process.cwd(), env, onLine, resolve })
      this.pump()
    })
  }

  private pump(): void {
    if (this.busy || this.queue.length === 0) return
    this.busy = true
    this.emit('busy', true)
    const job = this.queue.shift() as Job
    const child = spawn(job.bin, job.args, { cwd: job.cwd, env: job.env })
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
