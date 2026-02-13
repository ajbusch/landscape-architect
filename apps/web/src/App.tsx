import { useState, useEffect } from 'react';
import type { HealthResponse } from '@landscape-architect/shared';

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    void fetch('/api/health')
      .then((res) => res.json() as Promise<HealthResponse>)
      .then(setHealth);
  }, []);

  return (
    <main>
      <h1>Landscape Architect</h1>
      {health ? (
        <p data-testid="health-status">
          API Status: {health.status} (v{health.version})
        </p>
      ) : (
        <p>Loading...</p>
      )}
    </main>
  );
}
