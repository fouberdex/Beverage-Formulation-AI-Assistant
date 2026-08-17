import { randomUUID, timingSafeEqual } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const requestMetrics = new Map();
const startedAt = Date.now();

export function createRequestId(rawRequest) {
  const supplied = rawRequest?.headers?.['x-request-id'];
  return typeof supplied === 'string' && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
}

export function tokensMatch(candidate, expected) {
  if (!candidate || !expected) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
}

export function observeRequest({ method, route, statusCode, durationMs }) {
  const normalizedRoute = route || 'unmatched';
  const statusClass = `${Math.floor(statusCode / 100)}xx`;
  const key = JSON.stringify([method, normalizedRoute, statusClass]);
  const current = requestMetrics.get(key) || { method, route: normalizedRoute, statusClass, count: 0, durationMs: 0 };
  current.count += 1;
  current.durationMs += Math.max(0, durationMs || 0);
  requestMetrics.set(key, current);
}

function escapeLabel(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

export function renderPrometheusMetrics({ version = 'unknown' } = {}) {
  const memory = process.memoryUsage();
  const lines = [
    '# HELP beverageai_app_info Application release information.',
    '# TYPE beverageai_app_info gauge',
    `beverageai_app_info{version="${escapeLabel(version)}"} 1`,
    '# HELP beverageai_process_uptime_seconds Process uptime in seconds.',
    '# TYPE beverageai_process_uptime_seconds gauge',
    `beverageai_process_uptime_seconds ${((Date.now() - startedAt) / 1000).toFixed(3)}`,
    '# HELP beverageai_process_resident_memory_bytes Resident memory in bytes.',
    '# TYPE beverageai_process_resident_memory_bytes gauge',
    `beverageai_process_resident_memory_bytes ${memory.rss}`,
    '# HELP beverageai_http_requests_total HTTP responses grouped by route and status class.',
    '# TYPE beverageai_http_requests_total counter',
    '# HELP beverageai_http_request_duration_seconds Request duration grouped by route and status class.',
    '# TYPE beverageai_http_request_duration_seconds summary',
  ];

  for (const metric of [...requestMetrics.values()].sort((left, right) =>
    `${left.method}:${left.route}:${left.statusClass}`.localeCompare(`${right.method}:${right.route}:${right.statusClass}`))) {
    const labels = `method="${escapeLabel(metric.method)}",route="${escapeLabel(metric.route)}",status_class="${metric.statusClass}"`;
    lines.push(`beverageai_http_requests_total{${labels}} ${metric.count}`);
    lines.push(`beverageai_http_request_duration_seconds_sum{${labels}} ${(metric.durationMs / 1000).toFixed(6)}`);
    lines.push(`beverageai_http_request_duration_seconds_count{${labels}} ${metric.count}`);
  }

  return `${lines.join('\n')}\n`;
}

export function resetRequestMetricsForTests() {
  requestMetrics.clear();
}
