import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// Serves recorded responses like the Super-agent panel, enforcing its request-header rule.
export async function panel(set: string) {
  const dir = path.join(ROOT, 'fixtures', 'contract', set)
  const seen: string[] = []
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`)
    if (req.headers['x-orchestrator-request'] !== '1') return void res.writeHead(403).end()
    const route = (req.url ?? '').replace('/orchestrator/api/', '').replace(/[?=&]/g, '_')
    try {
      res.writeHead(200, { 'content-type': 'application/json' }).end(await readFile(path.join(dir, route + '.json')))
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as { port: number }
  return { url: `http://127.0.0.1:${port}`, seen, close: () => server.close() }
}

