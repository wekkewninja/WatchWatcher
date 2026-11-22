import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import type { AppConfig } from './config';
import type { IBlobStorageService } from './interfaces/IBlobStorageService';

export class AzuriteBlobStorageService implements IBlobStorageService {
  constructor(private readonly config: AppConfig) {}
  async healthCheck(): Promise<boolean> {
    try {
      const connection = this.config.azuriteConnectionString;
      if (!connection) return false;
      await BlobServiceClient.fromConnectionString(connection).getProperties();
      return true;
    } catch { return false; }
  }
}

export class ManagedIdentityBlobStorageService implements IBlobStorageService {
  constructor(private readonly config: AppConfig) {}
  async healthCheck(): Promise<boolean> {
    try {
      const account = this.config.azureStorageAccount;
      if (!account) return false;
      const client = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential());
      await client.getProperties();
      return true;
    } catch { return false; }
  }
}
