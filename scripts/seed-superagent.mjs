// Dev-only: writes synthetic Tickets, Threads, Triggers and Decisions into an ISOLATED Super-agent database so the real
// panel server (upstream 8c32a9d) projects them into API responses we can record as contract fixtures.
// Never point this at a real deployment. Stop the instance before running it.
//
//   node scripts/seed-superagent.mjs <path/to/orchestrator.sqlite> before|after
//
// "before" is the state when the operator last read the brief; "after" is the state when they come back.
// All data is sample data: repository example/widgets, people alice/bob.
import { DatabaseSync } from 'node:sqlite'

const [dbPath, phase] = process.argv.slice(2)
if (!dbPath || !['before', 'after'].includes(phase)) {
  console.error('usage: node scripts/seed-superagent.mjs <orchestrator.sqlite> before|after')
  process.exit(2)
}

const REPO = 'example/widgets'
const POLICY = '9fbbf9a0cf77f5da1785bc7d03d13b0b'
const now = Date.now()
const ago = minutes => new Date(now - minutes * 60_000).toISOString()

const db = new DatabaseSync(dbPath)
const put = (table, id, value, extra = []) =>
  db.prepare(`INSERT INTO ${table} VALUES (${['?', ...extra.map(() => '?'), '?'].join(',')}) ON CONFLICT(${table === 'thread' ? 'key' : 'id'}) DO UPDATE SET value=excluded.value`)
    .run(id, ...extra, JSON.stringify(value))

function thread(number, { pr = false, title, tickets }) {
  const key = `github:${number}`
  const url = `https://github.com/${REPO}/${pr ? 'pull' : 'issues'}/${number}`
  put('thread', key, { key, ref: { source: 'github', id: String(number) }, createdAt: ago(600), lastAt: ago(5),
    subscriptions: tickets, correlated: [], pending: [], meta: { url, label: title, facts: { number: { value: `#${number}` } } } })
  return { key, url, number }
}
function trigger(id, t, { actor = 'alice', text, at }) {
  const value = { id, source: 'github', threads: [{ source: 'github', id: String(t.number) }], actor: { source: 'github', id: actor },
    human: true, addressed: 'mention', at, text, url: `${t.url}#issuecomment-${id}`,
    channel: { source: 'github', thread: t.key, address: { number: String(t.number), url: t.url } },
    meta: { number: t.number, isPr: false, kind: 'comment' } }
  db.prepare('INSERT INTO trigger VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value, at=excluded.at').run(id, JSON.stringify(value), at)
  db.prepare('INSERT OR IGNORE INTO trigger_thread VALUES (?,?,?,?)').run(t.key, id, at, 1)
  return value
}
const mandate = actor => ({ strength: 'explicit', policyVersion: POLICY, basis: { via: 'addressed', addressed: 'mention', sender: actor },
  actor: { source: 'github', id: actor }, scope: 'What the request asks for' })
function decision(id, t, trig, { kind = 'accept', ticketId, at }) {
  const value = { id, evalId: `eval-${id}`, threadKey: t.key, triggerIds: [trig.id], policyVersion: POLICY, at, kind,
    reason: [{ code: 'said', values: { text: kind === 'accept' ? 'An allowed person asked for this work.' : 'Not a request for work.' } }],
    strength: 'explicit', ...(ticketId ? { ticketId, mandate: mandate(trig.actor.id) } : {}) }
  put('decision', id, value, [t.key])
}
const assignment = (id, { state, created, report }) => ({ id, state, createdAt: created, ...(state !== 'pending' ? { startedAt: created } : {}),
  ...(state === 'ended' ? { endedAt: report?.at ?? created, endedReason: 'reported' } : {}), ...(report ? { report } : {}) })
function ticket(id, t, trig, { title, created, updated, assignments = [], attention, ended }) {
  put('ticket', id, { id, title, decisionId: `d-${id}`, mandate: mandate(trig.actor.id), channels: [trig.channel],
    ...(ended ? { ended } : {}), ...(attention ? { attention } : {}), assignments, inputs: [], undelivered: [],
    createdAt: created, updatedAt: updated, origin: { triggerId: trig.id, triggerIds: [trig.id] } })
  decision(`d-${id}`, t, trig, { ticketId: id, at: created })
}

// --- Threads, shared by both phases --------------------------------------------------------------------------------------
const t12 = thread(12, { title: '登录接口偶发超时', tickets: ['T1'] })
const t15 = thread(15, { title: '升级 lodash 到 4.17.21', tickets: ['T2'] })
const t18 = thread(18, { pr: true, title: 'README 拼写修正', tickets: ['T3'] })
const t9 = thread(9, { pr: true, title: 'CI 缓存 key 不随锁文件变化', tickets: ['T4'] })
const g12 = trigger('9001', t12, { text: '@widgets-bot 登录接口偶发超时，帮忙查一下', at: ago(300) })
const g15 = trigger('9002', t15, { actor: 'bob', text: '@widgets-bot 把 lodash 升到 4.17.21', at: ago(240) })
const g18 = trigger('9003', t18, { text: '@widgets-bot README 里有几处拼写错误', at: ago(200) })
const g9 = trigger('9004', t9, { actor: 'bob', text: '@widgets-bot CI 缓存不生效', at: ago(900) })

