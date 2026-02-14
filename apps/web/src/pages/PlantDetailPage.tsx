import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import type { Plant } from '@landscape-architect/shared';
import { fetchPlant, ApiError } from '@/services/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  ArrowLeft,
  Sun,
  Droplets,
  Ruler,
  Thermometer,
  Flower2,
  DollarSign,
  Gauge,
  Leaf,
  TreeDeciduous,
  Sparkles,
} from 'lucide-react';

const LIGHT_LABELS: Record<string, string> = {
  full_sun: 'Full Sun',
  partial_shade: 'Partial Shade',
  full_shade: 'Full Shade',
};

const WATER_LABELS: Record<string, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
};

const COST_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

const BLOOM_LABELS: Record<string, string> = {
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall',
  winter: 'Winter',
  evergreen: 'Evergreen',
  none: 'None',
};

function buildSimilarLink(plant: Plant): string {
  const params = new URLSearchParams();
  params.set('type', plant.type);
  if (plant.light[0]) {
    params.set('light', plant.light[0]);
  }
  params.set('zone', plant.zoneMin);
  return `/plants?${params.toString()}`;
}

export function PlantDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [plant, setPlant] = useState<Plant | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setError(null);
    setNotFound(false);

    fetchPlant(id)
      .then((data) => {
        setPlant(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError('Failed to load plant. Please try again.');
        }
      });
  }, [id]);

  if (loading) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading plant...</p>
        </div>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Plant not found</h1>
        <p className="mt-2 text-muted-foreground">
          This plant may have been removed or the link is incorrect.
        </p>
        <Button asChild className="mt-6">
          <Link to="/plants">Browse Plants</Link>
        </Button>
      </main>
    );
  }

  if (error || !plant) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-destructive">{error ?? 'An unexpected error occurred.'}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/plants">Browse Plants</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      {/* Back link */}
      <Link
        to="/plants"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to browse
      </Link>

      {/* Hero: photo + name */}
      <div className="mb-8 grid gap-6 md:grid-cols-2">
        <div className="overflow-hidden rounded-xl bg-muted">
          {plant.photoUrl ? (
            <img
              src={plant.photoUrl}
              alt={plant.commonName}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center">
              <Leaf className="size-16 text-muted-foreground/40" />
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div>
            <h1 className="text-3xl font-bold">{plant.commonName}</h1>
            <p className="text-lg italic text-muted-foreground">{plant.scientificName}</p>
          </div>
          <p className="text-muted-foreground">{plant.description}</p>

          {/* Boolean badges */}
          <div className="flex flex-wrap gap-2">
            {plant.isNative && (
              <Badge variant="secondary" className="gap-1">
                <TreeDeciduous className="size-3" />
                Native
              </Badge>
            )}
            {plant.deerResistant && (
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="size-3" />
                Deer Resistant
              </Badge>
            )}
            {plant.droughtTolerant && (
              <Badge variant="secondary" className="gap-1">
                <Droplets className="size-3" />
                Drought Tolerant
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <section className="mb-8">
        <h2 className="mb-4 text-xl font-semibold">Quick Stats</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatItem icon={<Sun className="size-4" />} label="Light">
            {plant.light.map((l) => LIGHT_LABELS[l] ?? l).join(', ')}
          </StatItem>
          <StatItem icon={<Droplets className="size-4" />} label="Water Needs">
            {WATER_LABELS[plant.waterNeeds] ?? plant.waterNeeds}
          </StatItem>
          <StatItem icon={<Ruler className="size-4" />} label="Mature Size">
            {plant.matureHeightFtMin}–{plant.matureHeightFtMax} ft tall × {plant.matureWidthFtMin}–
            {plant.matureWidthFtMax} ft wide
          </StatItem>
          <StatItem icon={<Thermometer className="size-4" />} label="Hardiness Zones">
            {plant.zoneMin}–{plant.zoneMax}
          </StatItem>
          {plant.bloomSeason && (
            <StatItem icon={<Flower2 className="size-4" />} label="Bloom Season">
              {BLOOM_LABELS[plant.bloomSeason] ?? plant.bloomSeason}
            </StatItem>
          )}
          <StatItem icon={<DollarSign className="size-4" />} label="Cost Range">
            {COST_LABELS[plant.costRange] ?? plant.costRange}
          </StatItem>
          <StatItem icon={<Gauge className="size-4" />} label="Difficulty">
            {DIFFICULTY_LABELS[plant.difficulty] ?? plant.difficulty}
          </StatItem>
        </div>
      </section>

      {/* Tags */}
      {plant.tags.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold">Tags</h2>
          <div className="flex flex-wrap gap-2">
            {plant.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {/* Navigation */}
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="default">
          <Link to={buildSimilarLink(plant)}>Find more plants like this</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/plants">Back to browse</Link>
        </Button>
      </div>
    </main>
  );
}

function StatItem({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
