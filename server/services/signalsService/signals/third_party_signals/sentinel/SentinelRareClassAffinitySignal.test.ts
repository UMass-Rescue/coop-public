import { ScalarTypes } from '@roostorg/types';

import { Integration } from '../../../types/Integration.js';
import { SignalPricingStructure } from '../../../types/SignalPricingStructure.js';
import { SignalType } from '../../../types/SignalType.js';
import { type SignalInput } from '../../SignalBase.js';
import {
  type SentinelService,
  SentinelServiceError,
} from '../../../../sentinelService/sentinelService.js';
import SentinelRareClassAffinitySignal from './SentinelRareClassAffinitySignal.js';

type SentinelSignalInput = SignalInput<
  ScalarTypes['STRING'],
  false,
  false,
  string,
  'SENTINEL_RARE_CLASS_AFFINITY'
>;

function makeInput(
  overrides: Partial<SentinelSignalInput> = {},
): SentinelSignalInput {
  return {
    value: { type: 'STRING', value: 'test content' },
    matchingValues: undefined,
    actionPenalties: undefined,
    orgId: 'org-1',
    ...overrides,
  } as unknown as SentinelSignalInput;
}

function makeSentinelService(
  overrides: Partial<SentinelService> = {},
): SentinelService {
  return {
    healthCheck: jest.fn().mockResolvedValue({ status: 'ok', banks_loaded: true }),
    getBanksStatus: jest.fn().mockResolvedValue({ loaded: true }),
    scoreTexts: jest.fn().mockResolvedValue({
      rare_class_affinity_score: 0.5,
      observation_scores: { 'test content': 0.5 },
      num_observations: 1,
    }),
    scoreSingleText: jest.fn().mockResolvedValue(0.5),
    loadBanks: jest.fn().mockResolvedValue(undefined),
    unloadBanks: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

type MockItemInvestigationService = {
  insertItem: jest.Mock;
  getThreadSubmissionsByPosition: jest.Mock;
  getThreadSubmissionsByTime: jest.Mock;
  getItemByIdentifier: jest.Mock;
  getItemByTypeAgnosticIdentifier: jest.Mock;
  getAncestorItems: jest.Mock;
  getItemSubmissionsByCreator: jest.Mock;
  getItemActionHistory: jest.Mock;
};

function makeItemInvestigationService(
  overrides: Partial<MockItemInvestigationService> = {},
): MockItemInvestigationService {
  return {
    insertItem: jest.fn().mockResolvedValue(undefined),
    getThreadSubmissionsByPosition: jest.fn(),
    getThreadSubmissionsByTime: jest.fn().mockReturnValue(
      (async function* () {
        // Empty async iterable by default
      })(),
    ),
    getItemByIdentifier: jest.fn(),
    getItemByTypeAgnosticIdentifier: jest.fn(),
    getAncestorItems: jest.fn(),
    getItemSubmissionsByCreator: jest.fn(),
    getItemActionHistory: jest.fn(),
    ...overrides,
  };
}

function makeSignal(
  sentinelService?: Partial<SentinelService>,
  iisOverrides?: Partial<MockItemInvestigationService>,
) {
  return new SentinelRareClassAffinitySignal(
    makeSentinelService(sentinelService),
    makeItemInvestigationService(iisOverrides) as any,
  );
}

describe('SentinelRareClassAffinitySignal', () => {
  describe('signal metadata', () => {
    it('returns correct id', () => {
      expect(makeSignal().id).toEqual({ type: SignalType.SENTINEL_RARE_CLASS_AFFINITY });
    });

    it('returns correct integration', () => {
      expect(makeSignal().integration).toBe(Integration.SENTINEL);
    });

    it('returns STRING as eligible input type', () => {
      expect(makeSignal().eligibleInputs).toEqual([ScalarTypes.STRING]);
    });

    it('returns NUMBER as output type', () => {
      expect(makeSignal().outputType).toEqual({ scalarType: ScalarTypes.NUMBER });
    });

    it('returns FREE pricing structure', () => {
      expect(makeSignal().pricingStructure).toBe(SignalPricingStructure.FREE);
    });

    it('is allowed in automated rules', () => {
      expect(makeSignal().allowedInAutomatedRules).toBe(true);
    });

    it('does not need matching values', () => {
      expect(makeSignal().needsMatchingValues).toBe(false);
    });

    it('does not need action penalties', () => {
      expect(makeSignal().needsActionPenalties).toBe(false);
    });

    it('has no eligible subcategories', () => {
      expect(makeSignal().eligibleSubcategories).toEqual([]);
    });

    it('returns ALL as supported languages', () => {
      expect(makeSignal().supportedLanguages).toBe('ALL');
    });
  });

  describe('getDisabledInfo', () => {
    it('returns disabled=false when service is healthy and banks are loaded', async () => {
      const info = await makeSignal().getDisabledInfo('org-1');
      expect(info.disabled).toBe(false);
    });

    it('returns disabled=true when health check fails', async () => {
      const signal = makeSignal({
        healthCheck: jest.fn().mockRejectedValue(new Error('Connection refused')),
      });
      const info = await signal.getDisabledInfo('org-1');
      expect(info.disabled).toBe(true);
      expect(info.disabledMessage).toContain('unavailable');
    });

    it('returns disabled=true when health status is not ok', async () => {
      const signal = makeSignal({
        healthCheck: jest.fn().mockResolvedValue({ status: 'error', banks_loaded: false }),
      });
      const info = await signal.getDisabledInfo('org-1');
      expect(info.disabled).toBe(true);
      expect(info.disabledMessage).toContain('not healthy');
    });

    it('returns disabled=true when banks are not loaded', async () => {
      const signal = makeSignal({
        getBanksStatus: jest.fn().mockResolvedValue({ loaded: false }),
      });
      const info = await signal.getDisabledInfo('org-1');
      expect(info.disabled).toBe(true);
      expect(info.disabledMessage).toContain('banks are not loaded');
    });
  });

  describe('run', () => {
    it('scores the primary text and returns rare_class_affinity_score', async () => {
      const scoreTexts = jest.fn().mockResolvedValue({
        rare_class_affinity_score: 0.72,
        observation_scores: { 'test content': 0.72 },
        num_observations: 1,
      });
      const signal = makeSignal({ scoreTexts });

      const result = await signal.run(makeInput());

      expect(scoreTexts).toHaveBeenCalledWith(
        expect.objectContaining({ texts: expect.arrayContaining(['test content']) }),
      );
      expect(result).toMatchObject({
        outputType: { scalarType: ScalarTypes.NUMBER },
        score: 0.72,
      });
    });

    it('includes thread context texts when threadIdentifier is provided', async () => {
      const scoreTexts = jest.fn().mockResolvedValue({
        rare_class_affinity_score: 0.85,
        observation_scores: {},
        num_observations: 2,
      });

      // Async iterable that yields one prior thread item
      const threadItem = {
        latestSubmission: {
          data: { text: 'prior thread message' },
          itemType: { kind: 'CONTENT', schema: [], schemaFieldRoles: {} },
        },
        priorSubmissions: undefined,
        parents: (async function* () {})(),
      };
      const getThreadSubmissionsByTime = jest
        .fn()
        .mockReturnValue(
          (async function* () {
            yield threadItem;
          })(),
        );

      const signal = makeSignal({ scoreTexts }, { getThreadSubmissionsByTime });

      await signal.run(
        makeInput({
          runtimeArgs: {
            threadIdentifier: { id: 'thread-1', typeId: 'content-type-1' },
            contentTextFieldName: 'text',
          },
        }),
      );

      const texts = scoreTexts.mock.calls[0][0].texts;
      expect(texts).toContain('test content');
      expect(texts).toContain('prior thread message');
    });

    it('still returns a score when thread fetch fails', async () => {
      const scoreTexts = jest.fn().mockResolvedValue({
        rare_class_affinity_score: 0.5,
        observation_scores: { 'test content': 0.5 },
        num_observations: 1,
      });
      const getThreadSubmissionsByTime = jest.fn().mockImplementation(() => {
        throw new Error('Scylla unavailable');
      });

      const signal = makeSignal({ scoreTexts }, { getThreadSubmissionsByTime });

      const result = await signal.run(
        makeInput({
          runtimeArgs: {
            threadIdentifier: { id: 'thread-1', typeId: 'content-type-1' },
          },
        }),
      );

      // Should still score with just the primary text
      expect(result).toMatchObject({ score: 0.5 });
      expect(scoreTexts).toHaveBeenCalledWith(
        expect.objectContaining({ texts: ['test content'] }),
      );
    });

    it('returns an error result when Sentinel service throws SentinelServiceError', async () => {
      const signal = makeSignal({
        scoreTexts: jest.fn().mockRejectedValue(new SentinelServiceError('Banks not loaded', 503)),
      });
      const result = await signal.run(makeInput());
      expect(result.type).toBe('ERROR');
    });

    it('re-throws non-SentinelServiceError exceptions', async () => {
      const signal = makeSignal({
        scoreTexts: jest.fn().mockRejectedValue(new Error('Unexpected error')),
      });
      await expect(signal.run(makeInput())).rejects.toThrow('Unexpected error');
    });
  });
});
