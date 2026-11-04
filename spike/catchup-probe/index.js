// Throwaway spike for dsh-catchup (docs/DESIGN.md §15 in dsh-catch-up questions 1 and 2).
// Q1: can a plugin outside the Super-agent bundle inject `webServer` and read its port?
// Q2: does a prefix route registered the same way Super-agent registers /orchestrator get any token check from the host?
// The route mimics Super-agent's same-origin rule so the command can exercise a realistic loopback call.
export const name = 'catchup-probe'
export const inject = ['webServer', 'commands']

export function apply(ctx) {
  const ws = ctx.webServer
  ctx.logger.info('catchup-probe applied; port at apply time: %s', ws.port)
  ctx.effect(() => ws.register({
    kind: 'prefix', path: '/catchup-probe', handler: (req, res) => {
      const host = req.headers.host
      const sameHost = host === `127.0.0.1:${ws.port}` || host === `localhost:${ws.port}`
      const headerOk = req.headers['x-orchestrator-request'] === '1'
      const status = sameHost && headerOk ? 200 : 403
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ reached: true, status, port: ws.port, host, origin: req.headers.origin ?? null,
        authorization: req.headers.authorization ? 'present' : 'absent', cookie: req.headers.cookie ? 'present' : 'absent' }))
    },
  }))
  ctx.commands.register({
    name: 'catchup-probe',
    description: 'dsh-catchup spike: call this host over loopback from inside a plugin',
    async handler() {
      const url = `http://127.0.0.1:${ws.port}/catchup-probe/api/state`
      try {
        const res = await fetch(url, { headers: { 'x-orchestrator-request': '1' } })
        return { kind: 'success', text: `port=${ws.port}\nGET ${url} -> ${res.status}\n${await res.text()}` }
      } catch (error) {
        return { kind: 'error', text: `port=${ws.port}\nGET ${url} failed: ${error}` }
      }
    },
  })
}
