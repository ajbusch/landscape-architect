import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App.js';

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the heading', () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'healthy', timestamp: '2025-01-01T00:00:00Z', version: '0.0.1' })),
    );

    render(<App />);
    expect(screen.getByText('Landscape Architect')).toBeInTheDocument();
  });

  it('displays health status after fetch', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'healthy', timestamp: '2025-01-01T00:00:00Z', version: '0.0.1' })),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('health-status')).toHaveTextContent('API Status: healthy');
    });
  });
});
