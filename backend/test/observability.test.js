import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRequestId,
  observeRequest,
  renderPrometheusMetrics,
  resetRequestMetricsForTests,
  tokensMatch,
} from '../src/services/observability.js';

test('request correlation accepts safe IDs and rejects unsafe input', () => {
  assert.equal(createRequestId({ headers: { 'x-request-id': 'trace-123' } }), 'trace-123');
  assert.match(createRequestId({ headers: { 'x-request-id': 'bad\nlog-entry' } }), /^[0-9a-f-]{36}$/);
});

test('metrics aggregate route counts without tenant or URL cardinality', () => {
  resetRequestMetricsForTests();
  observeRequest({ method: 'GET', route: '/api/v1/formulations/:id', statusCode: 200, durationMs: 12 });
  observeRequest({ method: 'GET', route: '/api/v1/formulations/:id', statusCode: 204, durationMs: 8 });
  const output = renderPrometheusMetrics({ version: 'test' });

  assert.match(output, /beverageai_app_info\{version="test"\} 1/);
  assert.match(output, /route="\/api\/v1\/formulations\/:id",status_class="2xx"} 2/);
  assert.doesNotMatch(output, /tenant|authorization|trace-123/i);
});

test('metrics bearer tokens use exact constant-time comparison semantics', () => {
  assert.equal(tokensMatch('same-token', 'same-token'), true);
  assert.equal(tokensMatch('wrong-token', 'same-token'), false);
  assert.equal(tokensMatch('', 'same-token'), false);
});
