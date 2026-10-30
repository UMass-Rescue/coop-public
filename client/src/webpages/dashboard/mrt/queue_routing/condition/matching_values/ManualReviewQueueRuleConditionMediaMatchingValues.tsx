import { Select } from 'antd';

import ComponentLoading from '../../../../../../components/common/ComponentLoading';
import { selectFilterByLabelOption } from '@/webpages/dashboard/components/antDesignUtils';

import { useGQLHashBanksQuery } from '../../../../../../graphql/generated';
import {
  hashBankInstanceForSignal,
  UNAVAILABLE_BANK_HINT,
  unavailableBanks,
} from '../../../../rules/imageBankInstance';
import { RuleFormLeafCondition } from '../../../../rules/types';
import { ManualReviewQueueRoutingStaticTokenField } from '../../ManualReviewQueueRoutingStaticField';

const { Option } = Select;

export default function ManualReviewQueueRuleConditionMediaMatchingValues(props: {
  condition: RuleFormLeafCondition;
  editing: boolean;
  onUpdateSelectedBankIds(imageBankIds: readonly string[]): void;
  allConditions?: RuleFormLeafCondition[];
}) {
  const {
    condition,
    editing,
    onUpdateSelectedBankIds,
    allConditions = [],
  } = props;

  // Banks are created and hidden elsewhere, so don't trust a cached list.
  const { loading, error, data } = useGQLHashBanksQuery({
    fetchPolicy: 'cache-and-network',
  });
  const allHashBanks = data?.hashBanks ?? [];
  // CLIP banks only work with the CLIP signal, and the rest with the others.
  const bankInstance = hashBankInstanceForSignal(condition.signal);
  const hashBanks = allHashBanks.filter(
    (bank) => bank.hma_instance === bankInstance,
  );
  const selectedImageBankIds = condition.matchingValues?.imageBankIds;
  const unavailable = unavailableBanks(
    selectedImageBankIds,
    hashBanks,
    allHashBanks,
  );

  // Get all selected bank IDs from other conditions
  const selectedBankIds = new Set(
    allConditions
      .filter((c) => c !== condition) // Exclude current condition by reference
      .flatMap((c) => c.matchingValues?.imageBankIds ?? []),
  );

  if (loading) {
    return <ComponentLoading />;
  }
  if (error) {
    return <div />;
  }

  return (
    <div className="flex flex-col items-start">
      {editing ? (
        <Select
          placeholder="Select media bank(s)"
          defaultValue={selectedImageBankIds}
          value={selectedImageBankIds}
          onChange={(values) => onUpdateSelectedBankIds([...values])}
          allowClear
          showSearch
          filterOption={selectFilterByLabelOption}
          dropdownMatchSelectWidth={false}
        >
          {hashBanks.map((bank) => (
            <Option
              key={bank.id}
              value={bank.id}
              label={bank.name}
              disabled={selectedBankIds.has(bank.id)}
            >
              {bank.name}
            </Option>
          ))}
          {unavailable.map((bank) => (
            <Option
              key={bank.id}
              value={bank.id}
              label={bank.name}
              title={UNAVAILABLE_BANK_HINT}
            >
              {bank.name}
            </Option>
          ))}
        </Select>
      ) : (
        <ManualReviewQueueRoutingStaticTokenField
          tokens={
            selectedImageBankIds?.map(
              (id) =>
                [...hashBanks, ...unavailable].find((bank) => bank.id === id)
                  ?.name ?? id,
            ) ?? []
          }
        />
      )}
    </div>
  );
}
