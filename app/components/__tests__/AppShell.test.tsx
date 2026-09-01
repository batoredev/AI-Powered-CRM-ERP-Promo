import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AppShell } from '../AppShell';

describe('AppShell', () => {
  it('renders the Pipeline nav link as a normal active link, not disabled/soon', () => {
    render(<AppShell><div /></AppShell>);

    const pipelineLink = screen.getByRole('link', { name: /^pipeline$/i });
    expect(pipelineLink).toHaveAttribute('href', '/pipeline');
    expect(pipelineLink.className).not.toMatch(/disabled/i);
    expect(screen.queryByText(/\(soon\)/i)).not.toBeInTheDocument();
  });
});
