import { Outlet } from 'react-router';
import { Header } from './components/Header.js';

export function App(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <Outlet />
    </div>
  );
}
