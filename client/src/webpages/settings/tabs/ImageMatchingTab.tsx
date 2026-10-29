import { Button } from '@/coop-ui/Button';
import { Switch } from '@/coop-ui/Switch';
import { toast } from '@/coop-ui/Toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/coop-ui/Tooltip';
import { Heading, Text } from '@/coop-ui/Typography';
import {
  useGQLImageMatchingSettingsQuery,
  useGQLUpdateHasClipHashingEnabledMutation,
} from '@/graphql/generated';
import { gql } from '@apollo/client';
import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';

import FullScreenLoading from '@/components/common/FullScreenLoading';

gql`
  query ImageMatchingSettings {
    myOrg {
      id
      hasClipHashingEnabled
    }
  }

  mutation UpdateHasClipHashingEnabled($enabled: Boolean!) {
    updateHasClipHashingEnabled(enabled: $enabled)
  }
`;

export default function ImageMatchingTab() {
  const { data, loading, error, refetch } = useGQLImageMatchingSettingsQuery({
    fetchPolicy: 'network-only',
    nextFetchPolicy: 'cache-and-network',
  });
  const org = data?.myOrg;

  const [clipEnabled, setClipEnabled] = useState(false);
  useEffect(() => {
    if (org) {
      setClipEnabled(org.hasClipHashingEnabled);
    }
  }, [org]);

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

  const handleSave = () => {
    updateClipEnabled({ variables: { enabled: clipEnabled } });
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
              Turning this off hides your Semantic (CLIP) banks and stops rules
              that use them from matching. Nothing is deleted, and turning it
              back on restores them. A hidden bank still holds its name, so a
              new bank can&apos;t reuse it.
            </Text>
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
          disabled={!hasChanges || saving}
          loading={saving}
          onClick={handleSave}
        >
          Save Changes
        </Button>
      </div>
    </div>
  );
}
