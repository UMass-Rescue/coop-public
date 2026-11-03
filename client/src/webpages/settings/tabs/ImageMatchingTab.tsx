import { Button } from '@/coop-ui/Button';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/coop-ui/Dialog';
import { Switch } from '@/coop-ui/Switch';
import { toast } from '@/coop-ui/Toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/coop-ui/Tooltip';
import { Heading, Text } from '@/coop-ui/Typography';
import {
  GQLClipRuleKind,
  useGQLImageMatchingSettingsQuery,
  useGQLUpdateHasClipHashingEnabledMutation,
} from '@/graphql/generated';
import { gql } from '@apollo/client';
import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import FullScreenLoading from '@/components/common/FullScreenLoading';

gql`
  query ImageMatchingSettings {
    myOrg {
      id
      hasClipHashingEnabled
      clipRuleImpact {
        activeRules {
          id
          name
          kind
        }
        routingRules {
          id
          name
          kind
        }
        draftRules {
          id
          name
          kind
        }
      }
    }
  }

  mutation UpdateHasClipHashingEnabled($enabled: Boolean!) {
    updateHasClipHashingEnabled(enabled: $enabled)
  }
`;

type RuleRef = { id: string; name: string; kind: GQLClipRuleKind };

const RULE_KIND_LABELS: Record<GQLClipRuleKind, string> = {
  [GQLClipRuleKind.Proactive]: 'rule',
  [GQLClipRuleKind.Reporting]: 'reporting rule',
  [GQLClipRuleKind.Routing]: 'routing rule',
};

/** Where a rule can be opened, if Coop has a page for it. */
function ruleLink(rule: RuleRef): string | undefined {
  switch (rule.kind) {
    case GQLClipRuleKind.Proactive:
      return `/dashboard/rules/proactive/info/${rule.id}`;
    case GQLClipRuleKind.Reporting:
      return `/dashboard/rules/report/info/${rule.id}`;
    default:
      return undefined;
  }
}

