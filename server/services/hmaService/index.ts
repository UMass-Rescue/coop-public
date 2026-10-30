/* eslint-disable max-lines */
import { type JsonValue } from 'type-fest';
import { FormData } from 'undici';

import type { Dependencies } from '../../iocContainer/index.js';
import { inject } from '../../iocContainer/utils.js';
import { jsonStringify } from '../../utils/encoding.js';
import { isUniqueViolationError } from '../../utils/kysely.js';
import { makeMatchingBankNameExistsError } from '../moderationConfigService/modules/MatchingBankOperations.js';
import { type OrgSettingsService } from '../orgSettingsService/orgSettingsService.js';
import type { HashBank, HmaInstance } from './dbTypes.js';
import { HashBankUserError, HmaRequestError } from './errors.js';
import { HashBankService } from './hashBankService.js';

// Export types for external use
export type { HashBank, HmaInstance } from './dbTypes.js';
export { HashBankUserError, HmaRequestError } from './errors.js';
export { HashBankService } from './hashBankService.js';

export type ContentType = 'photo' | 'video';

export interface BankContentResponse {
  id: number;
  signals: Record<string, string>;
}

export interface BankMatch {
  bank_content_id: number;
  distance: string;
}

export interface BankMatches {
  [bankName: string]: BankMatch[];
}

export interface LookupResponse {
  [bankName: string]: BankMatch[] | undefined;
}

const DEFAULT_CLIP_TIMEOUT_MS = 10_000;
// A clip_float embedding is 4096 hex characters; this only bounds a bad response.
const MAX_CLIP_EMBEDDING_LENGTH = 16_384;

// Signal types computed by the optional CLIP HMA instance (CLIP_HMA_SERVICE_URL).
// Every other signal type belongs to the default instance (HMA_SERVICE_URL).
const CLIP_SIGNAL_TYPES: ReadonlySet<string> = new Set(['clip_float']);

export function isClipSignalType(signalType: string): boolean {
  return CLIP_SIGNAL_TYPES.has(signalType);
}

// HMA reports distances as strings. Blank or non-numeric ones must not pass,
// which a bare Number() would allow ('' and null both become 0).
function isDistanceWithin(distance: unknown, maxDistance: number): boolean {
  if (typeof distance !== 'string' || distance.trim() === '') {
    return false;
  }
  const value = Number(distance);
  return Number.isFinite(value) && value <= maxDistance;
}

export interface ExchangeFieldDescriptor {
  name: string;
  type: string;
  required: boolean;
  default: JsonValue | null;
  help: string;
  choices: string[] | null;
}

export interface ExchangeSchemaSection {
  fields: ExchangeFieldDescriptor[];
}

export interface ExchangeApiSchema {
  config_schema: ExchangeSchemaSection;
  credentials_schema: ExchangeSchemaSection | null;
}

export interface ExchangeApiInfo {
  name: string;
  supports_auth: boolean;
}

export interface ExchangeCredentialStatus {
  has_credentials: boolean;
  // False when the exchange falls back to credentials configured on the HMA
  // server itself, which every org on the instance shares.
  has_own_credentials: boolean;
}

export type ExchangeCredentialJson = Record<
  string,
  string | number | boolean | null
>;

export interface ExchangeInfo {
  api: string;
  enabled: boolean;
  has_auth: boolean;
  has_own_credentials: boolean;
  error?: string | null;
  last_fetch_succeeded?: boolean | null;
  last_fetch_time?: string | null;
  up_to_date?: boolean | null;
  fetched_items?: number | null;
  is_fetching?: boolean | null;
}

const KNOWN_EXCHANGE_SCHEMAS: Partial<Record<string, ExchangeApiSchema>> = {
  fb_threatexchange: {
    config_schema: {
      fields: [
        {
          name: 'privacy_group',
          type: 'number',
          required: true,
          default: null,
          help: 'ThreatPrivacyGroup ID for this collaboration',
          choices: null,
        },
      ],
    },
    credentials_schema: {
      fields: [
        {
          name: 'api_token',
          type: 'string',
          required: true,
          default: null,
          help: 'Meta app access token. Create one at https://developers.facebook.com/tools/accesstoken/ for your ThreatExchange app.',
          choices: null,
        },
      ],
    },
  },
  ncmec: {
    config_schema: {
      fields: [
        {
          name: 'environment',
          type: 'enum',
          required: true,
          default: null,
          help: 'which database to connect to',
          choices: [
            'https://report.cybertip.org/hashsharing',
            'https://hashsharing.ncmec.org/npo',
            'https://hashsharing.ncmec.org/exploitative',
            'https://exttest.cybertip.org/hashsharing',
            'https://hashsharing-test.ncmec.org/npo',
            'https://hashsharing-test.ncmec.org/exploitative',
          ],
        },
        {
          name: 'only_esp_ids',
          type: 'set_of_number',
          required: false,
          default: null,
          help: 'Only take entries from these electronic service provider (ESP) ids',
          choices: null,
        },
      ],
    },
    credentials_schema: {
      fields: [
        {
          name: 'user',
          type: 'string',
          required: true,
          default: null,
          help: 'NCMEC hash sharing API username.',
          choices: null,
        },
        {
          name: 'password',
          type: 'string',
          required: true,
          default: null,
          help: 'NCMEC hash sharing API password.',
          choices: null,
        },
      ],
    },
  },
  stop_ncii: {
    config_schema: { fields: [] },
    credentials_schema: {
      fields: [
        {
          name: 'fetch_function_key',
          type: 'string',
          required: true,
          default: null,
          help: 'API key for the Fetch Hashes endpoint. Used when downloading hashes from StopNCII.',
          choices: null,
        },
        {
          name: 'subscription_key',
          type: 'string',
          required: true,
          default: null,
          help: 'Azure API Management subscription key. Sent as Ocp-Apim-Subscription-Key on all requests.',
          choices: null,
        },
        {
          name: 'base_url_override',
          type: 'string',
          required: false,
          default: null,
          help: 'Optional. Override the API base URL (e.g. for testing). Leave blank to use https://api.stopncii.org/v1',
          choices: null,
        },
      ],
    },
  },
};

