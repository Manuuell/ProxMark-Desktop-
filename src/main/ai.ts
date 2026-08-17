import { Pm3Runner } from './pm3'
import { parseHelp } from '../shared/catalog'
import { AI_PROVIDERS, type AiSettings, type ChatInputMsg, type ChatOutputMsg } from '../shared/ai'

export type { AiSettings, ChatInputMsg, ChatOutputMsg } from '../shared/ai'

// Cliente multi-proveedor (DeepSeek/OpenAI/Ollama, todos con API compatible con OpenAI)
// + agente con herramientas pm3.

const DEFAULT_MODEL = 'deepseek-chat'
const MAX_ITERATIONS = 12
const MAX_TOOL_OUTPUT = 6000

export type ToolMsg = Extract<ChatOutputMsg, { kind: 'tool' }>

const SYSTEM_PROMPT = `Eres "Proxmark Assistant", el asistente IA de ProxMark Desktop, una app de
escritorio que controla un Proxmark3 (client Iceman) ya conectado por USB.
Ayudas al usuario a operar el dispositivo con lenguaje natural.

Para actuar usa SOLO las herramientas:
- pm3_run: ejecuta un comando pm3 y devuelve su salida.
- pm3_catalog: lista los subcomandos disponibles para una ruta ('' = raíz).

Pautas generales:
- Antes de ejecutar un comando, explica en UNA línea qué harás.
- Si un comando falla o no se detecta tarjeta, diagnostica con "hw version",
  "hw status" o "hf search" y sugiere el siguiente paso.
- Reporta claves y datos EXACTAMENTE como los devuelven las herramientas
  (12 hex chars para claves MIFARE); no los inventes ni los acortes.
- No concluyas "no se puede" hasta haber agotado la secuencia de ataques
  disponible para la tarea.

PLAYBOOK OBLIGATORIO cuando el usuario pida descubrir/recuperar claves de los
sectores (no te detengas en el primer chequeo; ejecuta TODO en orden y solo
entonces reporta):
1. "hf mf info" -> identifica tipo, PRNG (weak/hard) y claves por defecto.
2. "hf mf chk --1k --dump" -> claves hardcodeadas + default.
3. Diccionario ampliado con claves comunes del sistema:
   hf mf chk --1k --dump -k FFFFFFFFFFFF -k A75102F8BC34 -k 881F0E5883F6 -k 7110B1923D5A -k C72991CA1DF9 -k 2F879CA8E6F7 -k 3CABAA3B1B20 -k 000000000000
4. "hf mf autopwn" -> intenta darkside + nested automático. Puede tardar
   minutos; avisa al usuario y deja la tarjeta en el lector.
5. Si quedan sectores sin clave y el PRNG es hard, usa hardnested con el
   sector 0 como apoyo:
   hf mf hardnested --blk 0 -a -k FFFFFFFFFFFF --tblk <bloque_desconocido> --ta
   (repite por cada sector faltante; cada uno puede tardar varios minutos).
6. Al final, reporta una tabla sector por sector: claves encontradas (A/B),
   método que las encontró, y los sectores que siguen sin clave (si alguno)
   explicando que se agotaron los métodos. Ofrece continuar si el usuario
   dispone de más tiempo.

CASO ESPECIAL - MIFARE Plus (SL1):
Si "hf mf info" o "hf mfp info" indican MIFARE Plus (SAK 08 con ATS, SL1):
- autopwn se auto-limita y darkside/nested NO aplican (PRNG hard del chip Plus).
- Usa directamente "hf mf hardnested --blk 0 -a -k FFFFFFFFFFFF --tblk <bloque> --ta"
  para cada sector sin clave. Es lento (minutos por sector): avisa al usuario.
- Las claves AES de SL3 no son recuperables por estos métodos; dilo claramente.
- Recuperar solo Key A es un resultado válido: reporta y explica que las Key B
  restantes son la clave de recarga secreta del sistema.

Reglas de seguridad:
- Solo operar tarjetas que el usuario tiene físicamente o autoriza.
- NUNCA enumeres masivamente IDs ni barres rangos de tarjetas.
- Antes de cualquier ESCRITURA (wrbl, csetuid, cload, cwipe, gen3blk...)
  pide confirmación explícita y advierte del efecto irreversible.
- No ayudes a clonar tarjetas ajenas ni a fabricar saldo.
Responde en español y sé conciso.`

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'pm3_run',
      description: 'Ejecuta un comando del client pm3 (Iceman) en el Proxmark3 conectado y devuelve la salida. Ejemplos: "hf search", "hf mf info", "hf mf chk --1k -k FFFFFFFFFFFF --dump", "hf mf dump --1k".',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Comando pm3 completo con sus flags.' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'pm3_catalog',
      description: 'Lista los subcomandos disponibles de pm3 para una ruta. Ruta vacía para la raíz. Ejemplo: "hf mf".',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta del comando, ej. "hf" o "hf mf" o ""' }
        },
        required: ['path']
      }
    }
  }
]

