import { vi } from 'vitest';

import { type Action } from '../../services/moderationConfigService/index.js';
import { UserPermission } from '../../services/userManagementService/index.js';
import { resolveOrgActions, resolvers } from './org.js';

function makeAction(
  id: string,
  actionType: Action['actionType'],
  orgId: string,
): Action {
  const base = {
    id,
    orgId,
    name: id,
    description: null,
    penalty: 'NONE' as const,
    applyUserStrikes: false,
  };
  if (actionType === 'CUSTOM_ACTION') {
    return {
      ...base,
      actionType,
      callbackUrl: 'https://example.com',
      callbackUrlBody: null,
      callbackUrlHeaders: null,
      customMrtApiParams: null,
    };
  }
  return { ...base, actionType };
}

describe('Org resolvers', () => {
  describe('resolveOrgActions', () => {
    function makeContext(opts: {
      orgId: string;
      callerOrgId?: string;
      actionTypes: Array<{ id: string; actionType: Action['actionType'] }>;
      hasNCMECReportingEnabled: boolean;
    }) {
      const actions = opts.actionTypes.map((a) =>
        makeAction(a.id, a.actionType, opts.orgId),
      );
      const getActions = vi.fn(async () => actions);
      const hasNCMECReportingEnabled = vi.fn(
        async () => opts.hasNCMECReportingEnabled,
      );
      const ctx = {
        getUser: () => ({ orgId: opts.callerOrgId ?? opts.orgId }),
        services: {
          ModerationConfigService: { getActions },
          NcmecService: { hasNCMECReportingEnabled },
        },
      };
      return { ctx, getActions, hasNCMECReportingEnabled };
    }

    it('hides ENQUEUE_TO_NCMEC built-in when NCMEC reporting is disabled', async () => {
      const { ctx } = makeContext({
        orgId: 'org-1',
        actionTypes: [
          { id: 'a-custom', actionType: 'CUSTOM_ACTION' },
          { id: 'a-mrt', actionType: 'ENQUEUE_TO_MRT' },
          { id: 'a-author', actionType: 'ENQUEUE_AUTHOR_TO_MRT' },
          { id: 'a-ncmec', actionType: 'ENQUEUE_TO_NCMEC' },
        ],
        hasNCMECReportingEnabled: false,
      });

      const result = await resolveOrgActions({ id: 'org-1' }, {}, ctx);
      expect(result.map((it) => it.id).sort()).toEqual([
        'a-author',
        'a-custom',
        'a-mrt',
      ]);
    });

    it('returns ENQUEUE_TO_NCMEC built-in when NCMEC reporting is enabled', async () => {
      const { ctx } = makeContext({
        orgId: 'org-1',
        actionTypes: [
          { id: 'a-mrt', actionType: 'ENQUEUE_TO_MRT' },
          { id: 'a-ncmec', actionType: 'ENQUEUE_TO_NCMEC' },
        ],
        hasNCMECReportingEnabled: true,
      });

      const result = await resolveOrgActions({ id: 'org-1' }, {}, ctx);
      expect(result.map((it) => it.id).sort()).toEqual(['a-mrt', 'a-ncmec']);
    });

    it('rejects when caller org does not match the requested org (IDOR guard)', async () => {
      const { ctx, getActions, hasNCMECReportingEnabled } = makeContext({
        orgId: 'org-1',
        callerOrgId: 'other-org',
        actionTypes: [],
        hasNCMECReportingEnabled: false,
      });

      await expect(resolveOrgActions({ id: 'org-1' }, {}, ctx)).rejects.toThrow(
        'User required.',
      );
      expect(getActions).not.toHaveBeenCalled();
      expect(hasNCMECReportingEnabled).not.toHaveBeenCalled();
    });
  });

  describe('Org sensitive field resolvers require MANAGE_ORG', () => {
    function makeCtx(opts: {
      orgId: string;
      permissions: readonly UserPermission[];
      callerOrgId?: string;
    }) {
      const getActivatedApiKeyForOrg = vi.fn(async () => ({
        key: 'api-key-secret',
      }));
      const getPublicSigningKeyPem = vi.fn(async () => 'PEM_BODY');
      const getAllIntegrationConfigs = vi.fn(async () => []);
      const ctx = {
        getUser: () => ({
          id: 'user-1',
          orgId: opts.callerOrgId ?? opts.orgId,
          getPermissions: () => opts.permissions,
        }),
        dataSources: {
          orgAPI: { getActivatedApiKeyForOrg, getPublicSigningKeyPem },
          integrationAPI: { getAllIntegrationConfigs },
        },
      };
      return {
        ctx,
        getActivatedApiKeyForOrg,
        getPublicSigningKeyPem,
        getAllIntegrationConfigs,
      };
    }

    const orgParent = { id: 'org-1' };
    const Org = resolvers.Org as Record<
      'apiKey' | 'publicSigningKey' | 'integrationConfigs',
      (
        parent: typeof orgParent,
        args: unknown,
        ctx: unknown,
      ) => Promise<unknown>
    >;

    it('Org.apiKey throws forbiddenError when caller lacks MANAGE_ORG', async () => {
      const { ctx, getActivatedApiKeyForOrg } = makeCtx({
        orgId: 'org-1',
        permissions: [UserPermission.VIEW_MRT],
      });
      await expect(Org.apiKey(orgParent, {}, ctx)).rejects.toThrow(
        'User does not have permission to view the org API key',
      );
      expect(getActivatedApiKeyForOrg).not.toHaveBeenCalled();
    });

    it('Org.apiKey returns the key when caller has MANAGE_ORG', async () => {
      const { ctx, getActivatedApiKeyForOrg } = makeCtx({
        orgId: 'org-1',
        permissions: [UserPermission.MANAGE_ORG],
      });
      await expect(Org.apiKey(orgParent, {}, ctx)).resolves.toBe(
        'api-key-secret',
      );
      expect(getActivatedApiKeyForOrg).toHaveBeenCalledWith('org-1');
    });

    it('Org.publicSigningKey throws forbiddenError when caller lacks MANAGE_ORG', async () => {
      const { ctx, getPublicSigningKeyPem } = makeCtx({
        orgId: 'org-1',
        permissions: [UserPermission.VIEW_MRT],
      });
      await expect(Org.publicSigningKey(orgParent, {}, ctx)).rejects.toThrow(
        'User does not have permission to view the webhook signing key',
      );
      expect(getPublicSigningKeyPem).not.toHaveBeenCalled();
    });

    it('Org.integrationConfigs throws forbiddenError when caller lacks MANAGE_ORG', async () => {
      const { ctx, getAllIntegrationConfigs } = makeCtx({
        orgId: 'org-1',
        permissions: [UserPermission.VIEW_MRT],
      });
      await expect(Org.integrationConfigs(orgParent, {}, ctx)).rejects.toThrow(
        'User does not have permission to view integration configs',
      );
      expect(getAllIntegrationConfigs).not.toHaveBeenCalled();
    });

    it('Org.apiKey still throws unauthenticatedError when caller is in a different org (IDOR guard runs first)', async () => {
      const { ctx } = makeCtx({
        orgId: 'org-1',
        callerOrgId: 'other-org',
        permissions: [UserPermission.MANAGE_ORG],
      });
      await expect(Org.apiKey(orgParent, {}, ctx)).rejects.toThrow(
        'User required.',
      );
    });
  });

  describe('Org.usersWhoCanReviewEveryQueue is not readable cross-tenant (PII leak guard)', () => {
    function makeCtx(opts: { orgId: string; callerOrgId?: string | null }) {
      const getOrgUsersForGraphQL = vi.fn(async () => []);
      const ctx = {
        getUser: () =>
          opts.callerOrgId === null
            ? null
            : { id: 'user-1', orgId: opts.callerOrgId ?? opts.orgId },
        dataSources: {
          orgAPI: { getOrgUsersForGraphQL },
        },
      };
      return { ctx, getOrgUsersForGraphQL };
    }

    const orgParent = { id: 'org-1' };
    const Org = resolvers.Org as Record<
      'usersWhoCanReviewEveryQueue',
      (
        parent: typeof orgParent,
        args: unknown,
        ctx: unknown,
      ) => Promise<unknown>
    >;

    it('throws when the caller belongs to a different org (IDOR guard)', async () => {
      const { ctx, getOrgUsersForGraphQL } = makeCtx({
        orgId: 'org-1',
        callerOrgId: 'other-org',
      });
      await expect(
        Org.usersWhoCanReviewEveryQueue(orgParent, {}, ctx),
      ).rejects.toThrow('User required.');
      expect(getOrgUsersForGraphQL).not.toHaveBeenCalled();
    });

    it('throws when there is no authenticated user', async () => {
      const { ctx, getOrgUsersForGraphQL } = makeCtx({
        orgId: 'org-1',
        callerOrgId: null,
      });
      await expect(
        Org.usersWhoCanReviewEveryQueue(orgParent, {}, ctx),
      ).rejects.toThrow('User required.');
      expect(getOrgUsersForGraphQL).not.toHaveBeenCalled();
    });
  });

  describe('Org.mrtQueues is membership-scoped', () => {
    function makeCtx(opts: { callerOrgId?: string | null }) {
      const getReviewableQueuesForUser = vi.fn(async () => [
        { id: 'q-1', orgId: 'org-1', name: 'q-1' },
      ]);
      const getAllQueuesForOrgAndDangerouslyBypassPermissioning = vi.fn(
        async () => {
          throw new Error('resolver must not bypass permissioning');
        },
      );
      const ctx = {
        getUser: () =>
          opts.callerOrgId === null
            ? null
            : {
                id: 'user-1',
                orgId: opts.callerOrgId ?? 'org-1',
                getPermissions: () => [UserPermission.VIEW_MRT],
              },
        services: {
          ManualReviewToolService: {
            getReviewableQueuesForUser,
            getAllQueuesForOrgAndDangerouslyBypassPermissioning,
          },
        },
      };
      return {
        ctx,
        getReviewableQueuesForUser,
        getAllQueuesForOrgAndDangerouslyBypassPermissioning,
      };
    }

    const orgParent = { id: 'org-1' };
    const Org = resolvers.Org as Record<
      'mrtQueues',
      (
        parent: typeof orgParent,
        args: unknown,
        ctx: unknown,
      ) => Promise<unknown>
    >;

    it('delegates to getReviewableQueuesForUser, not the bypass helper', async () => {
      const {
        ctx,
        getReviewableQueuesForUser,
        getAllQueuesForOrgAndDangerouslyBypassPermissioning,
      } = makeCtx({});
      await expect(Org.mrtQueues(orgParent, {}, ctx)).resolves.toEqual([
        { id: 'q-1', orgId: 'org-1', name: 'q-1' },
      ]);
      expect(getReviewableQueuesForUser).toHaveBeenCalledWith({
        invoker: {
          userId: 'user-1',
          permissions: [UserPermission.VIEW_MRT],
          orgId: 'org-1',
        },
      });
      expect(
        getAllQueuesForOrgAndDangerouslyBypassPermissioning,
      ).not.toHaveBeenCalled();
    });

    it('throws the IDOR guard when the caller is in a different org', async () => {
      const { ctx, getReviewableQueuesForUser } = makeCtx({
        callerOrgId: 'other-org',
      });
      await expect(Org.mrtQueues(orgParent, {}, ctx)).rejects.toThrow(
        'User required',
      );
      expect(getReviewableQueuesForUser).not.toHaveBeenCalled();
    });

    it('throws when there is no authenticated user', async () => {
      const { ctx, getReviewableQueuesForUser } = makeCtx({
        callerOrgId: null,
      });
      await expect(Org.mrtQueues(orgParent, {}, ctx)).rejects.toThrow(
        'User required',
      );
      expect(getReviewableQueuesForUser).not.toHaveBeenCalled();
    });
  });

  describe('Org.ncmecReports requires VIEW_CHILD_SAFETY_DATA', () => {
    function makeCtx(opts: {
      permissions: readonly UserPermission[];
      callerOrgId?: string;
    }) {
      const getNcmecReports = vi.fn(async () => [] as unknown[]);
      const ctx = {
        getUser: () => ({
          id: 'user-1',
          orgId: opts.callerOrgId ?? 'org-1',
          getPermissions: () => opts.permissions,
        }),
        services: { NcmecService: { getNcmecReports } },
      };
      return { ctx, getNcmecReports };
    }

    const orgParent = { id: 'org-1' };
    const Org = resolvers.Org as Record<
      'ncmecReports',
      (
        parent: typeof orgParent,
        args: unknown,
        ctx: unknown,
      ) => Promise<unknown>
    >;

    it('throws forbiddenError when the caller lacks VIEW_CHILD_SAFETY_DATA', async () => {
      const { ctx, getNcmecReports } = makeCtx({
        permissions: [UserPermission.VIEW_MRT],
      });
      await expect(Org.ncmecReports(orgParent, {}, ctx)).rejects.toThrow(
        'VIEW_CHILD_SAFETY_DATA permission required',
      );
      expect(getNcmecReports).not.toHaveBeenCalled();
    });

    it('throws the IDOR guard first when the caller is in a different org', async () => {
      const { ctx, getNcmecReports } = makeCtx({
        permissions: [UserPermission.VIEW_CHILD_SAFETY_DATA],
        callerOrgId: 'other-org',
      });
      await expect(Org.ncmecReports(orgParent, {}, ctx)).rejects.toThrow(
        'User required.',
      );
      expect(getNcmecReports).not.toHaveBeenCalled();
    });

    it('reaches the service when the caller has VIEW_CHILD_SAFETY_DATA', async () => {
      const { ctx, getNcmecReports } = makeCtx({
        permissions: [UserPermission.VIEW_CHILD_SAFETY_DATA],
      });
      await expect(Org.ncmecReports(orgParent, {}, ctx)).resolves.toEqual([]);
      expect(getNcmecReports).toHaveBeenCalledWith({
        orgId: 'org-1',
        reviewerId: 'user-1',
      });
    });
  });

  describe('CLIP hashing setting', () => {
    function makeCtx(opts: {
      permissions?: readonly UserPermission[];
      clipDeployed: boolean;
      callerOrgId?: string;
      signedIn?: boolean;
    }) {
      const updateHasClipHashingEnabled = vi.fn(async () => undefined);
      const hasClipHashingEnabled = vi.fn(async () => true);
      const ctx = {
        getUser: () =>
          opts.signedIn === false
            ? null
            : {
                id: 'user-1',
                orgId: opts.callerOrgId ?? 'org-1',
                getPermissions: () => opts.permissions ?? [],
              },
        services: {
          OrgSettingsService: {
            updateHasClipHashingEnabled,
            hasClipHashingEnabled,
          },
          HMAHashBankService: { isClipEnabled: () => opts.clipDeployed },
          ModerationConfigService: {
            ruleSignals: () => ({
              moveActiveRulesUsingSignalToDraft: vi.fn(async () => []),
            }),
          },
          ReportingService: {
            moveActiveReportingRulesUsingSignalToDraft: vi.fn(async () => []),
          },
        },
      };
      return { ctx, updateHasClipHashingEnabled, hasClipHashingEnabled };
    }

    const update = (
      resolvers.Mutation as Record<
        'updateHasClipHashingEnabled',
        (
          parent: unknown,
          args: { enabled: boolean },
          ctx: unknown,
        ) => Promise<boolean>
      >
    ).updateHasClipHashingEnabled;
    const Org = resolvers.Org as Record<
      'hasClipHashingEnabled' | 'clipHashingAvailable',
      (parent: { id: string }, args: unknown, ctx: unknown) => Promise<unknown>
    >;

    it('lets an org admin turn it on when CLIP is deployed', async () => {
      const { ctx, updateHasClipHashingEnabled } = makeCtx({
        permissions: [UserPermission.MANAGE_ORG],
        clipDeployed: true,
      });
      await expect(update({}, { enabled: true }, ctx)).resolves.toBe(true);
      expect(updateHasClipHashingEnabled).toHaveBeenCalledWith({
        orgId: 'org-1',
        enabled: true,
      });
    });

    it('refuses a user without MANAGE_ORG, and writes nothing', async () => {
      const { ctx, updateHasClipHashingEnabled } = makeCtx({
        permissions: [UserPermission.VIEW_MRT],
        clipDeployed: true,
      });
      await expect(update({}, { enabled: true }, ctx)).rejects.toThrow(
        'User does not have permission to update org settings',
      );
      expect(updateHasClipHashingEnabled).not.toHaveBeenCalled();
    });

    it('refuses an unauthenticated caller, and writes nothing', async () => {
      const { ctx, updateHasClipHashingEnabled } = makeCtx({
        signedIn: false,
        clipDeployed: true,
      });
      await expect(update({}, { enabled: true }, ctx)).rejects.toThrow(
        'User required.',
      );
      expect(updateHasClipHashingEnabled).not.toHaveBeenCalled();
    });

    it('refuses to turn it on when the deployment has no CLIP instance', async () => {
      const { ctx, updateHasClipHashingEnabled } = makeCtx({
        permissions: [UserPermission.MANAGE_ORG],
        clipDeployed: false,
      });
      await expect(update({}, { enabled: true }, ctx)).rejects.toThrow(
        'CLIP is not available',
      );
      expect(updateHasClipHashingEnabled).not.toHaveBeenCalled();
    });

    it('still lets an org turn it off after CLIP is removed from the deployment', async () => {
      const { ctx, updateHasClipHashingEnabled } = makeCtx({
        permissions: [UserPermission.MANAGE_ORG],
        clipDeployed: false,
      });
      await expect(update({}, { enabled: false }, ctx)).resolves.toBe(true);
      expect(updateHasClipHashingEnabled).toHaveBeenCalledWith({
        orgId: 'org-1',
        enabled: false,
      });
    });

    it('exposes the org setting and the deployment flag to org members only', async () => {
      const { ctx } = makeCtx({ clipDeployed: true });
      await expect(
        Org.hasClipHashingEnabled({ id: 'org-1' }, {}, ctx),
      ).resolves.toBe(true);
      await expect(
        Org.clipHashingAvailable({ id: 'org-1' }, {}, ctx),
      ).resolves.toBe(true);

      const other = makeCtx({ clipDeployed: true, callerOrgId: 'org-2' }).ctx;
      await expect(
        Org.hasClipHashingEnabled({ id: 'org-1' }, {}, other),
      ).rejects.toThrow('User required.');
      await expect(
        Org.clipHashingAvailable({ id: 'org-1' }, {}, other),
      ).rejects.toThrow('User required.');
    });
  });
});

