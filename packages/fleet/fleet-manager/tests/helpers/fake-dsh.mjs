// Minimal stand-in for `dsh --profile web` in fleet tests: serves one HTTP
// port on loopback, prints the URL line the real CLI prints, labels itself
// with the fleet-injected subject, and exits on SIGTERM. Invoked as
// `node fake-dsh.mjs` (the production spawner appends `--port 0`, which Node
// passes through to the script as arguments).
import { createServer } from 'node:http'

const label = process.env.DSH_FLEET_USER_ID ?? 'dsh'
const server = createServer((_request, response) => {
  response.end(`${label} ok\n`)
})
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  process.stdout.write(`dsh web: http://127.0.0.1:${port}/?token=fake-${label}\n`)
})
process.on('SIGTERM', () => {
  process.exit(0)
})
