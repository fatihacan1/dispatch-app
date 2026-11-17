// Bundled Node helper for OpenSSH ProxyCommand (run via ELECTRON_RUN_AS_NODE=1).
// Connects to a target host:port through a SOCKS5 or HTTP CONNECT proxy using env vars,
// then pipes stdin/stdout to the tunneled socket.
const net = require('net');

const SOCKS5_ERRORS = {
  1: 'general SOCKS server failure',
  2: 'connection not allowed by ruleset',
  3: 'network unreachable',
  4: 'host unreachable',
  5: 'connection refused',
  6: 'TTL expired',
  7: 'command not supported',
  8: 'address type not supported',
};

/** Open a TCP tunnel through an HTTP CONNECT or SOCKS5 proxy and resolve with the connected socket. */
function connectViaProxy({ type, host, port, user = '', pass = '', targetHost, targetPort, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: Number(port) });
    let settled = false;
    const fail = err => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const timer = setTimeout(() => fail(new Error(`Proxy connection timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    const done = extra => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.removeListener('error', fail);
      resolve({ sock, extra });
    };

    sock.on('error', fail);

    if (type === 'http') {
      let buf = Buffer.alloc(0);
      const onData = chunk => {
        buf = Buffer.concat([buf, chunk]);
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) {
          if (buf.length > 16384) fail(new Error('HTTP proxy response too large'));
          return;
        }
        sock.removeListener('data', onData);
        const head = buf.slice(0, idx).toString('latin1');
        const statusLine = head.split('\r\n')[0] || '';
        const m = /^HTTP\/\d+\.\d+\s+(\d+)/i.exec(statusLine);
        if (!m || Number(m[1]) !== 200) {
          return fail(new Error(`HTTP proxy rejected CONNECT: ${statusLine || 'invalid response'}`));
        }
        done(buf.slice(idx + 4));
      };
      sock.on('data', onData);
      sock.on('connect', () => {
        const lines = [
          `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
          `Host: ${targetHost}:${targetPort}`,
        ];
        if (user || pass) {
          const auth = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
          lines.push(`Proxy-Authorization: Basic ${auth}`);
        }
        lines.push('', '');
        sock.write(lines.join('\r\n'));
      });
      return;
    }

    if (type === 'socks5') {
      let buf = Buffer.alloc(0);
      let stage = 'greeting';
      const sendConnect = () => {
        stage = 'connect';
        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(Number(targetPort), 0);
        let addrPart;
        if (net.isIPv4(targetHost)) {
          addrPart = Buffer.from([0x01, ...targetHost.split('.').map(Number)]);
        } else if (net.isIPv6(targetHost)) {
          // Use domain ATYP for IPv6 text to avoid writing a full IPv6 parser; standard SOCKS5 servers support ATYP 0x03.
          const hb = Buffer.from(targetHost, 'utf8');
          addrPart = Buffer.concat([Buffer.from([0x03, hb.length]), hb]);
        } else {
          const hb = Buffer.from(targetHost, 'utf8');
          if (hb.length > 255) return fail(new Error('Target hostname too long for SOCKS5'));
          addrPart = Buffer.concat([Buffer.from([0x03, hb.length]), hb]);
        }
        sock.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), addrPart, portBuf]));
      };

      const onData = chunk => {
        buf = Buffer.concat([buf, chunk]);
        if (stage === 'greeting') {
          if (buf.length < 2) return;
          const [ver, method] = [buf[0], buf[1]];
          buf = buf.slice(2);
          if (ver !== 0x05) return fail(new Error(`Unexpected SOCKS version: ${ver}`));
          if (method === 0xff) return fail(new Error('SOCKS5 proxy rejected authentication methods'));
          if (method === 0x02) {
            stage = 'auth';
            const ub = Buffer.from(user, 'utf8');
            const pb = Buffer.from(pass, 'utf8');
            if (ub.length > 255 || pb.length > 255) return fail(new Error('Proxy credentials too long'));
            sock.write(Buffer.concat([Buffer.from([0x01, ub.length]), ub, Buffer.from([pb.length]), pb]));
          } else if (method === 0x00) {
            sendConnect();
          } else {
            return fail(new Error(`Unsupported SOCKS5 auth method: ${method}`));
          }
        }
        if (stage === 'auth') {
          if (buf.length < 2) return;
          const [ver, status] = [buf[0], buf[1]];
          buf = buf.slice(2);
          if (ver !== 0x01 || status !== 0x00) return fail(new Error('SOCKS5 authentication failed'));
          sendConnect();
        }
        if (stage === 'connect') {
          if (buf.length < 4) return;
          const [ver, rep, , atyp] = [buf[0], buf[1], buf[2], buf[3]];
          if (ver !== 0x05) return fail(new Error(`Unexpected SOCKS5 reply version: ${ver}`));
          if (rep !== 0x00) return fail(new Error(`SOCKS5 connect failed: ${SOCKS5_ERRORS[rep] || `error ${rep}`}`));
          let need = 4;
          if (atyp === 0x01) need += 4 + 2;
          else if (atyp === 0x04) need += 16 + 2;
          else if (atyp === 0x03) {
            if (buf.length < 5) return;
            need += 1 + buf[4] + 2;
          } else {
            return fail(new Error(`Unsupported SOCKS5 address type: ${atyp}`));
          }
          if (buf.length < need) return;
          const extra = buf.slice(need);
          sock.removeListener('data', onData);
          done(extra);
        }
      };
      sock.on('data', onData);
      sock.on('connect', () => {
        const methods = (user || pass) ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00];
        sock.write(Buffer.from(methods));
      });
      return;
    }

    fail(new Error(`Unsupported proxy type: ${type}`));
  });
}

if (require.main === module) {
  const targetHost = process.argv[2];
  const targetPort = Number(process.argv[3]);
  const type = process.env.DISPATCH_PROXY_TYPE || 'socks5';
  const host = process.env.DISPATCH_PROXY_HOST || '';
  const port = Number(process.env.DISPATCH_PROXY_PORT || 0);
  const user = process.env.DISPATCH_PROXY_USER || '';
  const pass = process.env.DISPATCH_PROXY_PASS || '';

  if (!targetHost || !targetPort || !host || !port) {
    process.stderr.write('Missing proxy or target host/port\n');
    process.exit(1);
  }

  connectViaProxy({ type, host, port, user, pass, targetHost, targetPort })
    .then(({ sock, extra }) => {
      if (extra && extra.length) process.stdout.write(extra);
      process.stdin.pipe(sock);
      sock.pipe(process.stdout);
      const exit = () => process.exit(0);
      sock.on('close', exit);
      sock.on('error', err => { process.stderr.write(err.message + '\n'); process.exit(1); });
      process.stdin.on('end', () => sock.end());
      process.stdin.on('error', () => sock.destroy());
    })
    .catch(err => {
      process.stderr.write((err?.message || String(err)) + '\n');
      process.exit(1);
    });
}

module.exports = { connectViaProxy };
