import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import type { AnalysisResponse, PlantRecommendation } from '@landscape-architect/shared';
import { pollAnalysis, ApiError } from '@/services/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { PlantCard } from '@/components/PlantCard';
import { toast } from 'sonner';
import {
  Loader2,
  Share2,
  AlertCircle,
  TreeDeciduous,
  Shrub,
  Flower2,
  Fence,
  Footprints,
  Waves,
  LandPlot,
  Layers,
  CircleDot,
} from 'lucide-react';

const FEATURE_ICONS: Record<string, React.ReactNode> = {
  tree: <TreeDeciduous className="size-4" />,
  shrub: <Shrub className="size-4" />,
  flower: <Flower2 className="size-4" />,
  grass: <LandPlot className="size-4" />,
  fence: <Fence className="size-4" />,
  walkway: <Footprints className="size-4" />,
  water_feature: <Waves className="size-4" />,
  slope: <Layers className="size-4" />,
  garden_bed: <Flower2 className="size-4" />,
};

const CONFIDENCE_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  high: 'default',
  medium: 'secondary',
  low: 'outline',
};

const SUN_LABELS: Record<string, string> = {
  full_sun: 'Full Sun',
  partial_shade: 'Partial Shade',
  full_shade: 'Full Shade',
};

const CATEGORY_CONFIG: Record<string, { label: string; description: string }> = {
  quick_win: { label: 'Quick Wins', description: 'Easy improvements you can make right away' },
  foundation_plant: {
    label: 'Foundation Plants',
    description: 'Core plants for long-term structure',
  },
  seasonal_color: {
    label: 'Seasonal Color',
    description: 'Plants that add vibrant seasonal interest',
  },
  problem_solver: {
    label: 'Problem Solvers',
    description: 'Plants that address specific yard challenges',
  },
};

function groupByCategory(
  recommendations: PlantRecommendation[],
): Map<string, PlantRecommendation[]> {
  const groups = new Map<string, PlantRecommendation[]>();
  for (const rec of recommendations) {
    const existing = groups.get(rec.category);
    if (existing) {
      existing.push(rec);
    } else {
      groups.set(rec.category, [rec]);
    }
  }
  return groups;
}

const STATUS_MESSAGES: Record<string, string> = {
  pending: 'Starting analysis...',
  analyzing: 'Analyzing your yard...',
  matching: 'Finding perfect plants for your zone...',
};

export function ResultsPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setError(null);
    setNotFound(false);

    const checkStatus = (): void => {
      void pollAnalysis(id)
        .then((data) => {
          switch (data.status) {
            case 'pending':
            case 'analyzing':
            case 'matching':
              setLoading(false);
              setStatusMessage(STATUS_MESSAGES[data.status] ?? 'Processing...');
              // Start polling if not already
              if (!pollRef.current) {
                pollRef.current = setInterval(checkStatus, 2000);
                timeoutRef.current = setTimeout(() => {
                  stopPolling();
                  setStatusMessage(null);
                  setError('Analysis is taking longer than expected. Please try again.');
                }, 120_000);
              }
              break;
            case 'complete':
              stopPolling();
              setStatusMessage(null);
              if (data.result) {
                setAnalysis(data.result);
              }
              setLoading(false);
              break;
            case 'failed':
              stopPolling();
              setStatusMessage(null);
              setLoading(false);
              setError(data.error ?? 'Analysis failed. Please try again.');
              break;
          }
        })
        .catch((err: unknown) => {
          stopPolling();
          setLoading(false);
          setStatusMessage(null);
          if (err instanceof ApiError && err.status === 404) {
            setNotFound(true);
          } else {
            setError('Failed to load analysis. Please try again.');
          }
        });
    };

    checkStatus();

    return () => {
      stopPolling();
    };
  }, [id, stopPolling]);

  const handleShare = (): void => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- clipboard is undefined in some environments
    void navigator.clipboard?.writeText(window.location.href);
    toast.success('Link copied to clipboard');
  };

  if (loading || statusMessage) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-muted-foreground">{statusMessage ?? 'Loading analysis...'}</p>
        </div>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">This analysis has expired</h1>
        <p className="mt-2 text-muted-foreground">
          Analysis results are temporary and may have been removed.
        </p>
        <Button asChild className="mt-6">
          <Link to="/analyze">Analyze a New Yard</Link>
        </Button>
      </main>
    );
  }

  if (error || !analysis) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error ?? 'An unexpected error occurred.'}</AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/analyze">Analyze Another Yard</Link>
        </Button>
      </main>
    );
  }

  const { result, photoUrl, address } = analysis;
  const grouped = groupByCategory(result.recommendations);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {/* Actions */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Your Yard Analysis</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleShare}>
            <Share2 className="size-4" />
            Share
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/analyze">Analyze Another Yard</Link>
          </Button>
        </div>
      </div>

      {/* Photo + Summary */}
      <section className="mb-8 grid gap-6 md:grid-cols-2">
        <div className="overflow-hidden rounded-xl">
          <img src={photoUrl} alt="Uploaded yard" className="h-full w-full object-cover" />
        </div>
        <div className="space-y-4">
          <p className="text-muted-foreground">{result.summary}</p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{result.yardSize} yard</Badge>
            <Badge variant="secondary">
              {SUN_LABELS[result.overallSunExposure] ?? result.overallSunExposure}
            </Badge>
            <Badge variant="secondary">{result.estimatedSoilType} soil</Badge>
            <Badge variant="secondary">Zone {address.zone}</Badge>
          </div>
        </div>
      </section>

      {/* Identified Features */}
      <section className="mb-8">
        <h2 className="mb-4 text-xl font-semibold">Identified Features</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {result.features.map((feature) => (
            <div key={feature.id} className="flex items-start gap-3 rounded-lg border p-3">
              <span className="mt-0.5 text-muted-foreground">
                {FEATURE_ICONS[feature.type] ?? <CircleDot className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{feature.label}</span>
                  <Badge
                    variant={CONFIDENCE_VARIANT[feature.confidence] ?? 'outline'}
                    className="text-[10px]"
                  >
                    {feature.confidence}
                  </Badge>
                </div>
                {feature.species && (
                  <p className="text-sm italic text-muted-foreground">{feature.species}</p>
                )}
                {feature.notes && (
                  <p className="mt-1 text-sm text-muted-foreground">{feature.notes}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Plant Recommendations */}
      <section>
        <h2 className="mb-4 text-xl font-semibold">Plant Recommendations</h2>
        {Array.from(grouped.entries()).map(([category, recs]) => {
          const config = CATEGORY_CONFIG[category];
          return (
            <div key={category} className="mb-8">
              <h3 className="text-lg font-semibold">{config?.label ?? category}</h3>
              {config?.description && (
                <p className="mb-3 text-sm text-muted-foreground">{config.description}</p>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {recs.map((rec) => (
                  <PlantCard
                    key={rec.plantId}
                    id={rec.plantId}
                    commonName={rec.commonName}
                    scientificName={rec.scientificName}
                    photoUrl={rec.photoUrl}
                    reason={rec.reason}
                    light={rec.light}
                    waterNeeds={rec.waterNeeds}
                    difficulty={rec.difficulty}
                    zoneMin={rec.hardinessZones.min}
                    zoneMax={rec.hardinessZones.max}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
