import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';

const obsoletePaths = [
  'src/routes/ai.js',
  'src/routes/compatibility.js',
  'src/routes/cost.js',
  'src/routes/formulations.js',
  'src/routes/ingredients.js',
  'src/routes/regulatory.js',
  'src/routes/targetGeneration.js',
  'src/services/aiService.js',
  'src/services/compatibilityService.js',
  'src/services/costService.js',
  'src/services/formulationCalculations.js',
  'src/services/formulationService.js',
  'src/services/ingredientService.js',
  'src/services/regulatoryService.js',
  'src/services/targetGenerationService.js',
  'src/db/connection.js',
  'src/db/migrate.js',
];

async function exists(path) {
  try { await access(new URL(`../${path}`, import.meta.url)); return true; }
  catch { return false; }
}

test('obsolete parallel backend implementations cannot return unnoticed', async () => {
  const present = [];
  for (const path of obsoletePaths) if (await exists(path)) present.push(path);
  assert.deepEqual(present, [], `Obsolete backend files returned: ${present.join(', ')}`);
});

test('backend package does not expose the superseded direct-schema migration path', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts?.migrate, undefined);
  assert.equal(packageJson.dependencies?.pg, undefined);
});

test('the active server imports the current deterministic engines', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /from ['"]\.\/services\/formulationIntelligence\.js['"]/);
  assert.match(server, /from ['"]\.\/services\/productPassportEngine\.js['"]/);
  assert.doesNotMatch(server, /from ['"]\.\/routes\//);
});
