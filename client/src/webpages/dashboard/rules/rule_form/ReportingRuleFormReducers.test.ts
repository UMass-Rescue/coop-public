import {
  GQLConditionConjunction,
  GQLScalarType,
  GQLSignalPricingStructureType,
  GQLSignalType,
  type GQLSignal,
} from '../../../../graphql/generated';
import { type RuleFormLeafCondition } from '../types';
import { initialState, type ReportingRuleFormState } from './ReportingRuleForm';
import {
  ReportingRuleFormReducerActionType,
  updateSignal,
} from './ReportingRuleFormReducers';

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

const location = { conditionIndex: 0, conditionSetIndex: 0 };
const pdq = makeSignal(GQLSignalType.ImageSimilarityMatch);
const clip = makeSignal(GQLSignalType.ImageClipMatch);

function switchTo(from: GQLSignal, to: GQLSignal) {
  const state: ReportingRuleFormState = {
    ...initialState,
    conditionSet: {
      conjunction: GQLConditionConjunction.And,
      conditions: [
        {
          signal: from,
          threshold: '0.9',
          matchingValues: { imageBankIds: ['1'], strings: ['kept'] },
        },
      ],
    },
  };
  return updateSignal(state, {
    type: ReportingRuleFormReducerActionType.UpdateSignal,
    payload: { location, signal: to },
  }).conditionSet.conditions[0] as RuleFormLeafCondition;
}

describe('reporting rule updateSignal banks', () => {
  it('drops banks that the new signal cannot use, and the threshold', () => {
    const result = switchTo(pdq, clip);
    expect(result.signal).toEqual(clip);
    expect(result.threshold).toBeUndefined();
    expect(result.matchingValues).toEqual({ strings: ['kept'] });
  });

  it('keeps banks the new signal can use', () => {
    const result = switchTo(clip, clip);
    expect(result.matchingValues).toEqual({
      imageBankIds: ['1'],
      strings: ['kept'],
    });
  });
});
