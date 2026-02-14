import { RouterProvider } from 'react-router';
import { createRoot } from 'react-dom/client';
import { router } from './router.js';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(<RouterProvider router={router} />);
