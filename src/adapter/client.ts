// Super-agent panel HTTP client. Read-only: GET only, nothing that changes Super-agent state (design section 1, 3).
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { normalizeAll } from './normalize.ts'
import { VersionMismatchError } from '../core/types.ts'
import type { Current } from '../core/types.ts'

/** A transport takes a path like `tickets?state=open&limit=1000` and returns parsed JSON. */
export type Get = (route: string) => Promise<unknown>

const PAGE = 1000
const DECISION_PAGE = 200
const MAX_PAGES = 200

export class UnreachableError extends Error {
  constructor(url: string, cause: unknown) {
    super(`无法连接 Super-agent 面板：${url}（${cause instanceof Error ? cause.message : String(cause)}）。请确认实例正在运行，并检查 --url / DSH_SUPERAGENT_URL。`)
    this.name = 'UnreachableError'
  }
}

export function httpGet(panelUrl: string, fetchImpl: typeof fetch = fetch): Get {
  const base = `${panelUrl.replace(/\/+$/, '')}/orchestrator/api/`
  return async (route) => {
    let res: Response
    try {
      res = await fetchImpl(base + route, { headers: { 'x-orchestrator-request': '1' } })
    } catch (e) {
      throw new UnreachableError(base, e)
    }
    if (!res.ok) throw new UnreachableError(base + route, new Error(`HTTP ${res.status}`))
    return res.json()
  }
}

/** Reads recorded responses from a directory laid out like fixtures/contract/<name>/. */
export function fixtureGet(dir: string): Get {
  return async (route) => {
    const file = route.replace(/[?=&]/g, '_') + '.json'
    return JSON.parse(await readFile(path.join(dir, file), 'utf8'))
  }
}

async function waitReady(get: Get, tries: number, delayMs: number): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await get('state')
      return
    } catch (e) {
      if (i >= tries - 1) throw e
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
}

interface Page { items?: unknown[]; next_offset?: number | null }

/** Pages through a list. `stopWhen` lets decisions (ordered by write order, not `at`) stop once a whole page is old enough. */
async function pages(get: Get, route: string, params: string[], limit: number, stopWhen?: (items: unknown[]) => boolean): Promise<unknown[]> {
  const out: unknown[] = []
  let offset = 0
  for (let i = 0; i < MAX_PAGES; i++) {
    const query = [...params, ...(offset ? [`offset=${offset}`] : []), `limit=${limit}`].join('&')
    const page = (await get(`${route}?${query}`)) as Page
    if (!page || !Array.isArray(page.items)) throw new VersionMismatchError(`${route} 响应缺少 items 数组`)
    out.push(...page.items)
    if (page.next_offset == null || page.items.length === 0) break
    if (stopWhen?.(page.items)) break
    offset = page.next_offset
  }
  return out
}

export interface ReadOptions {
  /** Decisions older than this on a whole page end paging (design section 3). */
  since?: string | null
  now?: Date
  retries?: number
  retryDelayMs?: number
}

export async function readCurrent(get: Get, opts: ReadOptions = {}): Promise<Current> {
  await waitReady(get, opts.retries ?? 5, opts.retryDelayMs ?? 1000)
  const overview = await get('overview')
  const open = await pages(get, 'tickets', ['state=open'], PAGE)
  const ended = await pages(get, 'tickets', ['state=ended'], PAGE)
  const since = opts.since
  const decisions = await pages(get, 'decisions', [], DECISION_PAGE, since ? (items) => items.every((d) => typeof (d as { at?: unknown }).at === 'string' && (d as { at: string }).at <= since) : undefined)
  return normalizeAll({ overview, tickets: [...open, ...ended], decisions, now: opts.now })
}
