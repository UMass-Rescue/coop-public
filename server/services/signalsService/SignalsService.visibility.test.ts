import { vi } from 'vitest';

import { type Dependencies } from '../../iocContainer/index.js';
import { SignalsService } from './SignalsService.js';

function makeService(hma: { isClipEnabled: boolean }) {
  const hmaService = {
    isClipEnabled: vi.fn().mockReturnValue(hma.isClipEnabled),
    isClipAvailableToOrg: vi.fn().mockResolvedValue(false),
  };
  return new SignalsService(
    {} as Dependencies['Tracer'],
    {} as Dependencies['ModerationConfigService'],
    {} as Dependencies['AggregationsService'],
    {} as Dependencies['UserStrikeService'],
    vi.fn() as unknown as Dependencies['getPoliciesByIdEventuallyConsistent'],
    hmaService as unknown as Dependencies['HMAHashBankService'],
    {} as Dependencies['SignalAuthService'],
    vi.fn(),
    vi.fn(),
  );
}

const typesFor = async (service: SignalsService) =>
  (await service.getSignalsForOrg({ orgId: 'org-1' })).map((s) => s.id.type);

describe('SignalsService.getSignalsForOrg', () => {
  it('lists the CLIP signal when the deployment has CLIP', async () => {
    const service = makeService({ isClipEnabled: true });
    expect(await typesFor(service)).toContain('IMAGE_CLIP_MATCH');
    await service.close();
  });

  it('does not list the CLIP signal when the deployment has no CLIP', async () => {
    const service = makeService({ isClipEnabled: false });
    expect(await typesFor(service)).not.toContain('IMAGE_CLIP_MATCH');
    await service.close();
  });

  it('still lists the other image signals either way', async () => {
    const service = makeService({ isClipEnabled: false });
    const types = await typesFor(service);
    expect(types).toContain('IMAGE_SIMILARITY_MATCH');
    expect(types).toContain('IMAGE_SIMILARITY_DOES_NOT_MATCH');
    await service.close();
  });

  it('can still be looked up by type, whether or not it is listed', async () => {
    const service = makeService({ isClipEnabled: false });
    await expect(
      service.getSignal({
        orgId: 'org-1',
        signalId: { type: 'IMAGE_CLIP_MATCH' },
      }),
    ).resolves.toMatchObject({ id: { type: 'IMAGE_CLIP_MATCH' } });
    await service.close();
  });
});
