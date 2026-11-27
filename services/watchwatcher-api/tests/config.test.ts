import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, requireSetting } from '../src/services/config';

afterEach(() => vi.unstubAllEnvs());

describe('API configuration', () => {
  it('defaults to Production and leaves optional integrations unconfigured', () => {
    vi.stubEnv('AZURE_FUNCTIONS_ENVIRONMENT', undefined);
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('JWT_SECRET', undefined);
    vi.stubEnv('RATE_LIMIT_SECRET', undefined);
    vi.stubEnv('GOOGLE_CLIENT_ID', undefined);
    vi.stubEnv('GEMINI_API_KEY', undefined);
    vi.stubEnv('AZURE_STORAGE_ACCOUNT', undefined);
    vi.stubEnv('AZURITE_CONNECTION_STRING', undefined);

    expect(loadConfig()).toMatchObject({
      environment: 'Production',
      databaseUrl: undefined,
      jwtSecret: undefined,
      rateLimitSecret: undefined,
      jwtIssuer: 'watchwatcher-api',
      jwtAudience: 'watchwatcher-app',
      googleClientId: undefined,
      geminiApiKey: undefined,
      azureStorageAccount: undefined,
      azuriteConnectionString: undefined,
    });
  });

  it('loads configured values and requires nonempty settings', () => {
    vi.stubEnv('AZURE_FUNCTIONS_ENVIRONMENT', 'Development');
    vi.stubEnv('JWT_ISSUER', 'custom-issuer');
    vi.stubEnv('JWT_AUDIENCE', 'custom-audience');
    vi.stubEnv('RATE_LIMIT_SECRET', 'synthetic-rate-limit-setting');
    vi.stubEnv('REQUIRED_TEST_SETTING', 'configured');

    expect(loadConfig()).toMatchObject({ environment: 'Development', jwtIssuer: 'custom-issuer', jwtAudience: 'custom-audience', rateLimitSecret: 'synthetic-rate-limit-setting' });
    expect(requireSetting('REQUIRED_TEST_SETTING')).toBe('configured');
    expect(() => requireSetting('MISSING_TEST_SETTING')).toThrow('Missing required environment variable: MISSING_TEST_SETTING');
  });
});