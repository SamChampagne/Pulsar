/** Local qualification of deploy/ovh/compose.yml using DISPOSABLE containers.
 * Prereq: build pulsar-api:control-center-test and pulsar-web:control-center-test.
 * No server access, no real secrets, no mutations to the normal development DB.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const project = `pulsar-ovh-check-${process.pid}-${Date.now()}`;
const restoreProject = `${project}-restore`;
const env = {
  ...process.env,
  PULSAR_BUILD_VERSION: 'control-center-test',
  POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
  JWT_SECRET: randomBytes(48).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  PLATFORM_ADMIN_EMAIL: 'smoke@example.test',
  PLATFORM_ADMIN_PASSWORD: randomBytes(24).toString('hex'),
};
const base = [
  'compose',
  '--env-file',
  'deploy/ovh/env.example',
  '-p',
  project,
  '-f',
  'deploy/ovh/compose.yml',
];
const initialPassword = env.PLATFORM_ADMIN_PASSWORD;
function command(args, { input, binary = false, targetProject = project } = {}) {
  return new Promise((resolve, reject) => {
    assert.ok([project, restoreProject].includes(targetProject));
    const composeArgs = [...base];
    composeArgs[composeArgs.indexOf('-p') + 1] = targetProject;
    const child = spawn('docker', [...composeArgs, ...args], {
      env,
      windowsHide: true,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    const output = [];
    let errorOutput = '';
    child.stdout.on('data', (d) => output.push(d));
    child.stderr.on('data', (d) => {
      errorOutput += d;
    });
    // A dump/archive travels as bytes, never through shell redirection or UTF-8.
    if (input !== undefined) {
      child.stdin.on('error', reject);
      child.stdin.end(input);
    }
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(binary ? Buffer.concat(output) : Buffer.concat(output).toString('utf8'))
        : reject(new Error(`Docker ${args[0]} failed (${code}). ${errorOutput.slice(-1500)}`)),
    );
  });
}
async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:8180/api/v1/health/ready', {
        signal: AbortSignal.timeout(2000),
      });
      if (r.ok) return;
    } catch {
      /* bounded boot wait */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Readiness did not become healthy within 60 seconds');
}
// Avoid colliding with any service already listening on the profile port.
await new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(8180, '127.0.0.1', () => s.close(resolve));
});
try {
  await command(['config', '--quiet']);
  console.log('Compose valid; starting isolated database.');
  await command(['up', '-d', 'db']);
  await command(['run', '--rm', 'migrate']);
  await command(['run', '--rm', 'bootstrap']);
  const sql = async (q) =>
    (await command(['exec', '-T', 'db', 'psql', '-U', 'pulsar', '-d', 'pulsar', '-tAc', q])).trim();
  assert.equal(await sql('SELECT count(*) FROM tenants'), '0');
  const before = await sql('SELECT md5("passwordHash") FROM platform_users');
  // A second bootstrap with a different supplied password must preserve credentials.
  env.PLATFORM_ADMIN_PASSWORD = randomBytes(24).toString('hex');
  await command(['run', '--rm', 'bootstrap']);
  assert.equal(await sql('SELECT md5("passwordHash") FROM platform_users'), before);
  console.log('Migrations + bootstrap passed; no demo tenant; credentials preserved.');
  await command(['up', '-d', 'api', 'web']);
  await ready();
  const web = await fetch('http://127.0.0.1:8180/workflows');
  assert.equal(web.status, 200);
  assert.match(await web.text(), /<!doctype html>/i);
  const protectedRoute = await fetch('http://127.0.0.1:8180/api/v1/platform/operations');
  assert.equal(protectedRoute.status, 401);
  const login = await fetch('http://127.0.0.1:8180/api/v1/platform/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.PLATFORM_ADMIN_EMAIL, password: initialPassword }),
  });
  assert.ok(login.ok);
  const auth = await login.json();
  assert.equal(auth.mfaEnrollmentRequired, true);
  assert.equal(auth.accessToken, undefined);
  // The bootstrap password remains the original value; changing env is not rotation.
  await command(['restart', 'api']);
  await ready();
  console.log(
    'SPA fallback + API proxy + auth boundary + mandatory MFA + restart/readiness passed.',
  );

  // Consistent snapshot: no application writers during base + document backup.
  await command([
    'exec',
    '-T',
    'api',
    'node',
    '-e',
    `
    const fs = require('node:fs'); const assert = require('node:assert/strict');
    assert.notEqual(process.getuid(), 0);
    assert.throws(() => fs.writeFileSync('/app/readonly-canary', 'must fail'));
    const status = fs.readFileSync('/proc/self/status', 'utf8');
    assert.match(status, /NoNewPrivs:\\s+1/);
    assert.match(status, /CapEff:\\s+0+/);
    assert.equal(process.env.PULSAR_REPO_ROOT, '/app');
  `,
  ]);
  console.log('API non-root, read-only source, no capabilities/new privileges verified.');

  // All writes below are disposable fixtures, never files in the user's storage.
  await command(['stop', 'web', 'api']);
  // Rehearse the documented upgrade from legacy root-owned documents.
  await command([
    'run',
    '--rm',
    '--no-deps',
    '-T',
    '--user',
    '0',
    '--cap-add',
    'DAC_OVERRIDE',
    '--entrypoint',
    'node',
    'api',
    '-e',
    `
      const fs = require('node:fs');
      fs.mkdirSync('/app/storage/legacy-root', { mode: 0o700 });
      fs.writeFileSync('/app/storage/legacy-root/probe.txt', 'legacy', { mode: 0o600 });
    `,
  ]);
  await command([
    'run',
    '--rm',
    '--no-deps',
    '-T',
    '--user',
    '0',
    '--cap-add',
    'CHOWN',
    '--cap-add',
    'DAC_OVERRIDE',
    '--entrypoint',
    'chown',
    'api',
    '-R',
    '1000:1000',
    '/app/storage',
  ]);
  await command([
    'run',
    '--rm',
    '--no-deps',
    '-T',
    '--entrypoint',
    'node',
    'api',
    '-e',
    `
    const fs = require('node:fs'); const assert = require('node:assert/strict');
    assert.equal(fs.readFileSync('/app/storage/legacy-root/probe.txt', 'utf8'), 'legacy');
    assert.equal(fs.statSync('/app/storage/legacy-root/probe.txt').uid, 1000);
    fs.writeFileSync('/app/storage/legacy-root/new.txt', 'non-root');
  `,
  ]);
  console.log('Legacy document ownership migration and non-root writes verified.');
  const marker = randomBytes(32).toString('hex');
  await sql('CREATE TABLE pilot_restore_probe (id integer PRIMARY KEY, value text NOT NULL)');
  await sql(`INSERT INTO pilot_restore_probe VALUES (1, '${marker}')`);
  const fileBytes = randomBytes(1024).toString('base64');
  await command([
    'run',
    '--rm',
    '--no-deps',
    '-T',
    '--entrypoint',
    'node',
    'api',
    '-e',
    `require('node:fs').writeFileSync('/app/storage/restore-canary.bin', Buffer.from('${fileBytes}', 'base64'))`,
  ]);
  const migrationsBefore = await sql(
    "SELECT md5(string_agg(migration_name || checksum, ',' ORDER BY migration_name)) FROM _prisma_migrations WHERE finished_at IS NOT NULL",
  );
  const database = await command(
    ['exec', '-T', 'db', 'pg_dump', '-U', 'pulsar', '-d', 'pulsar', '-Fc'],
    { binary: true },
  );
  const documents = await command(
    [
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--entrypoint',
      'tar',
      'api',
      '-C',
      '/app/storage',
      '-czf',
      '-',
      '.',
    ],
    { binary: true },
  );
  assert.ok(database.length > 1000 && database.subarray(0, 5).toString() === 'PGDMP');
  assert.ok(documents.length > 1000);
  console.log(
    'Base and document backups captured as binary data; restoring into a separate project.',
  );

  const restored = (args, options = {}) =>
    command(args, { ...options, targetProject: restoreProject });
  await restored(['up', '-d', '--wait', 'db']);
  await restored(
    [
      'exec',
      '-T',
      'db',
      'pg_restore',
      '-U',
      'pulsar',
      '-d',
      'pulsar',
      '--exit-on-error',
      '--no-owner',
    ],
    { input: database },
  );
  await restored(
    [
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--entrypoint',
      'tar',
      'api',
      '-C',
      '/app/storage',
      '-xzf',
      '-',
    ],
    { input: documents },
  );
  const restoredSql = async (q) =>
    (
      await restored(['exec', '-T', 'db', 'psql', '-U', 'pulsar', '-d', 'pulsar', '-tAc', q])
    ).trim();
  assert.equal(await restoredSql('SELECT value FROM pilot_restore_probe WHERE id = 1'), marker);
  assert.equal(await restoredSql('SELECT md5("passwordHash") FROM platform_users'), before);
  assert.equal(await restoredSql('SELECT count(*) FROM tenants'), '0');
  assert.equal(
    await restoredSql(
      "SELECT md5(string_agg(migration_name || checksum, ',' ORDER BY migration_name)) FROM _prisma_migrations WHERE finished_at IS NOT NULL",
    ),
    migrationsBefore,
  );
  const restoredBytes = await restored([
    'run',
    '--rm',
    '--no-deps',
    '-T',
    '--entrypoint',
    'node',
    'api',
    '-e',
    "process.stdout.write(require('node:fs').readFileSync('/app/storage/restore-canary.bin').toString('base64'))",
  ]);
  assert.equal(restoredBytes, fileBytes);
  // Proof of isolation: changing the restored copy must not alter the source.
  await restoredSql("UPDATE pilot_restore_probe SET value = 'restored-only' WHERE id = 1");
  assert.equal(await sql('SELECT value FROM pilot_restore_probe WHERE id = 1'), marker);
  await restored(['up', '-d', 'api', 'web']);
  await ready();
  const restoredLogin = await fetch('http://127.0.0.1:8180/api/v1/platform/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.PLATFORM_ADMIN_EMAIL, password: initialPassword }),
  });
  assert.ok(restoredLogin.ok);
  const restoredAuth = await restoredLogin.json();
  assert.equal(restoredAuth.mfaEnrollmentRequired, true);
  assert.equal(restoredAuth.accessToken, undefined);
  console.log(
    'Restoration passed: migrations, credential, binary document, isolated volumes, readiness and mandatory MFA.',
  );
} finally {
  // Only the uniquely named test project created above is removed, never pulsar-dev.
  assert.match(project, /^pulsar-ovh-check-\d+-\d+$/);
  assert.equal(restoreProject, `${project}-restore`);
  // Try both cleanups even if the first fails; never point this at pulsar-dev.
  const cleanup = await Promise.allSettled(
    [project, restoreProject].map((targetProject) =>
      command(['down', '--volumes', '--remove-orphans'], { targetProject }),
    ),
  );
  const failure = cleanup.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  console.log('Disposable test containers and their volumes removed.');
}
