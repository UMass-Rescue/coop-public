import { getScalarType, ScalarTypes } from '@roostorg/coop-types';

import { type Dependencies } from '../../iocContainer/index.js';
import { HmaRequestError } from '../../services/hmaService/index.js';
import { type ItemType } from '../../services/moderationConfigService/index.js';
import { withRetries } from '../../utils/misc.js';

type HashService = Pick<
  Dependencies['HMAHashBankService'],
  'listBanks' | 'hashContentFromUrl' | 'checkImageMatchWithDetails'
>;

type ClipService = Pick<
  Dependencies['HMAHashBankService'],
  'isClipAvailableToOrg' | 'hashClipFromUrl'
>;

type ImageValue = string | { url: string; [key: string]: unknown };

export type ClipOutcome =
  'success' | 'image_error' | 'service_error' | 'skipped';

export type ClipHasher = {
  /**
   * Hashes one image with CLIP, e.g. `{ clip_float: '...' }`. Resolves to
   * undefined when CLIP is off for the org, or when the image is skipped or
   * fails; it never rejects.
   */
  hash: (url: string) => Promise<Record<string, string> | undefined>;
  /**
   * Runs another call to the CLIP service (a bank lookup) in turn with the
   * hashing. Resolves to undefined, without making the call, when CLIP is off
   * for the org or has failed during this request. Rejects with the call's
   * error; repeated service-level failures also stop CLIP for the request.
   */
  run: <T>(call: () => Promise<T>) => Promise<T | undefined>;
};

/**
 * A 4xx from HMA means that one image could not be handled, not that the
 * service is unwell. 408 (timed out) and 429 (too many requests) are the
 * exceptions: they say the service is struggling.
 */
const isImageError = (error: unknown) =>
  error instanceof HmaRequestError &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 408 &&
  error.status !== 429;

/** Service-level failures in a row after which CLIP is skipped for a request. */
const SERVICE_FAILURES_BEFORE_STOPPING = 2;

/**
 * Builds the CLIP hasher for one submit request, shared by all of its items.
 *
 * - Every call to the CLIP service runs one at a time. The service handles one
 *   image at a time anyway, so concurrent calls would only queue on its side,
 *   and a call's timeout would then count that waiting.
 * - Two failures of the service itself in a row (a timeout, a connection
 *   error, a 5xx) stop CLIP for the rest of the request, so a down service
 *   cannot stall a large batch for one timeout per image. Waiting for a second
 *   failure keeps one slow image host from switching CLIP off for the whole
 *   batch. A 4xx means that one image could not be hashed (blocked, not an
 *   image, ...), so the others carry on; any answer from the service, success
 *   or 4xx, resets the count.
 * - Whether CLIP is on for the org is checked once, and only if an image is
 *   actually hashed, so text-only requests never read the setting.
 */
export function makeClipHasher({
  isAvailable,
  hashClip,
  onOutcome = () => undefined,
}: {
  isAvailable: () => Promise<boolean>;
  hashClip: (url: string) => Promise<Record<string, string>>;
  onOutcome?: (outcome: ClipOutcome) => void;
}): ClipHasher {
  let available: Promise<boolean> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let serviceFailed = false;
  let serviceFailuresInARow = 0;

  // Reporting a metric must never change what happens to the image.
  const report = (outcome: ClipOutcome) => {
    try {
      onOutcome(outcome);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to record a CLIP hashing outcome:', error);
    }
  };

  const isAvailableOnce = async () => {
    available ??= isAvailable().catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('Failed to check whether CLIP is on for the org:', error);
      return false;
    });
    return available;
  };

  const serviceResponded = () => {
    serviceFailuresInARow = 0;
  };

  const serviceFailedOnce = (error: unknown) => {
    serviceFailuresInARow += 1;
    serviceFailed ||= serviceFailuresInARow >= SERVICE_FAILURES_BEFORE_STOPPING;
    // eslint-disable-next-line no-console
    console.error(
      serviceFailed
        ? 'CLIP failed repeatedly; skipping CLIP for the rest of this request:'
        : 'CLIP call failed:',
      error,
    );
  };

  // The queue carries on after a task fails, so one failure cannot reject
  // the tasks behind it.
  const enqueue = async <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  };

  const hashOne = async (url: string) => {
    if (!(await isAvailableOnce())) {
      return undefined;
    }
    if (serviceFailed) {
      report('skipped');
      return undefined;
    }
    try {
      const embeddings = await hashClip(url);
      serviceResponded();
      report('success');
      return Object.keys(embeddings).length > 0 ? embeddings : undefined;
    } catch (error) {
      if (isImageError(error)) {
        serviceResponded();
        report('image_error');
        return undefined;
      }
      serviceFailedOnce(error);
      report('service_error');
      return undefined;
    }
  };

  return {
    hash: async (url) => enqueue(async () => hashOne(url)),
    run: async (call) =>
      enqueue(async () => {
        if (!(await isAvailableOnce()) || serviceFailed) {
          return undefined;
        }
        try {
          const result = await call();
          serviceResponded();
          return result;
        } catch (error) {
          if (isImageError(error)) {
            serviceResponded();
          } else {
            serviceFailedOnce(error);
          }
          throw error;
        }
      }),
  };
}

