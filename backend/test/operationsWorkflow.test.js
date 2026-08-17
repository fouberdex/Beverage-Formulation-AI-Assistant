import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

test('GitHub workflows pin actions to immutable commits', async () => {
  const workflowDirectory = new URL('.github/workflows/', root);
  for (const name of await readdir(workflowDirectory)) {
    const workflow = await readFile(new URL(name, workflowDirectory), 'utf8');
    for (const match of workflow.matchAll(/uses:\s+[^\s@]+@([^\s#]+)/g)) {
      assert.match(match[1], /^[0-9a-f]{40}$/, `${name} contains an unpinned action: ${match[0]}`);
    }
  }
});

test('release workflow previews migrations and publishes hardened artifacts', async () => {
  const release = await readFile(new URL('.github/workflows/release.yml', root), 'utf8');
  assert.ok(release.indexOf('db push --linked --password "$SUPABASE_DB_PASSWORD" --dry-run') <
    release.indexOf('db push --linked --password "$SUPABASE_DB_PASSWORD"\n'));
  assert.match(release, /environment: production-database/);
  assert.match(release, /provenance: mode=max/);
  assert.match(release, /sbom: true/);
});

test('backup workflow encrypts dumps before artifact upload', async () => {
  const backup = await readFile(new URL('.github/workflows/backup.yml', root), 'utf8');
  assert.match(backup, /openssl enc -aes-256-cbc -pbkdf2 -salt/);
  assert.match(backup, /backup\/\*\.enc/);
  assert.doesNotMatch(backup, /path:[\s\S]{0,120}backup\/plain/);
});

test('production container runs unprivileged with health and filesystem controls', async () => {
  const dockerfile = await readFile(new URL('Dockerfile', root), 'utf8');
  const compose = await readFile(new URL('compose.production.yaml', root), 'utf8');
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
});
