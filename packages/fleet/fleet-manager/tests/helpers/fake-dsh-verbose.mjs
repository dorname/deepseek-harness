// Exercises the spawner's stdout handling in full: a first chunk without a
// URL, then the URL line, then a late chunk after readiness that would
// re-trigger a settle if the spawner did not guard it. Chunk pacing keeps
// them as separate stdout reads.
import { createServer } from 'node:http'

const server = createServer((_request, response) => {
  response.end('ok\n')
})
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  process.stdout.write('booting\n')
  setTimeout(() => {
    process.stdout.write(`dsh web: http://127.0.0.1:${port}/?token=fake\n`)
  }, 15)
  setTimeout(() => {
    process.stdout.write('still serving\n')
  }, 30)
})
process.on('SIGTERM', () => {
  process.exit(0)
})
