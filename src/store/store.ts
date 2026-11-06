// Reading-progress file (design section 9): $DSH_HOME/dsh-catch-up/<host>-<port>/state.json
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Baseline, Brief } from '../core/types.ts'

const VERSION = 1
const KEEP = 5

export interface StoredBrief { id: string; at: string; snapshot: Baseline }
export interface State { version: number; baseline: Baseline | null; briefs: StoredBrief[] }

export interface Loaded { state: State; recovered: boolean }

export function stateDir(panelUrl: string, home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')): string {
  const u = new URL(panelUrl)
  return path.join(home, 'dsh-catch-up', `${u.hostname}-${u.port || '80'}`)
}

const empty = (): State => ({ version: VERSION, baseline: null, briefs: [] })

export class Store {
  readonly file: string
  constructor(dir: string) {
    this.file = path.join(dir, 'state.json')
  }

  /** A corrupt file is moved aside and treated as first use (design section 9). */
  async load(now = new Date()): Promise<Loaded> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { state: empty(), recovered: false }
      throw e
    }
    try {
      const s = JSON.parse(text) as State
      if (s.version !== VERSION || !Array.isArray(s.briefs) || (s.baseline !== null && typeof s.baseline?.at !== 'string')) throw new Error('bad shape')
      return { state: s, recovered: false }
    } catch {
      await rename(this.file, `${this.file}.corrupt-${now.toISOString().replace(/[:.]/g, '-')}`)
      return { state: empty(), recovered: true }
    }
  }

  private async save(state: State): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}`
    await writeFile(tmp, JSON.stringify(state, null, 2))
    await rename(tmp, this.file)
  }

  /** Showing a brief remembers it (so `ack` can find it) but never moves the baseline. */
  async remember(state: State, brief: Brief): Promise<void> {
    const briefs = [...state.briefs.filter((b) => b.id !== brief.id), { id: brief.id, at: brief.at, snapshot: brief.snapshot }].slice(-KEEP)
    await this.save({ ...state, briefs })
  }

  /** Stores *that brief's* snapshot as the baseline, not the state at ack time (design section 7). */
  async ack(state: State, briefId?: string): Promise<StoredBrief> {
    const target = briefId ? state.briefs.find((b) => b.id === briefId) : state.briefs[state.briefs.length - 1]
    if (!target) throw new Error(briefId ? `找不到简报 ${briefId}（只保留最近 ${KEEP} 份）` : '还没有显示过简报，没有可确认的内容')
    await this.save({ ...state, baseline: target.snapshot })
    return target
  }
}
