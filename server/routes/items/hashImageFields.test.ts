import { vi } from 'vitest';

import { HmaRequestError } from '../../services/hmaService/index.js';
import { type ItemType } from '../../services/moderationConfigService/index.js';
import {
  addHashesToImageFields,
  makeClipHasher,
  makeClipHasherForOrg,
  type ClipOutcome,
} from './hashImageFields.js';

const schema = [
  { name: 'text', type: 'STRING', required: false, container: null },
  { name: 'images', type: 'IMAGE', required: false, container: null },
  {
    name: 'profilePic',
    type: 'ARRAY',
    required: false,
    container: {
      containerType: 'ARRAY',
      keyScalarType: 'NUMBER',
      valueScalarType: 'IMAGE',
    },
  },
  { name: 'cover', type: 'IMAGE', required: false, container: null },
] as unknown as ItemType['schema'];

const imageArray = {
  containerType: 'ARRAY',
  keyScalarType: 'NUMBER',
  valueScalarType: 'IMAGE',
};

const makeSchema = (fields: object[]) =>
  fields.map((it) => ({
    required: false,
    container: null,
    ...it,
  })) as unknown as ItemType['schema'];

const HMAHashBankService = {
  listBanks: vi.fn(),
  hashContentFromUrl: vi.fn(),
  checkImageMatchWithDetails: vi.fn(),
};

