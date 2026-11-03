import { GQLMatchingBankIdsDocument, GQLSignalType } from '@/graphql/generated';
import { MockedProvider } from '@apollo/client/testing';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { MatchingBankType } from '../../../../rules/rule_form/condition/matching_values/RuleFormConditionMatchingBankInput';
import { type RuleFormLeafCondition } from '../../../../rules/types';
import ManualReviewQueueRuleConditionMatchingBankInput from './ManualReviewQueueRuleConditionMatchingBankInput';

const hashBank = (id: string, name: string, isAvailable: boolean) => ({
  __typename: 'HashBank',
  id,
  name,
  description: null,
  enabled_ratio: 1,
  isAvailable,
});

const BANKS_RESULT = {
  data: {
    myOrg: {
      __typename: 'Org',
      id: 'org',
      banks: {
        __typename: 'MatchingBanks',
        textBanks: [],
        locationBanks: [],
        hashBanks: [
          hashBank('1', 'Standard Bank', true),
          hashBank('2', 'Off Clip Bank', false),
        ],
      },
    },
  },
};

// The names a user can pick, as antd shows them (it also keeps a hidden list).
const optionNames = () =>
  Array.from(document.querySelectorAll('.ant-select-item-option')).map(
    (option) => option.getAttribute('title') ?? option.textContent,
  );

function renderInput(condition: RuleFormLeafCondition, editing = true) {
  render(
    <MockedProvider
      mocks={[
        {
          request: { query: GQLMatchingBankIdsDocument },
          maxUsageCount: Infinity,
          result: BANKS_RESULT,
        },
      ]}
    >
      <ManualReviewQueueRuleConditionMatchingBankInput
        condition={condition}
        location={{ conditionIndex: 0, conditionSetIndex: 0 }}
        editing={editing}
        setShowBankDropdown={vi.fn()}
        bankType={MatchingBankType.TEXT}
        onUpdateSelectedBankIds={vi.fn()}
      />
    </MockedProvider>,
  );
}

const condition = (imageBankIds?: string[]): RuleFormLeafCondition => ({
  signal: {
    __typename: 'Signal',
    id: 'signal',
    type: GQLSignalType.TextMatchingContainsText,
  } as never,
  matchingValues: imageBankIds ? { imageBankIds } : {},
});

describe('ManualReviewQueueRuleConditionMatchingBankInput', () => {
  beforeEach(() => {
    // antd's form layout needs matchMedia, which jsdom doesn't have.
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

  it('does not offer a hash bank that is unavailable', async () => {
    renderInput(condition());

    await userEvent.click(await screen.findByRole('combobox'));

    expect(optionNames()).toEqual(['Standard Bank']);
  });

  it('keeps an unavailable hash bank that is already picked, labelled as unavailable', async () => {
    renderInput(condition(['1', '2']));

    expect(await screen.findByText('Standard Bank')).toBeInTheDocument();
    expect(screen.getByText('Off Clip Bank (unavailable)')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox'));
    expect(optionNames()).not.toContain('Off Clip Bank');
  });
});
