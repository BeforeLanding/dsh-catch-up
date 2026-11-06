// Field validation + reduction of raw panel API responses into core types.
// Anything unexpected throws VersionMismatchError: no guessing, no half results (design section 3).
import { createHash } from 'node:crypto'
import { VersionMismatchError } from '../core/types.ts'
import type { Current, DecisionView, ProblemView, Stage, TicketView } from '../core/types.ts'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function str(o: Obj, key: string, where: string): string {
  if (typeof o[key] !== 'string') throw new VersionMismatchError(`${where}.${key} 缺失或不是字符串`)
  return o[key] as string
}
function arr(o: Obj, key: string, where: string): unknown[] {
  if (!Array.isArray(o[key])) throw new VersionMismatchError(`${where}.${key} 缺失或不是数组`)
  return o[key] as unknown[]
}
function row(v: unknown, where: string): Obj {
  if (!isObj(v)) throw new VersionMismatchError(`${where} 不是对象`)
  return v
}

const STAGES: readonly string[] = ['person', 'working', 'idle', 'ended']

export function fingerprint(parts: { stage: string; action: string; attentionId?: string; outcome?: string; deliveryError: boolean }): string {
  return createHash('sha1')
    .update(JSON.stringify([parts.stage, parts.action, parts.attentionId ?? null, parts.outcome ?? null, parts.deliveryError]))
    .digest('hex')
    .slice(0, 12)
}

export function normalizeTicket(raw: unknown): TicketView {
  const t = row(raw, 'ticket')
  const id = str(t, 'id', 'ticket')
  const where = `ticket ${id}`
  const stage = str(t, 'stage', where)
  if (!STAGES.includes(stage)) throw new VersionMismatchError(`${where}.stage 出现未知值 ${stage}`)
  if (typeof t.assignments !== 'number') throw new VersionMismatchError(`${where}.assignments 缺失`)
  const action = typeof t.action === 'string' ? t.action : ''
  const attention = isObj(t.attention) ? t.attention : undefined
  const ended = isObj(t.ended) ? t.ended : undefined
  if (stage === 'ended' && !ended) throw new VersionMismatchError(`${where}.ended 缺失`)
  const attentionId = attention && typeof attention.id === 'string' ? attention.id : undefined
  const outcome = ended && typeof ended.outcome === 'string' ? ended.outcome : undefined
  const threads = Array.isArray(t.threads) ? t.threads.filter(isObj) : []
  const reply = isObj(t.reply) ? t.reply : undefined
  const label = reply && isObj(reply.label) && typeof reply.label.zh === 'string' ? reply.label.zh : undefined
  const url = (typeof threads[0]?.url === 'string' ? threads[0].url : undefined) ?? (reply && typeof reply.url === 'string' ? reply.url : undefined)
  const noteObj = isObj(t.note) ? t.note : undefined
  return {
    id,
    title: str(t, 'title', where),
    stage: stage as Stage,
    action,
    fp: fingerprint({ stage, action, attentionId, outcome, deliveryError: Boolean(t.deliveryError) }),
    assignments: t.assignments,
    attentionId,
    question: attention && typeof attention.question === 'string' ? attention.question : undefined,
    note: noteObj && typeof noteObj.text === 'string' ? noteObj.text : undefined,
    outcome,
    endedAt: ended && typeof ended.at === 'string' ? ended.at : undefined,
    createdAt: typeof t.createdAt === 'string' ? t.createdAt : '',
    url,
    replyLabel: label,
  }
}

/** Problems are keyed by kind plus whatever identifies the object (design section 4.4); text is ignored. */
export function normalizeProblem(raw: unknown): ProblemView {
  const p = row(raw, 'problem')
  const kind = str(p, 'kind', 'problem')
  const ident: string[] = [kind]
  for (const k of ['place', 'code', 'source', 'part', 'decisionId']) if (typeof p[k] === 'string') ident.push(`${k}=${p[k]}`)
  if (isObj(p.outgoing) && typeof p.outgoing.id === 'string') ident.push(`outgoing=${p.outgoing.id}`)
  const detail = typeof p.detail === 'string' ? p.detail : kind
  return { key: ident.join('|'), kind, detail }
}

export function normalizeDecision(raw: unknown): DecisionView {
  const d = row(raw, 'decision')
  return { at: str(d, 'at', 'decision'), outcome: typeof d.outcome === 'string' ? d.outcome : str(d, 'kind', 'decision') }
}

export function normalizeAll(input: { overview: unknown; tickets: unknown[]; decisions: unknown[]; now?: Date }): Current {
  const overview = row(input.overview, 'overview')
  return {
    at: (input.now ?? new Date()).toISOString(),
    problems: arr(overview, 'problems', 'overview').map(normalizeProblem),
    tickets: input.tickets.map(normalizeTicket),
    decisions: input.decisions.map(normalizeDecision),
  }
}
