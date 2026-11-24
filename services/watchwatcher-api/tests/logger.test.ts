import { describe, expect, it } from 'vitest';
import { logger } from '../src/logger';

describe('API logger configuration', () => {
  it('identifies the service in structured log bindings', () => {
    expect(logger.bindings()).toMatchObject({ service: 'watchwatcher-api' });
    expect(logger.level).toBe(process.env.LOG_LEVEL ?? 'info');
  });
});