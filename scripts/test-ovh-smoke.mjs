/** Local qualification of deploy/ovh/compose.yml using DISPOSABLE containers.
 * Prereq: build pulsar-api:control-center-test and pulsar-web:control-center-test.
 * No server access, no real secrets, no mutations to the normal development DB.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const project = `pulsar-ovh-check-${process.pid}-${Date.now()}`;
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
function command(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...base, ...args], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => {
      output += d;
    });
    child.stderr.on('data', (d) => {
      output += d;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`Docker ${args[0]} failed (${code}). ${output.slice(-1500)}`)),
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
} finally {
  // Only the uniquely named test project created above is removed, never pulsar-dev.
  assert.match(project, /^pulsar-ovh-check-\d+-\d+$/);
  await command(['down', '--volumes', '--remove-orphans']);
  console.log('Disposable test containers and their volumes removed.');
}
