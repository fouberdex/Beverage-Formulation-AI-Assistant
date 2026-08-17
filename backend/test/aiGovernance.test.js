import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIQuotaError,
  completeAIUsage,
  getAIPreferences,
  getAIQuotaStatus,
  reserveAIQuota,
  resetAIGovernanceForTests,
  updateAIPreferences,
} from '../src/services/aiGovernance.js';

test.beforeEach(() => {
  resetAIGovernanceForTests();
  process.env.AI_DAILY_REQUEST_LIMIT = '2';
  process.env.AI_MONTHLY_REQUEST_LIMIT = '3';
});

test.afterEach(() => {
  delete process.env.AI_DAILY_REQUEST_LIMIT;
  delete process.env.AI_MONTHLY_REQUEST_LIMIT;
});

test('external AI processing is private by default and explicitly configurable', async () => {
  assert.deepEqual(await getAIPreferences('tenant-a'), {
    external_processing_enabled: false,
    include_formulation_name: false,
  });
  const updated = await updateAIPreferences('tenant-a', {
    external_processing_enabled: true,
    include_formulation_name: false,
  });
  assert.equal(updated.external_processing_enabled, true);
  assert.equal((await getAIPreferences('tenant-b')).external_processing_enabled, false);
});

test('quota reservations are atomic per tenant and provider attempts remain counted', async () => {
  const reservations = await Promise.all([
    reserveAIQuota({ ownerId: 'tenant-a', requestId: 'request-1', operation: 'variant_review', provider: 'gemini', model: 'test' }),
    reserveAIQuota({ ownerId: 'tenant-a', requestId: 'request-2', operation: 'target_review', provider: 'gemini', model: 'test' }),
  ]);
  assert.deepEqual(reservations.map(item => item.daily_used).sort(), [1, 2]);
  await completeAIUsage({ ownerId: 'tenant-a', eventId: reservations[0].event_id, outcome: 'failed' });
  await assert.rejects(
    () => reserveAIQuota({ ownerId: 'tenant-a', requestId: 'request-3', operation: 'variant_review', provider: 'gemini', model: 'test' }),
    error => error instanceof AIQuotaError && error.code === 'AI_DAILY_QUOTA_EXCEEDED',
  );
  const status = await getAIQuotaStatus('tenant-a');
  assert.equal(status.daily_used, 2);
  assert.equal(status.daily_remaining, 0);
  assert.equal((await getAIQuotaStatus('tenant-b')).daily_used, 0);
});

test('a request identifier can reserve provider quota only once', async () => {
  await reserveAIQuota({ ownerId: 'tenant-a', requestId: 'same-request', operation: 'variant_review', provider: 'gemini', model: 'test' });
  await assert.rejects(
    () => reserveAIQuota({ ownerId: 'tenant-a', requestId: 'same-request', operation: 'variant_review', provider: 'gemini', model: 'test' }),
    error => error instanceof AIQuotaError && error.code === 'AI_REQUEST_ALREADY_RESERVED',
  );
});