function endpoint(settings: AiSettings): string {
  return settings.baseUrl || AI_PROVIDERS[settings.provider]?.baseUrl || AI_PROVIDERS.deepseek.baseUrl
}

async function chatCompletion(messages: unknown[], settings: AiSettings, withTools = true): Promise<unknown> {
  const url = endpoint(settings)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.model || DEFAULT_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: withTools ? 'auto' : 'none',
      temperature: 0.2
    })
  })
  if (!res.ok) {
    const err = (await res.text()).slice(0, 300)
    throw new Error(`La API respondió ${res.status}: ${err}`)
  }
  return res.json()
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  runner: Pm3Runner,
  hooks: { onLine?: (line: string) => void; onActivity?: (label: string) => void }
): Promise<ToolMsg> {
  if (name === 'pm3_run') {
    const command = String(args.command ?? '').trim()
    if (!command) return { kind: 'tool', tool: name, label: 'comando vacío', output: 'sin comando' }
    hooks.onActivity?.(`$ ${command}`)
    const lines: string[] = []
    const code = await runner.run(command, (l) => {
      lines.push(l)
      hooks.onLine?.(l)
    })
    const output = lines.join('\n').slice(-MAX_TOOL_OUTPUT)
    return {
      kind: 'tool',
      tool: name,
      label: command,
      output: output || `(sin salida, exit code ${code})`
    }
  }
  // pm3_catalog
  const path = String(args.path ?? '').trim()
  hooks.onActivity?.(`$ ${path ? `${path} ` : ''}help`)
  const lines: string[] = []
  await runner.run(path ? `${path} help` : 'help', (l) => {
    lines.push(l)
    hooks.onLine?.(l)
  })
  const entries = parseHelp(lines.join('\n'))
  const output = entries
    .map((e) => `${e.name}${e.isGroup ? '/' : ''} - ${e.description}`)
    .join('\n')
  return {
    kind: 'tool',
    tool: name,
    label: `${path || 'raíz'} help`,
    output: output || '(sin subcomandos)'
  }
}

/** Un turno de chat: el modelo puede ejecutar herramientas en loop. */
export async function chat(
  messages: ChatInputMsg[],
  settings: AiSettings,
  runner: Pm3Runner,
  hooks: { onLine?: (line: string) => void; onActivity?: (label: string) => void } = {}
): Promise<ChatOutputMsg[]> {
  const ctx: Record<string, unknown>[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages]
  const out: ChatOutputMsg[] = []

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const data = (await chatCompletion(ctx, settings)) as {
      error?: { message?: string }
      choices?: { message: { content?: string; tool_calls?: { id: string; function: { name: string; arguments?: string } }[] } }[]
    }
    if (data.error) throw new Error(data.error.message ?? 'Error de la API')
    const choice = data.choices?.[0]
    if (!choice) throw new Error('Respuesta vacía de la API')

    const msg = choice.message
    ctx.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls ?? [] })

    const calls = msg.tool_calls ?? []
    if (calls.length === 0) {
      if (msg.content) out.push({ kind: 'assistant', content: msg.content })
      return out
    }

    for (const c of calls) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(c.function.arguments ?? '{}')
      } catch {
        args = {}
      }
      let toolMsg: ToolMsg
      try {
        toolMsg = await runTool(c.function.name, args, runner, hooks)
      } catch (e) {
        toolMsg = {
          kind: 'tool',
          tool: c.function.name,
          label: 'error de ejecución',
          output: String(e)
        }
      }
      out.push(toolMsg)
      ctx.push({
        role: 'tool',
        tool_call_id: c.id,
        name: c.function.name,
        content: JSON.stringify({ label: toolMsg.label, output: toolMsg.output })
      })
    }
  }

  // Se agotaron las iteraciones: pedimos el resumen final sin más herramientas.
  try {
    const finalData = (await chatCompletion(ctx, settings, false)) as {
      choices?: { message: { content?: string } }[]
    }
    const content = finalData.choices?.[0]?.message?.content
    out.push({
      kind: 'assistant',
      content: content || 'Terminé los pasos; revisa los bloques de herramientas.'
    })
  } catch {
    out.push({
      kind: 'assistant',
      content: 'Terminé los pasos del análisis; revisa los bloques de herramientas.'
    })
  }
  return out
}
