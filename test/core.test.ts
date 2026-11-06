import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBrief, toBaseline } from '../src/core/brief.ts'
import { VersionMismatchError } from '../src/core/types.ts'
import type { Current } from '../src/core/types.ts'
import { normalizeAll, normalizeTicket } from '../src/adapter/normalize.ts'
import { fixtureGet, readCurrent } from '../src/adapter/client.ts'
import { Store } from '../src/store/store.ts'
import { render } from '../src/render/render.ts'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'contract')
const T0 = '2026-11-04T05:00:00.000Z'
const T1 = '2026-11-04T08:20:00.000Z'

type Raw = Record<string, unknown>
const row = (id: string, o: Raw = {}): Raw => ({ id, title: `title ${id}`, state: 'open', stage: 'working', assignments: 1, createdAt: '2026-11-04T01:00:00.000Z', threads: [], ...o })
const ask = (id: string, att: string): Raw => row(id, { stage: 'person', action: 'answer', attention: { id: att, question: 'q?' } })
const end = (id: string, outcome: string, at: string): Raw => row(id, { state: 'ended', stage: 'ended', ended: { at, outcome } })
const cur = (tickets: Raw[], o: { problems?: Raw[]; decisions?: Raw[]; at?: string } = {}): Current =>
  normalizeAll({ overview: { problems: o.problems ?? [] }, tickets, decisions: o.decisions ?? [], now: new Date(o.at ?? T1) })
const base = (tickets: Raw[], problems: Raw[] = []) => toBaseline(cur(tickets, { problems, at: T0 }))
const ids = (items: { ticket: { id: string } }[]) => items.map((i) => i.ticket.id)

test('new ticket entering person stage is "needs you"', () => {
  const b = buildBrief(cur([ask('A', 'a1')]), base([]))
  assert.deepEqual(ids(b.needsYou), ['A'])
})

test('same question still waiting goes to "still pending"', () => {
  const b = buildBrief(cur([ask('A', 'a1')]), base([ask('A', 'a1')]))
  assert.deepEqual(ids(b.stillPending), ['A'])
  assert.equal(b.needsYou.length, 0)
})

test('a new question (attention.id changed) counts as new', () => {
  const b = buildBrief(cur([ask('A', 'a2')]), base([ask('A', 'a1')]))
  assert.deepEqual(ids(b.needsYou), ['A'])
})

test('progress text or updatedAt changing alone shows nothing', () => {
  const before = base([row('A', { summary: 'x', updatedAt: '2026-11-04T02:00:00.000Z' })])
  const b = buildBrief(cur([row('A', { summary: 'y', updatedAt: '2026-11-04T07:00:00.000Z' })]), before)
  assert.equal(b.needsYou.length + b.stillPending.length + b.ended.length + b.running.opened + b.running.reopened, 0)
  assert.equal(b.id, buildBrief(cur([row('A')]), before).id)
})

test('re-execution is reported as a confirmable fact', () => {
  const b = buildBrief(cur([row('A', { stage: 'person', action: 'review', assignments: 3 })]), base([row('A', { assignments: 1 })]))
  assert.deepEqual(b.needsYou[0].notes, ['期间重新执行 2 次'])
})

test('opened and ended during the window', () => {
  const b = buildBrief(cur([end('A', 'completed', '2026-11-04T07:00:00.000Z')]), base([]))
  assert.deepEqual(b.ended.map((g) => g.outcome), ['completed'])
  assert.deepEqual(b.ended[0].items[0].notes, ['新开并已结束'])
})

test('long-ended ticket unknown to the baseline is not reported', () => {
  const b = buildBrief(cur([end('A', 'merged', '2026-11-01T00:00:00.000Z')]), base([]))
  assert.equal(b.ended.length, 0)
})

test('ended ticket reopened', () => {
  const b = buildBrief(cur([row('A')]), base([end('A', 'merged', '2026-11-03T00:00:00.000Z')]))
  assert.equal(b.running.reopened, 1)
  const p = buildBrief(cur([ask('A', 'a1')]), base([end('A', 'merged', '2026-11-03T00:00:00.000Z')]))
  assert.deepEqual(p.needsYou[0].notes, ['被重新打开'])
})

