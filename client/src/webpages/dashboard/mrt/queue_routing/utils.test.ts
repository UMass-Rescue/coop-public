import { vi } from 'vitest';

import {
  GQLConditionConjunction,
  GQLScalarType,
  GQLSignal,
  GQLSignalPricingStructureType,
  GQLSignalType,
} from '../../../../graphql/generated';
import {
  getConditionInputScalarType,
  getEligibleSignalsForInput,
  SimplifiedConditionInput,
} from '../../rules/rule_form/RuleFormUtils';
import { RuleFormConditionSet, RuleFormLeafCondition } from '../../rules/types';
import { updateConditionInput, updateSignal } from './utils';

vi.mock('../../rules/rule_form/RuleFormUtils', async () => {
  const origin = await vi.importActual<
    typeof import('../../rules/rule_form/RuleFormUtils')
  >('../../rules/rule_form/RuleFormUtils');
  return {
    ...origin,
    getConditionInputScalarType: vi.fn(),
    getEligibleSignalsForInput: vi.fn(),
  };
});

const makeSignal = (id: string, type: GQLSignalType): GQLSignal => ({
  __typename: 'Signal',
  id,
  type,
  shouldPromptForMatchingValues: false,
  eligibleSubcategories: [],
  eligibleInputs: [],
  name: `signal-${id}`,
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

describe('updateConditionInput signal eligibility', () => {
  const oldInput: SimplifiedConditionInput = {
    type: 'CONTENT_FIELD',
    name: 'old_field',
    contentTypeId: '12345',
  };
  const newInput: SimplifiedConditionInput = {
    type: 'CONTENT_FIELD',
    name: 'new_field',
    contentTypeId: '12345',
  };
  const location = { conditionIndex: 0, conditionSetIndex: 0 };

  beforeEach(() => {
    vi.clearAllMocks();
    // Keep the input scalar type stable so the input-type-change reset path
    // (which clears the whole condition) is not what's being exercised here.
    vi.mocked(getConditionInputScalarType).mockReturnValue(
      GQLScalarType.Number,
    );
  });

  it('clears a stale custom signal that is no longer eligible, even when other custom signals remain', () => {
    // All custom signals share GQLSignalType.Custom, so a type-based check would
    // incorrectly keep custom1 selected. The ID-based check must clear it.
    const custom1 = makeSignal('custom-1', GQLSignalType.Custom);
    const custom2 = makeSignal('custom-2', GQLSignalType.Custom);
    const custom3 = makeSignal('custom-3', GQLSignalType.Custom);

    vi.mocked(getEligibleSignalsForInput).mockReturnValue([custom2, custom3]);

    const conditionSet: RuleFormConditionSet = {
      conjunction: GQLConditionConjunction.And,
      conditions: [
        { input: oldInput, signal: custom1, eligibleSignals: [custom1] },
      ],
    };

    const result = updateConditionInput({
      currentConditionSet: conditionSet,
      location,
      input: newInput,
      selectedItemTypes: [],
      allSignals: [custom1, custom2, custom3],
    });

    const updatedLeaf = result.conditions[0] as RuleFormLeafCondition;
    expect(updatedLeaf.signal).toBeUndefined();
    expect(updatedLeaf.input).toEqual(newInput);
  });

  it('keeps the selected signal when it is still eligible for the new input', () => {
    const custom2 = makeSignal('custom-2', GQLSignalType.Custom);
    const custom3 = makeSignal('custom-3', GQLSignalType.Custom);

    vi.mocked(getEligibleSignalsForInput).mockReturnValue([custom2, custom3]);

    const conditionSet: RuleFormConditionSet = {
      conjunction: GQLConditionConjunction.And,
      conditions: [
        { input: oldInput, signal: custom2, eligibleSignals: [custom2] },
      ],
    };

    const result = updateConditionInput({
      currentConditionSet: conditionSet,
      location,
      input: newInput,
      selectedItemTypes: [],
      allSignals: [custom2, custom3],
    });

    const updatedLeaf = result.conditions[0] as RuleFormLeafCondition;
    expect(updatedLeaf.signal).toEqual(custom2);
  });
});

const location = { conditionIndex: 0, conditionSetIndex: 0 };
const pdq = makeSignal('pdq', GQLSignalType.ImageSimilarityMatch);
const clip = makeSignal('clip', GQLSignalType.ImageClipMatch);

function conditionSet(signal: GQLSignal): RuleFormConditionSet {
  return {
    conjunction: GQLConditionConjunction.And,
    conditions: [
      {
        signal,
        threshold: '0.9',
        matchingValues: { imageBankIds: ['1'], strings: ['kept'] },
      },
    ],
  };
}
function leafOf(set: RuleFormConditionSet) {
  return set.conditions[0] as RuleFormLeafCondition;
}

describe('updateSignal', () => {
  it('drops banks that the new signal cannot use, and the threshold', () => {
    const result = leafOf(
      updateSignal({ conditionSet: conditionSet(pdq), location, signal: clip }),
    );
    expect(result.signal).toEqual(clip);
    expect(result.threshold).toBeUndefined();
    expect(result.matchingValues).toEqual({ strings: ['kept'] });
  });

  it('keeps banks the new signal can use', () => {
    const result = leafOf(
      updateSignal({
        conditionSet: conditionSet(clip),
        location,
        signal: clip,
      }),
    );
    expect(result.matchingValues).toEqual({
      imageBankIds: ['1'],
      strings: ['kept'],
    });
  });

  it('sets a subcategory together with the signal', () => {
    const result = leafOf(
      updateSignal({
        conditionSet: conditionSet(pdq),
        location,
        signal: clip,
        subcategory: 'sub',
      }),
    );
    expect(result.signal).toMatchObject({ id: clip.id, subcategory: 'sub' });
  });

  it('does not change the condition set it is given', () => {
    const original = conditionSet(pdq);
    updateSignal({ conditionSet: original, location, signal: clip });
    expect(leafOf(original).matchingValues?.imageBankIds).toEqual(['1']);
  });
});
