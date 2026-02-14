import { Outlet } from 'react-router';
import { Header } from './components/Header.js';
import { Toaster } from './components/ui/sonner.js';

export function App(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <Outlet />
      <Toaster />
    </div>
  );
}
