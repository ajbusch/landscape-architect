import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ResultsPage } from './ResultsPage.js';
import type { AnalysisResponse } from '@landscape-architect/shared';

vi.mock('@/services/api', () => ({
  fetchAnalysis: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}));

import { fetchAnalysis, ApiError } from '@/services/api';
import { toast } from 'sonner';

const MOCK_ANALYSIS: AnalysisResponse = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  photoUrl: 'https://example.com/yard.jpg',
  address: { zipCode: '28202', zone: '7b' },
  tier: 'free',
  createdAt: '2026-01-15T10:00:00Z',
  result: {
    summary:
      'A medium-sized backyard with good sun exposure and mature trees providing partial shade.',
    yardSize: 'medium',
    overallSunExposure: 'partial_shade',
    estimatedSoilType: 'loamy',
    features: [
      {
        id: 'f1111111-1111-1111-1111-111111111111',
        type: 'tree',
        label: 'Large Oak Tree',
        species: 'Quercus alba',
        confidence: 'high',
        notes: 'Mature specimen providing dappled shade.',
      },
      {
        id: 'f2222222-2222-2222-2222-222222222222',
        type: 'patio',
        label: 'Stone Patio',
        confidence: 'medium',
      },
      {
        id: 'f3333333-3333-3333-3333-333333333333',
        type: 'garden_bed',
        label: 'Front Garden Bed',
        confidence: 'low',
        notes: 'Needs fresh mulch.',
      },
    ],
    recommendations: [
      {
        plantId: 'p1111111-1111-1111-1111-111111111111',
        commonName: 'Black-Eyed Susan',
        scientificName: 'Rudbeckia hirta',
        reason: 'Hardy native perennial that thrives in partial shade.',
        category: 'quick_win',
        light: 'partial_shade',
        waterNeeds: 'low',
        matureSize: { heightFt: { min: 1, max: 3 }, widthFt: { min: 1, max: 2 } },
        hardinessZones: { min: '3a', max: '9b' },
        costRange: 'low',
        difficulty: 'beginner',
      },
      {
        plantId: 'p2222222-2222-2222-2222-222222222222',
        commonName: 'Eastern Redbud',
        scientificName: 'Cercis canadensis',
        photoUrl: 'https://example.com/redbud.jpg',
        reason: 'Beautiful native tree adding spring color and structure.',
        category: 'foundation_plant',
        light: 'partial_shade',
        waterNeeds: 'moderate',
        matureSize: { heightFt: { min: 20, max: 30 }, widthFt: { min: 25, max: 35 } },
        hardinessZones: { min: '4b', max: '9a' },
        costRange: 'medium',
        difficulty: 'intermediate',
      },
      {
        plantId: 'p3333333-3333-3333-3333-333333333333',
        commonName: 'Purple Coneflower',
        scientificName: 'Echinacea purpurea',
        reason: 'Adds vibrant summer and fall color; attracts pollinators.',
        category: 'seasonal_color',
        light: 'full_sun',
        waterNeeds: 'low',
        matureSize: { heightFt: { min: 2, max: 4 }, widthFt: { min: 1, max: 2 } },
        hardinessZones: { min: '3a', max: '8b' },
        costRange: 'low',
        difficulty: 'beginner',
      },
    ],
  },
};

function renderResultsPage(id = 'test-id'): ReturnType<typeof render> {
  const router = createMemoryRouter([{ path: '/analyze/:id', element: <ResultsPage /> }], {
    initialEntries: [`/analyze/${id}`],
  });
  return render(<RouterProvider router={router} />);
}