function parseCredentialStatus(raw: unknown): ExchangeCredentialStatus {
  const status = (raw ?? {}) as Record<string, unknown>;
  const hasCredentials = status.has_credentials === true;
  return {
    has_credentials: hasCredentials,
    // HMA's other sources (api, environment, file) are all server-wide.
    has_own_credentials: hasCredentials && status.source === 'exchange',
  };
}

/**
 * Checks credentials against the API's credentials_schema before they are
 * sent to HMA, so errors can name the offending fields without echoing values.
 * Returns the credentials with empty fields dropped, or undefined if none.
 */
function validateExchangeCredentials(
  apiName: string,
  schema: ExchangeApiSchema,
  credentialJson: ExchangeCredentialJson | undefined,
): ExchangeCredentialJson | undefined {
  const fields = schema.credentials_schema?.fields ?? [];
  const provided = Object.entries(credentialJson ?? {}).filter(
    ([, value]) => value != null && value !== '',
  );

  if (fields.length === 0) {
    if (provided.length > 0) {
      throw new HashBankUserError(
        `Exchange API '${apiName}' does not accept credentials.`,
      );
    }
    return undefined;
  }

  const allowed = new Set(fields.map((f) => f.name));
  const unknown = provided
    .map(([name]) => name)
    .filter((name) => !allowed.has(name));
  if (unknown.length > 0) {
    throw new HashBankUserError(
      `Unexpected credential fields for '${apiName}': ${unknown.join(', ')}.`,
    );
  }

  const providedNames = new Set(provided.map(([name]) => name));
  const missing = fields
    .filter((f) => f.required && !providedNames.has(f.name))
    .map((f) => f.name);
  if (missing.length > 0) {
    throw new HashBankUserError(
      `Credentials are required for '${apiName}'. Missing: ${missing.join(', ')}.`,
    );
  }

  return provided.length > 0 ? Object.fromEntries(provided) : undefined;
}

export class HmaService {
  private readonly hmaServiceUrl: string;
  // Unset unless the optional CLIP HMA instance is deployed.
  private readonly clipServiceUrl: string | undefined;
  // fetchHTTP has no timeout by default, and a CLIP request that hangs would
  // otherwise hold up the caller indefinitely.
  private readonly clipTimeoutMs: number;
  private readonly hashBankService: HashBankService;

  constructor(
    private readonly fetchHTTP: Dependencies['fetchHTTP'],
    kyselyPg: Dependencies['KyselyPg'],
    private readonly tracer: Dependencies['Tracer'],
    private readonly orgSettings: Pick<
      OrgSettingsService,
      'hasClipHashingEnabled'
    >,
  ) {
    this.hmaServiceUrl =
      process.env.HMA_SERVICE_URL ?? 'http://localhost:9876/';
    const clipUrl = process.env.CLIP_HMA_SERVICE_URL?.trim().replace(
      /\/+$/,
      '',
    );
    this.clipServiceUrl = clipUrl === '' ? undefined : clipUrl;
    const clipTimeoutMs = Number(process.env.CLIP_HASH_TIMEOUT_MS);
    this.clipTimeoutMs =
      Number.isFinite(clipTimeoutMs) && clipTimeoutMs > 0
        ? clipTimeoutMs
        : DEFAULT_CLIP_TIMEOUT_MS;
    this.hashBankService = new HashBankService(kyselyPg);
  }

  private getHmaName(orgId: string, name: string): string {
    // Convert to uppercase and replace spaces and special characters with underscores
    const normalizedName = name
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_') // Replace any non-alphanumeric chars with underscore
      .replace(/_+/g, '_') // Replace multiple underscores with single underscore
      .replace(/^_|_$/g, ''); // Remove leading/trailing underscores

    return `COOP_${orgId.toUpperCase()}_${normalizedName}`;
  }

  /**
   * The HMA name for a bank called `name`: the normalized name, or with a
   * numeric suffix (`_2`, `_3`, ...) when that's taken. Different display
   * names can normalize to the same HMA name ("My Bank" and "my-bank"), and a
   * renamed exchange-backed bank keeps its original one. `currentHmaName` is
   * the renaming bank's own name, which counts as free.
   */
  private async pickHmaName(
    orgId: string,
    name: string,
    instance: HmaInstance,
    currentHmaName?: string,
  ): Promise<string> {
    const base = this.getHmaName(orgId, name);
    for (let attempt = 1; attempt <= 50; attempt++) {
      const candidate = attempt === 1 ? base : `${base}_${attempt}`;
      if (candidate === currentHmaName) {
        return candidate;
      }
      if (
        !(await this.hashBankService.isHmaNameTaken(candidate)) &&
        !(await this.hmaBankExists(candidate, instance))
      ) {
        return candidate;
      }
    }
    throw new Error(`No free HMA bank name for ${base}`);
  }