test('first run lists only person-stage tickets and says recording starts now', () => {
  const b = buildBrief(cur([ask('A', 'a1'), row('B'), end('C', 'merged', T0)]), null)
  assert.equal(b.firstRun, true)
  assert.deepEqual(ids(b.needsYou), ['A'])
  assert.equal(b.running.opened + b.ended.length, 0)
  assert.match(render(b), /从现在开始记录/)
})

test('problems: new ones listed, vanished ones counted, keyed without text', () => {
  const p1 = { kind: 'source-error', source: 'github', detail: 'old text' }
  const p2 = { kind: 'outgoing', outgoing: { id: 'o1' }, detail: 'x' }
  const b = buildBrief(cur([], { problems: [{ ...p1, detail: 'new text' }, p2] }), base([], [p1, { kind: 'no-allowed' }]))
  assert.deepEqual(b.newProblems.map((p) => p.kind), ['outgoing'])
  assert.equal(b.recoveredProblems, 1)
})

test('decisions are counted only after the baseline time', () => {
  const d = (at: string, outcome: string) => ({ at, outcome, kind: outcome })
  const b = buildBrief(cur([], { decisions: [d(T1, 'accept'), d('2026-11-04T06:00:00.000Z', 'ignore'), d('2026-11-04T01:00:00.000Z', 'accept')] }), base([]))
  assert.deepEqual(b.decisions, { accepted: 1, ignored: 1, unfinished: 0 })
})

test('ack stores the shown brief, so later changes still show as new', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'catchup-'))
  const store = new Store(dir)
  let { state } = await store.load()
  const shown = buildBrief(cur([ask('A', 'a1')]), state.baseline)
  await store.remember(state, shown)
  ;({ state } = await store.load())
  assert.equal(state.baseline, null, 'showing must not advance the baseline')
  await store.ack(state) // no arg: latest shown
  ;({ state } = await store.load())
  // B appears only after the brief was shown but before the next run.
  const next = buildBrief(cur([ask('A', 'a1'), ask('B', 'b1')]), state.baseline)
  assert.deepEqual(ids(next.stillPending), ['A'])
  assert.deepEqual(ids(next.needsYou), ['B'])
  await assert.rejects(store.ack(state, 'nope'), /找不到简报/)
})

test('corrupt progress file is backed up and treated as first use', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'catchup-'))
  const store = new Store(dir)
  await writeFile(store.file, '{not json')
  const { state, recovered } = await store.load()
  assert.equal(recovered, true)
  assert.equal(state.baseline, null)
  assert.ok((await readdir(dir)).some((f) => f.startsWith('state.json.corrupt-')))
  assert.equal(await readFile(path.join(dir, (await readdir(dir)).find((f) => f.includes('corrupt'))!), 'utf8'), '{not json')
})

test('missing upstream fields are reported as a version mismatch', () => {
  assert.throws(() => normalizeTicket({ id: 'A', title: 't', assignments: 1 }), VersionMismatchError)
  assert.throws(() => normalizeTicket(row('A', { stage: 'weird' })), VersionMismatchError)
  assert.throws(() => normalizeTicket(row('A', { stage: 'ended' })), VersionMismatchError)
  assert.throws(() => normalizeAll({ overview: {}, tickets: [], decisions: [] }), /8c32a9d/)
})

test('contract fixtures: before -> after', async () => {
  const before = await readCurrent(fixtureGet(path.join(FIX, '8c32a9d-before')), { now: new Date(T0) })
  const after = await readCurrent(fixtureGet(path.join(FIX, '8c32a9d-after')), { now: new Date(T1) })
  const b = buildBrief(after, toBaseline(before))
  assert.deepEqual(ids(b.needsYou).sort(), ['T2', 'T7'])
  assert.deepEqual(ids(b.stillPending), ['T1'])
  assert.deepEqual(b.ended.map((g) => [g.outcome, ids(g.items)]).sort(), [['completed', ['T5']], ['merged', ['T3']]])
  assert.deepEqual(b.running, { opened: 1, reopened: 0 })
  assert.deepEqual(b.decisions, { accepted: 3, ignored: 1, unfinished: 0 })
  assert.equal(b.newProblems.length, 0)
  // acknowledging that brief leaves nothing new next time
  const again = buildBrief(after, b.snapshot)
  assert.equal(again.needsYou.length, 0)
})
