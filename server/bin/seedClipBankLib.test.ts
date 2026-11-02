/* eslint-disable security/detect-non-literal-fs-filename */
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { listImageFiles, seedClipBank } from './seedClipBankLib.js';

type Service = Parameters<typeof seedClipBank>[0]['hmaService'];

const CLIP_BANK = {
  name: 'Memes',
  hma_name: 'COOP_ORG1_MEMES',
  hma_instance: 'CLIP',
};

function makeService(overrides: Partial<Record<keyof Service, unknown>> = {}) {
  const addContentToBank = vi.fn(async () => ({ id: 7 }));
  const service = {
    getBank: vi.fn(async () => CLIP_BANK),
    isClipEnabled: vi.fn(() => true),
    isClipAvailableToOrg: vi.fn(async () => true),
    addContentToBank,
    ...overrides,
  } as unknown as Service;
  return { service, addContentToBank };
}

async function makeDir(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'seed-clip-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content);
  }
  return dir;
}

async function seed(service: Service, dir: string, dryRun = false) {
  return seedClipBank({
    hmaService: service,
    orgId: 'org1',
    bankName: 'Memes',
    dir,
    dryRun,
    log: () => undefined,
  });
}

describe('listImageFiles', () => {
  it('lists only image files, in name order', async () => {
    const dir = await makeDir({
      'b.PNG': 'x',
      'a.jpg': 'x',
      'notes.txt': 'x',
      'c.webp': 'x',
    });
    expect(await listImageFiles(dir)).toEqual(['a.jpg', 'b.PNG', 'c.webp']);
  });
});

describe('seedClipBank', () => {
  it('adds each image to the CLIP instance with a content hash and file name', async () => {
    const dir = await makeDir({ 'a.jpg': 'first', 'b.png': 'second' });
    const { service, addContentToBank } = makeService();

    const result = await seed(service, dir);

    expect(result).toEqual({ added: ['a.jpg', 'b.png'], failed: [] });
    expect(addContentToBank).toHaveBeenCalledTimes(2);
    const [bankName, options] = addContentToBank.mock.calls[0] as unknown as [
      string,
      {
        instance: string;
        contentType: string;
        file: File;
        metadata: { content_id: string; json: unknown };
      },
    ];
    expect(bankName).toBe('COOP_ORG1_MEMES');
    expect(options.instance).toBe('CLIP');
    expect(options.contentType).toBe('photo');
    expect(options.file.name).toBe('a.jpg');
    expect(options.file.type).toBe('image/jpeg');
    // sha256 of "first"
    expect(options.metadata.content_id).toBe(
      'a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e',
    );
    expect(options.metadata.json).toEqual({ file_name: 'a.jpg' });
  });

  it('adds nothing on a dry run', async () => {
    const dir = await makeDir({ 'a.jpg': 'x' });
    const { service, addContentToBank } = makeService();

    expect(await seed(service, dir, true)).toEqual({ added: [], failed: [] });
    expect(addContentToBank).not.toHaveBeenCalled();
  });

  it('records a failed image and still adds the rest', async () => {
    const dir = await makeDir({ 'a.jpg': 'x', 'b.jpg': 'y' });
    const addContentToBank = vi
      .fn()
      .mockRejectedValueOnce(new Error('CLIP instance returned 400'))
      .mockResolvedValueOnce({ id: 7 });
    const { service } = makeService({ addContentToBank });

    expect(await seed(service, dir)).toEqual({
      added: ['b.jpg'],
      failed: [{ file: 'a.jpg', error: 'CLIP instance returned 400' }],
    });
  });

  it('refuses a bank that is not a CLIP bank', async () => {
    const dir = await makeDir({ 'a.jpg': 'x' });
    const { service, addContentToBank } = makeService({
      getBank: vi.fn(async () => ({ ...CLIP_BANK, hma_instance: 'DEFAULT' })),
    });

    await expect(seed(service, dir)).rejects.toThrow('is not a CLIP bank');
    expect(addContentToBank).not.toHaveBeenCalled();
  });

  it('says so when the bank does not exist and CLIP is on for the org', async () => {
    const dir = await makeDir({ 'a.jpg': 'x' });
    const { service } = makeService({ getBank: vi.fn(async () => null) });

    await expect(seed(service, dir)).rejects.toThrow('No bank named "Memes"');
  });

  it('says so when CLIP is off for the org', async () => {
    const dir = await makeDir({ 'a.jpg': 'x' });
    const { service, addContentToBank } = makeService({
      getBank: vi.fn(async () => null),
      isClipAvailableToOrg: vi.fn(async () => false),
    });

    await expect(seed(service, dir)).rejects.toThrow(
      'CLIP is not turned on for this org',
    );
    expect(addContentToBank).not.toHaveBeenCalled();
  });

  it('says so when the deployment has no CLIP instance', async () => {
    const dir = await makeDir({ 'a.jpg': 'x' });
    const { service } = makeService({
      getBank: vi.fn(async () => null),
      isClipEnabled: vi.fn(() => false),
    });

    await expect(seed(service, dir)).rejects.toThrow('CLIP is not available');
  });

  it('fails when the directory has no images', async () => {
    const dir = await makeDir({ 'notes.txt': 'x' });
    const { service } = makeService();

    await expect(seed(service, dir)).rejects.toThrow('No image files');
  });
});
