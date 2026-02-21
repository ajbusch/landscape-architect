import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { LandingPage } from './LandingPage.js';

function renderLandingPage(): ReturnType<typeof render> {
  const router = createMemoryRouter([{ path: '/', element: <LandingPage /> }], {
    initialEntries: ['/'],
  });
  return render(<RouterProvider router={router} />);
}

describe('LandingPage', () => {
  describe('Hero section', () => {
    it('displays the hero headline', () => {
      renderLandingPage();

      expect(
        screen.getByRole('heading', {
          name: 'Transform Your Yard with AI-Powered Plant Recommendations',
        }),
      ).toBeInTheDocument();
    });

    it('displays the subheadline', () => {
      renderLandingPage();

      expect(
        screen.getByText(/Upload a photo of your yard, enter your location/),
      ).toBeInTheDocument();
    });

    it('renders CTA button linking to /analyze', () => {
      renderLandingPage();

      const links = screen.getAllByRole('link', { name: /Analyze Your Yard/ });
      expect(links.length).toBeGreaterThanOrEqual(1);
      expect(links[0]).toHaveAttribute('href', '/analyze');
    });
  });

  describe('How It Works section', () => {
    it('displays the section heading', () => {
      renderLandingPage();

      expect(screen.getByRole('heading', { name: 'How It Works' })).toBeInTheDocument();
    });

    it('displays all three steps', () => {
      renderLandingPage();

      expect(screen.getByText('Upload a Photo')).toBeInTheDocument();
      expect(screen.getByText('Enter Your Location')).toBeInTheDocument();
      expect(screen.getByText('Get Recommendations')).toBeInTheDocument();
    });

    it('displays step numbers', () => {
      renderLandingPage();

      expect(screen.getByText('Step 1')).toBeInTheDocument();
      expect(screen.getByText('Step 2')).toBeInTheDocument();
      expect(screen.getByText('Step 3')).toBeInTheDocument();
    });

    it('displays step descriptions', () => {
      renderLandingPage();

      expect(screen.getByText(/Snap a picture of your yard/)).toBeInTheDocument();
      expect(screen.getByText(/tailor plant recommendations/)).toBeInTheDocument();
      expect(screen.getByText(/AI analyzes your yard/)).toBeInTheDocument();
    });
  });

  describe('Preview section', () => {
    it('displays the section heading', () => {
      renderLandingPage();

      expect(screen.getByRole('heading', { name: 'See What You Get' })).toBeInTheDocument();
    });

    it('displays mock yard summary badges', () => {
      renderLandingPage();

      expect(screen.getByText('Medium Yard')).toBeInTheDocument();
      expect(screen.getByText('Loamy Soil')).toBeInTheDocument();
      expect(screen.getByText('Zone 7b')).toBeInTheDocument();
    });

    it('displays mock identified features', () => {
      renderLandingPage();

      expect(screen.getByText('Identified Features')).toBeInTheDocument();
      expect(screen.getByText('Large Oak Tree')).toBeInTheDocument();
      expect(screen.getByText('Boxwood Hedge')).toBeInTheDocument();
      expect(screen.getByText('Front Garden Bed')).toBeInTheDocument();
    });

    it('displays mock plant recommendations', () => {
      renderLandingPage();

      expect(screen.getByText('Top Recommendations')).toBeInTheDocument();
      expect(screen.getByText('Black-Eyed Susan')).toBeInTheDocument();
      expect(screen.getByText('Rudbeckia hirta')).toBeInTheDocument();
      expect(screen.getByText('Eastern Redbud')).toBeInTheDocument();
      expect(screen.getByText('Purple Coneflower')).toBeInTheDocument();
    });

    it('displays plant stat badges in preview', () => {
      renderLandingPage();

      expect(screen.getAllByText('Full Sun').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Low Water').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('3a–9b')).toBeInTheDocument();
    });
  });

  describe('Browse Plants CTA section', () => {
    it('displays the section heading', () => {
      renderLandingPage();

      expect(
        screen.getByRole('heading', { name: 'Explore Our Plant Database' }),
      ).toBeInTheDocument();
    });

    it('renders a link to /plants', () => {
      renderLandingPage();

      const links = screen.getAllByRole('link', { name: /Browse Plants/ });
      const plantsLink = links.find((l) => l.getAttribute('href') === '/plants');
      expect(plantsLink).toBeTruthy();
    });
  });

  describe('Footer', () => {
    it('displays the brand name', () => {
      renderLandingPage();

      expect(screen.getByText('Landscape Architect')).toBeInTheDocument();
    });

    it('has footer navigation links', () => {
      renderLandingPage();

      const links = screen.getAllByRole('link');
      const browseLink = links.find((l) => l.getAttribute('href') === '/plants');
      const analyzeLink = links.find((l) => l.getAttribute('href') === '/analyze');
      expect(browseLink).toBeTruthy();
      expect(analyzeLink).toBeTruthy();
    });
  });
});