const q1 = { id: 'att-1', question: '超时阈值要从 5 秒改成 10 秒，还是先加重试？', triggerId: g12.id }
ticket('T1', t12, g12, { title: '登录接口偶发超时', created: ago(300), updated: ago(150), attention: q1,
  assignments: [assignment('A1', { state: 'running', created: ago(295), report: { state: 'waiting', summary: '已复现，需要确认处理方式', at: ago(150) } })] })
ticket('T4', t9, g9, { title: 'CI 缓存 key 不随锁文件变化', created: ago(900), updated: ago(700),
  ended: { at: ago(700), by: 'executor', outcome: 'merged' },
  assignments: [assignment('A4', { state: 'ended', created: ago(890), report: { state: 'ready', summary: 'PR #10 已合并', at: ago(700) } })] })

if (phase === 'before') {
  ticket('T2', t15, g15, { title: '升级 lodash 到 4.17.21', created: ago(240), updated: ago(130),
    assignments: [assignment('A2', { state: 'running', created: ago(235), report: { state: 'progress', summary: '正在跑测试', at: ago(130) } })] })
  ticket('T3', t18, g18, { title: 'README 拼写修正', created: ago(200), updated: ago(125),
    assignments: [assignment('A3', { state: 'running', created: ago(195), report: { state: 'ready', summary: 'PR #18 待审', at: ago(125) } })] })
} else {
  // T2 failed once, was retried, and is now ready for review.
  ticket('T2', t15, g15, { title: '升级 lodash 到 4.17.21', created: ago(240), updated: ago(20),
    assignments: [
      assignment('A2', { state: 'ended', created: ago(235), report: { state: 'failed', summary: '测试超时', at: ago(90) } }),
      assignment('A2b', { state: 'running', created: ago(80), report: { state: 'ready', summary: 'PR #19 待审，测试全部通过', at: ago(20) } })] })
  // T3 was merged while away.
  ticket('T3', t18, g18, { title: 'README 拼写修正', created: ago(200), updated: ago(60), ended: { at: ago(60), by: 'executor', outcome: 'merged' },
    assignments: [assignment('A3', { state: 'ended', created: ago(195), report: { state: 'ready', summary: 'PR #18 已合并', at: ago(60) } })] })
  // New while away: one finished, one queued, one asking a question.
  const t21 = thread(21, { title: '日志里打印了 token', tickets: ['T5'] })
  const t22 = thread(22, { title: '补充 API 文档示例', tickets: ['T6'] })
  const t23 = thread(23, { title: '支持 Node 24', tickets: ['T7'] })
  const t24 = thread(24, { title: '这个项目还维护吗？', tickets: [] })
  const g21 = trigger('9005', t21, { actor: 'bob', text: '@widgets-bot 日志里打印了 token，请去掉', at: ago(100) })
  const g22 = trigger('9006', t22, { text: '@widgets-bot 补充 API 文档示例', at: ago(40) })
  const g23 = trigger('9007', t23, { actor: 'bob', text: '@widgets-bot 支持一下 Node 24', at: ago(70) })
  const g24 = trigger('9008', t24, { actor: 'carol', text: '这个项目还维护吗？', at: ago(50) })
  ticket('T5', t21, g21, { title: '日志里打印了 token', created: ago(100), updated: ago(45), ended: { at: ago(45), by: 'executor', outcome: 'completed' },
    assignments: [assignment('A5', { state: 'ended', created: ago(98), report: { state: 'ready', summary: '已移除 token 输出并补了测试', at: ago(45) } })] })
  ticket('T6', t22, g22, { title: '补充 API 文档示例', created: ago(40), updated: ago(40),
    assignments: [assignment('A6', { state: 'pending', created: ago(40) })] })
  ticket('T7', t23, g23, { title: '支持 Node 24', created: ago(70), updated: ago(30),
    attention: { id: 'att-2', question: 'Node 18 还要继续支持吗？两种方案的兼容范围不同。', triggerId: g23.id },
    assignments: [assignment('A7', { state: 'running', created: ago(68), report: { state: 'waiting', summary: '需要确认支持范围', at: ago(30) } })] })
  decision('d-ignore-24', t24, g24, { kind: 'ignore', at: ago(49) })
}
db.close()
console.log(`seeded phase "${phase}" into ${dbPath}`)
