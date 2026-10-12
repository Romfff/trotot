import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const prepare = resolve(root, 'ops/prepare-local-https.mjs');

for (const host of ['0.0.0.0', '8.8.8.8', 'example.com', '172.32.1.2', '192.168.1.999', '::1']) {
  test(`rejects public/wildcard/invalid host ${host} before reading configuration`, async () => {
    const result = spawnSync(process.execPath, [prepare, 'missing-manifest.json', host], { windowsHide: true });
    assert.notEqual(result.status, 0);
    assert.match(String(result.stderr), /Only an explicit loopback\/private IPv4/);
  });
}
test('rejects an otherwise valid owner manifest outside its owned directory before reading an env', async () => {
  const directory = await mkdtemp(resolve(root, '.tmp', 'https-guard-'));
  const manifest = resolve(directory, 'owned-resources.json');
  const id = '0123456789abcdef0123456789abcdef';
  try {
    await writeFile(manifest, JSON.stringify({ project: `trotot-app-test-${id.slice(0, 12)}`, id, database: `app_test_${id}` }));
    const result = spawnSync(process.execPath, [prepare, manifest], { windowsHide: true });
    assert.notEqual(result.status, 0);
    assert.match(String(result.stderr), /Do not use external\/unowned env files/);
    assert.deepEqual(await readdir(directory), ['owned-resources.json']);
  } finally { await unlink(manifest); await rmdir(directory); }
});
for (const port of ['443', '5000', '5432', '6379', '65536', 'not-a-port']) {
  test(`rejects reserved/invalid edge port ${port}`, () => {
    const result = spawnSync(process.execPath, [prepare, 'missing-manifest.json', '127.0.0.1', port], { windowsHide: true });
    assert.notEqual(result.status, 0);
    assert.match(String(result.stderr), /separate unprivileged edge port/);
  });
}
test('HTTPS override replaces HTTP binding and never mounts CA private key', async () => {
  const config = await readFile(resolve(root, 'compose.app.https.local.yaml'), 'utf8');
  assert.match(config, /ports: !override/);
  assert.match(config, /LOCAL_PREVIEW_BIND:-127\.0\.0\.1/);
  assert.match(config, /server\.key:.*:ro/);
  assert.doesNotMatch(config, /ca\.key|trustStore|privileged:/);
});
test('edge overwrites proxy identity, rejects wrong Host and proxies Socket upgrade', async () => {
  const config = await readFile(resolve(root, 'ops/nginx.https.local.conf.template'), 'utf8');
  assert.match(config, /if \(\$http_host != "__HOST__:__PORT__"\) \{ return 444; \}/);
  assert.match(config, /proxy_set_header X-Trotot-Edge-IP \$remote_addr/);
  assert.match(config, /proxy_set_header X-Trotot-Proxy-Signature ''/);
  assert.match(config, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(config, /ssl_protocols TLSv1\.2 TLSv1\.3/);
  assert.match(config, /location \/api\/docs \{ return 404; \}/);
});