describe('ResultsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (fetchAnalysis as Mock).mockResolvedValue(MOCK_ANALYSIS);
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching', () => {
      (fetchAnalysis as Mock).mockReturnValue(new Promise<never>(() => undefined));
      renderResultsPage();

      expect(screen.getByText('Loading analysis...')).toBeInTheDocument();
    });

    it('fetches analysis with the route ID', async () => {
      renderResultsPage('my-analysis-id');

      await waitFor(() => {
        expect(fetchAnalysis).toHaveBeenCalledWith('my-analysis-id');
      });
    });
  });

  describe('Yard summary', () => {
    it('displays the page heading', async () => {
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText('Your Yard Analysis')).toBeInTheDocument();
      });
    });

    it('displays the uploaded photo', async () => {
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByAltText('Uploaded yard')).toHaveAttribute(
          'src',
          'https://example.com/yard.jpg',
        );
      });
    });

    it('displays the AI summary text', async () => {
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText(/medium-sized backyard/)).toBeInTheDocument();
      });
    });

    it('displays yard size, sun exposure, soil type, and zone badges', async () => {
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText('medium yard')).toBeInTheDocument();
      });
      expect(screen.getAllByText('Partial Shade').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('loamy soil')).toBeInTheDocument();
      expect(screen.getByText('Zone 7b')).toBeInTheDocument();
    });
  });

  describe('Identified features', () => {
    it('renders all features', async () => {
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText('Large Oak Tree')).toBeInTheDocument();
      });
      expect(screen.getByText('Stone Patio')).toBeInTheDocument();
      expect(screen.getByText('Front Garden Bed')).toBeInTheDocument();
    });

    it('shows species name when available', async () => {
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText('Quercus alba')).toBeInTheDocument();
      });
    });

    it('shows feature notes when available', async () => {
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText('Mature specimen providing dappled shade.')).toBeInTheDocument();
      });
      expect(screen.getByText('Needs fresh mulch.')).toBeInTheDocument();
    });

    it('shows confidence badges', async () => {
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText('high')).toBeInTheDocument();
      });
      expect(screen.getByText('medium')).toBeInTheDocument();
      expect(screen.getByText('low')).toBeInTheDocument();
    });
  });

  describe('Plant recommendations', () => {
    it('renders category headings', async () => {
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText('Quick Wins')).toBeInTheDocument();
      });
      expect(screen.getByText('Foundation Plants')).toBeInTheDocument();
      expect(screen.getByText('Seasonal Color')).toBeInTheDocument();
    });

    it('renders category descriptions', async () => {
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText('Easy improvements you can make right away')).toBeInTheDocument();
      });
    });

    it('renders plant cards with names and scientific names', async () => {
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });
      expect(screen.getByText('Rudbeckia hirta')).toBeInTheDocument();
      expect(screen.getByText('Eastern Redbud')).toBeInTheDocument();
      expect(screen.getByText('Cercis canadensis')).toBeInTheDocument();
    });

    it('renders recommendation reasons', async () => {
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText(/Hardy native perennial/)).toBeInTheDocument();
      });
    });

    it('renders stat badges on plant cards', async () => {
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      });
      // These labels appear on multiple cards, so use getAllByText
      expect(screen.getAllByText('Low Water').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Beginner').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('3a\u20139b')).toBeInTheDocument();
    });

    it('renders plant card links to /plants/:id', async () => {
      renderResultsPage();

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
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByAltText('Eastern Redbud')).toHaveAttribute(
          'src',
          'https://example.com/redbud.jpg',
        );
      });
    });
  });

  describe('Share button', () => {
    it('shows toast on click', async () => {
      const user = userEvent.setup();
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText('Your Yard Analysis')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Share/ }));

      expect(toast.success).toHaveBeenCalledWith('Link copied to clipboard');
    });
  });

  describe('Analyze Another Yard button', () => {
    it('renders a link to /analyze', async () => {
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText('Your Yard Analysis')).toBeInTheDocument();
      });

      const link = screen.getByRole('link', { name: 'Analyze Another Yard' });
      expect(link).toHaveAttribute('href', '/analyze');
    });
  });

  describe('Expired / Not found state', () => {
    it('shows expired message on 404', async () => {
      (fetchAnalysis as Mock).mockRejectedValue(new ApiError(404, 'Not found'));
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText('This analysis has expired')).toBeInTheDocument();
      });
      expect(screen.getByRole('link', { name: 'Analyze a New Yard' })).toHaveAttribute(
        'href',
        '/analyze',
      );
    });
  });

  describe('Error handling', () => {
    it('shows error message on network failure', async () => {
      (fetchAnalysis as Mock).mockRejectedValue(new Error('Network error'));
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByText('Failed to load analysis. Please try again.')).toBeInTheDocument();
      });
    });

    it('shows link to analyze page on error', async () => {
      (fetchAnalysis as Mock).mockRejectedValue(new Error('fail'));
      renderResultsPage();

      await waitFor(() => {
        expect(screen.getByRole('link', { name: 'Analyze Another Yard' })).toHaveAttribute(
          'href',
          '/analyze',
        );
      });
    });
  });
});
