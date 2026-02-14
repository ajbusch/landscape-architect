import { Link } from 'react-router';

export function Header(): React.JSX.Element {
  return (
    <header className="border-b bg-background">
      <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <Link to="/" className="text-lg font-semibold">
          Landscape Architect
        </Link>
        <Link to="/analyze" className="text-muted-foreground hover:text-foreground">
          Analyze
        </Link>
        <Link to="/plants" className="text-muted-foreground hover:text-foreground">
          Browse Plants
        </Link>
      </nav>
    </header>
  );
}
