import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { GQLHashBankHmaInstance } from '../../../../graphql/generated';
import HashBankInstanceSelect, {
  hashBankInstanceLabel,
} from './HashBankInstanceSelect';

const { Clip, Default } = GQLHashBankHmaInstance;

describe('HashBankInstanceSelect', () => {
  test('renders nothing when CLIP is not available', () => {
    const { container } = render(
      <HashBankInstanceSelect
        available={[Default]}
        value={Default}
        onChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('offers both matching types when CLIP is available', () => {
    render(
      <HashBankInstanceSelect
        available={[Default, Clip]}
        value={Default}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('radiogroup', { name: 'Matching Type' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Standard/ })).toBeChecked();
    expect(
      screen.getAllByRole('radio').map((radio) => radio.getAttribute('value')),
    ).toEqual([Default, Clip]);
    expect(
      screen.getByRole('radio', { name: /Semantic \(CLIP\)/ }),
    ).not.toBeChecked();
  });

  test('reports the chosen instance', async () => {
    const onChange = vi.fn();
    render(
      <HashBankInstanceSelect
        available={[Default, Clip]}
        value={Default}
        onChange={onChange}
      />,
    );

    await userEvent.click(
      screen.getByRole('radio', { name: /Semantic \(CLIP\)/ }),
    );

    expect(onChange).toHaveBeenCalledWith(Clip);
  });

  test('labels each instance', () => {
    expect(hashBankInstanceLabel(Default)).toBe('Standard');
    expect(hashBankInstanceLabel(Clip)).toBe('Semantic (CLIP)');
  });
});
