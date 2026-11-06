// Brief -> text. One renderer for terminal text and Markdown (DSH command); no model involved.
import type { Brief, TicketItem } from '../core/types.ts'

const ACTION: Record<string, string> = {
  review: '审 PR',
  answer: '回答问题',
  blocked: '处理受阻',
  failed: '处理失败',
  delivery: '投递失败',
}
const OUTCOME: Record<string, string> = {
  merged: '已合并',
  completed: '已完成',
  closed: '已关闭',
  dismissed: '无需处理',
  stopped: '被人停止',
}

export const outcomeLabel = (o: string): string => OUTCOME[o] ?? o

export interface RenderOptions { markdown?: boolean; demo?: boolean }

function line(item: TicketItem, md: boolean, tag?: string): string[] {
  const t = item.ticket
  const action = ACTION[t.action] ?? t.action
  const head = [action && `[${action}]`, t.title, `(${t.id})`].filter(Boolean).join(' ')
  const extra = [...item.notes, ...(tag ? [tag] : [])]
  const out = [`${md ? '- ' : '  · '}${head}${extra.length ? `  —— ${extra.join('；')}` : ''}`]
  const pad = md ? '  ' : '    '
  const q = t.question ?? t.note
  if (q) out.push(`${pad}${md ? '> ' : '问题：'}${q}`)
  if (t.url) out.push(`${pad}${md ? `[${t.replyLabel ?? '原帖'}](${t.url})` : t.url}`)
  return out
}

export function render(brief: Brief, opts: RenderOptions = {}): string {
  const md = Boolean(opts.markdown)
  const h = (s: string) => (md ? `**${s}**` : `【${s}】`)
  const out: string[] = []
  if (opts.demo) out.push('样例数据')
  out.push(brief.firstRun ? `# catch-up · 简报 ${brief.id}（首次运行）` : `# catch-up · 简报 ${brief.id}（自 ${brief.since} 起）`)

  if (brief.firstRun) {
    if (brief.needsYou.length) {
      out.push('', h(`当前待处理 ${brief.needsYou.length}`))
      for (const i of brief.needsYou) out.push(...line(i, md))
    } else out.push('', '当前没有需要你处理的事')
    out.push('', '从现在开始记录。看完后执行 ack 以标记已阅。')
    return out.join('\n')
  }

  if (!brief.needsYou.length && !brief.stillPending.length && !brief.newProblems.length) out.push('', '离开期间没有需要你处理的事')
  if (brief.needsYou.length) {
    out.push('', h(`需要你 ${brief.needsYou.length}`))
    for (const i of brief.needsYou) out.push(...line(i, md))
  }
  if (brief.stillPending.length) {
    out.push('', h(`仍待处理 ${brief.stillPending.length}`))
    for (const i of brief.stillPending) out.push(...line(i, md, '上次已阅时已存在'))
  }
  if (brief.newProblems.length || brief.recoveredProblems) {
    out.push('', h('系统问题'))
    for (const p of brief.newProblems) out.push(`${md ? '- ' : '  · '}${p.kind}：${p.detail}`)
    if (brief.recoveredProblems) out.push(`${md ? '- ' : '  · '}已恢复 ${brief.recoveredProblems} 项`)
  }
  for (const g of brief.ended) {
    out.push('', h(`已结束，无需操作 · ${outcomeLabel(g.outcome)} ${g.items.length}`))
    for (const i of g.items) out.push(...line(i, md))
  }
  const r = brief.running
  if (r.opened || r.reopened) out.push('', `进行中：新开 ${r.opened}${r.reopened ? `，重新打开 ${r.reopened}` : ''}`)
  const d = brief.decisions
  if (d.accepted || d.ignored || d.unfinished) out.push('', `消息：接单 ${d.accepted}，忽略 ${d.ignored}，未完成评估 ${d.unfinished}`)
  out.push('', `看完后执行 ack ${brief.id} 标记已阅。任务可在面板顶部按 ID 搜索。`)
  return out.join('\n')
}
