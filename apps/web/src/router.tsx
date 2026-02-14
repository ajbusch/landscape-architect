import { createBrowserRouter } from 'react-router';
import { App } from './App.js';
import { LandingPage } from './pages/LandingPage.js';
import { AnalyzePage } from './pages/AnalyzePage.js';
import { ResultsPage } from './pages/ResultsPage.js';
import { PlantsPage } from './pages/PlantsPage.js';
import { PlantDetailPage } from './pages/PlantDetailPage.js';

export const router = createBrowserRouter([
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
]);
