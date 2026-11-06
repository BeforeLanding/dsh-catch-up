// Pure data types shared by core / adapter / store / render. No I/O here.

/** The upstream commit this version was verified against. */
export const VERIFIED_UPSTREAM = '8c32a9d'

export type Stage = 'person' | 'working' | 'idle' | 'ended'

/** One ticket, reduced to what the briefing needs. Built from a `tickets` list row. */
export interface TicketView {
  id: string
  title: string
  stage: Stage
  action: string
  fp: string
  assignments: number
  attentionId?: string
  question?: string
  note?: string
  outcome?: string
  endedAt?: string
  createdAt: string
  url?: string
  replyLabel?: string
}

export interface ProblemView {
  key: string
  kind: string
  detail: string
}

export interface DecisionView {
  at: string
  outcome: string
}

/** Everything read from one Super-agent instance at one moment. */
export interface Current {
  at: string
  tickets: TicketView[]
  problems: ProblemView[]
  decisions: DecisionView[]
}

/** What is persisted as the reading position (design section 9). */
export interface Baseline {
  at: string
  tickets: Record<string, { fp: string; stage: Stage; assignments: number }>
  problems: string[]
}

export interface TicketItem {
  ticket: TicketView
  /** Facts that can be confirmed (design section 6); never guesses. */
  notes: string[]
}

export interface Brief {
  id: string
  at: string
  /** null when there was no baseline (first run). */
  since: string | null
  firstRun: boolean
  needsYou: TicketItem[]
  stillPending: TicketItem[]
  newProblems: ProblemView[]
  recoveredProblems: number
  ended: { outcome: string; items: TicketItem[] }[]
  running: { opened: number; reopened: number }
  decisions: { accepted: number; ignored: number; unfinished: number }
  /** The snapshot that `ack` will store as the new baseline. */
  snapshot: Baseline
}

export class VersionMismatchError extends Error {
  constructor(detail: string) {
    super(`无法读取：上游接口与 v0.1 适配的版本（${VERIFIED_UPSTREAM}）不一致（${detail}）`)
    this.name = 'VersionMismatchError'
  }
}
