import {
  GQLHashBankHmaInstance,
  GQLHashBanksDocument,
  GQLScalarType,
  GQLSignalPricingStructureType,
  GQLSignalType,
  type GQLSignal,
} from '@/graphql/generated';
import { MockedProvider } from '@apollo/client/testing';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form } from 'antd';
import { vi } from 'vitest';

import { type RuleFormLeafCondition } from '../../../types';
import RuleFormConditionMediaMatchingValues from './RuleFormConditionMediaMatchingValues';

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

const bank = (
  id: string,
  name: string,
  hma_instance: GQLHashBankHmaInstance,
) => ({
  __typename: 'HashBank',
  id,
  name,
  description: null,
  hma_name: `COOP_${name.toUpperCase().replace(/ /g, '_')}`,
  enabled_ratio: 1,
  hma_instance,
  org_id: 'org',
});

const BANKS = [
  bank('1', 'Standard Bank', GQLHashBankHmaInstance.Default),
  bank('2', 'Other Standard Bank', GQLHashBankHmaInstance.Default),
  bank('3', 'Clip Bank', GQLHashBankHmaInstance.Clip),
];

function renderPicker(condition: RuleFormLeafCondition) {
  const onUpdateMatchingValues = vi.fn();
  render(
    <MockedProvider
      mocks={[
        {
          request: { query: GQLHashBanksDocument },
          maxUsageCount: Infinity,
          result: { data: { hashBanks: BANKS } },
        },
      ]}
    >
      <Form>
        <RuleFormConditionMediaMatchingValues
          condition={condition}
          location={{ conditionIndex: 0, conditionSetIndex: 0 }}
          onUpdateMatchingValues={onUpdateMatchingValues}
        />
      </Form>
    </MockedProvider>,
  );
  return { onUpdateMatchingValues };
}

// The options a user sees (antd also keeps a hidden list of bare ids).
const optionNames = () =>
  Array.from(document.querySelectorAll('.ant-select-item-option')).map(
    (option) => option.getAttribute('title'),
  );

async function openPicker() {
  await userEvent.click(await screen.findByRole('combobox'));
}

describe('RuleFormConditionMediaMatchingValues', () => {
  // antd's form layout needs matchMedia, which jsdom doesn't have.
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('offers only CLIP banks for the CLIP signal', async () => {
    renderPicker({ signal: makeSignal(GQLSignalType.ImageClipMatch) });
    await openPicker();
    expect(optionNames()).toEqual(['Clip Bank']);
  });

  it.each([
    GQLSignalType.ImageSimilarityMatch,
    GQLSignalType.ImageSimilarityDoesNotMatch,
  ])('offers only standard banks for %s', async (type) => {
    renderPicker({ signal: makeSignal(type) });
    await openPicker();
    expect(optionNames()).toEqual(['Standard Bank', 'Other Standard Bank']);
  });

  it('reports the banks that are picked', async () => {
    const { onUpdateMatchingValues } = renderPicker({
      signal: makeSignal(GQLSignalType.ImageClipMatch),
    });
    await openPicker();
    await userEvent.click(screen.getByText('Clip Bank'));
    expect(onUpdateMatchingValues).toHaveBeenCalledWith({
      imageBankIds: ['3'],
    });
  });

  it('shows a picked bank by name', async () => {
    renderPicker({
      signal: makeSignal(GQLSignalType.ImageClipMatch),
      matchingValues: { imageBankIds: ['3'] },
    });
    expect(await screen.findByTitle('Clip Bank')).toBeInTheDocument();
  });

  it('keeps a picked bank that is not on offer, labelled as unavailable', async () => {
    const { onUpdateMatchingValues } = renderPicker({
      signal: makeSignal(GQLSignalType.ImageClipMatch),
      // 99 is hidden from the client (CLIP off), 1 is the other kind of bank.
      matchingValues: { imageBankIds: ['3', '99', '1'] },
    });
    expect(await screen.findByTitle('Clip Bank')).toBeInTheDocument();
    expect(screen.getByText('Unavailable bank')).toBeInTheDocument();
    expect(screen.getByText('Standard Bank (unavailable)')).toBeInTheDocument();
    expect(screen.queryByText('99')).not.toBeInTheDocument();

    // Removing one bank leaves the unavailable ones in the rule.
    await userEvent.click(
      screen
        .getByTitle('Clip Bank')
        .querySelector('.ant-select-selection-item-remove')!,
    );
    expect(onUpdateMatchingValues).toHaveBeenCalledWith({
      imageBankIds: ['99', '1'],
    });
  });

  it('does not offer an unavailable bank as a new choice when none is picked', async () => {
    renderPicker({
      signal: makeSignal(GQLSignalType.ImageClipMatch),
      matchingValues: { imageBankIds: [] },
    });
    await openPicker();
    expect(optionNames()).toEqual(['Clip Bank']);
  });
});