  private async hmaBankExists(
    hmaName: string,
    instance: HmaInstance,
  ): Promise<boolean> {
    const response = await this.fetchHTTP({
      url: `${this.urlFor(instance)}/c/bank/${encodeURIComponent(hmaName)}`,
      method: 'get',
      handleResponseBody: 'discard',
    });
    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw new HmaRequestError('Failed to look up HMA bank', response.status);
    }
    return true;
  }

  async createBank(
    orgId: string,
    name: string,
    description: string,
    enabled_ratio: number,
    exchange?: {
      apiName: string;
      apiJson: Record<string, unknown>;
      credentialJson?: ExchangeCredentialJson;
    },
    instance: HmaInstance = 'DEFAULT',
  ): Promise<HashBank> {
    if (instance === 'CLIP') {
      if (!this.isClipEnabled()) {
        throw new HashBankUserError(
          'CLIP is not available: this deployment has no CLIP HMA instance.',
        );
      }
      // Checked apart from isClipAvailableToOrg to give a separate message.
      if (!(await this.orgSettings.hasClipHashingEnabled(orgId))) {
        throw new HashBankUserError(
          'CLIP is turned off for your organization. Turn it on under Settings, Image Matching.',
        );
      }
      if (exchange) {
        throw new HashBankUserError(
          'CLIP banks cannot be connected to an exchange.',
        );
      }
    }
    if (await this.hashBankService.findByName(name, orgId)) {
      throw makeMatchingBankNameExistsError({ shouldErrorSpan: false });
    }
    const hmaName = await this.pickHmaName(orgId, name, instance);

    if (exchange) {
      const credentialJson = validateExchangeCredentials(
        exchange.apiName,
        await this.getExchangeApiSchema(exchange.apiName),
        exchange.credentialJson,
      );

      try {
        await this.createExchange(
          hmaName,
          exchange.apiName,
          exchange.apiJson,
          credentialJson,
        );
      } catch (error) {
        // A 4xx means HMA created nothing. Deleting by name then could remove
        // an exchange that an earlier request created under the same name.
        const rejected =
          error instanceof HashBankUserError ||
          (error instanceof HmaRequestError && error.status < 500);
        if (!rejected) {
          await this.deleteHmaBank(hmaName, true, instance);
        }
        throw error;
      }
    } else {
      const requestBody = {
        name: hmaName,
        enabled_ratio: enabled_ratio.toString(),
      };

      const response = await this.fetchHTTP({
        url: `${this.urlFor(instance)}/c/banks`,
        method: 'post',
        body: jsonStringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
        handleResponseBody: 'as-json',
      });

      if (!response.ok) {
        const errorDetails = {
          status: response.status,
          responseBody: response.body,
          requestBody,
          url: `${this.urlFor(instance)}/c/banks`,
          headers: response.headers,
        };
        throw new Error(
          `Failed to create HMA bank: ${jsonStringify(errorDetails)}`,
        );
      }
    }

    try {
      // POST /c/exchanges has no ratio field, so it is set on the import bank.
      if (exchange && enabled_ratio !== 1.0) {
        const ratioResponse = await this.fetchHTTP({
          url: `${this.hmaServiceUrl}/c/bank/${hmaName}`,
          method: 'put',
          body: jsonStringify({ enabled_ratio }),
          headers: { 'Content-Type': 'application/json' },
          handleResponseBody: 'discard',
        });
        if (!ratioResponse.ok) {
          throw new Error(
            `Failed to set HMA bank enabled_ratio: status=${ratioResponse.status}`,
          );
        }
      }

      const bank = await this.hashBankService.create({
        name,
        hma_name: hmaName,
        description,
        enabled_ratio,
        hma_instance: instance,
        org_id: orgId,
      });

      return bank;
    } catch (error) {
      await this.deleteHmaBank(hmaName, exchange != null, instance);
      throw isUniqueViolationError(error)
        ? makeMatchingBankNameExistsError({ shouldErrorSpan: false })
        : error;
    }
  }

  /**
   * Best-effort removal of a bank created during a failed createBank. Failures
   * are recorded on the active span rather than thrown, so the caller's
   * original error is the one surfaced.
   */
  private async deleteHmaBank(
    hmaName: string,
    isExchange: boolean,
    instance: HmaInstance,
  ): Promise<void> {
    try {
      // Deleting only the bank would leave an exchange and its credentials.
      const response = await this.fetchHTTP({
        url: isExchange
          ? `${this.urlFor(instance)}/c/exchange/${encodeURIComponent(hmaName)}`
          : `${this.urlFor(instance)}/c/bank/${encodeURIComponent(hmaName)}`,
        method: 'delete',
        handleResponseBody: 'discard',
      });
      if (!response.ok && response.status !== 404) {
        throw new HmaRequestError(
          `Failed to clean up HMA bank ${hmaName}`,
          response.status,
        );
      }
    } catch (cleanupError) {
      this.tracer.logActiveSpanFailedIfAny(cleanupError);
    }
  }

  async updateBank(
    orgId: string,
    id: string,
    updates: { name?: string; description?: string; enabled_ratio?: number },
  ): Promise<HashBank> {
    // Get the existing bank
    const bank = await this.hashBankService.findById(parseInt(id), orgId);

    if (!bank) {
      throw new Error('Bank not found');
    }
    await this.assertUsable(bank);

    const newName =
      updates.name != null && updates.name !== bank.name
        ? updates.name
        : undefined;
    const newHmaName =
      newName != null ? await this.renamedHmaName(bank, newName) : undefined;
    const newRatio =
      updates.enabled_ratio !== undefined &&
      updates.enabled_ratio !== bank.enabled_ratio
        ? updates.enabled_ratio
        : undefined;

    // PUT /c/bank renames in place, so the bank keeps its hashed content.
    if (newHmaName != null || newRatio != null) {
      await this.updateHmaBank(
        bank.hma_name,
        {
          ...(newHmaName != null ? { name: newHmaName } : {}),
          ...(newRatio != null ? { enabled_ratio: newRatio } : {}),
        },
        bank.hma_instance,
      );
    }

    const fieldsToUpdate: {
      name?: string;
      hma_name?: string;
      description?: string | null;
      enabled_ratio?: number;
    } = {};
    if (newName != null) {
      fieldsToUpdate.name = newName;
    }
    if (newHmaName != null) {
      fieldsToUpdate.hma_name = newHmaName;
    }
    if (updates.description !== undefined) {
      fieldsToUpdate.description = updates.description;
    }
    if (updates.enabled_ratio !== undefined) {
      fieldsToUpdate.enabled_ratio = updates.enabled_ratio;
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
      return bank;
    }

    try {
      return await this.hashBankService.update(
        Number(bank.id),
        orgId,
        fieldsToUpdate,
      );
    } catch (error) {
      if (newHmaName != null) {
        // Without this, Coop's row would point at a name HMA no longer has.
        await this.updateHmaBank(
          newHmaName,
          { name: bank.hma_name },
          bank.hma_instance,
        ).catch((revertError: unknown) => {
          this.tracer.logActiveSpanFailedIfAny(revertError);
        });
      }
      throw isUniqueViolationError(error)
        ? makeMatchingBankNameExistsError({ shouldErrorSpan: false })
        : error;
    }
  }

  /**
   * The HMA name a bank should have after being renamed to newName, or
   * undefined if it keeps its current one. Throws if the org already has a
   * bank called newName.
   */
  private async renamedHmaName(
    bank: HashBank,
    newName: string,
  ): Promise<string | undefined> {
    if (await this.hashBankService.findByName(newName, bank.org_id)) {
      throw makeMatchingBankNameExistsError({ shouldErrorSpan: false });
    }
    // HMA can't rename an exchange, and Coop finds a bank's exchange by its
    // HMA name, so exchange-backed banks keep their original one.
    if (await this.hasExchange(bank.hma_name, bank.hma_instance)) {
      return undefined;
    }
    const newHmaName = await this.pickHmaName(
      bank.org_id,
      newName,
      bank.hma_instance,
      bank.hma_name,
    );
    return newHmaName === bank.hma_name ? undefined : newHmaName;
  }

  private async updateHmaBank(
    hmaName: string,
    changes: { name?: string; enabled_ratio?: number },
    instance: HmaInstance,
  ): Promise<void> {
    const response = await this.fetchHTTP({
      url: `${this.urlFor(instance)}/c/bank/${encodeURIComponent(hmaName)}`,
      method: 'put',
      body: jsonStringify(changes),
      headers: { 'Content-Type': 'application/json' },
      handleResponseBody: 'discard',
    });
    if (!response.ok) {
      // HMA answers 403 when the new name belongs to another bank.
      if (response.status === 403 && changes.name != null) {
        throw makeMatchingBankNameExistsError({ shouldErrorSpan: false });
      }
      throw new HmaRequestError('Failed to update HMA bank', response.status);
    }
  }

  async deleteBank(orgId: string, id: string): Promise<void> {
    // Get the bank
    const bank = await this.hashBankService.findById(parseInt(id), orgId);

    if (!bank) {
      throw new Error('Bank not found');
    }
    await this.assertUsable(bank);

    // DELETE /c/bank on an exchange-backed bank leaves the exchange and its
    // credentials in HMA, so those must go through DELETE /c/exchange.
    const base = this.urlFor(bank.hma_instance);
    const url = (await this.hasExchange(bank.hma_name, bank.hma_instance))
      ? `${base}/c/exchange/${encodeURIComponent(bank.hma_name)}`
      : `${base}/c/bank/${encodeURIComponent(bank.hma_name)}`;

    const response = await this.fetchHTTP({
      url,
      method: 'delete',
      handleResponseBody: 'discard',
    });

    // Keep the local row on failure: it holds the only reference to the HMA
    // name, which is needed to retry the delete.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete HMA bank: status=${response.status}`);
    }

    await this.hashBankService.delete(Number(bank.id), orgId);
  }

  private async hasExchange(
    hmaName: string,
    instance: HmaInstance,
  ): Promise<boolean> {
    return (await this.getExchangeApiName(hmaName, instance)) != null;
  }

  /** The exchange API type of an exchange-backed bank, or null for plain banks. */
  private async getExchangeApiName(
    hmaName: string,
    instance: HmaInstance,
  ): Promise<string | null> {
    // The CLIP instance has no exchanges.
    if (instance === 'CLIP') {
      return null;
    }
    const response = await this.fetchHTTP({
      url: `${this.hmaServiceUrl}/c/exchange/${encodeURIComponent(hmaName)}`,
      method: 'get',
      handleResponseBody: 'as-json',
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new HmaRequestError(
        'Failed to look up HMA exchange',
        response.status,
      );
    }
    const body = response.body as unknown as { api?: unknown };
    return typeof body.api === 'string' ? body.api : '';
  }

  async getBank(orgId: string, name: string): Promise<HashBank | null> {
    // Get local bank
    const bank = await this.hashBankService.findByName(name, orgId);

    if (!bank || !(await this.isUsable(bank))) {
      return null;
    }

    // Verify bank exists in HMA service
    try {
      const response = await this.fetchHTTP({
        url: `${this.urlFor(bank.hma_instance)}/c/bank/${bank.hma_name}`,
        timeoutMs: this.timeoutFor(bank.hma_instance),
        method: 'get',
        handleResponseBody: 'discard',
      });

      if (response.status === 404 && (await this.forgetMissingBank(bank))) {
        return null;
      }

      if (!response.ok) {
        this.tracer.logActiveSpanFailedIfAny(
          new HmaRequestError(
            `Failed to verify bank ${bank.hma_name} in HMA`,
            response.status,
          ),
        );
      }
    } catch (error) {
      this.tracer.logActiveSpanFailedIfAny(error);
    }

    return bank;
  }

  /**
   * Drops the local row for a bank HMA no longer has. A bank deleted directly
   * in HMA can leave its exchange (and credentials) behind, and the local row
   * holds the only reference to it, so the exchange is deleted first and the
   * row is kept if that fails. Returns whether the row was dropped.
   */
  private async forgetMissingBank(bank: HashBank): Promise<boolean> {
    // A CLIP instance that was repointed, reset or fronted by a gateway answers
    // 404 for banks that still exist, and forgetting them would drop every CLIP
    // bank row. They are only removed through deleteBank.
    if (bank.hma_instance === 'CLIP') {
      return false;
    }
    const response = await this.fetchHTTP({
      url: `${this.hmaServiceUrl}/c/exchange/${encodeURIComponent(bank.hma_name)}`,
      method: 'delete',
      handleResponseBody: 'discard',
    });
    if (!response.ok && response.status !== 404) {
      this.tracer.logActiveSpanFailedIfAny(
        new HmaRequestError(
          `Failed to delete leftover HMA exchange ${bank.hma_name}`,
          response.status,
        ),
      );
      return false;
    }
    await this.hashBankService.delete(Number(bank.id), bank.org_id);
    return true;
  }

  async getBankById(orgId: string, id: number): Promise<HashBank | null> {
    // Get local bank by ID
    const bank = await this.hashBankService.findById(id, orgId);

    if (!bank || !(await this.isUsable(bank))) {
      return null;
    }

    // Verify bank exists in HMA service
    try {
      const response = await this.fetchHTTP({
        url: `${this.urlFor(bank.hma_instance)}/c/bank/${bank.hma_name}`,
        timeoutMs: this.timeoutFor(bank.hma_instance),
        method: 'get',
        handleResponseBody: 'discard',
      });

      if (response.status === 404 && (await this.forgetMissingBank(bank))) {
        return null;
      }

      if (!response.ok) {
        this.tracer.logActiveSpanFailedIfAny(
          new HmaRequestError(
            `Failed to verify bank ${bank.hma_name} in HMA`,
            response.status,
          ),
        );
      }
    } catch (error) {
      this.tracer.logActiveSpanFailedIfAny(error);
    }

    return bank;
  }

  async listBanks(orgId: string): Promise<HashBank[]> {
    try {
      // Get all local banks for org
      const allBanks = await this.hashBankService.findAllByOrgId(orgId);
      // One settings read per call, and none for orgs without CLIP banks. If
      // the read fails, hide only the CLIP banks rather than losing every bank.
      const clipAvailable = allBanks.some(
        (bank) => bank.hma_instance === 'CLIP',
      )
        ? await this.isClipAvailableToOrg(orgId).catch((error: unknown) => {
            this.tracer.logActiveSpanFailedIfAny(error);
            return false;
          })
        : false;
      const banks = allBanks.filter(
        (bank) => bank.hma_instance !== 'CLIP' || clipAvailable,
      );

      // Filter out banks that don't exist in HMA service
      const validBanks = await Promise.all(
        banks.map(async (bank) => {
          try {
            const response = await this.fetchHTTP({
              url: `${this.urlFor(bank.hma_instance)}/c/bank/${bank.hma_name}`,
              timeoutMs: this.timeoutFor(bank.hma_instance),
              method: 'get',
              headers: {
                'Content-Type': 'application/json',
              },
              handleResponseBody: 'as-json',
            });

            if (
              response.status === 404 &&
              (await this.forgetMissingBank(bank))
            ) {
              return null;
            }

            if (!response.ok) {
              this.tracer.logActiveSpanFailedIfAny(
                new HmaRequestError(
                  `Failed to verify bank ${bank.hma_name} in HMA`,
                  response.status,
                ),
              );
            }

            return bank;
          } catch (error) {
            this.tracer.logActiveSpanFailedIfAny(error);
            return bank;
          }
        }),
      );

      return validBanks.filter((bank): bank is HashBank => bank !== null);
    } catch (error) {
      return [];
    }
  }

  async getExchangeApis(): Promise<ExchangeApiInfo[]> {
    const apisResponse = await this.fetchHTTP({
      url: `${this.hmaServiceUrl}/c/exchanges/apis`,
      method: 'get',
      handleResponseBody: 'as-json',
    });

    if (!apisResponse.ok) {
      throw new Error(`Failed to fetch exchange APIs: ${apisResponse.status}`);
    }

    const apiNames = apisResponse.body as unknown as string[];

    const infos = await Promise.all(
      apiNames.map(async (name) => {
        try {
          const configResponse = await this.fetchHTTP({
            url: `${this.hmaServiceUrl}/c/exchanges/api/${encodeURIComponent(name)}`,
            method: 'get',
            handleResponseBody: 'as-json',
          });

          // has_set_authentification is deliberately not read: it only says
          // whether a shared API-level default exists, which isn't org state.
          if (configResponse.ok) {
            const body = configResponse.body as unknown as {
              supports_authentification: boolean;
            };
            return { name, supports_auth: body.supports_authentification };
          }
        } catch {
          // fall through to default
        }
        return { name, supports_auth: false };
      }),
    );
    return infos;
  }

  async getExchangeApiSchema(apiName: string): Promise<ExchangeApiSchema> {
    try {
      const response = await this.fetchHTTP({
        url: `${this.hmaServiceUrl}/c/exchanges/api/${encodeURIComponent(apiName)}/schema`,
        method: 'get',
        handleResponseBody: 'as-json',
      });

      if (response.ok) {
        return response.body as unknown as ExchangeApiSchema;
      }
    } catch {
      // Fall through to built-in schemas
    }

    const fallback = KNOWN_EXCHANGE_SCHEMAS[apiName];
    if (fallback) {
      return fallback;
    }

    return { config_schema: { fields: [] }, credentials_schema: null };
  }

  /**
   * Creates the exchange and its import bank in HMA. Credentials, when given,
   * are stored on this exchange only. Errors never include the request or
   * response body, since either may carry credential values.
   */
  async createExchange(
    bankName: string,
    apiType: string,
    apiJson: Record<string, unknown>,
    credentialJson?: ExchangeCredentialJson,
  ): Promise<void> {
    const hasCredentials =
      credentialJson != null && Object.keys(credentialJson).length > 0;
    const requestBody = {
      bank: bankName,
      api: apiType,
      api_json: apiJson,
      ...(hasCredentials ? { credential_json: credentialJson } : {}),
    };

    const response = await this.fetchHTTP({
      url: `${this.hmaServiceUrl}/c/exchanges`,
      method: 'post',
      body: jsonStringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
      handleResponseBody: 'discard',
    });

    if (!response.ok) {
      // HMA's 400 can come from api_json or credential_json, and its message
      // isn't passed through in case it ever quotes a value.
      if (response.status === 400) {
        throw new HashBankUserError(
          `The exchange rejected the configuration${hasCredentials ? ' or credentials' : ''} for '${apiType}'. Check the submitted fields.`,
        );
      }
      throw new HmaRequestError(
        `Failed to create exchange in HMA for '${apiType}'`,
        response.status,
      );
    }
  }

  /**
   * Sets or replaces the credentials of a single exchange. Only call this
   * after checking that hmaName belongs to the requesting org.
   */
  private async setExchangeCredentials(
    hmaName: string,
    credentialJson: ExchangeCredentialJson,
  ): Promise<ExchangeCredentialStatus> {
    const response = await this.fetchHTTP({
      url: `${this.hmaServiceUrl}/c/exchange/${encodeURIComponent(hmaName)}/credentials`,
      method: 'post',
      body: jsonStringify({ credential_json: credentialJson }),
      headers: { 'Content-Type': 'application/json' },
      handleResponseBody: 'as-json',
    });

    if (!response.ok) {
      if (response.status === 400) {
        throw new HashBankUserError(
          `The exchange rejected the credentials. Check the values for: ${Object.keys(credentialJson).join(', ')}.`,
        );
      }
      if (response.status === 404) {
        throw new HashBankUserError(
          'This bank is not connected to an exchange.',
        );
      }
      throw new HmaRequestError(
        'Failed to set exchange credentials',
        response.status,
      );
    }

    return parseCredentialStatus(response.body);
  }

  async setBankExchangeCredentials(
    orgId: string,
    bankId: number,
    credentialJson: ExchangeCredentialJson,
  ): Promise<ExchangeCredentialStatus> {
    const bank = await this.hashBankService.findById(bankId, orgId);
    if (!bank) {
      throw new HashBankUserError('Hash bank not found.');
    }

    const apiName = await this.getExchangeApiName(
      bank.hma_name,
      bank.hma_instance,
    );
    if (apiName == null) {
      throw new HashBankUserError('This bank is not connected to an exchange.');
    }

    const validated = validateExchangeCredentials(
      apiName,
      await this.getExchangeApiSchema(apiName),
      credentialJson,
    );
    // HMA treats {} as "clear", so an empty submission must not reach it.
    if (validated == null) {
      throw new HashBankUserError('Enter at least one credential value.');
    }
    return this.setExchangeCredentials(bank.hma_name, validated);
  }

  async getExchangeForBank(
    hmaName: string,
    instance: HmaInstance = 'DEFAULT',
  ): Promise<ExchangeInfo | null> {
    // The CLIP instance has no exchanges.
    if (instance === 'CLIP') {
      return null;
    }
    let response;
    try {
      response = await this.fetchHTTP({
        url: `${this.hmaServiceUrl}/c/exchange/${encodeURIComponent(hmaName)}`,
        method: 'get',
        handleResponseBody: 'as-json',
      });
    } catch (err) {
      return {
        api: '',
        enabled: false,
        has_auth: false,
        has_own_credentials: false,
        error: `Unable to reach HMA service: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      return {
        api: '',
        enabled: false,
        has_auth: false,
        has_own_credentials: false,
        error: `Failed to fetch exchange info from HMA (status ${response.status})`,
      };
    }

    const body = response.body as unknown as Record<string, unknown>;
    const credentialStatus = parseCredentialStatus(body.credential_status);

    const info: ExchangeInfo = {
      api: String(body.api ?? ''),
      enabled: Boolean(body.enabled),
      has_auth: credentialStatus.has_credentials,
      has_own_credentials: credentialStatus.has_own_credentials,
    };

    try {
      const statusResponse = await this.fetchHTTP({
        url: `${this.hmaServiceUrl}/c/exchange/${encodeURIComponent(hmaName)}/status`,
        method: 'get',
        handleResponseBody: 'as-json',
      });
      if (statusResponse.ok) {
        const status = statusResponse.body as unknown as {
          last_fetch_succeeded: boolean;
          last_fetch_complete_ts: number | null;
          up_to_date: boolean;
          fetched_items: number;
          running_fetch_start_ts: number | null;
        };
        info.last_fetch_succeeded = status.last_fetch_succeeded;
        info.up_to_date = status.up_to_date;
        info.fetched_items = status.fetched_items;
        info.is_fetching = status.running_fetch_start_ts != null;
        if (status.last_fetch_complete_ts != null) {
          info.last_fetch_time = new Date(
            status.last_fetch_complete_ts * 1000,
          ).toISOString();
        }
      }
    } catch {
      // Non-critical: can't determine fetch status
    }

    return info;
  }

  async hashContentFromUrl(url: string): Promise<Record<string, string>> {
    const response = await this.fetchHTTP({
      url: `${this.hmaServiceUrl}/h/hash?url=${encodeURIComponent(url)}`,
      method: 'get',
      handleResponseBody: 'as-json',
    });

    if (!response.ok) {
      throw new Error(`Failed to hash content from URL: ${response.status}`);
    }

    return response.body as unknown as Record<string, string>;
  }

  /** Whether this deployment has the optional CLIP instance, for any org. */
  isClipEnabled(): boolean {
    return this.clipServiceUrl != null;
  }

  /**
   * Whether CLIP is on for an org: the deployment has the CLIP instance and the
   * org has turned CLIP hashing on. This single check decides whether the org
   * can see and use CLIP banks.
   */
  async isClipAvailableToOrg(orgId: string): Promise<boolean> {
    return (
      this.isClipEnabled() &&
      (await this.orgSettings.hasClipHashingEnabled(orgId))
    );
  }

  private requireClipUrl(): string {
    if (this.clipServiceUrl == null) {
      throw new Error('CLIP_HMA_SERVICE_URL is not set');
    }
    return this.clipServiceUrl;
  }

  private urlFor(instance: HmaInstance): string {
    return instance === 'CLIP' ? this.requireClipUrl() : this.hmaServiceUrl;
  }

  /** Only the CLIP instance gets a timeout; the default instance is unchanged. */
  private timeoutFor(instance: HmaInstance): number | undefined {
    return instance === 'CLIP' ? this.clipTimeoutMs : undefined;
  }

  /** CLIP banks are hidden, not deleted, while CLIP is off for their org. */
  private async isUsable(bank: HashBank): Promise<boolean> {
    return (
      bank.hma_instance !== 'CLIP' ||
      (await this.isClipAvailableToOrg(bank.org_id))
    );
  }

  private async assertUsable(bank: HashBank): Promise<void> {
    if (!(await this.isUsable(bank))) {
      throw new HashBankUserError(
        'This bank uses CLIP, which is not turned on for your organization.',
      );
    }
  }

  /** Hashes an image with the CLIP HMA instance, e.g. `{ clip_float: '...' }`. */
  async hashClipFromUrl(url: string): Promise<Record<string, string>> {
    const response = await this.fetchHTTP({
      url: `${this.requireClipUrl()}/h/hash?url=${encodeURIComponent(url)}`,
      method: 'get',
      handleResponseBody: 'as-json',
      timeoutMs: this.clipTimeoutMs,
    });

    if (!response.ok) {
      throw new HmaRequestError(
        'Failed to hash content with CLIP',
        response.status,
      );
    }

    // Keep only the embedding we expect: whatever is returned is stored on the
    // item, and each key would be used as a signal type for lookups.
    const embedding = (response.body as { clip_float?: unknown } | null)
      ?.clip_float;
    if (
      typeof embedding !== 'string' ||
      embedding.length > MAX_CLIP_EMBEDDING_LENGTH ||
      !/^[0-9a-f]+$/i.test(embedding)
    ) {
      throw new Error('Unexpected response from the CLIP instance');
    }
    return { clip_float: embedding };
  }

  /**
   * CLIP hashes are ~4 KB of hex, which exceeds the web server's request-line
   * limit as a query string, so unlike lookupContent this is a JSON POST.
   */
  private async lookupClipSignal(
    banks: string[],
    signalType: string,
    signal: string,
  ): Promise<LookupResponse> {
    const response = await this.fetchHTTP({
      url: `${this.requireClipUrl()}/m/lookup`,
      method: 'post',
      body: jsonStringify({ signal_type: signalType, signal, banks }),
      headers: { 'Content-Type': 'application/json' },
      handleResponseBody: 'as-json',
      timeoutMs: this.clipTimeoutMs,
    });

    if (!response.ok) {
      throw new HmaRequestError(
        'Failed to look up content with CLIP',
        response.status,
      );
    }

    return response.body as unknown as LookupResponse;
  }

  async addContentToBank(
    bankName: string,
    options: {
      file?: File | Blob;
      contentType?: ContentType;
      url?: string;
      metadata?: {
        content_id?: string;
        content_uri?: string;
        json?: Record<string, unknown>;
      };
    },
  ): Promise<BankContentResponse> {
    const { file, contentType, url, metadata } = options;

    if (!url && (!file || !contentType)) {
      throw new Error(
        'Either url or (file + contentType) must be provided to addContentToBank',
      );
    }

    let response;
    if (url) {
      // URL-based content
      const params = new URLSearchParams();
      params.append('url', url);
      if (metadata) {
        if (metadata.content_id)
          params.append('content_id', metadata.content_id);
        if (metadata.content_uri)
          params.append('content_uri', metadata.content_uri);
        if (metadata.json)
          params.append('metadata', jsonStringify(metadata.json));
      }

      response = await this.fetchHTTP({
        url: `${this.hmaServiceUrl}/c/bank/${bankName}/content?${params.toString()}`,
        method: 'post',
        handleResponseBody: 'as-json',
      });
    } else {
      if (!file || !contentType) {
        throw new Error(
          'addContentToBank reached file-upload branch without file/contentType',
        );
      }
      const formData = new FormData();
      formData.append(contentType, file);

      if (metadata) {
        if (metadata.content_id)
          formData.append('content_id', metadata.content_id);
        if (metadata.content_uri)
          formData.append('content_uri', metadata.content_uri);
        if (metadata.json)
          formData.append('metadata', jsonStringify(metadata.json));
      }

      response = await this.fetchHTTP({
        url: `${this.hmaServiceUrl}/c/bank/${bankName}/content`,
        method: 'post',
        // Don't set Content-Type explicitly: undici needs to add the multipart
        // boundary parameter itself when serializing the FormData.
        body: formData,
        handleResponseBody: 'as-json',
      });
    }

    if (!response.ok) {
      throw new Error(`Failed to add content to bank: ${response.status}`);
    }

    return response.body as unknown as BankContentResponse;
  }

  async lookupContent(options: {
    url?: string;
    contentType?: ContentType;
    signalType?: string;
    signal?: string;
  }): Promise<LookupResponse> {
    const { url, contentType, signalType, signal } = options;

    const params = new URLSearchParams();
    if (url) params.append('url', url);
    if (contentType) params.append('content_type', contentType);
    if (signalType) params.append('signal_type', signalType);
    if (signal) params.append('signal', signal);

    const response = await this.fetchHTTP({
      url: `${this.hmaServiceUrl}/m/lookup?${params.toString()}`,
      method: 'get',
      handleResponseBody: 'as-json',
    });

    if (!response.ok) {
      throw new Error(`Failed to lookup content: ${response.status}`);
    }

    return response.body as unknown as LookupResponse;
  }

  /**
   * Checks if an image matches any images in any of the provided hash banks
   * and returns detailed match information
   * @param hmaBankIds Array of hash bank IDs to check against
   * @param signalType The type of signal (e.g. 'pdq', 'md5', 'clip_float').
   * CLIP signals are looked up on the CLIP HMA instance, and never match when
   * it is not configured.
   * @param signal The hash value to check
   * @param options.maxDistance Ignore matches farther than this, in the units
   * of the signal type (cosine distance for clip_float). HMA already applies
   * its own cutoff per signal type (0.10 for clip_float), so this can only
   * tighten matching, not loosen it. A match whose distance is missing or not
   * a number never satisfies it.
   * @returns A promise that resolves to an object with matched status and list of matched banks
   */
  async checkImageMatchWithDetails(
    hmaBankIds: string[],
    signalType: string,
    signal: string,
    options: { maxDistance?: number } = {},
  ): Promise<{ matched: boolean; matchedBanks: string[] }> {
    let matches: LookupResponse;
    if (isClipSignalType(signalType)) {
      // HMA reads an empty bank list as "search every bank".
      if (!this.isClipEnabled() || hmaBankIds.length === 0) {
        return { matched: false, matchedBanks: [] };
      }
      matches = await this.lookupClipSignal(hmaBankIds, signalType, signal);
    } else {
      matches = await this.lookupContent({ signal, signalType });
    }

    const { maxDistance } = options;
    const matchedBanks = hmaBankIds.filter((bankId) => {
      const bankMatches = matches[bankId];
      return (
        Array.isArray(bankMatches) &&
        bankMatches.some(
          (match) =>
            maxDistance == null ||
            isDistanceWithin(match.distance, maxDistance),
        )
      );
    });

    return {
      matched: matchedBanks.length > 0,
      matchedBanks,
    };
  }

  /**
   * Checks if an image matches any images in any of the provided hash banks
   * @param hmaBankIds Array of hash bank IDs to check against
   * @param signalType The type of signal (e.g. 'pdq', 'md5', etc.)
   * @param signal The hash value to check
   * @returns A promise that resolves to true if the image matches any images in any of the banks
   * @deprecated Use checkImageMatchWithDetails for more detailed information
   */
  async checkImageMatch(
    hmaBankIds: string[],
    signalType: string,
    signal: string,
  ): Promise<boolean> {
    const result = await this.checkImageMatchWithDetails(
      hmaBankIds,
      signalType,
      signal,
    );
    return result.matched;
  }
}

export default inject(
  ['fetchHTTP', 'KyselyPg', 'Tracer', 'OrgSettingsService'],
  HmaService,
);
