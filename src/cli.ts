#!/usr/bin/env node
// dsh-catch-up CLI (design section 8). Read-only against Super-agent; only writes its own state.json.
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readCurrent, fixtureGet } from './adapter/client.ts'
import { ack, show } from './app.ts'
import { buildBrief, toBaseline } from './core/brief.ts'
import { render } from './render/render.ts'

const USAGE = `用法：
  dsh-catch-up [--url <面板地址>] [--json]    显示简报（不推进阅读进度）
  dsh-catch-up ack [briefId] [--url <地址>]    标记已阅（不带 briefId 时确认最近显示的一份）
  dsh-catch-up --demo                          用样例数据演示，不需要 Super-agent
--url 默认读环境变量 DSH_SUPERAGENT_URL。`

function parse(argv: string[]) {
  const o = { url: process.env.DSH_SUPERAGENT_URL, json: false, demo: false, help: false, ack: false, briefId: undefined as string | undefined }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--url') o.url = argv[++i]
    else if (a === '--json') o.json = true
    else if (a === '--demo') o.demo = true
    else if (a === '-h' || a === '--help') o.help = true
    else if (a === 'ack') o.ack = true
    else if (o.ack && !o.briefId && !a.startsWith('-')) o.briefId = a
    else throw new Error(`不认识的参数：${a}`)
  }
  return o
}

async function demo(json: boolean): Promise<void> {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'contract')
  const at = (iso: string) => new Date(iso)
  // "before" was last acknowledged at 05:00; "after" is read at 08:20 (the recorded timeline).
  const before = await readCurrent(fixtureGet(path.join(root, '8c32a9d-before')), { now: at('2026-11-04T05:00:00.000Z') })
  const after = await readCurrent(fixtureGet(path.join(root, '8c32a9d-after')), { now: at('2026-11-04T08:20:00.000Z') })
  const brief = buildBrief(after, toBaseline(before))
  console.log(json ? JSON.stringify({ demo: true, ...brief }, null, 2) : render(brief, { demo: true }))
}

async function main(): Promise<void> {
  const o = parse(process.argv.slice(2))
  if (o.help) return void console.log(USAGE)
  if (o.demo) return demo(o.json)
  if (!o.url) throw new Error(`缺少面板地址。\n${USAGE}`)

  const res = o.ack ? await ack({ panelUrl: o.url }, o.briefId) : await show({ panelUrl: o.url, json: o.json })
  for (const w of res.warnings) console.error(w)
  console.log(res.text)
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
