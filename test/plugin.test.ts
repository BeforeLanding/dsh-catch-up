import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply, run } from '../src/plugin/index.ts'
import { panel } from './helpers.ts'

test('plugin: /catchup then /catchup ack, markdown, via the registered handler', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catchup-plugin-'))
  const p = await panel('8c32a9d-after')
  process.env.DSH_HOME = home
  const port = Number(new URL(p.url).port)
  let def: { name: string; handler(i: { rawInput?: string }): Promise<{ kind: string; text: string }> } | undefined
  apply({ webServer: { port }, commands: { register: (d) => void (def = d as typeof def) }, logger: { info() {} } })
  try {
    assert.equal(def?.name, 'catchup')
    const first = await def!.handler({ rawInput: '' })
    assert.equal(first.kind, 'success')
    assert.match(first.text, /\*\*当前待处理 3\*\*/)
    const acked = await def!.handler({ rawInput: ' ack ' })
    assert.match(acked.text, /已阅/)
    assert.match((await def!.handler({ rawInput: '' })).text, /仍待处理 3/)
    assert.equal((await run('bogus', p.url)).kind, 'error')
    assert.equal((await run('ack nope', p.url)).kind, 'error')
    assert.ok(p.seen.every((l) => l.startsWith('GET ')))
  } finally {
    p.close()
  }
})

test('plugin: unreachable panel yields an error reply, not a throw', async () => {
  const r = await run('', 'http://127.0.0.1:1', await mkdtemp(path.join(os.tmpdir(), 'catchup-plugin-')))
  assert.equal(r.kind, 'error')
  assert.match(r.text, /无法连接/)
})
