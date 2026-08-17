import test from 'node:test';
import assert from 'node:assert/strict';
import { isBootstrapAdministrator } from '../src/services/supabaseClient.js';

test('admin bootstrap matches only the configured authenticated email', () => {
  const environment = { BOOTSTRAP_ADMIN_EMAIL: ' Admin@Example.com ' };

  assert.equal(isBootstrapAdministrator({ email: 'admin@example.com' }, environment), true);
  assert.equal(isBootstrapAdministrator({ email: 'other@example.com' }, environment), false);
  assert.equal(isBootstrapAdministrator({}, environment), false);
  assert.equal(isBootstrapAdministrator({ email: 'admin@example.com' }, {}), false);
});
