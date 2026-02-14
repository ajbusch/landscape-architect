import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { PlantsPage } from './PlantsPage.js';
import type { PlantSearchResponse, Plant } from '@landscape-architect/shared';

vi.mock('@/services/api', () => ({
  searchPlants: vi.fn(),
}));

import { searchPlants } from '@/services/api';

function makePlant(overrides: Partial<Plant> = {}): Plant {
  return {
    id: 'p0000000-0000-0000-0000-000000000001',
    commonName: 'Test Plant',
    scientificName: 'Testus plantus',
    description: 'A test plant.',
    light: ['full_sun'],
    waterNeeds: 'low',
    soilTypes: ['loamy'],
    matureHeightFtMin: 1,
    matureHeightFtMax: 3,
    matureWidthFtMin: 1,
    matureWidthFtMax: 2,
    zoneMin: '3a',
    zoneMax: '9b',
    type: 'perennial',
    isNative: true,
    isInvasive: false,
    deerResistant: false,
    droughtTolerant: true,
    costRange: 'low',
    difficulty: 'beginner',
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const MOCK_RESPONSE: PlantSearchResponse = {
  plants: [
    makePlant({
      id: 'p1111111-1111-1111-1111-111111111111',
      commonName: 'Black-Eyed Susan',
      scientificName: 'Rudbeckia hirta',
      difficulty: 'beginner',
    }),
    makePlant({
      id: 'p2222222-2222-2222-2222-222222222222',
      commonName: 'Eastern Redbud',
      scientificName: 'Cercis canadensis',
      photoUrl: 'https://example.com/redbud.jpg',
      type: 'tree',
      light: ['partial_shade', 'full_sun'],
      waterNeeds: 'moderate',
      difficulty: 'intermediate',
      zoneMin: '4b',
      zoneMax: '9a',
    }),
  ],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const PAGED_RESPONSE: PlantSearchResponse = {
  plants: [
    makePlant({
      id: 'p3333333-3333-3333-3333-333333333333',
      commonName: 'Purple Coneflower',
      scientificName: 'Echinacea purpurea',
    }),
  ],
  total: 25,
  page: 1,
  limit: 20,
  totalPages: 2,
};

const EMPTY_RESPONSE: PlantSearchResponse = {
  plants: [],
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
};

function renderPlantsPage(initialRoute = '/plants'): ReturnType<typeof render> {
  const router = createMemoryRouter([{ path: '/plants', element: <PlantsPage /> }], {
    initialEntries: [initialRoute],
  });
  return render(<RouterProvider router={router} />);
}

describe('PlantsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (searchPlants as Mock).mockResolvedValue(MOCK_RESPONSE);
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching', () => {
      (searchPlants as Mock).mockReturnValue(new Promise<never>(() => undefined));
      renderPlantsPage();

      expect(screen.getByText('Loading plants...')).toBeInTheDocument();
    });
  });

  describe('Page heading', () => {
    it('displays the Browse Plants heading', async () => {
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Browse Plants' })).toBeInTheDocument();
      });
    });
  });

  describe('Plant results', () => {
    it('renders plant cards after loading', async () => {
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });
      expect(screen.getByText('Eastern Redbud')).toBeInTheDocument();
    });

    it('shows total count', async () => {
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByText('2 plants found')).toBeInTheDocument();
      });
    });

    it('shows singular count for one plant', async () => {
      (searchPlants as Mock).mockResolvedValue({
        ...PAGED_RESPONSE,
        total: 1,
        totalPages: 1,
        plants: [PAGED_RESPONSE.plants[0]],
      });
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByText('1 plant found')).toBeInTheDocument();
      });
    });

    it('renders plant card links to /plants/:id', async () => {
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });

      const links = screen.getAllByRole('link');
      const plantLink = links.find(
        (l) => l.getAttribute('href') === '/plants/p1111111-1111-1111-1111-111111111111',
      );
      expect(plantLink).toBeTruthy();
    });

    it('shows plant photo when available', async () => {
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByAltText('Eastern Redbud')).toHaveAttribute(
          'src',
          'https://example.com/redbud.jpg',
        );
      });
    });

    it('does not show reason text', async () => {
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });

      // PlantCard should not render a reason paragraph since none was provided
      expect(screen.queryByText('Hardy native perennial')).not.toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows empty message when no plants match', async () => {
      (searchPlants as Mock).mockResolvedValue(EMPTY_RESPONSE);
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByText('No plants match your filters')).toBeInTheDocument();
      });
    });

    it('shows reset button when filters are active and no results', async () => {
      (searchPlants as Mock).mockResolvedValue(EMPTY_RESPONSE);
      renderPlantsPage('/plants?light=full_shade');

      await waitFor(() => {
        expect(screen.getByText('No plants match your filters')).toBeInTheDocument();
      });

      const resetButtons = screen.getAllByRole('button', { name: /Reset Filters/ });
      expect(resetButtons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Error handling', () => {
    it('shows error message on fetch failure', async () => {
      (searchPlants as Mock).mockRejectedValue(new Error('Network error'));
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByText('Failed to load plants. Please try again.')).toBeInTheDocument();
      });
    });

    it('shows try again button on error', async () => {
      (searchPlants as Mock).mockRejectedValue(new Error('fail'));
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
      });
    });

    it('retries fetch on try again click', async () => {
      const user = userEvent.setup();
      (searchPlants as Mock).mockRejectedValueOnce(new Error('fail'));
      (searchPlants as Mock).mockResolvedValueOnce(MOCK_RESPONSE);
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Try Again' }));

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });
    });
  });

  describe('Filters', () => {
    it('renders zone input', async () => {
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByLabelText('USDA Zone')).toBeInTheDocument();
      });
    });

    it('renders light checkboxes', async () => {
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByText('Light')).toBeInTheDocument();
      });
      // Text may appear in both filter checkboxes and card badges
      expect(screen.getAllByText('Full Sun').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Partial Shade').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Full Shade')).toBeInTheDocument();
    });

    it('renders type checkboxes', async () => {
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByText('Tree')).toBeInTheDocument();
      });
      expect(screen.getByText('Shrub')).toBeInTheDocument();
      expect(screen.getByText('Perennial')).toBeInTheDocument();
      expect(screen.getByText('Grass')).toBeInTheDocument();
      expect(screen.getByText('Groundcover')).toBeInTheDocument();
      expect(screen.getByText('Vine')).toBeInTheDocument();
    });

    it('renders difficulty checkboxes', async () => {
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByText('Difficulty')).toBeInTheDocument();
      });
      // Text may appear in both filter checkboxes and card badges
      expect(screen.getAllByText('Beginner').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Intermediate').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Advanced')).toBeInTheDocument();
    });

    it('renders toggle switches', async () => {
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByLabelText('Native only')).toBeInTheDocument();
      });
      expect(screen.getByLabelText('Deer resistant')).toBeInTheDocument();
      expect(screen.getByLabelText('Drought tolerant')).toBeInTheDocument();
    });

    it('calls searchPlants on mount', async () => {
      renderPlantsPage();

      await waitFor(() => {
        expect(searchPlants).toHaveBeenCalledWith({});
      });
    });

    it('initializes filters from URL params', async () => {
      renderPlantsPage('/plants?zone=7b&light=full_sun');

      await waitFor(() => {
        expect(searchPlants).toHaveBeenCalledWith(
          expect.objectContaining({ zone: '7b', light: 'full_sun' }),
        );
      });
    });

    it('shows reset filters button when filters are active', async () => {
      renderPlantsPage('/plants?light=full_sun');

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });

      const resetButtons = screen.getAllByRole('button', { name: /Reset Filters/ });
      expect(resetButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('does not show reset filters button when no filters are active', async () => {
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /Reset Filters/ })).not.toBeInTheDocument();
    });
  });

  describe('Pagination', () => {
    it('shows pagination when totalPages > 1', async () => {
      (searchPlants as Mock).mockResolvedValue(PAGED_RESPONSE);
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
    });

    it('does not show pagination when totalPages is 1', async () => {
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });

      expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument();
    });

    it('navigates to next page on click', async () => {
      const user = userEvent.setup();
      (searchPlants as Mock).mockResolvedValue(PAGED_RESPONSE);
      renderPlantsPage();

      await waitFor(() => {
        expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Next/ }));

      await waitFor(() => {
        expect(searchPlants).toHaveBeenCalledWith(expect.objectContaining({ page: '2' }));
      });
    });
  });
});