describe('addHashesToImageFields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HMAHashBankService.listBanks.mockResolvedValue([
      { hma_name: 'hma_bank', name: 'Bank' },
    ]);
    HMAHashBankService.hashContentFromUrl.mockResolvedValue({ pdq: 'abc' });
    HMAHashBankService.checkImageMatchWithDetails.mockResolvedValue({
      matchedBanks: ['hma_bank'],
    });
  });

  const run = async (
    data: { [key: string]: unknown },
    itemSchema: ItemType['schema'] = schema,
  ) => {
    await addHashesToImageFields({
      itemType: { schema: itemSchema },
      data,
      orgId: 'org',
      HMAHashBankService,
    });
    return data;
  };

  it('hashes an array Image field not named `images`', async () => {
    const data = await run({ profilePic: [{ url: 'https://x.test/a.png' }] });
    expect(data.profilePic).toEqual([
      {
        url: 'https://x.test/a.png',
        hashes: { pdq: 'abc' },
        matchedBanks: ['Bank'],
      },
    ]);
  });

  it('hashes a singular Image field, keeping it a single object', async () => {
    const data = await run({ images: { url: 'https://x.test/a.png' } });
    expect(data.images).toEqual({
      url: 'https://x.test/a.png',
      hashes: { pdq: 'abc' },
      matchedBanks: ['Bank'],
    });
  });

  it('hashes an array Image field named `images`', async () => {
    const data = await run(
      {
        images: [
          { url: 'https://x.test/a.png' },
          { url: 'https://x.test/b.png' },
        ],
      },
      makeSchema([{ name: 'images', type: 'ARRAY', container: imageArray }]),
    );
    expect(data.images).toEqual([
      {
        url: 'https://x.test/a.png',
        hashes: { pdq: 'abc' },
        matchedBanks: ['Bank'],
      },
      {
        url: 'https://x.test/b.png',
        hashes: { pdq: 'abc' },
        matchedBanks: ['Bank'],
      },
    ]);
  });

  it('hashes a singular Image field not named `images`', async () => {
    const data = await run({ cover: { url: 'https://x.test/c.png' } });
    expect(data.cover).toEqual({
      url: 'https://x.test/c.png',
      hashes: { pdq: 'abc' },
      matchedBanks: ['Bank'],
    });
  });

  it.each([
    ['a STRING', { name: 'images', type: 'STRING' }, 'https://x.test/a.png'],
    [
      'an array of STRING',
      {
        name: 'images',
        type: 'ARRAY',
        container: { ...imageArray, valueScalarType: 'STRING' },
      },
      ['https://x.test/a.png'],
    ],
  ])(
    'does not hash a field named `images` that is %s',
    async (_, field, value) => {
      const data = await run({ images: value }, makeSchema([field]));
      expect(data.images).toEqual(value);
      expect(HMAHashBankService.hashContentFromUrl).not.toHaveBeenCalled();
    },
  );

  it('keeps the image with empty hashes when hashing fails', async () => {
    HMAHashBankService.hashContentFromUrl.mockRejectedValue(new Error('boom'));
    const data = await run({ cover: { url: 'https://x.test/c.png' } });
    expect(data.cover).toEqual({ url: 'https://x.test/c.png', hashes: {} });
  });

  it('leaves matchedBanks undefined when no bank matches', async () => {
    HMAHashBankService.checkImageMatchWithDetails.mockResolvedValue({
      matchedBanks: [],
    });
    const data = await run({ cover: { url: 'https://x.test/c.png' } });
    expect(data.cover).toEqual({
      url: 'https://x.test/c.png',
      hashes: { pdq: 'abc' },
      matchedBanks: undefined,
    });
  });

  it('keeps the computed hashes when the bank lookup fails', async () => {
    HMAHashBankService.checkImageMatchWithDetails.mockRejectedValue(
      new Error('lookup down'),
    );
    const data = await run({ cover: { url: 'https://x.test/c.png' } });
    expect(data.cover).toEqual({
      url: 'https://x.test/c.png',
      hashes: { pdq: 'abc' },
      matchedBanks: undefined,
    });
  });

  it('skips the bank lookup entirely when image containers are empty', async () => {
    await run({ profilePic: [] });
    expect(HMAHashBankService.listBanks).not.toHaveBeenCalled();
  });

  it('hashes every value of a MAP-of-Image field', async () => {
    const data = await run(
      {
        gallery: {
          a: { url: 'https://x.test/a.png' },
          b: { url: 'https://x.test/b.png' },
        },
      },
      makeSchema([
        {
          name: 'gallery',
          type: 'MAP',
          container: {
            containerType: 'MAP',
            keyScalarType: 'STRING',
            valueScalarType: 'IMAGE',
          },
        },
      ]),
    );
    expect(data.gallery).toEqual({
      a: {
        url: 'https://x.test/a.png',
        hashes: { pdq: 'abc' },
        matchedBanks: ['Bank'],
      },
      b: {
        url: 'https://x.test/b.png',
        hashes: { pdq: 'abc' },
        matchedBanks: ['Bank'],
      },
    });
  });

  it('hashes images in a MEDIA array and leaves videos unchanged', async () => {
    const video = { url: 'https://x.test/v.mp4', mediaType: 'VIDEO' };
    const data = await run(
      {
        attachments: [
          { url: 'https://x.test/a.png', mediaType: 'IMAGE' },
          video,
        ],
      },
      makeSchema([
        {
          name: 'attachments',
          type: 'ARRAY',
          container: { ...imageArray, valueScalarType: 'MEDIA' },
        },
      ]),
    );
    expect(data.attachments).toEqual([
      {
        url: 'https://x.test/a.png',
        mediaType: 'IMAGE',
        hashes: { pdq: 'abc' },
        matchedBanks: ['Bank'],
      },
      video,
    ]);
    expect(HMAHashBankService.hashContentFromUrl).toHaveBeenCalledTimes(1);
  });

  it('hashes a singular MEDIA field holding an image', async () => {
    const data = await run(
      { attachment: { url: 'https://x.test/a.png', mediaType: 'IMAGE' } },
      makeSchema([{ name: 'attachment', type: 'MEDIA' }]),
    );
    expect(data.attachment).toMatchObject({
      mediaType: 'IMAGE',
      hashes: { pdq: 'abc' },
    });
  });

  it('hashes a MEDIA value whose mediaType could not be detected', async () => {
    const data = await run(
      { attachment: { url: 'https://x.test/no-extension', mediaType: null } },
      makeSchema([{ name: 'attachment', type: 'MEDIA' }]),
    );
    expect(data.attachment).toMatchObject({
      mediaType: null,
      hashes: { pdq: 'abc' },
    });
  });

  it('still hashes images when listing banks fails', async () => {
    HMAHashBankService.listBanks.mockRejectedValue(new Error('db down'));
    const data = await run({ cover: { url: 'https://x.test/c.png' } });
    expect(data.cover).toEqual({
      url: 'https://x.test/c.png',
      hashes: { pdq: 'abc' },
      matchedBanks: undefined,
    });
  });

  it('hashes every Image field and leaves other fields alone', async () => {
    const data = await run({
      text: 'hi',
      cover: { url: 'https://x.test/c.png' },
      profilePic: [{ url: 'https://x.test/a.png' }],
    });
    expect(data.text).toBe('hi');
    expect(data.cover).toMatchObject({ hashes: { pdq: 'abc' } });
    expect(HMAHashBankService.hashContentFromUrl).toHaveBeenCalledTimes(2);
  });
});

