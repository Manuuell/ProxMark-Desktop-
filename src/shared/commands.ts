// Esquemas tipados para los comandos principales.
// Los comandos sin esquema usan el campo de argumentos libre.

export interface ParamDef {
  label: string
  kind: 'flag' | 'text' | 'select'
  flag: string
  options?: string[]
  placeholder?: string
}

export interface CommandSpec {
  params: ParamDef[]
  note?: string
}

export const DUMP_DIR = '~/Documents/mifare'

const SIZE_OPTIONS = ['--1k', '--2k', '--4k', '--mini']

export const COMMAND_SCHEMAS: Record<string, CommandSpec> = {
  'hf search': {
    params: [],
    note: 'Detecta y reporta la etiqueta presente en la antena.'
  },
  'hf 14a reader': {
    params: [],
    note: 'Lee el UID, ATQA y SAK de la tarjeta ISO14443-A.'
  },
  'hf mf info': {
    params: [],
    note: 'Info de la tarjeta MIFARE: firma, claves por defecto, detección de magic.'
  },
  'hf mf chk': {
    params: [
      { label: 'Tamaño', kind: 'select', flag: 'size', options: SIZE_OPTIONS },
      { label: 'Claves (-k)', kind: 'text', flag: '-k', placeholder: 'FFFFFFFFFFFF A75102F8BC34 …' },
      { label: 'Diccionario (-f)', kind: 'text', flag: '-f', placeholder: 'ruta/al/diccionario.dic' },
      { label: 'Guardar key file', kind: 'flag', flag: '--dump' }
    ],
    note: 'Prueba claves contra todos los sectores. Varias -k se separan por espacio.'
  },
  'hf mf fchk': {
    params: [
      { label: 'Tamaño', kind: 'select', flag: 'size', options: SIZE_OPTIONS },
      { label: 'Diccionario (-f)', kind: 'text', flag: '-f', placeholder: 'ruta/al/diccionario.dic' }
    ]
  },
  'hf mf dump': {
    params: [
      { label: 'Tamaño', kind: 'select', flag: 'size', options: SIZE_OPTIONS },
      { label: 'Archivo (-f)', kind: 'text', flag: '-f', placeholder: 'ruta/dump.json (opcional)' },
      { label: 'No guardar (--ns)', kind: 'flag', flag: '--ns' },
      { label: 'Verbose (-v)', kind: 'flag', flag: '-v' }
    ],
    note: 'Vuelca la tarjeta a .bin/.json. Sin -f usa el UID como nombre.'
  },
  'hf mf rdbl': {
    params: [
      { label: 'Bloque (--blk)', kind: 'text', flag: '--blk', placeholder: '0..63' },
      { label: 'Clave (Key A)', kind: 'flag', flag: '-a' },
      { label: 'Clave (Key B)', kind: 'flag', flag: '-b' },
      { label: 'Clave (-k)', kind: 'text', flag: '-k', placeholder: 'FFFFFFFFFFFF' }
    ]
  },
  'hf mf wrbl': {
    params: [
      { label: 'Bloque (--blk)', kind: 'text', flag: '--blk', placeholder: '0..63' },
      { label: 'Clave (Key A)', kind: 'flag', flag: '-a' },
      { label: 'Clave (Key B)', kind: 'flag', flag: '-b' },
      { label: 'Clave (-k)', kind: 'text', flag: '-k', placeholder: 'FFFFFFFFFFFF' },
      { label: 'Datos (-d)', kind: 'text', flag: '-d', placeholder: '32 hex chars' }
    ]
  },
  'hf mf autopwn': {
    params: [],
    note: 'Recuperación automática de claves MIFARE Classic.'
  },
  'hf mf hardnested': {
    params: [
      { label: 'Bloque apoyo (--blk)', kind: 'text', flag: '--blk', placeholder: '0' },
      { label: 'Clave apoyo (Key A)', kind: 'flag', flag: '-a' },
      { label: 'Clave apoyo (-k)', kind: 'text', flag: '-k', placeholder: 'FFFFFFFFFFFF' },
      { label: 'Bloque objetivo (--tblk)', kind: 'text', flag: '--tblk', placeholder: '8' },
      { label: 'Objetivo Key A', kind: 'flag', flag: '--ta' },
      { label: 'Objetivo Key B', kind: 'flag', flag: '--tb' }
    ],
    note: 'Ataque a tarjetas con PRNG endurecido.'
  },
  'hf 14a sniff': {
    params: [
      { label: 'Disparo por tarjeta (-c)', kind: 'flag', flag: '-c' },
      { label: 'Disparo por lector (-r)', kind: 'flag', flag: '-r' },
      { label: 'Interactivo (-i)', kind: 'flag', flag: '-i' }
    ],
    note: 'Captura la comunicación lector↔tarjeta. Detener con el botón del PM3 o Cancelar.'
  },
  'hf list 14a': {
    params: [
      { label: 'Marcar CRC (-c)', kind: 'flag', flag: '-c' },
      { label: 'Tiempos entre tramas (--frame)', kind: 'flag', flag: '--frame' }
    ],
    note: 'Muestra el tráfico capturado por el sniff.'
  },
  'hf mf csetuid': {
    params: [
      { label: 'UID (-u)', kind: 'text', flag: '-u', placeholder: '9ABC9957' }
    ],
    note: 'Solo tarjetas mágicas Gen1a/Gen2.'
  },
  'hf mf cload': {
    params: [
      { label: 'Archivo (-f)', kind: 'text', flag: '-f', placeholder: 'ruta/dump.eml o .bin' }
    ],
    note: 'Carga un dump a una tarjeta mágica.'
  },
  'hf mf cwipe': {
    params: [],
    note: 'Borra la tarjeta mágica a estado de fábrica.'
  },
  'hw version': { params: [] },
  'hw status': { params: [] },
  'hw tune': { params: [] },
  'lf search': { params: [] },
  'lf read': { params: [] }
}

export function specFor(path: string): CommandSpec | undefined {
  return COMMAND_SCHEMAS[path]
}

// Arma la línea de comando a partir de los valores del formulario.
export function buildCommand(path: string, spec: CommandSpec, values: Record<string, string | boolean>): string {
  const parts = [path]
  for (const p of spec.params) {
    const v = values[p.flag]
    if (p.kind === 'flag') {
      if (v) parts.push(p.flag)
    } else if (p.kind === 'select') {
      if (typeof v === 'string' && v) parts.push(v)
    } else {
      const t = typeof v === 'string' ? v.trim() : ''
      if (t) {
        for (const piece of t.split(/\s+/)) parts.push(p.flag, piece)
      }
    }
  }
  return parts.join(' ')
}
