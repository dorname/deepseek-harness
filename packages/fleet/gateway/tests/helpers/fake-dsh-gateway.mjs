// Fleet user-process stand-in for the gateway scenario tests, mirroring the
// real `dsh web` authentication face: a launch-token URL mints a bound
// browser-session cookie (303), authenticated requests answer with the
// subject and the requested path, unauthenticated ones get 401, `/events`
// streams an SSE line naming the subject, and a WebSocket upgrade echoes a
// frame naming the subject. Labels itself from the fleet-injected subject.
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'

const subject = process.env.DSH_FLEET_USER_ID ?? 'user'
const cookieValue = `ok-${subject}`
const cookieName = `dsh-auth-${subject}`

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://process.invalid')
  const token = url.searchParams.get('token')
  if (token !== null) {
    if (token === process.env.DSH_FAKE_LAUNCH_TOKEN) {
      response.writeHead(303, {
        location: './',
        'set-cookie': `${cookieName}=${cookieValue}; Path=/; HttpOnly; SameSite=Strict`,
      })
      response.end()
      return
    }
    response.writeHead(401)
    response.end('unauthorized\n')
    return
  }
  const cookie = request.headers.cookie ?? ''
  if (!cookie.split(';').some((part) => part.trim() === `${cookieName}=${cookieValue}`)) {
    response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('dsh web authentication required\n')
    return
  }
  if (url.pathname === '/events') {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`data: events-${subject}\n\n`)
    return
  }
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(`${subject} home ${url.pathname}\n`)
})

server.on('upgrade', (request, socket) => {
  const key = request.headers['sec-websocket-key']
  if (typeof key !== 'string') {
    socket.destroy()
    return
  }
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
  socket.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n')
  socket.write(`sec-websocket-accept: ${accept}\r\n\r\n`)
  socket.write(`ws-upgraded-${subject}`)
})

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  // The launch token the process announces; the fake accepts exactly this one.
  process.env.DSH_FAKE_LAUNCH_TOKEN = `fake-${subject}`
  process.stdout.write(`dsh web: http://127.0.0.1:${port}/?token=fake-${subject}\n`)
})

process.on('SIGTERM', () => {
  process.exit(0)
})
