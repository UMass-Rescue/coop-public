import {
  GQLHashBankHmaInstance,
  GQLScalarType,
  GQLSignalPricingStructureType,
  GQLSignalType,
  type GQLSignal,
} from '../../../graphql/generated';
import {
  hashBankInstanceForSignal,
  matchingValuesForNewSignal,
} from './imageBankInstance';
import { type RuleFormLeafCondition } from './types';

const { Clip, Default } = GQLHashBankHmaInstance;

const makeSignal = (type: GQLSignalType): GQLSignal => ({
  __typename: 'Signal',
  id: `signal-${type}`,
  type,
  shouldPromptForMatchingValues: true,
  eligibleSubcategories: [],
  eligibleInputs: [GQLScalarType.Image],
  name: type,
  description: 'Some description',
  disabledInfo: { __typename: 'DisabledInfo', disabled: false },
  outputType: {
    __typename: 'ScalarSignalOutputType',
    scalarType: GQLScalarType.Number,
  },
  pricingStructure: {
    __typename: 'SignalPricingStructure',
    type: GQLSignalPricingStructureType.Free,
  },
  supportedLanguages: { __typename: 'AllLanguages', _: true },
  allowedInAutomatedRules: true,
});

const clipSignal = makeSignal(GQLSignalType.ImageClipMatch);
const pdqSignal = makeSignal(GQLSignalType.ImageSimilarityMatch);

describe('hashBankInstanceForSignal', () => {
  it('uses CLIP banks for the CLIP signal', () => {
    expect(hashBankInstanceForSignal(clipSignal)).toBe(Clip);
  });

  it.each([
    GQLSignalType.ImageSimilarityMatch,
    GQLSignalType.ImageSimilarityDoesNotMatch,
    GQLSignalType.TextSimilarityScore,
  ])('uses standard banks for %s', (type) => {
    expect(hashBankInstanceForSignal(makeSignal(type))).toBe(Default);
  });

  it('defaults to standard banks before a signal is chosen', () => {
    expect(hashBankInstanceForSignal(undefined)).toBe(Default);
  });
});

function condition(signal: GQLSignal | undefined): RuleFormLeafCondition {
  return {
    signal,
    matchingValues: {
      imageBankIds: ['1', '2'],
      strings: ['kept'],
    },
  };
}

describe('matchingValuesForNewSignal', () => {
  it.each([
    ['standard to CLIP', pdqSignal, clipSignal],
    ['CLIP to standard', clipSignal, pdqSignal],
  ])('drops the banks when switching from %s', (_name, from, to) => {
    expect(matchingValuesForNewSignal(condition(from), to)).toEqual({
      strings: ['kept'],
    });
  });

  it.each([
    [
      'one standard signal to another',
      pdqSignal,
      makeSignal(GQLSignalType.ImageSimilarityDoesNotMatch),
    ],
    ['CLIP to CLIP', clipSignal, clipSignal],
  ])('keeps the banks when switching from %s', (_name, from, to) => {
    expect(matchingValuesForNewSignal(condition(from), to)).toEqual({
      imageBankIds: ['1', '2'],
      strings: ['kept'],
    });
  });

  it('leaves a condition without banks alone', () => {
    const noBanks: RuleFormLeafCondition = {
      signal: pdqSignal,
      matchingValues: { strings: ['x'] },
    };
    expect(matchingValuesForNewSignal(noBanks, clipSignal)).toBe(
      noBanks.matchingValues,
    );
    expect(
      matchingValuesForNewSignal({ signal: pdqSignal }, clipSignal),
    ).toBeUndefined();
  });

  it('does not change the condition it is given', () => {
    const original = condition(pdqSignal);
    matchingValuesForNewSignal(original, clipSignal);
    expect(original.matchingValues?.imageBankIds).toEqual(['1', '2']);
  });
});
