// Application layer shared by the CLI and the DSH plugin: one flow, one progress file (design section 8).
import { readCurrent, httpGet } from './adapter/client.ts'
import { buildBrief } from './core/brief.ts'
import { render } from './render/render.ts'
import { Store, stateDir } from './store/store.ts'

export interface RunOptions {
  panelUrl: string
  markdown?: boolean
  json?: boolean
  /** Overrides DSH_HOME; mainly for tests. */
  home?: string
  fetchImpl?: typeof fetch
}

export interface Result { text: string; warnings: string[] }

/** Show the brief. Remembers it so `ack` can find it, but never moves the baseline. */
export async function show(o: RunOptions): Promise<Result> {
  const store = new Store(stateDir(o.panelUrl, o.home))
  const { state, recovered } = await store.load()
  const warnings = recovered ? ['阅读进度无法读取，已按首次使用处理（原文件已备份为 .corrupt-*）'] : []
  const cur = await readCurrent(httpGet(o.panelUrl, o.fetchImpl), { since: state.baseline?.at })
  const brief = buildBrief(cur, state.baseline)
  await store.remember(state, brief)
  return { text: o.json ? JSON.stringify(brief, null, 2) : render(brief, { markdown: o.markdown }), warnings }
}

/** Acknowledge a brief (default: the latest shown). Does not touch Super-agent at all. */
export async function ack(o: RunOptions, briefId?: string): Promise<Result> {
  const store = new Store(stateDir(o.panelUrl, o.home))
  const { state, recovered } = await store.load()
  const done = await store.ack(state, briefId)
  return { text: `已阅：简报 ${done.id}（${done.at}）`, warnings: recovered ? ['阅读进度无法读取，已按首次使用处理'] : [] }
}
