import {
  GQLHashBankHmaInstance,
  GQLHashBanksDocument,
} from '@/graphql/generated';
import { MockedProvider } from '@apollo/client/testing';
import { render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router';

import HashBanksDashboard from './HashBanksDashboard';

const { Clip, Default } = GQLHashBankHmaInstance;

function bank(id: string, name: string, hmaInstance: GQLHashBankHmaInstance) {
  return {
    __typename: 'HashBank',
    id,
    name,
    description: `${name} description`,
    hma_name: `COOP_ORG_${id}`,
    enabled_ratio: 1,
    hma_instance: hmaInstance,
    org_id: 'org',
  };
}

function renderDashboard(banks: ReturnType<typeof bank>[]) {
  render(
    <HelmetProvider>
      <MockedProvider
        mocks={[
          {
            request: { query: GQLHashBanksDocument },
            result: { data: { hashBanks: banks } },
          },
        ]}
      >
        <MemoryRouter>
          <HashBanksDashboard />
        </MemoryRouter>
      </MockedProvider>
    </HelmetProvider>,
  );
}

describe('HashBanksDashboard', () => {
  test('shows no Type column when every bank is standard', async () => {
    renderDashboard([bank('1', 'PDQ bank', Default)]);

    expect(await screen.findByText('PDQ bank')).toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'Type' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Standard')).not.toBeInTheDocument();
  });

  test('shows each bank’s type once there is a CLIP bank', async () => {
    renderDashboard([
      bank('1', 'PDQ bank', Default),
      bank('2', 'Semantic bank', Clip),
    ]);

    expect(await screen.findByText('Semantic bank')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Type' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('Semantic (CLIP)')).toBeInTheDocument();
  });
});
