import { Radio } from 'antd';
import React from 'react';

import FormSectionHeader from '../../components/FormSectionHeader';

import { GQLHashBankHmaInstance } from '../../../../graphql/generated';

const INSTANCE_LABELS: Record<GQLHashBankHmaInstance, string> = {
  [GQLHashBankHmaInstance.Default]: 'Standard',
  [GQLHashBankHmaInstance.Clip]: 'Semantic (CLIP)',
};

// The generated enum is alphabetical; the standard option should come first.
const INSTANCE_ORDER: ReadonlyArray<GQLHashBankHmaInstance> = [
  GQLHashBankHmaInstance.Default,
  GQLHashBankHmaInstance.Clip,
];

const INSTANCE_DESCRIPTIONS: Record<GQLHashBankHmaInstance, string> = {
  [GQLHashBankHmaInstance.Default]:
    'Matches near-duplicates of known images (PDQ) and exact copies of known videos (MD5).',
  [GQLHashBankHmaInstance.Clip]:
    'Matches images that look alike in content, even when they are not copies. Uses the optional CLIP service, which needs more compute.',
};

export function hashBankInstanceLabel(instance: GQLHashBankHmaInstance) {
  return INSTANCE_LABELS[instance];
}

/**
 * Chooses which HMA instance a new bank lives on. Renders nothing until the
 * deployment offers CLIP, since there is then nothing to choose.
 */
export default function HashBankInstanceSelect({
  available,
  value,
  onChange,
}: {
  available: ReadonlyArray<GQLHashBankHmaInstance>;
  value: GQLHashBankHmaInstance;
  onChange: (value: GQLHashBankHmaInstance) => void;
}) {
  if (!available.includes(GQLHashBankHmaInstance.Clip)) {
    return null;
  }

  return (
    <div className="flex flex-col justify-start">
      <FormSectionHeader
        title="Matching Type"
        subtitle="Choose how this bank matches images. This can't be changed after the bank is created."
      />
      <div role="radiogroup" aria-label="Matching Type">
        <Radio.Group
          value={value}
          onChange={(event) =>
            onChange(event.target.value as GQLHashBankHmaInstance)
          }
        >
          <div className="flex flex-col gap-3">
            {INSTANCE_ORDER.map((instance) => (
              <Radio key={instance} value={instance}>
                <span className="font-medium">
                  {hashBankInstanceLabel(instance)}
                </span>
                <span className="block text-xs text-zinc-500">
                  {INSTANCE_DESCRIPTIONS[instance]}
                </span>
              </Radio>
            ))}
          </div>
        </Radio.Group>
      </div>
    </div>
  );
}
