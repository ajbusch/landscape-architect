import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});

/** Cached API key — persists for Lambda lifecycle. */
let cachedApiKey: string | null = null;

const SECRET_NAME =
  process.env.ANTHROPIC_SECRET_NAME ?? 'LandscapeArchitect/dev/AnthropicApiKey';

export async function getAnthropicApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;

  const result = await client.send(
    new GetSecretValueCommand({ SecretId: SECRET_NAME }),
  );

  if (!result.SecretString) {
    throw new Error('Anthropic API key secret is empty');
  }

  cachedApiKey = result.SecretString;
  return cachedApiKey;
}

/** Reset cache — used in tests. */
export function _resetApiKeyCache(): void {
  cachedApiKey = null;
}
