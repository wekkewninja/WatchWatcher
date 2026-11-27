import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import pg from 'pg';

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const require = createRequire(import.meta.url);
const migrationCli = require.resolve('node-pg-migrate/bin/node-pg-migrate');
const apiDirectory = path.resolve('services/watchwatcher-api');
const migrationCount = readdirSync(path.join(apiDirectory, 'migrations')).filter((file) => /^\d+.*\.js$/.test(file)).length;

test('migrations apply, roll back and reapply with glob discovery', async () => {
  assert.ok(databaseUrl, 'Set MIGRATION_TEST_DATABASE_URL to a disposable PostgreSQL database.');
  assert.ok(migrationCount > 0, 'No migration files found.');
  const schema = `migration_test_${randomUUID().replaceAll('-', '')}`;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let created = false;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const migrate = (direction, directory, ...extra) => {
      const result = spawnSync(process.execPath, [migrationCli, direction, '--migrations-dir', directory,
        '--schema', schema, '--migrations-schema', schema, ...extra], {
        cwd: apiDirectory,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, `Migration failed: ${result.error?.message ?? result.stderr}`);
    };
    const count = async () => Number((await client.query(`SELECT count(*) FROM "${schema}".pgmigrations`)).rows[0].count);

    migrate('up', 'migrations');
    assert.equal(await count(), migrationCount);
    migrate('down', 'migrations', String(migrationCount));
    assert.equal(await count(), 0);
    migrate('up', 'migrations/*.js', '--use-glob');
    assert.equal(await count(), migrationCount);
    migrate('down', 'migrations/*.js', String(migrationCount), '--use-glob');
    assert.equal(await count(), 0);
  } finally {
    if (created) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.end();
  }
});