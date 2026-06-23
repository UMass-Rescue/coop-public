import { type Dependencies } from '../../../iocContainer/index.js';
import { cached } from '../../../utils/caching.js';
import { type ConfigurableIntegration } from '../../signalAuthService/signalAuthService.js';

type CredentialCache = {
  (orgId: string): Promise<Record<string, unknown> | undefined>;
  close(): Promise<void>;
};

export type CredentialGetters = ReturnType<typeof makeCachedCredentialGetters>;

/**
 * Returns a set of functions that can be used for looking up an org's stored
 * API keys for a given third-party service, which is needed when running
 * signals that connect to that service. Also provides getForIntegrationId for
 * plugin integrations (any string id). Call close() to dispose all caches.
 */
export function makeCachedCredentialGetters(
  signalAuthService: Dependencies['SignalAuthService'],
) {
  const getApiCredentialForIntegration = <T extends ConfigurableIntegration>(
    integration: T,
  ) =>
    cached({
      producer: async (orgId: string) =>
        signalAuthService.get(integration, orgId),
      directives: { freshUntilAge: 600 },
    });

  // Create built-in caches once so close() disposes the same instances in use.
  const builtInCaches = {
    GOOGLE_CONTENT_SAFETY_API: getApiCredentialForIntegration(
      'GOOGLE_CONTENT_SAFETY_API',
    ),
    OPEN_AI: getApiCredentialForIntegration('OPEN_AI'),
    ZENTROPI: getApiCredentialForIntegration('ZENTROPI'),
  };

  const cacheByIntegrationId = new Map<string, CredentialCache>();

  function getForIntegrationId(integrationId: string): CredentialCache {
    let c = cacheByIntegrationId.get(integrationId);
    if (c == null) {
      c = cached({
        producer: async (orgId: string) =>
          signalAuthService.getByIntegrationId(integrationId, orgId),
        directives: { freshUntilAge: 600 },
      });
      cacheByIntegrationId.set(integrationId, c);
    }
    return c;
  }

  async function close(): Promise<void> {
    await Promise.all([
      ...Object.values(builtInCaches).map(async (c) => c.close()),
      ...Array.from(cacheByIntegrationId.values(), async (c) => c.close()),
    ]);
  }

  return {
    ...builtInCaches,
    getForIntegrationId,
    close,
  };
}
