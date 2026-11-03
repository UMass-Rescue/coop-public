import { TooltipProvider } from '@/coop-ui/Tooltip';
import {
  GQLImageMatchingSettingsDocument,
  GQLUpdateHasClipHashingEnabledDocument,
} from '@/graphql/generated';
import { MockedProvider, type MockedResponse } from '@apollo/client/testing';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

import ImageMatchingTab from './ImageMatchingTab';

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/coop-ui/Toast', () => ({ toast: toastMocks }));

type RuleRef = { id: string; name: string; kind: string };
const ref = (id: string, name: string, kind: string): RuleRef => ({
  __typename: 'ClipRule',
  id,
  name,
  kind,
});

function settingsMock(
  hasClipHashingEnabled: boolean,
  maxUsageCount = Infinity,
  impact: {
    activeRules?: RuleRef[];
    routingRules?: RuleRef[];
    draftRules?: RuleRef[];
  } = {},
): MockedResponse {
  return {
    request: { query: GQLImageMatchingSettingsDocument },
    maxUsageCount,
    result: {
      data: {
        myOrg: {
          __typename: 'Org',
          id: 'org-1',
          hasClipHashingEnabled,
          clipRuleImpact: {
            __typename: 'ClipRuleImpact',
            activeRules: impact.activeRules ?? [],
            routingRules: impact.routingRules ?? [],
            draftRules: impact.draftRules ?? [],
          },
        },
      },
    },
  };
}

function renderTab(mocks: MockedResponse[]) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <MockedProvider mocks={mocks}>
          <ImageMatchingTab />
        </MockedProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

const saveButton = () => screen.getByRole('button', { name: 'Save Changes' });
const clipSwitch = () =>
  screen.getByRole('switch', { name: 'Semantic image matching (CLIP)' });

