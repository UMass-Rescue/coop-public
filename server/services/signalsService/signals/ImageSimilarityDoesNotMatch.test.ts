import { type ScalarTypes } from '@roostorg/coop-types';
import { vi } from 'vitest';

import { jsonParse, type JsonOf } from '../../../utils/encoding.js';
import { type HmaService } from '../../hmaService/index.js';
import ImageSimilarityDoesNotMatch from './ImageSimilarityDoesNotMatch.js';
import { type SignalInput } from './SignalBase.js';

type MatchSignalInput = SignalInput<ScalarTypes['IMAGE'], true>;
type MatchedValuePayload = { checkedBanks: string[]; matchedBanks: string[] };

function makeSignal(
  checkImageMatchWithDetails: HmaService['checkImageMatchWithDetails'],
) {
  return new ImageSimilarityDoesNotMatch({
    checkImageMatchWithDetails,
  } as unknown as HmaService);
}

const mockBanks = [
  {
    id: 1,
    name: 'Blocked Bank',
    hma_name: 'ORG_BLOCKED_BANK',
    description: null,
    enabled_ratio: 1,
    org_id: 'org-1',
    created_at: new Date(),
    updated_at: new Date(),
  },
];

describe('ImageSimilarityDoesNotMatchSignal', () => {
  it('throws when no banks are provided', async () => {
    const signal = makeSignal(vi.fn());

    await expect(
      signal.run({
        value: {
          type: 'IMAGE',
          value: { url: 'https://example.com/img.png', hashes: { pdq: 'abc' } },
        },
        matchingValues: [],
        orgId: 'org-1',
        actionPenalties: undefined,
      } as unknown as MatchSignalInput),
    ).rejects.toThrow('No banks provided for matching');
  });

  it('throws when image has no hashes', async () => {
    const signal = makeSignal(vi.fn());

    await expect(
      signal.run({
        value: { type: 'IMAGE', value: { url: 'https://example.com/img.png' } },
        matchingValues: mockBanks,
        orgId: 'org-1',
        actionPenalties: undefined,
      } as unknown as MatchSignalInput),
    ).rejects.toThrow('No hashes found in image value');
  });

  it('returns score true (does not match) when no bank matches', async () => {
    const signal = makeSignal(
      vi.fn().mockResolvedValue({
        matched: false,
        matchedBanks: [],
      }),
    );

    const result = await signal.run({
      value: {
        type: 'IMAGE',
        value: {
          url: 'https://example.com/img.png',
          hashes: { pdq: 'abc123' },
        },
      },
      matchingValues: mockBanks,
      orgId: 'org-1',
      actionPenalties: undefined,
    } as unknown as MatchSignalInput);

    expect(result.score).toBe(true);
    expect(result.matchedValue).toBeDefined();
    const parsed = jsonParse(
      result.matchedValue! as JsonOf<MatchedValuePayload>,
    );
    expect(parsed.checkedBanks).toEqual(['Blocked Bank']);
    expect(parsed.matchedBanks).toEqual([]);
  });

  it('returns score false (does match) when at least one bank matches', async () => {
    const signal = makeSignal(
      vi.fn().mockResolvedValue({
        matched: true,
        matchedBanks: ['ORG_BLOCKED_BANK'],
      }),
    );

    const result = await signal.run({
      value: {
        type: 'IMAGE',
        value: {
          url: 'https://example.com/img.png',
          hashes: { pdq: 'abc123' },
        },
      },
      matchingValues: mockBanks,
      orgId: 'org-1',
      actionPenalties: undefined,
    } as unknown as MatchSignalInput);

    expect(result.score).toBe(false);
    expect(result.matchedValue).toBeDefined();
    const parsed = jsonParse(
      result.matchedValue! as JsonOf<MatchedValuePayload>,
    );
    expect(parsed.checkedBanks).toEqual(['Blocked Bank']);
    expect(parsed.matchedBanks).toEqual(['Blocked Bank']);
  });

  describe('CLIP banks', () => {
    const clipBank = {
      ...mockBanks[0],
      id: 99,
      name: 'Clip Bank',
      hma_name: 'ORG_CLIP_BANK',
      hma_instance: 'CLIP' as const,
    };
    const image = {
      type: 'IMAGE',
      value: { url: 'https://example.com/img.png', hashes: { pdq: 'abc' } },
    };

    it('only checks hashes against the standard banks of a mixed selection', async () => {
      const check = vi
        .fn()
        .mockResolvedValue({ matched: false, matchedBanks: [] });
      const signal = makeSignal(check);

      await signal.run({
        value: image,
        matchingValues: [...mockBanks, clipBank],
        orgId: 'org-1',
        actionPenalties: undefined,
      } as unknown as MatchSignalInput);

      expect(check).toHaveBeenCalledTimes(1);
      expect(check).toHaveBeenCalledWith([mockBanks[0].hma_name], 'pdq', 'abc');
    });

    it('is a permanent error when only CLIP banks were selected', async () => {
      const check = vi.fn();
      const signal = makeSignal(check);

      await expect(
        signal.run({
          value: image,
          matchingValues: [clipBank],
          orgId: 'org-1',
          actionPenalties: undefined,
        } as unknown as MatchSignalInput),
      ).rejects.toMatchObject({
        name: 'SignalPermanentError',
        title: 'Only CLIP hash banks were selected',
      });
      expect(check).not.toHaveBeenCalled();
    });
  });
});
