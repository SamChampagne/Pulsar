// HTTPS CONNECT only, exact operator allowlist, public IPv4 pinned at dial time.
import http from 'node:http';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function publicV4(ip) {
  if (net.isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export function createProxy(hosts, resolve = lookup, dial = net.connect) {
  const allowed = new Set(hosts);
  if (
    !hosts.length ||
    hosts.some((h) => !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(h) || net.isIP(h))
  )
    throw new Error('Exact provider hostnames required');
  const server = http.createServer((_req, res) => {
    res.writeHead(403);
    res.end();
  });
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('connect', async (req, client, head) => {
    client.on('error', () => client.destroy());
    client.setTimeout(180_000, () => client.destroy());
    let upstream;
    client.on('close', () => upstream?.destroy());
    try {
      const match = /^([a-z0-9.-]+):443$/.exec(req.url ?? '');
      if (!match || !allowed.has(match[1])) throw new Error('Denied');
      const addresses = await resolve(match[1], { all: true, family: 4 });
      if (!addresses.length || addresses.some((a) => !publicV4(a.address)) || client.destroyed)
        throw new Error('Denied');
      // Dial validated IP, never re-resolve the hostname (DNS rebinding).
      upstream = dial({ host: addresses[0].address, port: 443 });
      upstream.on('error', () => client.destroy());
      upstream.setTimeout(180_000, () => upstream.destroy());
      upstream.on('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('close', () => client.destroy());
    } catch {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
  });
  server.headersTimeout = 10_000;
  server.maxConnections = 64;
  server.stopSockets = () => {
    for (const socket of sockets) socket.destroy();
  };
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createProxy(
    (process.env.RUNNER_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  server.listen(3128, '0.0.0.0');
  process.on('SIGTERM', () => {
    server.stopSockets();
    server.close();
  });
}
