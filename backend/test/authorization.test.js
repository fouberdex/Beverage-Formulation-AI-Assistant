import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeApiRequest, hasPermission, PERMISSIONS, USER_ROLES } from '../src/services/authorization.js';

test('read requests are available to every valid authenticated role', () => {
  for (const role of Object.values(USER_ROLES)) {
    assert.equal(authorizeApiRequest({ method: 'GET', path: '/api/v1/projects', role }).allowed, true);
  }
  assert.equal(authorizeApiRequest({ method: 'GET', path: '/api/v1/projects', role: 'unknown' }).allowed, false);
});

test('administrator resources remain protected even for read requests', () => {
  assert.equal(authorizeApiRequest({ method: 'GET', path: '/api/v1/admin/users', role: USER_ROLES.ADMIN }).allowed, true);
  for (const role of Object.values(USER_ROLES).filter(role => role !== USER_ROLES.ADMIN)) {
    assert.equal(authorizeApiRequest({ method: 'GET', path: '/api/v1/admin/users', role }).allowed, false);
  }
});

test('role capabilities encode specialist segregation of duties', () => {
  assert.equal(hasPermission(USER_ROLES.FORMULATOR, PERMISSIONS.MANAGE_FORMULATIONS), true);
  assert.equal(hasPermission(USER_ROLES.FORMULATOR, PERMISSIONS.PERFORM_QC_RELEASE), false);
  assert.equal(hasPermission(USER_ROLES.LAB, PERMISSIONS.MANAGE_LAB), true);
  assert.equal(hasPermission(USER_ROLES.LAB, PERMISSIONS.APPROVE_SPECIFICATIONS), false);
  assert.equal(hasPermission(USER_ROLES.QA, PERMISSIONS.PERFORM_QC_RELEASE), true);
  assert.equal(hasPermission(USER_ROLES.REGULATORY, PERMISSIONS.MANAGE_REGULATORY), true);
  assert.equal(hasPermission(USER_ROLES.VIEWER, PERMISSIONS.MANAGE_PROJECTS), false);
});

test('sensitive workflow decisions require their explicit permission', () => {
  const cases = [
    ['POST', '/api/v1/projects/project-1/qc-releases', USER_ROLES.FORMULATOR, false],
    ['POST', '/api/v1/projects/project-1/qc-releases', USER_ROLES.QA, true],
    ['PUT', '/api/v1/projects/project-1/quality-events/event-1', USER_ROLES.FORMULATOR, false],
    ['PUT', '/api/v1/projects/project-1/capas/capa-1', USER_ROLES.FORMULATOR, false],
    ['POST', '/api/v1/projects/project-1/specifications/spec-1/approve', USER_ROLES.LAB, false],
    ['POST', '/api/v1/projects/project-1/specifications/spec-1/approve', USER_ROLES.QA, true],
    ['POST', '/api/v1/regulatory/formulations/form-1/labels', USER_ROLES.FORMULATOR, false],
    ['POST', '/api/v1/regulatory/formulations/form-1/labels', USER_ROLES.REGULATORY, true],
  ];
  for (const [method, path, role, allowed] of cases) {
    assert.equal(authorizeApiRequest({ method, path, role }).allowed, allowed, `${role} ${method} ${path}`);
  }
});

test('domain mutations are assigned to the matching specialist capability', () => {
  assert.equal(authorizeApiRequest({ method: 'POST', path: '/api/v1/formulations', role: USER_ROLES.FORMULATOR }).allowed, true);
  assert.equal(authorizeApiRequest({ method: 'POST', path: '/api/v1/formulations/form-1/laboratory-results', role: USER_ROLES.FORMULATOR }).allowed, false);
  assert.equal(authorizeApiRequest({ method: 'POST', path: '/api/v1/formulations/form-1/laboratory-results', role: USER_ROLES.LAB }).allowed, true);
  assert.equal(authorizeApiRequest({ method: 'POST', path: '/api/v1/sensory/studies', role: USER_ROLES.SENSORY }).allowed, true);
  assert.equal(authorizeApiRequest({ method: 'POST', path: '/api/v1/supply-chain/suppliers', role: USER_ROLES.PROCUREMENT }).allowed, true);
  assert.equal(authorizeApiRequest({ method: 'POST', path: '/api/v1/projects', role: USER_ROLES.VIEWER }).allowed, false);
});

test('own profile and AI privacy consent remain self-service', () => {
  for (const role of Object.values(USER_ROLES)) {
    assert.equal(authorizeApiRequest({ method: 'PUT', path: '/api/v1/auth/profile', role }).allowed, true);
    assert.equal(authorizeApiRequest({ method: 'PUT', path: '/api/v1/ai/preferences', role }).allowed, true);
  }
});

test('unclassified mutations are denied by default, including for administrators', () => {
  const result = authorizeApiRequest({ method: 'POST', path: '/api/v1/unclassified-operation', role: USER_ROLES.ADMIN });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /denied by default/);
});
