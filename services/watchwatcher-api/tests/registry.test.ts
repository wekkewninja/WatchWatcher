import { afterEach, describe, expect, it } from 'vitest';
import { AzuriteBlobStorageService, ManagedIdentityBlobStorageService } from '../src/services/blobStorage';
import { clearServices, getServices } from '../src/services/registry';

afterEach(() => {
  clearServices();
  delete process.env.AZURE_FUNCTIONS_ENVIRONMENT;
  delete process.env.DATABASE_URL;
  delete process.env.AZURITE_CONNECTION_STRING;
  delete process.env.AZURE_STORAGE_ACCOUNT;
});

describe('service registry', () => {
  it('auto-initializes and selects Azurite only for exact Development', () => {
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
    const services = getServices();
    expect(services.blobStorage).toBeInstanceOf(AzuriteBlobStorageService);
    expect(services.deterministicEvaluation).toBeDefined();
  });

  it('defaults to managed identity when environment is missing', () => {
    const services = getServices();
    expect(services.blobStorage).toBeInstanceOf(ManagedIdentityBlobStorageService);
  });
});
