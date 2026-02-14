import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { App } from './App.js';
import { LandingPage } from './pages/LandingPage.js';
import { AnalyzePage } from './pages/AnalyzePage.js';
import { ResultsPage } from './pages/ResultsPage.js';
import { PlantsPage } from './pages/PlantsPage.js';
import { PlantDetailPage } from './pages/PlantDetailPage.js';
import { cn } from './lib/utils.js';

function renderWithRouter(initialRoute = '/'): ReturnType<typeof render> {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <App />,
        children: [
          { index: true, element: <LandingPage /> },
          { path: 'analyze', element: <AnalyzePage /> },
          { path: 'analyze/:id', element: <ResultsPage /> },
          { path: 'plants', element: <PlantsPage /> },
          { path: 'plants/:id', element: <PlantDetailPage /> },
        ],
      },
    ],
    { initialEntries: [initialRoute] },
  );

  return render(<RouterProvider router={router} />);
}

describe('App', () => {
  it('renders landing page at /', () => {
    renderWithRouter('/');
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('renders nav links', () => {
    renderWithRouter('/');
    expect(screen.getByText('Landscape Architect')).toBeInTheDocument();
    expect(screen.getByText('Analyze')).toBeInTheDocument();
    expect(screen.getByText('Browse Plants')).toBeInTheDocument();
  });

  it('renders analyze page at /analyze', () => {
    renderWithRouter('/analyze');
    expect(screen.getByText('Analyze Your Yard')).toBeInTheDocument();
  });

  it('renders results page at /analyze/:id', () => {
    renderWithRouter('/analyze/abc-123');
    expect(screen.getByText('Loading analysis...')).toBeInTheDocument();
  });

  it('renders plants page at /plants', () => {
    renderWithRouter('/plants');
    expect(screen.getByRole('heading', { name: 'Browse Plants' })).toBeInTheDocument();
  });

  it('renders plant detail page at /plants/:id', () => {
    renderWithRouter('/plants/rose-001');
    expect(screen.getByRole('heading', { name: 'Plant Detail' })).toBeInTheDocument();
  });
});

describe('cn utility', () => {
  it('merges class names', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1');
  });

  it('handles conflicting tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
