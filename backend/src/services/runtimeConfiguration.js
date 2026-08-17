const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

function parseAllowedOrigins(value, errors) {
  if (!value?.trim()) {
    errors.push('CORS_ORIGINS must be explicitly configured in production');
    return;
  }

  for (const origin of value.split(',').map(item => item.trim()).filter(Boolean)) {
    if (origin === '*') {
      errors.push('CORS_ORIGINS cannot contain a wildcard in production');
      continue;
    }

    try {
      const url = new URL(origin);
      const isSecure = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname));
      if (!isSecure || url.origin !== origin) {
        errors.push(`CORS_ORIGINS contains an invalid or insecure origin: ${origin}`);
      }
    } catch {
      errors.push(`CORS_ORIGINS contains an invalid origin: ${origin}`);
    }
  }
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateNumericLimit(environment, name, minimum, maximum, errors) {
  if (environment[name] === undefined) return;
  const value = Number(environment[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    errors.push(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

export function validateRuntimeConfiguration(environment = process.env) {
  const production = environment.NODE_ENV === 'production';
  const storageMode = environment.STORAGE_MODE || 'file';
  const host = environment.HOST || '127.0.0.1';
  const errors = [];

  if (storageMode !== 'supabase' && !isLoopbackHost(host)) {
    errors.push('File storage is unauthenticated and may only bind to a loopback host');
  }

  if (production) {
    if (storageMode !== 'supabase') {
      errors.push('STORAGE_MODE must be supabase in production');
    }
    if (environment.PERSIST_DATA === 'false') {
      errors.push('PERSIST_DATA cannot be false in production');
    }
    if (!environment.SUPABASE_URL?.trim()) {
      errors.push('SUPABASE_URL is required in production');
    } else {
      try {
        if (new URL(environment.SUPABASE_URL).protocol !== 'https:') {
          errors.push('SUPABASE_URL must use HTTPS in production');
        }
      } catch {
        errors.push('SUPABASE_URL must be a valid URL');
      }
    }
    if (!environment.SUPABASE_SECRET_KEY?.trim()) {
      errors.push('SUPABASE_SECRET_KEY is required in production');
    }
    if (!environment.BOOTSTRAP_ADMIN_EMAIL?.trim()) {
      errors.push('BOOTSTRAP_ADMIN_EMAIL is required in production');
    } else if (!isValidEmail(environment.BOOTSTRAP_ADMIN_EMAIL.trim())) {
      errors.push('BOOTSTRAP_ADMIN_EMAIL must be a valid email address');
    }
    if (!environment.METRICS_TOKEN || environment.METRICS_TOKEN.length < 32) {
      errors.push('METRICS_TOKEN must contain at least 32 characters in production');
    }
    if (environment.API_KEY && environment.API_KEY.length < 32) {
      errors.push('API_KEY must contain at least 32 characters when enabled in production');
    }
    if (['true', '*', '0.0.0.0/0', '::/0'].includes(environment.TRUST_PROXY?.trim())) {
      errors.push('TRUST_PROXY must list only trusted proxy IP addresses or CIDR ranges');
    }
    parseAllowedOrigins(environment.CORS_ORIGINS, errors);
  }

  const logLevels = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
  if (environment.LOG_LEVEL && !logLevels.has(environment.LOG_LEVEL)) {
    errors.push('LOG_LEVEL is invalid');
  }
  validateNumericLimit(environment, 'BODY_LIMIT_BYTES', 1024, 10 * 1024 * 1024, errors);
  validateNumericLimit(environment, 'REQUEST_TIMEOUT_MS', 1000, 120000, errors);

  if (errors.length > 0) {
    throw new Error(`Unsafe runtime configuration:\n- ${errors.join('\n- ')}`);
  }
}
