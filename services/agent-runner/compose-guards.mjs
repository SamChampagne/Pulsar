// Read-only Compose validation with synthetic interpolation; never print resolved secrets.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const env = {
  ...process.env,
  PULSAR_BUILD_VERSION: 'runner-fixture',
  POSTGRES_PASSWORD: 'fixture',
  JWT_SECRET: 'fixture',
  ENCRYPTION_KEY: 'fixture',
  PLATFORM_ADMIN_EMAIL: 'fixture@example.invalid',
  PLATFORM_ADMIN_PASSWORD: 'fixture',
  PULSAR_AGENT_CONFIG_DIR: path.resolve('deploy/agent-runner'),
  PULSAR_AGENT_TENANT_ID: 'fixture',
  PULSAR_AGENT_ALLOWED_HOSTS: 'example.com',
};
const config = JSON.parse(
  execFileSync(
    'docker',
    [
      'compose',
      '--env-file',
      'deploy/ovh/env.example',
      '-f',
      'deploy/ovh/compose.yml',
      '-f',
      'deploy/agent-runner/compose.yml',
      'config',
      '--format',
      'json',
    ],
    { encoding: 'utf8', env, windowsHide: true, maxBuffer: 1024 * 1024 },
  ),
);
const runner = config.services['agent-runner'];
assert.equal(runner.read_only, true);
assert.equal(runner.user, '1000:1000');
assert.deepEqual(runner.cap_drop, ['ALL']);
assert.equal(runner.ports, undefined);
assert.ok(runner.security_opt.includes('no-new-privileges:true'));
assert.deepEqual(Object.keys(runner.networks), ['agent_tenant']);
assert.equal(config.networks.agent_tenant.internal, true);
assert.equal(config.services['agent-egress'].ports, undefined);
assert.equal(runner.tmpfs.length, 1);
assert.ok(runner.tmpfs[0].includes('noexec'));
assert.equal(config.services.api.environment.AGENT_RUNTIME_MODE, 'remote');
assert.equal(config.services.api.read_only, true);
assert.equal(runner.environment.DATABASE_URL, undefined);
assert.equal(runner.environment.JWT_SECRET, undefined);
assert.ok(!JSON.stringify(runner.volumes).includes('docker.sock'));
assert.ok(!Object.keys(config.services.db.networks).includes('agent_tenant'));
console.log(
  'PASS merged OVH Compose: private tenant network, no DB/host ports/socket, non-root read-only, one bounded tmpfs, remote API mode',
);
