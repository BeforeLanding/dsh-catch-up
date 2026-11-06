// DSH plugin: /catchup and /catchup ack [briefId] (design section 8).
// Install it in the *same profile as Super-agent*: webServer.port is then Super-agent's own port (design 15.2).
// Commands run directly, never through the model. Only GETs are sent to the panel.
import { ack, show } from '../app.ts'

export const name = 'dsh-catch-up'
export const inject = ['webServer', 'commands']

interface Ctx {
  webServer: { port: number }
  commands: { register(def: unknown): void }
  logger: { info(msg: string, ...a: unknown[]): void }
}
interface Invocation { rawInput?: string }
type Reply = { kind: 'success' | 'error'; text: string }

export async function run(rawInput: string, panelUrl: string, home?: string): Promise<Reply> {
  const [sub, arg, ...extra] = rawInput.trim().split(/\s+/).filter(Boolean)
  try {
    if (sub === undefined) {
      const r = await show({ panelUrl, markdown: true, home })
      return { kind: 'success', text: [...r.warnings, r.text].join('\n\n') }
    }
    if (sub === 'ack' && extra.length === 0) {
      const r = await ack({ panelUrl, home }, arg)
      return { kind: 'success', text: r.text }
    }
    return { kind: 'error', text: '用法：/catchup 或 /catchup ack [briefId]' }
  } catch (e) {
    return { kind: 'error', text: e instanceof Error ? e.message : String(e) }
  }
}

export function apply(ctx: Ctx): void {
  ctx.commands.register({
    name: 'catchup',
    description: '离开期间 Super-agent 的新进展（只读，不调用模型）',
    input: { hint: '[ack [briefId]]' },
    // The user's command is its own record; no need to duplicate payload in the session log.
    handler: ({ rawInput }: Invocation) => run(rawInput ?? '', `http://127.0.0.1:${ctx.webServer.port}`),
  })
  ctx.logger.info('catch-up applied; panel port %s', ctx.webServer.port)
}