const CLIP = { clip_float: 'c'.repeat(8) };

describe('makeClipHasher', () => {
  const make = (
    overrides: Partial<Parameters<typeof makeClipHasher>[0]> = {},
  ) => {
    const outcomes: ClipOutcome[] = [];
    const hashClip = overrides.hashClip ?? vi.fn().mockResolvedValue(CLIP);
    const isAvailable =
      overrides.isAvailable ?? vi.fn().mockResolvedValue(true);
    const hasher = makeClipHasher({
      // eslint-disable-next-line functional/immutable-data
      onOutcome: (outcome) => outcomes.push(outcome),
      ...overrides,
      isAvailable,
      hashClip,
    });
    return { hasher, hashClip, isAvailable, outcomes };
  };

  it('hashes an image and reports success', async () => {
    const { hasher, hashClip, outcomes } = make();
    await expect(hasher.hash('https://x.test/a.png')).resolves.toEqual(CLIP);
    expect(hashClip).toHaveBeenCalledWith('https://x.test/a.png');
    expect(outcomes).toEqual(['success']);
  });

  it('does nothing when CLIP is off for the org, checking only once', async () => {
    const { hasher, hashClip, isAvailable, outcomes } = make({
      isAvailable: vi.fn().mockResolvedValue(false),
    });
    await expect(hasher.hash('https://x.test/a.png')).resolves.toBeUndefined();
    await expect(hasher.hash('https://x.test/b.png')).resolves.toBeUndefined();
    expect(hashClip).not.toHaveBeenCalled();
    expect(isAvailable).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([]);
  });

  it('checks availability once for many images', async () => {
    const { hasher, isAvailable } = make();
    await Promise.all(
      ['a', 'b', 'c'].map(async (n) => hasher.hash(`https://x.test/${n}.png`)),
    );
    expect(isAvailable).toHaveBeenCalledTimes(1);
  });

  it('treats a failed availability check as CLIP being off', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const { hasher, hashClip } = make({
      isAvailable: vi.fn().mockRejectedValue(new Error('db down')),
    });
    await expect(hasher.hash('https://x.test/a.png')).resolves.toBeUndefined();
    expect(hashClip).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('runs CLIP calls one at a time, in order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    const { hasher } = make({
      hashClip: vi.fn(async (url: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        // eslint-disable-next-line functional/immutable-data
        order.push(url);
        inFlight -= 1;
        return CLIP;
      }),
    });
    const urls = ['a', 'b', 'c', 'd', 'e'].map((n) => `https://x.test/${n}`);
    await Promise.all(urls.map(async (url) => hasher.hash(url)));
    expect(maxInFlight).toBe(1);
    expect(order).toEqual(urls);
  });

  it('moves on after an image-specific failure (4xx)', async () => {
    const { hasher, hashClip, outcomes } = make({
      hashClip: vi
        .fn()
        .mockRejectedValueOnce(new HmaRequestError('unsupported', 400))
        .mockResolvedValue(CLIP),
    });
    await expect(hasher.hash('https://x.test/bad')).resolves.toBeUndefined();
    await expect(hasher.hash('https://x.test/good')).resolves.toEqual(CLIP);
    expect(hashClip).toHaveBeenCalledTimes(2);
    expect(outcomes).toEqual(['image_error', 'success']);
  });

  it.each([
    ['a 5xx', new HmaRequestError('down', 503)],
    [
      'a timeout',
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    ],
    ['a connection error', new Error('ECONNREFUSED')],
  ])(
    'stops CLIP for the rest of the request after two failures in a row (%s)',
    async (_name, failure) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(vi.fn());
      const hashClip = vi.fn().mockRejectedValue(failure);
      const { hasher, outcomes } = make({ hashClip });

      const results = await Promise.all(
        ['a', 'b', 'c', 'd'].map(async (n) =>
          hasher.hash(`https://x.test/${n}`),
        ),
      );

      expect(results).toEqual([undefined, undefined, undefined, undefined]);
      expect(hashClip).toHaveBeenCalledTimes(2);
      expect(outcomes).toEqual([
        'service_error',
        'service_error',
        'skipped',
        'skipped',
      ]);
      expect(consoleError).toHaveBeenCalledTimes(2);
      consoleError.mockRestore();
    },
  );

  describe('failures in a row', () => {
    const down = () => new HmaRequestError('down', 503);
    const urls = ['a', 'b', 'c', 'd'].map((n) => `https://x.test/${n}`);
    const hashAll = async (hasher: ReturnType<typeof makeClipHasher>) =>
      Promise.all(urls.map(async (url) => hasher.hash(url)));

    it('does not stop after a single service failure', async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(vi.fn());
      const hashClip = vi
        .fn()
        .mockRejectedValueOnce(down())
        .mockResolvedValue(CLIP);
      const { hasher, outcomes } = make({ hashClip });

      const results = await hashAll(hasher);

      expect(results).toEqual([undefined, CLIP, CLIP, CLIP]);
      expect(outcomes).toEqual([
        'service_error',
        'success',
        'success',
        'success',
      ]);
      consoleError.mockRestore();
    });

    it('counts only failures that follow each other', async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(vi.fn());
      const hashClip = vi
        .fn()
        .mockRejectedValueOnce(down())
        .mockResolvedValueOnce(CLIP)
        .mockRejectedValueOnce(down())
        .mockResolvedValue(CLIP);
      const { hasher, outcomes } = make({ hashClip });

      await hashAll(hasher);

      expect(hashClip).toHaveBeenCalledTimes(4);
      expect(outcomes).toEqual([
        'service_error',
        'success',
        'service_error',
        'success',
      ]);
      consoleError.mockRestore();
    });

    it('resets the count when the service answers that an image is bad', async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(vi.fn());
      const hashClip = vi
        .fn()
        .mockRejectedValueOnce(down())
        .mockRejectedValueOnce(new HmaRequestError('not an image', 400))
        .mockRejectedValueOnce(down())
        .mockResolvedValue(CLIP);
      const { hasher, outcomes } = make({ hashClip });

      const results = await hashAll(hasher);

      expect(hashClip).toHaveBeenCalledTimes(4);
      expect(results[3]).toEqual(CLIP);
      expect(outcomes).toEqual([
        'service_error',
        'image_error',
        'service_error',
        'success',
      ]);
      consoleError.mockRestore();
    });

    it.each([408, 429])(
      'treats a %i as the service struggling, not as a bad image',
      async (status) => {
        const consoleError = vi
          .spyOn(console, 'error')
          .mockImplementation(vi.fn());
        const hashClip = vi
          .fn()
          .mockRejectedValue(new HmaRequestError('busy', status));
        const { hasher, outcomes } = make({ hashClip });

        await hashAll(hasher);

        expect(hashClip).toHaveBeenCalledTimes(2);
        expect(outcomes).toEqual([
          'service_error',
          'service_error',
          'skipped',
          'skipped',
        ]);
        consoleError.mockRestore();
      },
    );

    it.each([400, 403, 404, 422])(
      'treats a %i as a problem with that one image',
      async (status) => {
        const hashClip = vi
          .fn()
          .mockRejectedValue(new HmaRequestError('bad image', status));
        const { hasher, outcomes } = make({ hashClip });

        await hashAll(hasher);

        expect(hashClip).toHaveBeenCalledTimes(4);
        expect(outcomes).toEqual([
          'image_error',
          'image_error',
          'image_error',
          'image_error',
        ]);
      },
    );
  });

  it('does not let a failing metric callback change the outcome', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const { hasher } = make({
      onOutcome: () => {
        throw new Error('metrics down');
      },
    });
    await expect(hasher.hash('https://x.test/a.png')).resolves.toEqual(CLIP);
    await expect(hasher.hash('https://x.test/b.png')).resolves.toEqual(CLIP);
    consoleError.mockRestore();
  });

  it('remembers that the availability check failed, without retrying it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const isAvailable = vi.fn().mockRejectedValue(new Error('db down'));
    const { hasher, hashClip } = make({ isAvailable });
    await hasher.hash('https://x.test/a.png');
    await hasher.hash('https://x.test/b.png');
    expect(isAvailable).toHaveBeenCalledTimes(1);
    expect(hashClip).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  describe('run', () => {
    it('does not make the call when CLIP is off for the org', async () => {
      const call = vi.fn().mockResolvedValue('x');
      const { hasher } = make({
        isAvailable: vi.fn().mockResolvedValue(false),
      });
      await expect(hasher.run(call)).resolves.toBeUndefined();
      expect(call).not.toHaveBeenCalled();
    });

    it('returns what the call returns', async () => {
      const { hasher } = make();
      await expect(hasher.run(async () => 42)).resolves.toBe(42);
    });

    it('queues behind hashing, one call at a time', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const slow = async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return CLIP;
      };
      const { hasher } = make({ hashClip: vi.fn(slow) });
      await Promise.all([
        hasher.hash('https://x.test/a.png'),
        hasher.run(slow),
        hasher.hash('https://x.test/b.png'),
        hasher.run(slow),
      ]);
      expect(maxInFlight).toBe(1);
    });

    it('rejects with the call error but keeps the queue working', async () => {
      const { hasher } = make();
      await expect(
        hasher.run(async () => {
          throw new HmaRequestError('bad signal', 400);
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(hasher.hash('https://x.test/a.png')).resolves.toEqual(CLIP);
    });

    it('stops CLIP for the request after two service-level failures in a row', async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(vi.fn());
      const { hasher, hashClip, outcomes } = make();
      const fail = async () => {
        throw new HmaRequestError('down', 503);
      };
      await expect(hasher.run(fail)).rejects.toBeInstanceOf(HmaRequestError);
      // One failure is not enough to stop.
      await expect(hasher.run(async () => 'still on')).resolves.toBe(
        'still on',
      );
      await expect(hasher.run(fail)).rejects.toBeInstanceOf(HmaRequestError);
      await expect(hasher.run(fail)).rejects.toBeInstanceOf(HmaRequestError);

      await expect(
        hasher.hash('https://x.test/a.png'),
      ).resolves.toBeUndefined();
      await expect(hasher.run(async () => 'x')).resolves.toBeUndefined();
      expect(hashClip).not.toHaveBeenCalled();
      expect(outcomes).toEqual(['skipped']);
      consoleError.mockRestore();
    });

    it('carries on after an image-specific failure in a call', async () => {
      const { hasher } = make();
      await expect(
        hasher.run(async () => {
          throw new HmaRequestError('bad', 400);
        }),
      ).rejects.toBeInstanceOf(HmaRequestError);
      await expect(hasher.run(async () => 'ok')).resolves.toBe('ok');
    });
  });

  it('treats an empty result as no embedding', async () => {
    const { hasher } = make({ hashClip: vi.fn().mockResolvedValue({}) });
    await expect(hasher.hash('https://x.test/a.png')).resolves.toBeUndefined();
  });
});

