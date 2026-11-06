import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
import { panel, ROOT } from './helpers.ts'

test('cli: show -> ack -> show again against a live panel, GET only', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catchup-home-'))
  const p = await panel('8c32a9d-after')
  const cli = (...args: string[]) => run('node', ['src/cli.ts', ...args], { cwd: ROOT, env: { ...process.env, DSH_HOME: home, DSH_SUPERAGENT_URL: p.url } })
  try {
    const first = (await cli()).stdout
    assert.match(first, /首次运行/)
    assert.match(first, /当前待处理 3/)
    const id = /简报 (\w{8})/.exec(first)![1]
    assert.match((await cli('ack')).stdout, new RegExp(`已阅：简报 ${id}`))
    const second = (await cli()).stdout
    assert.match(second, /仍待处理 3/)
    assert.doesNotMatch(second, /需要你 \d/)
    assert.ok(p.seen.length > 0 && p.seen.every((l) => l.startsWith('GET ')))
    await assert.rejects(cli('ack', 'deadbeef'), /找不到简报/)
  } finally {
    p.close()
  }
})
