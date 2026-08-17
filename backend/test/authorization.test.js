import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeApiRequest, USER_ROLES } from '../src/services/authorization.js';

test('read requests are available to every authenticated role', () => {
  for (const role of Object.values(USER_ROLES)) {
    assert.equal(authorizeApiRequest({ method: 'GET', path: '/api/v1/ingredients', role }).allowed, true);
  }
});

test('only administrators can change the shared ingredient catalog and pricing', () => {
  const paths = ['/api/v1/ingredients', '/api/v1/ingredients/ingredient-1', '/api/v1/cost/ingredients/ingredient-1/pricing'];
  for (const path of paths) {
    assert.equal(authorizeApiRequest({ method: 'POST', path, role: USER_ROLES.ADMIN }).allowed, true);
    assert.equal(authorizeApiRequest({ method: 'PUT', path, role: USER_ROLES.FORMULATOR }).allowed, false);
  }
});

test('viewers are read-only except for their own profile', () => {
  assert.equal(authorizeApiRequest({ method: 'POST', path: '/api/v1/formulations', role: USER_ROLES.VIEWER }).allowed, false);
  assert.equal(authorizeApiRequest({ method: 'PUT', path: '/api/v1/auth/profile', role: USER_ROLES.VIEWER }).allowed, true);
});

test('only administrators can call administrator endpoints, including reads', () => {
  for (const method of ['GET', 'PUT']) {
    assert.equal(authorizeApiRequest({ method, path: '/api/v1/admin/users/user-1/role', role: USER_ROLES.ADMIN }).allowed, true);
    assert.equal(authorizeApiRequest({ method, path: '/api/v1/admin/users/user-1/role', role: USER_ROLES.FORMULATOR }).allowed, false);
    assert.equal(authorizeApiRequest({ method, path: '/api/v1/admin/users/user-1/role', role: USER_ROLES.VIEWER }).allowed, false);
  }
});