function RuleList({
  rules,
  linked,
}: {
  rules: readonly RuleRef[];
  linked?: boolean;
}) {
  return (
    <ul className="list-disc pl-5 mt-1">
      {rules.map((rule) => {
        const link = linked ? ruleLink(rule) : undefined;
        return (
          <li key={`${rule.kind}-${rule.id}`}>
            {link ? (
              <Link to={link} className="underline">
                {rule.name}
              </Link>
            ) : (
              rule.name
            )}{' '}
            <span className="text-gray-500">
              ({RULE_KIND_LABELS[rule.kind]})
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function ImageMatchingTab() {
  const { data, loading, error, refetch } = useGQLImageMatchingSettingsQuery({
    fetchPolicy: 'network-only',
    nextFetchPolicy: 'cache-and-network',
  });
  const org = data?.myOrg;

  const [clipEnabled, setClipEnabled] = useState(false);
  // Depends on the value, not the object: a refetch that only changes the
  // rules to be listed must not flip the switch back.
  const savedClipEnabled = org?.hasClipHashingEnabled;
  useEffect(() => {
    if (savedClipEnabled !== undefined) {
      setClipEnabled(savedClipEnabled);
    }
  }, [savedClipEnabled]);

  const [confirmingOff, setConfirmingOff] = useState(false);
  const [checkingImpact, setCheckingImpact] = useState(false);

  const [updateClipEnabled, { loading: saving }] =
    useGQLUpdateHasClipHashingEnabledMutation({
      onCompleted: () => {
        toast.success('Image matching settings updated');
        refetch();
      },
      onError: (err) => {
        toast.error(err.message ?? 'Failed to update image matching settings');
      },
    });

  if (loading) return <FullScreenLoading />;
  if (error || !org) return <div>Error loading image matching settings</div>;

  const hasChanges = clipEnabled !== org.hasClipHashingEnabled;

  const turningOff = org.hasClipHashingEnabled && !clipEnabled;
  const { activeRules, routingRules, draftRules } = org.clipRuleImpact;

  const handleSave = async () => {
    if (!turningOff) {
      updateClipEnabled({ variables: { enabled: clipEnabled } });
      return;
    }
    // The rules to be moved can change while the tab is open, so list the
    // current ones in the confirmation.
    setCheckingImpact(true);
    try {
      await refetch();
      setConfirmingOff(true);
    } catch {
      toast.error('Could not check which rules use CLIP. Please try again.');
    } finally {
      setCheckingImpact(false);
    }
  };

  const handleConfirmOff = () => {
    if (saving) return;
    setConfirmingOff(false);
    updateClipEnabled({ variables: { enabled: false } });
  };

  const handleCancelOff = () => {
    setConfirmingOff(false);
    setClipEnabled(org.hasClipHashingEnabled);
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="border-b border-gray-200 py-2">
          <Heading size="2XL" weight="semibold">
            Image Matching
          </Heading>
        </div>

        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Text size="SM" weight="medium">
                Semantic image matching (CLIP)
              </Text>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="About the cost of CLIP hashing"
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <Info size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Hashing every submitted image with CLIP needs significant
                  compute. A GPU is recommended, and it adds processing time to
                  each image you submit.
                </TooltipContent>
              </Tooltip>
            </div>
            <Text className="text-[0.8125rem] text-gray-500 mt-[.31rem]">
              Hashes submitted images with CLIP so they can be matched by what
              they show, not only as near-duplicates. This adds a Semantic
              (CLIP) option when you create hash banks.
            </Text>
            <Text className="text-[0.8125rem] text-gray-500 mt-[.31rem]">
              Turning this off moves the rules that use CLIP to Draft and makes
              your Semantic (CLIP) banks unavailable. Nothing is deleted.
              Turning it back on restores the banks, but the rules stay in Draft
              until you turn them on again. An unavailable bank still holds its
              name, so a new bank can&apos;t reuse it.
            </Text>
            {org.hasClipHashingEnabled && draftRules.length > 0 && (
              <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-[0.8125rem]">
                <Text size="SM" weight="medium">
                  Rules that use CLIP are in Draft
                </Text>
                <Text className="text-[0.8125rem] text-gray-500">
                  These stay in Draft until you turn them on again from the rule
                  page.
                </Text>
                <RuleList rules={draftRules} linked />
              </div>
            )}
          </div>
          <Switch
            aria-label="Semantic image matching (CLIP)"
            checked={clipEnabled}
            onCheckedChange={setClipEnabled}
          />
        </div>
      </div>

      <div className="flex justify-end border-t border-gray-200 pt-4">
        <Button
          disabled={!hasChanges || saving || checkingImpact}
          loading={saving || checkingImpact}
          onClick={handleSave}
        >
          Save Changes
        </Button>
      </div>

      <Dialog
        open={confirmingOff}
        onOpenChange={(open) => !open && handleCancelOff()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn off semantic image matching?</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogDescription asChild>
            <div className="flex flex-col gap-3 text-sm">
              {activeRules.length > 0 && (
                <div>
                  <p>
                    {activeRules.length === 1 ? 'This rule' : 'These rules'}{' '}
                    will be moved to Draft and stop running:
                  </p>
                  <RuleList rules={activeRules} />
                </div>
              )}
              {routingRules.length > 0 && (
                <div>
                  <p>
                    {routingRules.length === 1
                      ? 'This routing rule has'
                      : 'These routing rules have'}{' '}
                    no Draft state, so{' '}
                    {routingRules.length === 1 ? 'it stays' : 'they stay'} as{' '}
                    {routingRules.length === 1 ? 'it is' : 'they are'}. The CLIP
                    condition cannot match while CLIP is off, so{' '}
                    {routingRules.length === 1 ? 'it' : 'each'} matches only
                    through its other conditions, and otherwise the job goes on
                    to the next rule or the default queue:
                  </p>
                  <RuleList rules={routingRules} />
                </div>
              )}
              {activeRules.length === 0 && routingRules.length === 0 && (
                <p>No rules use CLIP.</p>
              )}
              <p>
                Your Semantic (CLIP) banks are kept but become unavailable until
                you turn CLIP on again. Rules moved to Draft must be turned on
                again by hand.
              </p>
            </div>
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelOff}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={handleConfirmOff}>
              Turn off CLIP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
