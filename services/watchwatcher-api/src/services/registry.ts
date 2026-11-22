import type { AppConfig } from './config';
import { loadConfig } from './config';
import { AuthService } from './authService';
import { AzuriteBlobStorageService, ManagedIdentityBlobStorageService } from './blobStorage';
import { DeterministicEvaluationService, GeminiEvaluationService } from './evaluationService';
import { PostgresDatabaseService } from './postgresDatabase';
import type { IAuthService } from './interfaces/IAuthService';
import type { IBlobStorageService } from './interfaces/IBlobStorageService';
import type { IDatabaseService } from './interfaces/IDatabaseService';
import type { IEvaluationService } from './interfaces/IEvaluationService';

export interface ServiceRegistry {
  database: IDatabaseService;
  auth: IAuthService;
  blobStorage: IBlobStorageService;
  evaluation: IEvaluationService;
  deterministicEvaluation: IEvaluationService;
}

let services: ServiceRegistry | null = null;

export function registerServices(registry: ServiceRegistry): void { services = registry; }
export function clearServices(): void { services = null; }

export function getServices(): ServiceRegistry {
  if (!services) initializeServices();
  if (!services) throw new Error('Service initialization did not complete.');
  return services;
}

function initializeServices(config: AppConfig = loadConfig()): void {
  const database = new PostgresDatabaseService(config);
  const blobStorage = config.environment === 'Development'
    ? new AzuriteBlobStorageService(config)
    : new ManagedIdentityBlobStorageService(config);
  services = {
    database,
    auth: new AuthService(database, config),
    blobStorage,
    evaluation: new GeminiEvaluationService(config),
    deterministicEvaluation: new DeterministicEvaluationService(),
  };
}
