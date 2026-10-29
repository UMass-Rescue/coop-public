import {
  GQLCreateHashBankDocument,
  GQLExchangeApiSchemaDocument,
  GQLExchangeApisDocument,
  GQLHashBankByIdDocument,
  GQLHashBankHmaInstance,
  GQLHashBankHmaInstancesDocument,
} from '@/graphql/generated';
import { MockedProvider, type MockedResponse } from '@apollo/client/testing';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';

import HashBankForm from './HashBankForm';

const { Clip, Default } = GQLHashBankHmaInstance;

function renderForm(instances: GQLHashBankHmaInstance[] | Error) {
  const createVariables = vi.fn().mockReturnValue(true);

  const mocks: MockedResponse[] = [
    {
      request: { query: GQLHashBankHmaInstancesDocument },
      ...(instances instanceof Error
        ? { error: instances }
        : { result: { data: { hashBankHmaInstances: instances } } }),
    },
    {
      request: { query: GQLExchangeApisDocument },
      result: {
        data: {
          exchangeApis: [
            {
              __typename: 'ExchangeApiInfo',
              name: 'ncmec',
              supports_auth: true,
            },
          ],
        },
      },
    },
    {
      request: {
        query: GQLExchangeApiSchemaDocument,
        variables: { apiName: 'ncmec' },
      },
      result: {
        data: {
          exchangeApiSchema: {
            __typename: 'ExchangeApiSchema',
            config_schema: {
              __typename: 'ExchangeSchemaSection',
              fields: [
                {
                  __typename: 'ExchangeFieldDescriptor',
                  name: 'environment',
                  type: 'enum',
                  required: true,
                  default: null,
                  help: '',
                  choices: ['https://example.test'],
                },
              ],
            },
            credentials_schema: null,
          },
        },
      },
    },
    {
      request: { query: GQLCreateHashBankDocument },
      variableMatcher: createVariables,
      result: {
        data: {
          createHashBank: {
            __typename: 'MutateHashBankSuccessResponse',
            data: {
              __typename: 'HashBank',
              id: '1',
              name: 'my bank',
              description: '',
              hma_name: 'COOP_ORG_MY_BANK',
              enabled_ratio: 1,
              org_id: 'org',
            },
            warning: null,
          },
        },
      },
    },
  ];

  render(
    <HelmetProvider>
      <MockedProvider mocks={mocks}>
        <MemoryRouter>
          <HashBankForm />
        </MemoryRouter>
      </MockedProvider>
    </HelmetProvider>,
  );

  return { createVariables };
}

async function submit(name: string) {
  await userEvent.type(screen.getAllByRole('textbox')[0], name);
  await userEvent.click(
    screen.getByRole('button', { name: 'Create Hash Bank' }),
  );
}

describe('HashBankForm (create)', () => {
  test('offers no matching type and creates a standard bank when CLIP is not deployed', async () => {
    const { createVariables } = renderForm([Default]);

    await screen.findByText('Exchange Connection');
    expect(screen.queryByText('Matching Type')).not.toBeInTheDocument();

    await submit('my bank');

    await waitFor(() => expect(createVariables).toHaveBeenCalled());
    expect(createVariables.mock.calls[0][0].input).toMatchObject({
      name: 'my bank',
      hma_instance: Default,
    });
  });

  test('lets a CLIP bank be chosen, hides the exchange section, and creates it without an exchange', async () => {
    const { createVariables } = renderForm([Default, Clip]);

    await screen.findByText('Matching Type');
    expect(screen.getByText('Exchange Connection')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('radio', { name: /Semantic \(CLIP\)/ }),
    );
    expect(screen.queryByText('Exchange Connection')).not.toBeInTheDocument();

    await submit('my bank');

    await waitFor(() => expect(createVariables).toHaveBeenCalled());
    const { input } = createVariables.mock.calls[0][0];
    expect(input).toMatchObject({ name: 'my bank', hma_instance: Clip });
    expect(input.exchange).toBeUndefined();
  });

  test('brings the exchange section back when switching to a standard bank', async () => {
    renderForm([Default, Clip]);

    await userEvent.click(
      await screen.findByRole('radio', { name: /Semantic \(CLIP\)/ }),
    );
    await userEvent.click(screen.getByRole('radio', { name: /^Standard/ }));

    expect(screen.getByText('Exchange Connection')).toBeInTheDocument();
  });

  test('drops a chosen exchange when switching to CLIP, so it neither blocks nor is sent', async () => {
    const { createVariables } = renderForm([Default, Clip]);

    await userEvent.click(await screen.findByRole('combobox'));
    await userEvent.click(await screen.findByText('NCMEC'));
    await screen.findByText('Exchange Configuration');
    // The exchange has a required field that is still empty.
    expect(
      screen.getByRole('button', { name: 'Create Hash Bank' }),
    ).toBeDisabled();

    await userEvent.click(
      screen.getByRole('radio', { name: /Semantic \(CLIP\)/ }),
    );
    expect(
      screen.getByRole('button', { name: 'Create Hash Bank' }),
    ).toBeEnabled();

    await submit('my bank');

    await waitFor(() => expect(createVariables).toHaveBeenCalled());
    const { input } = createVariables.mock.calls[0][0];
    expect(input.hma_instance).toBe(Clip);
    expect(input.exchange).toBeUndefined();
  });

  test('still creates a standard bank when the instances query fails', async () => {
    const { createVariables } = renderForm(new Error('network'));

    await screen.findByText('Exchange Connection');
    expect(screen.queryByText('Matching Type')).not.toBeInTheDocument();

    await submit('my bank');

    await waitFor(() => expect(createVariables).toHaveBeenCalled());
    expect(createVariables.mock.calls[0][0].input.hma_instance).toBe(Default);
  });
});

function renderEdit(hmaInstance: GQLHashBankHmaInstance) {
  const mocks: MockedResponse[] = [
    {
      request: { query: GQLHashBankByIdDocument, variables: { id: '7' } },
      result: {
        data: {
          hashBankById: {
            __typename: 'HashBank',
            id: '7',
            name: 'existing bank',
            description: '',
            hma_name: 'COOP_ORG_EXISTING_BANK',
            enabled_ratio: 1,
            hma_instance: hmaInstance,
            org_id: 'org',
            exchange: null,
          },
        },
      },
    },
  ];

  render(
    <HelmetProvider>
      <MockedProvider mocks={mocks}>
        <MemoryRouter initialEntries={['/form/hash/7']}>
          <Routes>
            <Route path="/form/hash/:id" element={<HashBankForm />} />
          </Routes>
        </MemoryRouter>
      </MockedProvider>
    </HelmetProvider>,
  );
}

describe('HashBankForm (edit)', () => {
  test('tags a CLIP bank and explains its type is fixed, without offering a choice', async () => {
    renderEdit(Clip);

    expect(await screen.findByText('Semantic (CLIP)')).toBeInTheDocument();
    expect(screen.getByText(/can.t be changed/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  test('shows no matching-type tag for a standard bank', async () => {
    renderEdit(Default);

    await screen.findByRole('button', { name: 'Save Changes' });
    expect(screen.queryByText('Standard')).not.toBeInTheDocument();
    expect(screen.queryByText('Semantic (CLIP)')).not.toBeInTheDocument();
    expect(screen.queryByText(/can.t be changed/)).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});
