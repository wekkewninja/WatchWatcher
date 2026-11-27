export interface AppConfig {
  environment: string;
  databaseUrl: string | undefined;
  jwtSecret: string | undefined;
  rateLimitSecret?: string;
  jwtIssuer: string;
  jwtAudience: string;
  googleClientId: string | undefined;
  geminiApiKey: string | undefined;
  azureStorageAccount: string | undefined;
  azuriteConnectionString: string | undefined;
}

export function requireSetting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadConfig(): AppConfig {
  return {
    environment: process.env.AZURE_FUNCTIONS_ENVIRONMENT ?? 'Production',
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    rateLimitSecret: process.env.RATE_LIMIT_SECRET,
    jwtIssuer: process.env.JWT_ISSUER ?? 'watchwatcher-api',
    jwtAudience: process.env.JWT_AUDIENCE ?? 'watchwatcher-app',
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    geminiApiKey: process.env.GEMINI_API_KEY,
    azureStorageAccount: process.env.AZURE_STORAGE_ACCOUNT,
    azuriteConnectionString: process.env.AZURITE_CONNECTION_STRING,
  };
}
