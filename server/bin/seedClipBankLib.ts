/* eslint-disable no-console */
// The directory comes from the operator running this CLI, so the paths below
// are expected to be non-literal.
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Helpers for `bin/seed-clip-bank.ts`. Split out so the logic can be tested
 * without the IoC container; not intended for general reuse.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { type HmaService } from '../services/hmaService/index.js';

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export type SeedResult = {
  added: string[];
  failed: { file: string; error: string }[];
};

/** The image files directly inside `dir`, in name order. */
export async function listImageFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() && path.extname(entry.name).toLowerCase() in IMAGE_TYPES,
    )
    .map((entry) => entry.name)
    .sort();
}

/**
 * Adds every image in `dir` to a CLIP bank. Throws if the bank cannot take
 * them (missing, not a CLIP bank, or CLIP off for the org); a failure on one
 * image is recorded and the rest still run.
 */
export async function seedClipBank(args: {
  hmaService: Pick<
    HmaService,
    'getBank' | 'isClipEnabled' | 'isClipAvailableToOrg' | 'addContentToBank'
  >;
  orgId: string;
  bankName: string;
  dir: string;
  dryRun: boolean;
  log?: (line: string) => void;
}): Promise<SeedResult> {
  const { hmaService, orgId, bankName, dir, dryRun, log = console.log } = args;

  const bank = await hmaService.getBank(orgId, bankName);
  if (!bank) {
    if (!hmaService.isClipEnabled()) {
      throw new Error(
        'CLIP is not available: CLIP_HMA_SERVICE_URL is not set for this deployment.',
      );
    }
    throw new Error(
      (await hmaService.isClipAvailableToOrg(orgId))
        ? `No bank named "${bankName}" found for org ${orgId}.`
        : `No usable bank named "${bankName}" for org ${orgId}: CLIP is not turned on for this org, or the bank does not exist.`,
    );
  }
  if (bank.hma_instance !== 'CLIP') {
    throw new Error(`Bank "${bankName}" is not a CLIP bank.`);
  }

  const files = await listImageFiles(dir);
  if (files.length === 0) {
    throw new Error(`No image files (jpg, png, gif, webp) found in ${dir}.`);
  }
  log(`Bank "${bank.name}" (${bank.hma_name}) on the CLIP instance`);

  const result: SeedResult = { added: [], failed: [] };
  // The CLIP instance hashes one image at a time, so upload one at a time.
  for (const name of files) {
    if (dryRun) {
      log(`  ${name}  would add`);
      continue;
    }
    try {
      const bytes = await readFile(path.join(dir, name));
      const content = await hmaService.addContentToBank(bank.hma_name, {
        instance: bank.hma_instance,
        file: new File([bytes], name, {
          type: IMAGE_TYPES[path.extname(name).toLowerCase()],
        }),
        contentType: 'photo',
        metadata: {
          content_id: createHash('sha256').update(bytes).digest('hex'),
          json: { file_name: name },
        },
      });
      result.added.push(name);
      log(`  ${name}  added (HMA content id ${content.id})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ file: name, error: message });
      log(`  ${name}  FAILED (${message})`);
    }
  }
  return result;
}