describe('ImageMatchingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('shows the current setting and nothing to save until it changes', async () => {
    renderTab([settingsMock(true)]);

    await screen.findByText('Image Matching');
    expect(clipSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(saveButton()).toBeDisabled();
  });

  test('saves a turned-on setting', async () => {
    const updateVariables = vi.fn().mockReturnValue(true);
    renderTab([
      settingsMock(false),
      {
        request: { query: GQLUpdateHasClipHashingEnabledDocument },
        variableMatcher: updateVariables,
        result: { data: { updateHasClipHashingEnabled: true } },
      },
    ]);

    await screen.findByText('Image Matching');
    expect(clipSwitch()).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(clipSwitch());
    expect(saveButton()).toBeEnabled();
    await userEvent.click(saveButton());

    await waitFor(() => expect(updateVariables).toHaveBeenCalled());
    expect(updateVariables.mock.calls[0][0]).toEqual({ enabled: true });
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled());
  });

  test('saves a turned-off setting once it is confirmed', async () => {
    const updateVariables = vi.fn().mockReturnValue(true);
    renderTab([
      settingsMock(true),
      {
        request: { query: GQLUpdateHasClipHashingEnabledDocument },
        variableMatcher: updateVariables,
        result: { data: { updateHasClipHashingEnabled: true } },
      },
    ]);

    await screen.findByText('Image Matching');
    await userEvent.click(clipSwitch());
    await userEvent.click(saveButton());
    await userEvent.click(
      await screen.findByRole('button', { name: 'Turn off CLIP' }),
    );

    await waitFor(() => expect(updateVariables).toHaveBeenCalled());
    expect(updateVariables.mock.calls[0][0]).toEqual({ enabled: false });
  });

  test('reports a failed save', async () => {
    renderTab([
      settingsMock(false),
      {
        request: { query: GQLUpdateHasClipHashingEnabledDocument },
        variableMatcher: () => true,
        error: new Error('CLIP is not available'),
      },
    ]);

    await screen.findByText('Image Matching');
    await userEvent.click(clipSwitch());
    await userEvent.click(saveButton());

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith('CLIP is not available'),
    );
    expect(toastMocks.success).not.toHaveBeenCalled();
  });

  test('warns about the compute cost in a tooltip', async () => {
    renderTab([settingsMock(false)]);

    await screen.findByText('Image Matching');
    await userEvent.hover(
      screen.getByRole('button', { name: 'About the cost of CLIP hashing' }),
    );

    expect(
      await screen.findByRole('tooltip', { name: /GPU is recommended/ }),
    ).toBeInTheDocument();
  });

  test('explains what turning it off does', async () => {
    renderTab([settingsMock(true)]);

    expect(await screen.findByText(/Nothing is deleted/)).toBeInTheDocument();
    expect(screen.getByText(/the rules stay in\s+Draft/)).toBeInTheDocument();
  });

  test('re-reads the setting after saving, leaving nothing to save', async () => {
    renderTab([
      settingsMock(false, 1),
      {
        request: { query: GQLUpdateHasClipHashingEnabledDocument },
        variableMatcher: () => true,
        result: { data: { updateHasClipHashingEnabled: true } },
      },
      settingsMock(true, 1),
    ]);

    await screen.findByText('Image Matching');
    await userEvent.click(clipSwitch());
    await userEvent.click(saveButton());

    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled());
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(clipSwitch()).toHaveAttribute('aria-checked', 'true');
  });

  test('disables Save while the change is being saved', async () => {
    renderTab([
      settingsMock(false),
      {
        request: { query: GQLUpdateHasClipHashingEnabledDocument },
        variableMatcher: () => true,
        delay: 200,
        result: { data: { updateHasClipHashingEnabled: true } },
      },
    ]);

    await screen.findByText('Image Matching');
    await userEvent.click(clipSwitch());
    await userEvent.click(saveButton());

    expect(saveButton()).toBeDisabled();
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled());
  });

  describe('turning CLIP off', () => {
    const impact = {
      activeRules: [
        ref('r1', 'Block look-alikes', 'PROACTIVE'),
        ref('r2', 'Report look-alikes', 'REPORTING'),
      ],
      routingRules: [ref('q1', 'Route look-alikes', 'ROUTING')],
    };
    const dialog = () => screen.getByRole('dialog');

    async function startTurningOff(updateVariables = vi.fn()) {
      renderTab([
        settingsMock(true, Infinity, impact),
        {
          request: { query: GQLUpdateHasClipHashingEnabledDocument },
          variableMatcher: updateVariables.mockReturnValue(true),
          result: { data: { updateHasClipHashingEnabled: true } },
        },
      ]);
      await screen.findByText('Image Matching');
      await userEvent.click(clipSwitch());
      await userEvent.click(saveButton());
      await screen.findByRole('dialog');
      return updateVariables;
    }

    test('asks first, listing the rules that will move to Draft and the routing rules that will stop matching', async () => {
      const updateVariables = await startTurningOff();

      expect(
        within(dialog()).getByText(/will be moved to Draft and stop running/),
      ).toBeInTheDocument();
      expect(
        within(dialog()).getByText('Block look-alikes'),
      ).toBeInTheDocument();
      expect(
        within(dialog()).getByText('Report look-alikes'),
      ).toBeInTheDocument();
      expect(within(dialog()).getByText(/no Draft state/)).toBeInTheDocument();
      expect(
        within(dialog()).getByText('Route look-alikes'),
      ).toBeInTheDocument();
      expect(updateVariables).not.toHaveBeenCalled();
    });

    test('Cancel changes nothing and puts the switch back', async () => {
      const updateVariables = await startTurningOff();

      await userEvent.click(
        within(dialog()).getByRole('button', { name: 'Cancel' }),
      );

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(updateVariables).not.toHaveBeenCalled();
      expect(clipSwitch()).toHaveAttribute('aria-checked', 'true');
      expect(saveButton()).toBeDisabled();
    });

    test('lists the rules as they are when Save is pressed, not as they were when the tab opened', async () => {
      renderTab([
        settingsMock(true, 1),
        settingsMock(true, Infinity, {
          activeRules: [ref('r9', 'Made live meanwhile', 'PROACTIVE')],
        }),
      ]);
      await screen.findByText('Image Matching');
      await userEvent.click(clipSwitch());
      await userEvent.click(saveButton());

      expect(
        await within(await screen.findByRole('dialog')).findByText(
          'Made live meanwhile',
        ),
      ).toBeInTheDocument();
      // The refreshed list must not flip the switch back. (The page behind a
      // dialog is hidden from the accessibility tree.)
      expect(
        screen.getByRole('switch', {
          name: 'Semantic image matching (CLIP)',
          hidden: true,
        }),
      ).toHaveAttribute('aria-checked', 'false');
    });

    test('Escape closes it like Cancel', async () => {
      const updateVariables = await startTurningOff();

      fireEvent.keyDown(dialog(), { key: 'Escape', code: 'Escape' });

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(updateVariables).not.toHaveBeenCalled();
      expect(clipSwitch()).toHaveAttribute('aria-checked', 'true');
    });

    test('turning it off and on again needs no confirmation and saves nothing', async () => {
      renderTab([settingsMock(true, Infinity, impact)]);
      await screen.findByText('Image Matching');
      await userEvent.click(clipSwitch());
      await userEvent.click(clipSwitch());

      expect(saveButton()).toBeDisabled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('says so when no rule uses CLIP', async () => {
      renderTab([settingsMock(true)]);
      await screen.findByText('Image Matching');
      await userEvent.click(clipSwitch());
      await userEvent.click(saveButton());

      expect(
        await within(await screen.findByRole('dialog')).findByText(
          'No rules use CLIP.',
        ),
      ).toBeInTheDocument();
    });

    test('is not shown when turning CLIP on', async () => {
      const updateVariables = vi.fn().mockReturnValue(true);
      renderTab([
        settingsMock(false, Infinity, impact),
        {
          request: { query: GQLUpdateHasClipHashingEnabledDocument },
          variableMatcher: updateVariables,
          result: { data: { updateHasClipHashingEnabled: true } },
        },
      ]);
      await screen.findByText('Image Matching');
      await userEvent.click(clipSwitch());
      await userEvent.click(saveButton());

      await waitFor(() => expect(updateVariables).toHaveBeenCalled());
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('rules left in Draft', () => {
    const draftRules = [
      ref('r1', 'Drafted proactive', 'PROACTIVE'),
      ref('r2', 'Drafted reporting', 'REPORTING'),
    ];

    test('lists them, with links, while CLIP is on', async () => {
      renderTab([settingsMock(true, Infinity, { draftRules })]);

      expect(
        await screen.findByText('Rules that use CLIP are in Draft'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Drafted proactive' }),
      ).toHaveAttribute('href', '/dashboard/rules/proactive/info/r1');
      expect(
        screen.getByRole('link', { name: 'Drafted reporting' }),
      ).toHaveAttribute('href', '/dashboard/rules/report/info/r2');
    });

    test('does not mention them while CLIP is off', async () => {
      renderTab([settingsMock(false, Infinity, { draftRules })]);

      await screen.findByText('Image Matching');
      expect(
        screen.queryByText('Rules that use CLIP are in Draft'),
      ).not.toBeInTheDocument();
    });

    test('does not mention them when there are none', async () => {
      renderTab([settingsMock(true)]);

      await screen.findByText('Image Matching');
      expect(
        screen.queryByText('Rules that use CLIP are in Draft'),
      ).not.toBeInTheDocument();
    });
  });
});