describe('makeClipHasherForOrg', () => {
  it('asks whether CLIP is on for this org and hashes with the service', async () => {
    const service = {
      isClipAvailableToOrg: vi.fn().mockResolvedValue(true),
      hashClipFromUrl: vi.fn().mockResolvedValue(CLIP),
    };
    const hasher = makeClipHasherForOrg({
      orgId: 'org-9',
      HMAHashBankService: service,
    });
    await expect(hasher.hash('https://x.test/a.png')).resolves.toEqual(CLIP);
    expect(service.isClipAvailableToOrg).toHaveBeenCalledWith('org-9');
    expect(service.hashClipFromUrl).toHaveBeenCalledWith(
      'https://x.test/a.png',
    );
  });

  it('never reads the setting when the request has no images', () => {
    const service = {
      isClipAvailableToOrg: vi.fn(),
      hashClipFromUrl: vi.fn(),
    };
    makeClipHasherForOrg({ orgId: 'org-9', HMAHashBankService: service });
    expect(service.isClipAvailableToOrg).not.toHaveBeenCalled();
  });
});

describe('addHashesToImageFields with CLIP', () => {
  const PDQ_BANK = {
    hma_name: 'pdq_bank',
    name: 'PDQ Bank',
    hma_instance: 'DEFAULT',
  };
  const CLIP_BANK = {
    hma_name: 'clip_bank',
    name: 'CLIP Bank',
    hma_instance: 'CLIP',
  };

  const hashClip = vi.fn();
  // A fresh hasher per test: it remembers a CLIP service failure.
  let clipHasher: ReturnType<typeof makeClipHasher>;

  beforeEach(() => {
    vi.clearAllMocks();
    clipHasher = makeClipHasher({
      isAvailable: async () => true,
      hashClip: async (url) => hashClip(url),
    });
    HMAHashBankService.listBanks.mockResolvedValue([PDQ_BANK, CLIP_BANK]);
    HMAHashBankService.hashContentFromUrl.mockResolvedValue({ pdq: 'abc' });
    hashClip.mockResolvedValue(CLIP);
    HMAHashBankService.checkImageMatchWithDetails.mockImplementation(
      async (bankNames: string[]) => ({ matchedBanks: bankNames }),
    );
  });

  const run = async (
    data: { [key: string]: unknown },
    options: { withClip?: boolean; schema?: ItemType['schema'] } = {},
  ) => {
    await addHashesToImageFields({
      itemType: { schema: options.schema ?? schema },
      data,
      orgId: 'org',
      HMAHashBankService,
      ...((options.withClip ?? true) ? { clipHasher } : {}),
    });
    return data;
  };

  const mediaSchema = makeSchema([{ name: 'attachment', type: 'MEDIA' }]);

  it('stores the embedding apart from the hashes, which NCMEC forwards', async () => {
    const data = await run({ cover: { url: 'https://x.test/c.png' } });
    expect(data.cover).toMatchObject({
      hashes: { pdq: 'abc' },
      embeddings: CLIP,
    });
    expect(
      Object.keys((data.cover as { hashes: object }).hashes),
    ).not.toContain('clip_float');
  });

  it('checks hashes only against standard banks and embeddings only against CLIP banks', async () => {
    const data = await run({ cover: { url: 'https://x.test/c.png' } });

    expect(HMAHashBankService.checkImageMatchWithDetails).toHaveBeenCalledWith(
      ['pdq_bank'],
      'pdq',
      'abc',
    );
    expect(HMAHashBankService.checkImageMatchWithDetails).toHaveBeenCalledWith(
      ['clip_bank'],
      'clip_float',
      CLIP.clip_float,
    );
    expect(HMAHashBankService.checkImageMatchWithDetails).toHaveBeenCalledTimes(
      2,
    );
    expect(data.cover).toMatchObject({
      matchedBanks: ['PDQ Bank', 'CLIP Bank'],
    });
  });

  it('adds nothing CLIP when the org has no CLIP hasher', async () => {
    const data = await run(
      { cover: { url: 'https://x.test/c.png' } },
      { withClip: false },
    );
    expect(data.cover).not.toHaveProperty('embeddings');
    expect(hashClip).not.toHaveBeenCalled();
  });

  it('keeps PDQ hashes and matches when CLIP fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    hashClip.mockRejectedValue(new HmaRequestError('down', 503));
    const data = await run({ cover: { url: 'https://x.test/c.png' } });
    expect(data.cover).toEqual({
      url: 'https://x.test/c.png',
      hashes: { pdq: 'abc' },
      matchedBanks: ['PDQ Bank'],
    });
    consoleError.mockRestore();
  });

  it('keeps the CLIP embedding when PDQ hashing fails', async () => {
    HMAHashBankService.hashContentFromUrl.mockRejectedValue(new Error('boom'));
    const data = await run({ cover: { url: 'https://x.test/c.png' } });
    expect(data.cover).toEqual({
      url: 'https://x.test/c.png',
      hashes: {},
      embeddings: CLIP,
      matchedBanks: ['CLIP Bank'],
    });
  });

  it('keeps PDQ matches when the CLIP bank lookup fails', async () => {
    HMAHashBankService.checkImageMatchWithDetails.mockImplementation(
      async (bankNames: string[], signalType: string) => {
        if (signalType === 'clip_float') {
          throw new Error('lookup down');
        }
        return { matchedBanks: bankNames };
      },
    );
    const data = await run({ cover: { url: 'https://x.test/c.png' } });
    expect(data.cover).toMatchObject({
      embeddings: CLIP,
      matchedBanks: ['PDQ Bank'],
    });
  });

  it('keeps CLIP matches when the PDQ bank lookup fails', async () => {
    HMAHashBankService.checkImageMatchWithDetails.mockImplementation(
      async (bankNames: string[], signalType: string) => {
        if (signalType === 'pdq') {
          throw new Error('lookup down');
        }
        return { matchedBanks: bankNames };
      },
    );
    const data = await run({ cover: { url: 'https://x.test/c.png' } });
    expect(data.cover).toMatchObject({ matchedBanks: ['CLIP Bank'] });
  });

  it('ignores an embedding supplied by the client', async () => {
    const forged = { clip_float: 'forged' };
    const withoutClip = await run(
      { cover: { url: 'https://x.test/c.png', embeddings: forged } },
      { withClip: false },
    );
    expect(withoutClip.cover).not.toHaveProperty('embeddings');

    hashClip.mockRejectedValue(new HmaRequestError('unsupported', 400));
    const whenClipFails = await run({
      cover: { url: 'https://x.test/c.png', embeddings: forged },
    });
    expect(whenClipFails.cover).not.toHaveProperty('embeddings');
  });

  it('hashes every image of a batch one at a time', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    hashClip.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return CLIP;
    });
    const data = await run({
      cover: { url: 'https://x.test/c.png' },
      profilePic: [
        { url: 'https://x.test/a.png' },
        { url: 'https://x.test/b.png' },
      ],
    });
    expect(hashClip).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(1);
    expect(data.profilePic).toEqual([
      expect.objectContaining({ embeddings: CLIP }),
      expect.objectContaining({ embeddings: CLIP }),
    ]);
  });

  it('looks CLIP banks up one at a time, in turn with the hashing', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const track = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
    };
    hashClip.mockImplementation(async () => {
      await track();
      return CLIP;
    });
    HMAHashBankService.checkImageMatchWithDetails.mockImplementation(
      async (bankNames: string[], signalType: string) => {
        if (signalType === 'clip_float') {
          await track();
        }
        return { matchedBanks: bankNames };
      },
    );
    await run({
      profilePic: [
        { url: 'https://x.test/a.png' },
        { url: 'https://x.test/b.png' },
        { url: 'https://x.test/c.png' },
      ],
    });
    expect(maxInFlight).toBe(1);
  });

  it('stops looking CLIP banks up once the CLIP service has failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    HMAHashBankService.checkImageMatchWithDetails.mockImplementation(
      async (bankNames: string[], signalType: string) => {
        if (signalType === 'clip_float') {
          throw new HmaRequestError('down', 503);
        }
        return { matchedBanks: bankNames };
      },
    );
    const data = await run({
      profilePic: [
        { url: 'https://x.test/a.png' },
        { url: 'https://x.test/b.png' },
        { url: 'https://x.test/c.png' },
      ],
    });

    // Hashing is queued ahead of any lookup, so every image has its embedding;
    // only the first two lookups were attempted before CLIP was given up on,
    // and the PDQ matches are unharmed.
    const lookups = HMAHashBankService.checkImageMatchWithDetails.mock.calls
      .map(([, signalType]) => signalType)
      .filter((signalType) => signalType === 'clip_float');
    expect(lookups).toHaveLength(2);
    expect(data.profilePic).toEqual([
      expect.objectContaining({ embeddings: CLIP, matchedBanks: ['PDQ Bank'] }),
      expect.objectContaining({ embeddings: CLIP, matchedBanks: ['PDQ Bank'] }),
      expect.objectContaining({ embeddings: CLIP, matchedBanks: ['PDQ Bank'] }),
    ]);
    consoleError.mockRestore();
  });

  it('lists the banks through the function it is given, not the service', async () => {
    const listBanks = vi.fn().mockResolvedValue([PDQ_BANK, CLIP_BANK]);
    HMAHashBankService.listBanks.mockRejectedValue(new Error('not used'));
    const data: { [key: string]: unknown } = {
      cover: { url: 'https://x.test/c.png' },
    };

    await addHashesToImageFields({
      itemType: { schema },
      data,
      orgId: 'org',
      HMAHashBankService,
      clipHasher,
      listBanks,
    });

    expect(listBanks).toHaveBeenCalledTimes(1);
    expect(HMAHashBankService.listBanks).not.toHaveBeenCalled();
    expect(data.cover).toMatchObject({
      matchedBanks: ['PDQ Bank', 'CLIP Bank'],
    });
  });

  it('asks the service for the banks of its own org when not given a function', async () => {
    await run({ cover: { url: 'https://x.test/c.png' } });
    expect(HMAHashBankService.listBanks).toHaveBeenCalledWith('org');
  });

  it('drops a client-supplied embeddings from non-image media too', async () => {
    const data = await run(
      {
        attachment: {
          url: 'https://x.test/v.mp4',
          mediaType: 'VIDEO',
          embeddings: { clip_float: 'forged' },
        },
      },
      { schema: mediaSchema },
    );
    expect(data.attachment).toEqual({
      url: 'https://x.test/v.mp4',
      mediaType: 'VIDEO',
    });
  });

  it('does not CLIP-hash videos', async () => {
    await run(
      { attachment: { url: 'https://x.test/v.mp4', mediaType: 'VIDEO' } },
      { schema: mediaSchema },
    );
    expect(hashClip).not.toHaveBeenCalled();
    expect(HMAHashBankService.hashContentFromUrl).not.toHaveBeenCalled();
  });

  it('does CLIP-hash an image held in a MEDIA field', async () => {
    const data = await run(
      { attachment: { url: 'https://x.test/a.png', mediaType: 'IMAGE' } },
      { schema: mediaSchema },
    );
    expect(hashClip).toHaveBeenCalledWith('https://x.test/a.png');
    expect(data.attachment).toMatchObject({ embeddings: CLIP });
  });
});