/** The CLIP hasher for a request from `orgId`, sharing its state across items. */
export function makeClipHasherForOrg({
  orgId,
  HMAHashBankService,
  onOutcome,
}: {
  orgId: string;
  HMAHashBankService: ClipService;
  onOutcome?: (outcome: ClipOutcome) => void;
}): ClipHasher {
  return makeClipHasher({
    isAvailable: async () => HMAHashBankService.isClipAvailableToOrg(orgId),
    hashClip: async (url) => HMAHashBankService.hashClipFromUrl(url),
    onOutcome,
  });
}

/**
 * Computes HMA hashes for every Image- (or Media-) typed field in the item's schema
 * (singular or array, whatever the field is named) and writes them back onto
 * `data`, in the same shape the field already had, so that signals like
 * IMAGE_SIMILARITY_MATCH can read `hashes` and `matchedBanks` from the values.
 *
 * When a `clipHasher` is given, each image also gets its CLIP embedding under
 * `embeddings`, and `matchedBanks` also lists the matching CLIP banks. CLIP is
 * kept out of `hashes` on purpose: everything in `hashes` is forwarded to NCMEC
 * as a file hash. PDQ and CLIP succeed or fail independently of each other.
 *
 * NB: This mutates `data`.
 */
export async function addHashesToImageFields({
  itemType,
  data,
  orgId,
  HMAHashBankService,
  clipHasher,
  listBanks = async () => HMAHashBankService.listBanks(orgId),
}: {
  itemType: Pick<ItemType, 'schema'>;
  data: { [key: string]: unknown };
  orgId: string;
  HMAHashBankService: HashService;
  clipHasher?: ClipHasher;
  /**
   * How to list the org's banks. A request with several items passes one
   * shared function, so the banks are listed (and checked against HMA) once
   * for the request instead of once per item.
   */
  listBanks?: () => ReturnType<HashService['listBanks']>;
}) {
  const imageFields = itemType.schema.filter(
    (field) =>
      isHashableScalarType(getScalarType(field)) &&
      hasImageValues(field.type, data[field.name]),
  );
  if (imageFields.length === 0) {
    return;
  }

  try {
    // Get all hash banks for this org once. Banks only add `matchedBanks`
    // metadata, so failing to list them must not stop us hashing the images.
    // CLIP banks only match CLIP embeddings, and the rest only match hashes.
    const allBanks = await listBanks().catch(() => []);
    const clipBanks = allBanks.filter((bank) => bank.hma_instance === 'CLIP');
    const standardBanks = allBanks.filter(
      (bank) => bank.hma_instance !== 'CLIP',
    );

    // Names of the banks in `banks` that any of the `hashes` matches. Best
    // effort: signals re-check the hashes against banks themselves, so a
    // failed lookup must not discard the hashes we have.
    const matchBanks = async (
      banks: typeof allBanks,
      hashes: Record<string, string>,
      run?: ClipHasher['run'],
    ) => {
      const bankNames = banks.map((bank) => bank.hma_name);
      if (Object.keys(hashes).length === 0 || bankNames.length === 0) {
        return [];
      }
      try {
        const lookUp = async (signalType: string, hash: string) => {
          const check = async () =>
            HMAHashBankService.checkImageMatchWithDetails(
              bankNames,
              signalType,
              hash,
            );
          return run ? run(check) : check();
        };
        const matchResults = await Promise.all(
          Object.entries(hashes).map(async ([signalType, hash]) =>
            lookUp(signalType, hash),
          ),
        );

        const allMatchedHmaBanks = new Set<string>();
        matchResults.forEach((result) => {
          result?.matchedBanks.forEach((bank) => allMatchedHmaBanks.add(bank));
        });

        // Map HMA bank names to user-friendly names
        return Array.from(allMatchedHmaBanks).flatMap((hmaName) => {
          const bank = banks.find((b) => b.hma_name === hmaName);
          return bank ? [bank.name] : [];
        });
      } catch (e) {
        return [];
      }
    };

    const hashWithPdq = async (
      url: string,
    ): Promise<Record<string, string> | undefined> => {
      try {
        const hmaHashWithRetries = await withRetries(
          {
            maxRetries: 5,
            initialTimeMsBetweenRetries: 5,
            maxTimeMsBetweenRetries: 500,
            jitter: true,
          },
          async () => HMAHashBankService.hashContentFromUrl(url),
        );
        return await hmaHashWithRetries();
      } catch (e) {
        return undefined;
      }
    };

    const hashImage = async (image: ImageValue) => {
      // MEDIA fields can also hold video/audio, which we return unchanged.
      // A null mediaType means the kind couldn't be inferred from the URL's
      // extension, so we hash it and let HMA detect the content type.
      if (
        typeof image === 'object' &&
        'mediaType' in image &&
        image.mediaType != null &&
        image.mediaType !== ScalarTypes.IMAGE
      ) {
        const { embeddings: _clientEmbeddings, ...rest } = image;
        return rest;
      }
      const url = typeof image === 'string' ? image : image.url;
      // Preserve any fields the coercion step already populated on the media
      // object, rather than rebuilding a fresh object that drops them. The
      // client controls those, so `embeddings` is never taken from them.
      const clientFields: Record<string, unknown> =
        typeof image === 'string' ? {} : image;
      const { embeddings: _clientEmbeddings, ...coercedFields } = clientFields;
      if (typeof url !== 'string' || !url) {
        return null;
      }

      const [hashes, embeddings] = await Promise.all([
        hashWithPdq(url),
        clipHasher?.hash(url),
      ]);

      const matchedBankNames = [
        ...(await matchBanks(standardBanks, hashes ?? {})),
        ...(await matchBanks(clipBanks, embeddings ?? {}, clipHasher?.run)),
      ];

      return {
        ...coercedFields,
        url,
        hashes: hashes ?? {},
        ...(embeddings ? { embeddings } : {}),
        matchedBanks:
          matchedBankNames.length > 0 ? matchedBankNames : undefined,
      };
    };

    for (const field of imageFields) {
      const value = data[field.name];
      if (field.type === 'ARRAY') {
        data[field.name] = await Promise.all(
          (value as ImageValue[]).map(hashImage),
        );
      } else if (field.type === 'MAP') {
        const entries = Object.entries(value as Record<string, ImageValue>);
        const hashed = await Promise.all(
          entries.map(async ([, it]) => hashImage(it)),
        );
        data[field.name] = Object.fromEntries(
          entries.map(([key], i) => [key, hashed[i]]),
        );
      } else {
        const hashed = await hashImage(value as ImageValue);
        if (hashed) {
          data[field.name] = hashed;
        }
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to get HMA hashes for images:', error);
  }
}

function isHashableScalarType(scalarType: string) {
  return scalarType === ScalarTypes.IMAGE || scalarType === ScalarTypes.MEDIA;
}

/** Whether a field's value holds at least one image to hash. */
function hasImageValues(fieldType: string, value: unknown) {
  if (value == null) {
    return false;
  }
  if (fieldType === 'ARRAY') {
    return Array.isArray(value) && value.length > 0;
  }
  if (fieldType === 'MAP') {
    return typeof value === 'object' && Object.keys(value).length > 0;
  }
  return true;
}
