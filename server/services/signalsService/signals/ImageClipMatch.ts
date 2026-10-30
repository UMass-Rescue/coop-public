import { ScalarTypes } from '@roostorg/coop-types';

import type { Dependencies } from '../../../iocContainer/index.js';
import { jsonStringify } from '../../../utils/encoding.js';
import { makeSignalPermanentError } from '../../../utils/errors.js';
import type { HashBank } from '../../hmaService/dbTypes.js';
import { SignalPricingStructure as SignalPricingStructureType } from '../types/SignalPricingStructure.js';
import { SignalType } from '../types/SignalType.js';
import SignalBase, {
  type ImageValue,
  type SignalInput,
  type SignalResult,
} from './SignalBase.js';

export default class ImageClipMatchSignal extends SignalBase<
  ScalarTypes['IMAGE'],
  { scalarType: ScalarTypes['NUMBER'] }
> {
  constructor(private readonly hmaService: Dependencies['HMAHashBankService']) {
    super();
  }

  override get id() {
    return { type: SignalType.IMAGE_CLIP_MATCH };
  }

  override get outputType() {
    return { scalarType: ScalarTypes.NUMBER };
  }

  override get displayName() {
    return 'Image similarity (CLIP)';
  }

  override get description() {
    return (
      'Compares what an image shows with the images in the selected CLIP ' +
      'banks, and scores how similar the closest one is, from 0 to 1. ' +
      'Images that are not close enough to any image in the banks score 0. ' +
      'By default only images that are at least 90% similar get a score, so ' +
      'a rule can ask for a closer match than that, but not a looser one. ' +
      'Only images submitted after CLIP was turned on for your organization ' +
      'can be scored.'
    );
  }

  override get supportedLanguages() {
    return 'ALL' as const;
  }

  get pricingStructure(): SignalPricingStructureType {
    return SignalPricingStructureType.FREE;
  }

  /**
   * Only deployments with the optional CLIP instance have this signal. Where
   * it exists, orgs see it, disabled until they turn CLIP on.
   */
  override async isVisibleToOrg() {
    return this.hmaService.isClipEnabled();
  }

  override async getDisabledInfo(orgId: string) {
    return (await this.hmaService.isClipAvailableToOrg(orgId))
      ? { disabled: false as const }
      : {
          disabled: true as const,
          disabledMessage:
            'Turn on CLIP under Settings, Image Matching to use this signal.',
        };
  }

  override get eligibleInputs() {
    return [ScalarTypes.IMAGE];
  }

  override get needsMatchingValues() {
    return true;
  }

  /**
   * Estimated cost of looking an embedding up in the CLIP banks. The
   * embedding itself is created when the image is submitted.
   */
  override getCost() {
    return 10;
  }

  override get allowedInAutomatedRules() {
    return true;
  }

  override get eligibleSubcategories() {
    return [];
  }

  override get needsActionPenalties() {
    return false;
  }

  override get docsUrl() {
    return null;
  }

  override get recommendedThresholds() {
    return null;
  }

  override get integration() {
    return null;
  }

  override async run(
    input: SignalInput<ScalarTypes['IMAGE'], true>,
  ): Promise<SignalResult<{ scalarType: ScalarTypes['NUMBER'] }>> {
    const { value, matchingValues } = input;

    // The banks are already loaded and cached by the execution service. Only
    // CLIP banks can be matched against an embedding.
    const banks = (matchingValues as unknown as HashBank[]).filter(
      (bank) => bank.hma_instance === 'CLIP',
    );

    // Each of these is a case where no score can be determined, so retrying
    // cannot help. They are expected, so they do not mark the span as failed.
    if (banks.length === 0) {
      throw makeSignalPermanentError('No CLIP hash banks were selected', {
        detail: 'This signal only compares images with CLIP hash banks.',
        shouldErrorSpan: false,
      });
    }
    if (!this.hmaService.isClipEnabled()) {
      throw makeSignalPermanentError('CLIP is not available', {
        detail: 'This deployment has no CLIP instance.',
        shouldErrorSpan: false,
      });
    }
    const embedding = (value.value as ImageValue).embeddings?.clip_float;
    if (!embedding) {
      throw makeSignalPermanentError('This image has no CLIP embedding', {
        detail:
          'Embeddings are only created for images submitted while CLIP is ' +
          'turned on for the organization, so this image cannot be compared.',
        shouldErrorSpan: false,
      });
    }

    // An error from the CLIP instance is deliberately not caught: it is not a
    // reason to say there is no match, and the engine may retry it.
    const { matchedBanks, closestDistance } =
      await this.hmaService.findClosestClipMatch(
        banks.map((bank) => bank.hma_name),
        embedding,
      );

    // Cosine distance 0 is identical and 1 is unrelated, so 1 - distance reads
    // as a similarity. Nothing close enough to any bank is a 0.
    const score =
      closestDistance === undefined
        ? 0
        : Math.min(1, Math.max(0, 1 - closestDistance));

    // Map HMA bank names back to user-friendly bank names
    const matchedBankNames = matchedBanks.map(
      (hmaName) =>
        banks.find((bank) => bank.hma_name === hmaName)?.name ?? hmaName,
    );

    return {
      score,
      outputType: { scalarType: ScalarTypes.NUMBER },
      // Store matched banks as metadata for frontend display
      matchedValue:
        matchedBankNames.length > 0
          ? jsonStringify({ matchedBanks: matchedBankNames })
          : undefined,
    };
  }
}
