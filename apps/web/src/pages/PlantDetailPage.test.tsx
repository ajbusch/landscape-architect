import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { PlantDetailPage } from './PlantDetailPage.js';
import type { Plant } from '@landscape-architect/shared';

vi.mock('@/services/api', () => ({
  fetchPlant: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

import { fetchPlant, ApiError } from '@/services/api';

const MOCK_PLANT: Plant = {
  id: 'p1111111-1111-1111-1111-111111111111',
  commonName: 'Black-Eyed Susan',
  scientificName: 'Rudbeckia hirta',
  description: 'A hardy native perennial with bright yellow daisy-like flowers.',
  photoUrl: 'https://example.com/susan.jpg',
  light: ['full_sun', 'partial_shade'],
  waterNeeds: 'low',
  soilTypes: ['loamy', 'sandy'],
  matureHeightFtMin: 1,
  matureHeightFtMax: 3,
  matureWidthFtMin: 1,
  matureWidthFtMax: 2,
  zoneMin: '3a',
  zoneMax: '9b',
  type: 'perennial',
  bloomSeason: 'summer',
  isNative: true,
  isInvasive: false,
  deerResistant: true,
  droughtTolerant: true,
  costRange: 'low',
  difficulty: 'beginner',
  careGuide: 'Water sparingly once established.',
  tags: ['pollinator-friendly', 'native', 'low-maintenance'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function renderDetailPage(id = 'test-id'): ReturnType<typeof render> {
  const router = createMemoryRouter([{ path: '/plants/:id', element: <PlantDetailPage /> }], {
    initialEntries: [`/plants/${id}`],
  });
  return render(<RouterProvider router={router} />);
}

describe('PlantDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (fetchPlant as Mock).mockResolvedValue(MOCK_PLANT);
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching', () => {
      (fetchPlant as Mock).mockReturnValue(new Promise<never>(() => undefined));
      renderDetailPage();

      expect(screen.getByText('Loading plant...')).toBeInTheDocument();
    });

    it('fetches plant with the route ID', async () => {
      renderDetailPage('my-plant-id');

      await waitFor(() => {
        expect(fetchPlant).toHaveBeenCalledWith('my-plant-id');
      });
    });
  });

  describe('Plant info', () => {
    it('displays common name as heading', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Black-Eyed Susan' })).toBeInTheDocument();
      });
    });

    it('displays scientific name in italic', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Rudbeckia hirta')).toBeInTheDocument();
      });
    });

    it('displays the plant photo', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByAltText('Black-Eyed Susan')).toHaveAttribute(
          'src',
          'https://example.com/susan.jpg',
        );
      });
    });

    it('displays description', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText(/hardy native perennial/)).toBeInTheDocument();
      });
    });

    it('shows placeholder when no photo', async () => {
      (fetchPlant as Mock).mockResolvedValue({ ...MOCK_PLANT, photoUrl: undefined });
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
  });

  describe('Boolean badges', () => {
    it('shows Native badge when isNative is true', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Native')).toBeInTheDocument();
      });
    });

    it('shows Deer Resistant badge when deerResistant is true', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Deer Resistant')).toBeInTheDocument();
      });
    });

    it('shows Drought Tolerant badge when droughtTolerant is true', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Drought Tolerant')).toBeInTheDocument();
      });
    });

    it('hides badges when boolean flags are false', async () => {
      (fetchPlant as Mock).mockResolvedValue({
        ...MOCK_PLANT,
        isNative: false,
        deerResistant: false,
        droughtTolerant: false,
      });
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });
      expect(screen.queryByText('Native')).not.toBeInTheDocument();
      expect(screen.queryByText('Deer Resistant')).not.toBeInTheDocument();
      expect(screen.queryByText('Drought Tolerant')).not.toBeInTheDocument();
    });
  });

  describe('Quick Stats', () => {
    it('displays light requirements', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Full Sun, Partial Shade')).toBeInTheDocument();
      });
    });

    it('displays water needs', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Water Needs')).toBeInTheDocument();
      });
      // "Low" appears in both water needs and cost range
      expect(screen.getAllByText('Low').length).toBeGreaterThanOrEqual(1);
    });

    it('displays mature size', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText(/1–3 ft tall × 1–2 ft wide/)).toBeInTheDocument();
      });
    });

    it('displays hardiness zones', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('3a–9b')).toBeInTheDocument();
      });
    });

    it('displays bloom season', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Summer')).toBeInTheDocument();
      });
    });

    it('displays cost range', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Cost Range')).toBeInTheDocument();
      });
    });

    it('displays difficulty', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Beginner')).toBeInTheDocument();
      });
    });

    it('hides bloom season when not set', async () => {
      (fetchPlant as Mock).mockResolvedValue({ ...MOCK_PLANT, bloomSeason: undefined });
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });
      expect(screen.queryByText('Bloom Season')).not.toBeInTheDocument();
    });
  });

  describe('Tags', () => {
    it('displays tags as chips', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('pollinator-friendly')).toBeInTheDocument();
      });
      expect(screen.getByText('native')).toBeInTheDocument();
      expect(screen.getByText('low-maintenance')).toBeInTheDocument();
    });

    it('hides tags section when no tags', async () => {
      (fetchPlant as Mock).mockResolvedValue({ ...MOCK_PLANT, tags: [] });
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });
      expect(screen.queryByText('Tags')).not.toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('renders back to browse link', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });

      const backLinks = screen.getAllByRole('link', { name: /Back to browse/i });
      expect(backLinks.length).toBeGreaterThanOrEqual(1);
      expect(backLinks[0]).toHaveAttribute('href', '/plants');
    });

    it('renders "Find more plants like this" link with pre-filled filters', async () => {
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });

      const link = screen.getByRole('link', { name: 'Find more plants like this' });
      const href = link.getAttribute('href');
      expect(href).toContain('type=perennial');
      expect(href).toContain('light=full_sun');
      expect(href).toContain('zone=3a');
    });
  });

  describe('404 state', () => {
    it('shows "Plant not found" on 404', async () => {
      (fetchPlant as Mock).mockRejectedValue(new ApiError(404, 'Not found'));
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Plant not found')).toBeInTheDocument();
      });
    });

    it('shows link to browse on 404', async () => {
      (fetchPlant as Mock).mockRejectedValue(new ApiError(404, 'Not found'));
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByRole('link', { name: 'Browse Plants' })).toHaveAttribute(
          'href',
          '/plants',
        );
      });
    });
  });

  describe('Error handling', () => {
    it('shows error message on network failure', async () => {
      (fetchPlant as Mock).mockRejectedValue(new Error('Network error'));
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByText('Failed to load plant. Please try again.')).toBeInTheDocument();
      });
    });

    it('shows link to browse on error', async () => {
      (fetchPlant as Mock).mockRejectedValue(new Error('fail'));
      renderDetailPage();

      await waitFor(() => {
        expect(screen.getByRole('link', { name: 'Browse Plants' })).toHaveAttribute(
          'href',
          '/plants',
        );
      });
    });
  });
});
