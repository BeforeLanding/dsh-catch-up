// Pure logic: compare the current state with the last-acknowledged baseline (design sections 5-7).
import { createHash } from 'node:crypto'
import type { Baseline, Brief, Current, TicketItem, TicketView } from './types.ts'

export function toBaseline(cur: Current): Baseline {
  const tickets: Baseline['tickets'] = {}
  for (const t of cur.tickets) tickets[t.id] = { fp: t.fp, stage: t.stage, assignments: t.assignments }
  return { at: cur.at, tickets, problems: cur.problems.map((p) => p.key).sort() }
}

/** Hash of the state itself (not of the time it was read), so equal states get equal ids. */
export function briefIdOf(b: Baseline): string {
  const ids = Object.keys(b.tickets).sort()
  return createHash('sha1')
    .update(JSON.stringify([ids.map((i) => [i, b.tickets[i]]), b.problems]))
    .digest('hex')
    .slice(0, 8)
}

function itemFor(t: TicketView, base: Baseline | null): TicketItem {
  const b = base?.tickets[t.id]
  const notes: string[] = []
  if (b && t.assignments > b.assignments) notes.push(`期间重新执行 ${t.assignments - b.assignments} 次`)
  if (b && b.stage === 'ended' && t.stage !== 'ended') notes.push('被重新打开')
  if (base && !b && t.stage === 'ended') notes.push('新开并已结束')
  return { ticket: t, notes }
}

export function buildBrief(cur: Current, base: Baseline | null): Brief {
  const snapshot = toBaseline(cur)
  const brief: Brief = {
    id: briefIdOf(snapshot),
    at: cur.at,
    since: base?.at ?? null,
    firstRun: base === null,
    needsYou: [],
    stillPending: [],
    newProblems: [],
    recoveredProblems: 0,
    ended: [],
    running: { opened: 0, reopened: 0 },
    decisions: { accepted: 0, ignored: 0, unfinished: 0 },
    snapshot,
  }

  const endedByOutcome = new Map<string, TicketItem[]>()
  for (const t of cur.tickets) {
    const b = base?.tickets[t.id]
    if (t.stage === 'person') {
      // First run: everything awaiting a person is "currently pending" (design section 7).
      if (base && b && b.fp === t.fp) brief.stillPending.push(itemFor(t, base))
      else brief.needsYou.push(itemFor(t, base))
    } else if (!base) {
      continue // first run: only person-stage tickets are shown
    } else if (t.stage === 'ended') {
      const inWindow = b ? b.stage !== 'ended' : (t.endedAt ?? '') > base.at
      if (!inWindow) continue
      const key = t.outcome ?? 'unknown'
      const list = endedByOutcome.get(key) ?? []
      list.push(itemFor(t, base))
      endedByOutcome.set(key, list)
    } else if (!b) {
      brief.running.opened++
    } else if (b.stage === 'ended') {
      brief.running.reopened++
    }
  }
  for (const [outcome, items] of endedByOutcome) brief.ended.push({ outcome, items })

  if (base) {
    const nowKeys = new Set(cur.problems.map((p) => p.key))
    const before = new Set(base.problems)
    brief.newProblems = cur.problems.filter((p) => !before.has(p.key))
    brief.recoveredProblems = base.problems.filter((k) => !nowKeys.has(k)).length
    for (const d of cur.decisions) {
      if (d.at <= base.at) continue
      if (d.outcome === 'accept') brief.decisions.accepted++
      else if (d.outcome === 'ignore') brief.decisions.ignored++
      else brief.decisions.unfinished++
    }
  }
  return brief
}