describe('turning CLIP off', () => {
  const CLIP = 'IMAGE_CLIP_MATCH';

  function makeCtx(opts: { permissions?: readonly UserPermission[] } = {}) {
    const updateHasClipHashingEnabled = vi.fn(async () => undefined);
    const moveProactive = vi.fn(async () => []);
    const moveReporting = vi.fn(async () => []);
    const getRulesUsingSignal = vi.fn(
      async (args: { statuses: readonly string[] }) =>
        args.statuses.includes('DRAFT')
          ? [{ id: 'p-draft', name: 'Drafted proactive' }]
          : [{ id: 'p-live', name: 'Live proactive' }],
    );
    const getReportingRulesUsingSignal = vi.fn(
      async (args: { statuses: readonly string[] }) =>
        args.statuses.includes('DRAFT')
          ? [{ id: 'r-draft', name: 'Drafted reporting' }]
          : [{ id: 'r-live', name: 'Live reporting' }],
    );
    const getRoutingRulesUsingSignal = vi.fn(async () => [
      { id: 'route-1', name: 'Route images' },
    ]);
    const ctx = {
      getUser: () => ({
        id: 'user-1',
        orgId: 'org-1',
        getPermissions: () => opts.permissions ?? [UserPermission.MANAGE_ORG],
      }),
      services: {
        OrgSettingsService: { updateHasClipHashingEnabled },
        HMAHashBankService: { isClipEnabled: () => true },
        ModerationConfigService: {
          ruleSignals: () => ({
            moveActiveRulesUsingSignalToDraft: moveProactive,
            getRulesUsingSignal,
          }),
        },
        ReportingService: {
          moveActiveReportingRulesUsingSignalToDraft: moveReporting,
          getReportingRulesUsingSignal,
        },
        ManualReviewToolService: { getRoutingRulesUsingSignal },
      },
    };
    return {
      ctx,
      updateHasClipHashingEnabled,
      moveProactive,
      moveReporting,
      getRulesUsingSignal,
      getReportingRulesUsingSignal,
      getRoutingRulesUsingSignal,
    };
  }

  const update = (
    resolvers.Mutation as Record<
      'updateHasClipHashingEnabled',
      (
        parent: unknown,
        args: { enabled: boolean },
        ctx: unknown,
      ) => Promise<boolean>
    >
  ).updateHasClipHashingEnabled;

  it('moves the org active rules that use CLIP to Draft before switching the setting off', async () => {
    const { ctx, moveProactive, moveReporting, updateHasClipHashingEnabled } =
      makeCtx();

    await expect(update({}, { enabled: false }, ctx)).resolves.toBe(true);

    expect(moveProactive).toHaveBeenCalledWith({
      orgId: 'org-1',
      signalType: CLIP,
    });
    expect(moveReporting).toHaveBeenCalledWith({
      orgId: 'org-1',
      signalType: CLIP,
    });
    expect(updateHasClipHashingEnabled).toHaveBeenCalledWith({
      orgId: 'org-1',
      enabled: false,
    });
    const setting = updateHasClipHashingEnabled.mock.invocationCallOrder[0];
    expect(moveProactive.mock.invocationCallOrder[0]).toBeLessThan(setting);
    expect(moveReporting.mock.invocationCallOrder[0]).toBeLessThan(setting);
  });

  it('leaves CLIP on, and says so, when the rules cannot be moved', async () => {
    const { ctx, moveProactive, moveReporting, updateHasClipHashingEnabled } =
      makeCtx();
    moveProactive.mockRejectedValueOnce(new Error('database down'));

    await expect(update({}, { enabled: false }, ctx)).rejects.toThrow(
      'database down',
    );

    expect(moveReporting).not.toHaveBeenCalled();
    expect(updateHasClipHashingEnabled).not.toHaveBeenCalled();
  });

  it('leaves the rules alone when turning CLIP on', async () => {
    const { ctx, moveProactive, moveReporting, updateHasClipHashingEnabled } =
      makeCtx();

    await update({}, { enabled: true }, ctx);

    expect(moveProactive).not.toHaveBeenCalled();
    expect(moveReporting).not.toHaveBeenCalled();
    expect(updateHasClipHashingEnabled).toHaveBeenCalledWith({
      orgId: 'org-1',
      enabled: true,
    });
  });

  it('moves nothing for a user without MANAGE_ORG', async () => {
    const { ctx, moveProactive, updateHasClipHashingEnabled } = makeCtx({
      permissions: [UserPermission.VIEW_MRT],
    });

    await expect(update({}, { enabled: false }, ctx)).rejects.toThrow(
      'User does not have permission to update org settings',
    );

    expect(moveProactive).not.toHaveBeenCalled();
    expect(updateHasClipHashingEnabled).not.toHaveBeenCalled();
  });

  describe('Org.clipRuleImpact', () => {
    const Org = resolvers.Org as Record<
      'clipRuleImpact',
      (parent: { id: string }, args: unknown, ctx: unknown) => Promise<unknown>
    >;

    it('lists the active, routing and draft rules that use CLIP, with their kinds', async () => {
      const { ctx, getRulesUsingSignal, getRoutingRulesUsingSignal } =
        makeCtx();

      await expect(
        Org.clipRuleImpact({ id: 'org-1' }, {}, ctx),
      ).resolves.toEqual({
        activeRules: [
          { id: 'p-live', name: 'Live proactive', kind: 'PROACTIVE' },
          { id: 'r-live', name: 'Live reporting', kind: 'REPORTING' },
        ],
        routingRules: [
          { id: 'route-1', name: 'Route images', kind: 'ROUTING' },
        ],
        draftRules: [
          { id: 'p-draft', name: 'Drafted proactive', kind: 'PROACTIVE' },
          { id: 'r-draft', name: 'Drafted reporting', kind: 'REPORTING' },
        ],
      });
      expect(getRulesUsingSignal).toHaveBeenCalledWith({
        orgId: 'org-1',
        signalType: CLIP,
        statuses: ['LIVE', 'BACKGROUND'],
      });
      expect(getRoutingRulesUsingSignal).toHaveBeenCalledWith({
        orgId: 'org-1',
        signalType: CLIP,
      });
    });

    it('is only for org admins of that org', async () => {
      const viewer = makeCtx({ permissions: [UserPermission.VIEW_MRT] }).ctx;
      await expect(
        Org.clipRuleImpact({ id: 'org-1' }, {}, viewer),
      ).rejects.toThrow('User does not have permission');

      const admin = makeCtx().ctx;
      await expect(
        Org.clipRuleImpact({ id: 'org-2' }, {}, admin),
      ).rejects.toThrow('User required.');
    });
  });
});
