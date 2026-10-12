// Opt-in local Docker/PostGIS test. Creates and removes only UUID test databases/files.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { config } from 'dotenv';
config({ path: '../.env', quiet: true });
const container = process.env.BACKUP_TEST_CONTAINER;
const source = new URL(process.env.DATABASE_URL);
assert.equal(process.env.NODE_ENV, 'test', 'Use NODE_ENV=test');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname), 'Local database required');
assert.match(container ?? '', /^trotot-(?:s345|backup-test)-[a-f0-9]{12}-postgres-1$/);
function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 60_000, ...options });
}
const project = docker(['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', container]).trim();
assert.equal(container, `${project}-postgres-1`, 'Container must belong to isolated test project');
const ports = JSON.parse(docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', container]));
assert.ok(ports['5432/tcp'].some(p => p.HostPort === source.port && p.HostIp === '127.0.0.1'));
const id = randomUUID().replaceAll('-', '');
const names = [`trotot_backup_test_${id}`, `trotot_restore_test_${id}`];
const directory = `/tmp/trotot-backup-test-${id}`;
const admin = new Pool({ connectionString: source.toString() });
const created = [];
let database;
let restored;
function shell(command, env = []) {
  return docker(['exec', ...env.flatMap(v => ['-e', v]), container, 'bash', '-c', command]);
}
async function snapshot(pool) {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const data = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-zA-Z0-9_]+$/);
    data[tablename] = (await pool.query(`SELECT count(*)::int AS count, md5(string_agg(t::text, '' ORDER BY t::text)) AS digest FROM "${tablename}" t`)).rows[0];
  }
  return data;
}
async function schemaSnapshot(pool) {
  // Counts alone cannot prove that restored inventory/ledger guards still exist.
  const queries = {
    // pg_dump expands array casts in CHECK/exclusion predicates on restore. Compare identity/flags,
    // then exercise representative checks below; retain exact definitions for FK/unique/primary keys.
    constraints: `SELECT c.conrelid::regclass::text AS relation, c.conname,c.contype,c.convalidated,c.condeferrable,c.condeferred,c.conkey,
      CASE WHEN c.contype IN ('p','u','f') THEN pg_get_constraintdef(c.oid) END AS definition
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY 1,2`,
    indexes: `SELECT c.relname AS tablename,idx.relname AS indexname,am.amname,i.indisunique,i.indisvalid,i.indisready,
      i.indkey::text AS columns,i.indnkeyatts,i.indnatts,(i.indpred IS NOT NULL) AS partial,(i.indexprs IS NOT NULL) AS expression
      FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class idx ON idx.oid=i.indexrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_am am ON am.oid=idx.relam
      WHERE n.nspname='public' ORDER BY c.relname,idx.relname`,
    triggers: `SELECT t.tgrelid::regclass::text AS relation,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY 1,2`,
    functions: `SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prokind='f' AND NOT EXISTS
        (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY 1,2`,
    extensions: 'SELECT extname,extversion FROM pg_extension ORDER BY extname',
  };
  const result = {};
  for (const [name, query] of Object.entries(queries)) result[name] = (await pool.query(query)).rows;
  return result;
}
try {
  for (const name of names) { await admin.query(`CREATE DATABASE "${name}"`); created.push(name); }
  const url = new URL(source); url.pathname = `/${names[0]}`;
  execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe', timeout: 90_000,
  });
  database = new Pool({ connectionString: url.toString() });
  await database.query(`INSERT INTO users(id,phone,password_hash,full_name,role) VALUES
    ('00000000-0000-4000-8000-000000000001','0999999999','fixture-only','Backup fixture','HOST');
    INSERT INTO host_profiles(user_id,balance_wallet) VALUES ('00000000-0000-4000-8000-000000000001',123456.78);
    INSERT INTO address_provinces(code,name) VALUES ('TEST','Fixture only');
    INSERT INTO address_wards(code,name,province_code) VALUES ('TEST','Fixture only','TEST');
    INSERT INTO properties(id,host_id,title,slug,property_type,rental_mode,description,address_detail,province_code,ward_code,latitude,longitude,status)
    VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Backup fixture','backup-fixture','PHONG_TRO','LONG_TERM','Fixture only','Fixture only','TEST','TEST',10,106,'PUBLISHED');
    INSERT INTO property_revisions(property_id,content) VALUES ('00000000-0000-4000-8000-000000000002','{"title":"Pending fixture"}');`);
  await database.query(`INSERT INTO users(id,phone,password_hash,full_name,role) VALUES
    ('00000000-0000-4000-8000-000000000003','0999999998','fixture-only','Backup Admin fixture','ADMIN');
    UPDATE properties SET version=2 WHERE id='00000000-0000-4000-8000-000000000002';
    INSERT INTO listing_moderation_events(property_id,actor_id,action,target,reviewed_version,result_version,status_before,status_after)
    VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','APPROVE','LISTING',1,2,'PENDING_REVIEW','PUBLISHED');`);
  await database.query(`INSERT INTO homestay_units(id,property_id,unit_name,max_adults,max_children,bedrooms,bathrooms,
      base_price_per_night,cleaning_fee,check_in_time,check_out_time,cancellation_policy,instant_book)
    VALUES ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002',
      'Backup unit fixture',2,1,1,1,350000,50000,'14:00','12:00','FLEXIBLE',true);
    INSERT INTO calendar_pricing(homestay_unit_id,date,custom_price,status)
    VALUES ('00000000-0000-4000-8000-000000000004','2099-01-01',400000,'AVAILABLE'),
      ('00000000-0000-4000-8000-000000000004','2099-01-02',NULL,'BLOCKED');`);
  const fixture=(operation,url)=>execFileSync(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),resolve('test/backup-fixtures.ts'),operation],{
    env:{...process.env,DATABASE_URL:url.toString()},encoding:'utf8',stdio:'pipe',timeout:60000});
  fixture('seed',url);
  const before = await snapshot(database);
  const schemaBefore = await schemaSnapshot(database);
  assert.ok(schemaBefore.constraints.some(c => c.relation === 'bookings' && c.contype === 'x'),
    'Source must contain the booking overlap guard');
  assert.ok(schemaBefore.triggers.some(t => t.relation === 'finance_entries'), 'Source must contain ledger guards');
  docker(['exec', container, 'mkdir', '-m', '700', directory]);
  docker(['cp', resolve('scripts/backup-database.sh'), `${container}:${directory}/backup.sh`]);
  const pgEnv = [`PGUSER=${decodeURIComponent(source.username)}`, `PGDATABASE=${names[0]}`];
  const archive = shell(`bash ${directory}/backup.sh ${directory}/backups`, pgEnv).trim();
  assert.match(archive, new RegExp(`^${directory}/backups/[0-9TZ]+-[a-zA-Z0-9]+$`));
  shell(`cd ${archive} && sha256sum -c SHA256SUMS && gzip -t database.sql.gz`);
  assert.equal(shell(`stat -c '%a' ${archive}`).trim(), '700');
  assert.equal(shell(`stat -c '%a' ${archive}/database.sql.gz`).trim(), '600');
  shell(`set -o pipefail; gzip -dc ${archive}/database.sql.gz | psql --no-password --single-transaction --set ON_ERROR_STOP=on >/dev/null`,
    [`PGUSER=${decodeURIComponent(source.username)}`, `PGDATABASE=${names[1]}`]);
  const restoredUrl = new URL(source); restoredUrl.pathname = `/${names[1]}`;
  restored = new Pool({ connectionString: restoredUrl.toString() });
  assert.deepEqual(await snapshot(restored), before, 'All public table counts/content and migration records must match');
  const schemaAfter = await schemaSnapshot(restored);
  for (const [category, rows] of Object.entries(schemaBefore)) {
    assert.equal(schemaAfter[category].length, rows.length, `${category} count must survive restore`);
    for (let index = 0; index < rows.length; index++) {
      assert.ok(JSON.stringify(schemaAfter[category][index]) === JSON.stringify(rows[index]),
        `${category} definition mismatch at ${rows[index].conname ?? rows[index].indexname ?? rows[index].tgname ?? rows[index].proname ?? rows[index].extname}`);
    }
  }
  const upgrade = execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: restoredUrl.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 90_000,
  });
  assert.match(upgrade, /No pending migrations to apply/);
  assert.equal((await restored.query('SELECT sum(balance_wallet)::text AS total FROM host_profiles')).rows[0].total, '123456.78');
  assert.equal((await restored.query("SELECT count(*)::int AS n FROM listing_moderation_events e JOIN users u ON u.id=e.actor_id JOIN properties p ON p.id=e.property_id WHERE u.role='ADMIN' AND e.result_version=p.version")).rows[0].n,1);
  assert.equal((await restored.query('SELECT count(*)::int AS n FROM properties p JOIN users u ON u.id=p.host_id JOIN property_revisions r ON r.property_id=p.id JOIN address_wards w ON w.code=p.ward_code')).rows[0].n, 1);
  await assert.rejects(restored.query("INSERT INTO host_profiles(user_id) VALUES ('00000000-0000-4000-8000-000000000099')"), /foreign key/);
  await assert.rejects(restored.query("INSERT INTO calendar_pricing(homestay_unit_id,date,status) VALUES ('00000000-0000-4000-8000-000000000004','2099-01-01','AVAILABLE')"), /unique constraint/);
  await assert.rejects(restored.query("UPDATE homestay_units SET max_adults=0 WHERE id='00000000-0000-4000-8000-000000000004'"), /check constraint/);
  const nextCalendar = (await restored.query("INSERT INTO calendar_pricing(homestay_unit_id,date,status) VALUES ('00000000-0000-4000-8000-000000000004','2099-01-03','AVAILABLE') RETURNING id")).rows[0];
  assert.ok(BigInt(nextCalendar.id) > 2n, 'Restored sequence must not collide with existing rows');
  console.log(fixture('verify',restoredUrl).trim());
  for (const [label, command, env] of [
    ['missing database config', `unset PGDATABASE; bash ${directory}/backup.sh ${directory}/missing`, []],
    ['database unavailable', `bash ${directory}/backup.sh ${directory}/unavailable`, [`PGUSER=${decodeURIComponent(source.username)}`, `PGDATABASE=trotot_missing_${id}`]],
    ['compression failure', `mkdir -p ${directory}/bin; printf '#!/bin/sh\nexit 1\n' > ${directory}/bin/gzip; chmod 700 ${directory}/bin/gzip; PATH=${directory}/bin:$PATH bash ${directory}/backup.sh ${directory}/compression`, pgEnv],
    ['dump warning', `mkdir -p ${directory}/warn-bin; printf '#!/bin/sh\n/usr/bin/pg_dump "$@"\necho warning >&2\n' > ${directory}/warn-bin/pg_dump; chmod 700 ${directory}/warn-bin/pg_dump; PATH=${directory}/warn-bin:$PATH bash ${directory}/backup.sh ${directory}/warning`, pgEnv],
    ['disk full simulation', `mkdir -p ${directory}/full-bin; printf '#!/bin/sh\nexec /usr/bin/gzip "$@" >/dev/full\n' > ${directory}/full-bin/gzip; chmod 700 ${directory}/full-bin/gzip; PATH=${directory}/full-bin:$PATH bash ${directory}/backup.sh ${directory}/disk-full`, pgEnv],
    ['checksum failure', `mkdir -p ${directory}/sum-bin; printf '#!/bin/sh\nexit 1\n' > ${directory}/sum-bin/sha256sum; chmod 700 ${directory}/sum-bin/sha256sum; PATH=${directory}/sum-bin:$PATH bash ${directory}/backup.sh ${directory}/checksum`, pgEnv],
    ['write failure', `bash ${directory}/backup.sh /proc/trotot-backup-test-${id}`, pgEnv],
  ]) {
    const result = spawnSync('docker', ['exec', ...env.flatMap(v => ['-e', v]), container, 'bash', '-c', command], { encoding: 'utf8', timeout: 30_000 });
    assert.notEqual(result.status, 0, label);
  }
  assert.equal(shell(`find ${directory}/missing ${directory}/unavailable ${directory}/compression ${directory}/warning ${directory}/disk-full ${directory}/checksum -mindepth 1 -print 2>/dev/null || true`).trim(), '', 'Failed backups must leave no completed or partial files');
  shell(`printf 'corrupt' >> ${archive}/database.sql.gz`);
  assert.throws(() => shell(`cd ${archive} && sha256sum -c SHA256SUMS`), 'Checksum must detect corruption');
  console.log(JSON.stringify({ result: 'PASS', tables: Object.keys(before).length, migrations: before._prisma_migrations.count,
    real: 'PostgreSQL/PostGIS + pg_dump/gzip/psql + BullMQ/Redis worker', checks: ['content/relations/wallet/calendar fixtures', 'constraint/index metadata and trigger/function/extension definitions match', 'restored calendar uniqueness/capacity/sequence', 'migration after restore no-op', 'real worker startup recovers both overdue booking paths and releases DB inventory without recording payment', 'permissions', 'missing config', 'database unavailable', 'dump warnings', 'compression/write/checksum failure', 'disk full via /dev/full', 'partial cleanup', 'corruption detection'],
    notRun: ['offsite/retention/schedule', 'physical disk full', 'real payment/provider retry after restore'] }));
} finally {
  await database?.end(); await restored?.end();
  for (const name of created) {
    assert.match(name, /^trotot_(?:backup|restore)_test_[a-f0-9]{32}$/);
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.end();
  assert.match(directory, /^\/tmp\/trotot-backup-test-[a-f0-9]{32}$/);
  docker(['exec', container, 'rm', '-rf', '--', directory]);
}
