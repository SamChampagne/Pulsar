import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { createProxy, publicV4 } from './proxy.mjs';

test('approved public host tunnels to the validated IP, without a second DNS lookup', async (t) => {
  let target;
  const server = createProxy(
    ['allowed.example'],
    async () => [{ address: '8.8.8.8' }],
    (options) => {
      target = options;
      const upstream = new PassThrough();
      upstream.setTimeout = () => upstream;
      setImmediate(() => upstream.emit('connect'));
      return upstream;
    },
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.stopSockets();
    server.close();
  });
  const req = http.request(`http://127.0.0.1:${server.address().port}`, {
    method: 'CONNECT',
    path: 'allowed.example:443',
  });
  req.end();
  const [res, socket] = await once(req, 'connect');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(target, { host: '8.8.8.8', port: 443 });
  const data = once(socket, 'data');
  socket.write('synthetic-tunnel');
  assert.equal((await data)[0].toString(), 'synthetic-tunnel');
  socket.destroy();
});

test('blocks private, metadata, loopback, multicast and non IPv4 ranges', () => {
  for (const ip of [
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '169.254.169.254',
    '172.17.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '198.18.1.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::ffff:127.0.0.1',
  ])
    assert.equal(publicV4(ip), false, ip);
  assert.equal(publicV4('8.8.8.8'), true);
});

test('exact host allowlist, HTTPS only, all DNS answers must be public', async (t) => {
  let lookups = 0,
    dials = 0;
  const server = createProxy(
    ['allowed.example'],
    async () => {
      lookups++;
      return [{ address: '8.8.8.8' }, { address: '127.0.0.1' }];
    },
    () => {
      dials++;
      throw new Error('Must not dial');
    },
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.stopSockets();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url)).status, 403);
  for (const target of [
    'allowed.example:443',
    'allowed.example:80',
    'unlisted.example:443',
    '127.0.0.1:443',
    'allowed.example.attacker:443',
  ]) {
    const req = http.request(url, { method: 'CONNECT', path: target });
    req.end();
    const [res, socket] = await once(req, 'connect');
    assert.equal(res.statusCode, 403, target);
    socket.destroy();
  }
  assert.equal(lookups, 1);
  assert.equal(dials, 0);
});
