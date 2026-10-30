import { TooltipProvider } from '@/coop-ui/Tooltip';
import {
  GQLImageMatchingSettingsDocument,
  GQLUpdateHasClipHashingEnabledDocument,
} from '@/graphql/generated';
import { MockedProvider, type MockedResponse } from '@apollo/client/testing';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import ImageMatchingTab from './ImageMatchingTab';

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/coop-ui/Toast', () => ({ toast: toastMocks }));

function settingsMock(
  hasClipHashingEnabled: boolean,
  maxUsageCount = Infinity,
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
        },
      },
    },
  };
}

function renderTab(mocks: MockedResponse[]) {
  return render(
    <TooltipProvider>
      <MockedProvider mocks={mocks}>
        <ImageMatchingTab />
      </MockedProvider>
    </TooltipProvider>,
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

  test('saves a turned-off setting', async () => {
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
});
