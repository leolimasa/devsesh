// Spike server: serves the association file and a WebAuthn/PRF test page over HTTPS.
// Runs on the Mac. No dependencies. Needs root for port 443.
//   sudo node server.js            (HOST/TEAM/BUNDLE can be set via env)
const https = require('https')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const HOST = process.env.HOST || 'devsesh-spike.example.net'
const APP_ID = `${process.env.TEAM || '9YDT4ML5X7'}.${process.env.BUNDLE || 'com.leosa.devseshspike'}`
const PORT = Number(process.env.PORT || 443)
const CERT_DIR = process.env.CERT_DIR || path.join(__dirname, '..', 'certs')
const LOG = process.env.RESULTS || path.join(process.env.HOME || '.', 'spike', 'results.log')

const b64url = (b) => Buffer.from(b).toString('base64url')
const challenges = new Set()

function send(res, code, type, body) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

const server = https.createServer(
  {
    key: fs.readFileSync(path.join(CERT_DIR, 'leaf.key')),
    cert: fs.readFileSync(path.join(CERT_DIR, 'leaf.pem')),
  },
  (req, res) => {
    const url = new URL(req.url, `https://${HOST}`)
    console.log(req.method, url.pathname, req.headers['user-agent']?.slice(0, 60))

    if (url.pathname === '/.well-known/apple-app-site-association') {
      return send(res, 200, 'application/json', JSON.stringify({ webcredentials: { apps: [APP_ID] } }))
    }
    if (url.pathname === '/') {
      return send(res, 200, 'text/html', fs.readFileSync(path.join(__dirname, 'index.html')))
    }
    if (url.pathname === '/api/challenge') {
      const c = b64url(crypto.randomBytes(32))
      challenges.add(c)
      return send(res, 200, 'application/json', JSON.stringify({ challenge: c, rpId: HOST }))
    }
    if (url.pathname === '/api/log' && req.method === 'POST') {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', () => {
        try {
          const m = JSON.parse(body)
          // If the page reports the challenge it got back in clientDataJSON, check we issued it.
          if (m.clientChallenge) m.challengeIssuedByServer = challenges.has(m.clientChallenge)
          fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...m }) + '\n')
          console.log('RESULT', JSON.stringify(m))
        } catch (e) {
          console.log('bad log body', e.message)
        }
        send(res, 200, 'application/json', '{"ok":true}')
      })
      return
    }
    send(res, 404, 'text/plain', 'not found')
  }
)

server.listen(PORT, () => console.log(`spike server on https://${HOST}:${PORT}  (app id ${APP_ID})`))

// Log TLS handshakes that fail before any request, e.g. a client that does not trust our CA.
server.on('tlsClientError', (e, s) => console.log('TLS ERROR from', s.remoteAddress, e.code || e.message))
server.on('secureConnection', (s) => console.log('TLS OK from', s.remoteAddress, s.servername || ''))
