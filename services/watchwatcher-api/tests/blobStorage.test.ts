import { BlobServiceClient } from '@azure/storage-blob';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/services/config';
import { AzuriteBlobStorageService, ManagedIdentityBlobStorageService } from '../src/services/blobStorage';

const config: AppConfig = {
  environment: 'Test',
  databaseUrl: undefined,
  jwtSecret: undefined,
  jwtIssuer: 'watchwatcher-api',
  jwtAudience: 'watchwatcher-app',
  googleClientId: undefined,
  geminiApiKey: undefined,
  azureStorageAccount: undefined,
  azuriteConnectionString: undefined,
};

afterEach(() => vi.restoreAllMocks());

describe('blob storage health checks', () => {
  it('reports Azurite unavailable when no connection string is configured', async () => {
    await expect(new AzuriteBlobStorageService(config).healthCheck()).resolves.toBe(false);
  });

  it('reports Azurite health and handles connection failures', async () => {
    vi.spyOn(BlobServiceClient.prototype, 'getProperties').mockResolvedValue({} as never);
    await expect(new AzuriteBlobStorageService({ ...config, azuriteConnectionString: 'UseDevelopmentStorage=true' }).healthCheck()).resolves.toBe(true);

    vi.restoreAllMocks();
    vi.spyOn(BlobServiceClient.prototype, 'getProperties').mockRejectedValue(new Error('storage unavailable'));
    await expect(new AzuriteBlobStorageService({ ...config, azuriteConnectionString: 'UseDevelopmentStorage=true' }).healthCheck()).resolves.toBe(false);
  });

  it('reports managed identity storage availability and failures', async () => {
    await expect(new ManagedIdentityBlobStorageService(config).healthCheck()).resolves.toBe(false);

    vi.spyOn(BlobServiceClient.prototype, 'getProperties').mockResolvedValue({} as never);
    const configured = { ...config, azureStorageAccount: 'watchwatcher-test' };
    await expect(new ManagedIdentityBlobStorageService(configured).healthCheck()).resolves.toBe(true);

    vi.restoreAllMocks();
    vi.spyOn(BlobServiceClient.prototype, 'getProperties').mockRejectedValue(new Error('storage unavailable'));
    await expect(new ManagedIdentityBlobStorageService(configured).healthCheck()).resolves.toBe(false);
  });
});