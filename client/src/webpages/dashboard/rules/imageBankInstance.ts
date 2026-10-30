import {
  GQLHashBankHmaInstance,
  GQLSignalType,
  type GQLSignal,
} from '../../../graphql/generated';
import { type RuleFormLeafCondition } from './types';

/**
 * Which kind of hash bank an image signal compares against. CLIP banks only
 * work with the CLIP signal, and every other image signal uses standard banks.
 */
export function hashBankInstanceForSignal(
  signal: Pick<GQLSignal, 'type'> | undefined,
): GQLHashBankHmaInstance {
  return signal?.type === GQLSignalType.ImageClipMatch
    ? GQLHashBankHmaInstance.Clip
    : GQLHashBankHmaInstance.Default;
}

/**
 * The matching values a condition keeps when its signal changes to `newSignal`.
 * Banks picked for the old signal are dropped when the new signal needs the
 * other kind of bank: they would no longer be offered in the picker, but would
 * stay in the saved rule.
 */
export function matchingValuesForNewSignal(
  condition: RuleFormLeafCondition,
  newSignal: Pick<GQLSignal, 'type'>,
): RuleFormLeafCondition['matchingValues'] {
  const { matchingValues } = condition;
  if (
    matchingValues?.imageBankIds === undefined ||
    hashBankInstanceForSignal(condition.signal) ===
      hashBankInstanceForSignal(newSignal)
  ) {
    return matchingValues;
  }
  const { imageBankIds: _dropped, ...rest } = matchingValues;
  return rest;
}

export const UNAVAILABLE_BANK_HINT =
  'This bank cannot be used with the selected signal, or it is a CLIP bank ' +
  'and CLIP is turned off for your organization.';

/**
 * Banks a condition has selected that are not on offer, for example CLIP banks
 * while CLIP is off. They stay selected, and are listed so that the picker does
 * not look empty or show a raw id. Banks that are hidden are not sent to the
 * client at all, so they have no name.
 */
export function unavailableBanks(
  selectedBankIds: readonly string[] | undefined,
  offeredBanks: readonly { id: string }[],
  allBanks: readonly { id: string; name: string }[],
): { id: string; name: string }[] {
  const offeredIds = new Set(offeredBanks.map((bank) => bank.id));
  return (selectedBankIds ?? [])
    .filter((id) => !offeredIds.has(id))
    .map((id) => {
      const known = allBanks.find((bank) => bank.id === id);
      return {
        id,
        name: known ? `${known.name} (unavailable)` : 'Unavailable bank',
      };
    });
}
