import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeConfiguration } from '../src/services/runtimeConfiguration.js';

test('local file storage is allowed only on a loopback host', () => {
  assert.doesNotThrow(() => validateRuntimeConfiguration({ HOST: '127.0.0.1' }));
  assert.throws(
    () => validateRuntimeConfiguration({ HOST: '0.0.0.0' }),
    /File storage is unauthenticated and may only bind to a loopback host/,
  );
});

test('production requires authenticated Supabase storage', () => {
  assert.throws(
    () => validateRuntimeConfiguration({
      NODE_ENV: 'production',
      STORAGE_MODE: 'file',
      CORS_ORIGINS: 'https://app.example.com',
    }),
    /STORAGE_MODE must be supabase in production/,
  );

  assert.throws(
    () => validateRuntimeConfiguration({
      NODE_ENV: 'production',
      STORAGE_MODE: 'supabase',
      CORS_ORIGINS: 'https://app.example.com',
    }),
    /SUPABASE_URL is required in production/,
  );

  assert.throws(
    () => validateRuntimeConfiguration({
      NODE_ENV: 'production',
      STORAGE_MODE: 'supabase',
      PERSIST_DATA: 'false',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SECRET_KEY: 'server-secret',
      BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
      METRICS_TOKEN: 'm'.repeat(32),
      CORS_ORIGINS: 'https://app.example.com',
    }),
    /PERSIST_DATA cannot be false in production/,
  );
});

test('production requires an explicit secure CORS allowlist', () => {
  const base = {
    NODE_ENV: 'production',
    STORAGE_MODE: 'supabase',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'server-secret',
    BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
    METRICS_TOKEN: 'm'.repeat(32),
  };

  assert.throws(() => validateRuntimeConfiguration(base), /CORS_ORIGINS must be explicitly configured/);
  assert.throws(() => validateRuntimeConfiguration({ ...base, CORS_ORIGINS: '*' }), /cannot contain a wildcard/);
  assert.throws(
    () => validateRuntimeConfiguration({ ...base, CORS_ORIGINS: 'http://app.example.com' }),
    /invalid or insecure origin/,
  );
  assert.doesNotThrow(() => validateRuntimeConfiguration({
    ...base,
    CORS_ORIGINS: 'https://app.example.com,https://admin.example.com',
  }));
});

test('production requires an explicit bootstrap administrator identity', () => {
  const base = {
    NODE_ENV: 'production',
    STORAGE_MODE: 'supabase',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'server-secret',
    CORS_ORIGINS: 'https://app.example.com',
    METRICS_TOKEN: 'm'.repeat(32),
  };

  assert.throws(() => validateRuntimeConfiguration(base), /BOOTSTRAP_ADMIN_EMAIL is required/);
  assert.throws(
    () => validateRuntimeConfiguration({ ...base, BOOTSTRAP_ADMIN_EMAIL: 'not-an-email' }),
    /must be a valid email address/,
  );
});

test('production validates operational security controls', () => {
  const base = {
    NODE_ENV: 'production',
    STORAGE_MODE: 'supabase',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'server-secret',
    BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
    METRICS_TOKEN: 'm'.repeat(32),
    CORS_ORIGINS: 'https://app.example.com',
  };

  assert.throws(
    () => validateRuntimeConfiguration({ ...base, METRICS_TOKEN: 'short' }),
    /METRICS_TOKEN must contain at least 32 characters/,
  );
  assert.throws(
    () => validateRuntimeConfiguration({ ...base, TRUST_PROXY: '*' }),
    /only trusted proxy IP addresses/,
  );
  assert.throws(
    () => validateRuntimeConfiguration({ ...base, BODY_LIMIT_BYTES: '99999999' }),
    /BODY_LIMIT_BYTES must be an integer/,
  );
  assert.doesNotThrow(() => validateRuntimeConfiguration({ ...base, TRUST_PROXY: '10.0.0.0/8' }));
});
