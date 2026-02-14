import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import type { PlantSearchResponse } from '@landscape-architect/shared';
import { searchPlants } from '@/services/api';
import { PlantCard } from '@/components/PlantCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Loader2, Search, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';

const LIGHT_OPTIONS = [
  { value: 'full_sun', label: 'Full Sun' },
  { value: 'partial_shade', label: 'Partial Shade' },
  { value: 'full_shade', label: 'Full Shade' },
] as const;

const TYPE_OPTIONS = [
  { value: 'tree', label: 'Tree' },
  { value: 'shrub', label: 'Shrub' },
  { value: 'perennial', label: 'Perennial' },
  { value: 'grass', label: 'Grass' },
  { value: 'groundcover', label: 'Groundcover' },
  { value: 'vine', label: 'Vine' },
] as const;

const DIFFICULTY_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
] as const;

function getParam(params: URLSearchParams, key: string): string {
  return params.get(key) ?? '';
}

function getBoolParam(params: URLSearchParams, key: string): boolean {
  return params.get(key) === 'true';
}

export function PlantsPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<PlantSearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const zone = getParam(searchParams, 'zone');
  const light = getParam(searchParams, 'light');
  const type = getParam(searchParams, 'type');
  const difficulty = getParam(searchParams, 'difficulty');
  const isNative = getBoolParam(searchParams, 'isNative');
  const deerResistant = getBoolParam(searchParams, 'deerResistant');
  const droughtTolerant = getBoolParam(searchParams, 'droughtTolerant');
  const page = Number(searchParams.get('page') ?? '1');

  const fetchPlants = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Record<string, string> = {};
    if (zone) params.zone = zone;
    if (light) params.light = light;
    if (type) params.type = type;
    if (difficulty) params.difficulty = difficulty;
    if (isNative) params.isNative = 'true';
    if (deerResistant) params.deerResistant = 'true';
    if (droughtTolerant) params.droughtTolerant = 'true';
    if (page > 1) params.page = String(page);

    searchPlants(params)
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load plants. Please try again.');
        setLoading(false);
      });
  }, [zone, light, type, difficulty, isNative, deerResistant, droughtTolerant, page]);

  useEffect(() => {
    fetchPlants();
  }, [fetchPlants]);

  const updateFilter = (key: string, value: string | boolean): void => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === '' || value === false) {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  };

  const resetFilters = (): void => {
    setSearchParams({}, { replace: true });
  };

  const goToPage = (p: number): void => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (p <= 1) {
          next.delete('page');
        } else {
          next.set('page', String(p));
        }
        return next;
      },
      { replace: true },
    );
  };

  const hasFilters =
    zone !== '' ||
    light !== '' ||
    type !== '' ||
    difficulty !== '' ||
    isNative ||
    deerResistant ||
    droughtTolerant;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Browse Plants</h1>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Filters sidebar */}
        <aside className="w-full shrink-0 space-y-6 lg:w-64">
          {/* Zone */}
          <div className="space-y-2">
            <Label htmlFor="zone-filter">USDA Zone</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                id="zone-filter"
                placeholder="e.g. 7b"
                className="pl-8"
                value={zone}
                onChange={(e) => {
                  updateFilter('zone', e.target.value);
                }}
              />
            </div>
          </div>

          {/* Light */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Light</legend>
            {LIGHT_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2">
                <Checkbox
                  checked={light === opt.value}
                  onCheckedChange={(checked) => {
                    updateFilter('light', checked ? opt.value : '');
                  }}
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </fieldset>

          {/* Type */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Type</legend>
            {TYPE_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2">
                <Checkbox
                  checked={type === opt.value}
                  onCheckedChange={(checked) => {
                    updateFilter('type', checked ? opt.value : '');
                  }}
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </fieldset>

          {/* Difficulty */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Difficulty</legend>
            {DIFFICULTY_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2">
                <Checkbox
                  checked={difficulty === opt.value}
                  onCheckedChange={(checked) => {
                    updateFilter('difficulty', checked ? opt.value : '');
                  }}
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </fieldset>

          {/* Toggles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="native-toggle">Native only</Label>
              <Switch
                id="native-toggle"
                checked={isNative}
                onCheckedChange={(checked) => {
                  updateFilter('isNative', checked);
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="deer-toggle">Deer resistant</Label>
              <Switch
                id="deer-toggle"
                checked={deerResistant}
                onCheckedChange={(checked) => {
                  updateFilter('deerResistant', checked);
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="drought-toggle">Drought tolerant</Label>
              <Switch
                id="drought-toggle"
                checked={droughtTolerant}
                onCheckedChange={(checked) => {
                  updateFilter('droughtTolerant', checked);
                }}
              />
            </div>
          </div>

          {/* Reset */}
          {hasFilters && (
            <Button variant="outline" size="sm" className="w-full" onClick={resetFilters}>
              <RotateCcw className="size-4" />
              Reset Filters
            </Button>
          )}
        </aside>

        {/* Results area */}
        <div className="min-w-0 flex-1">
          {loading && (
            <div className="flex min-h-[30vh] items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="size-8 animate-spin text-primary" />
                <p className="text-muted-foreground">Loading plants...</p>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="flex min-h-[30vh] flex-col items-center justify-center gap-4">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" onClick={fetchPlants}>
                Try Again
              </Button>
            </div>
          )}

          {!loading && !error && data?.plants.length === 0 && (
            <div className="flex min-h-[30vh] flex-col items-center justify-center gap-4">
              <p className="text-muted-foreground">No plants match your filters</p>
              {hasFilters && (
                <Button variant="outline" onClick={resetFilters}>
                  <RotateCcw className="size-4" />
                  Reset Filters
                </Button>
              )}
            </div>
          )}

          {!loading && !error && data && data.plants.length > 0 && (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                {data.total} {data.total === 1 ? 'plant' : 'plants'} found
              </p>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {data.plants.map((plant) => (
                  <PlantCard
                    key={plant.id}
                    id={plant.id}
                    commonName={plant.commonName}
                    scientificName={plant.scientificName}
                    photoUrl={plant.photoUrl}
                    light={plant.light[0] ?? 'full_sun'}
                    waterNeeds={plant.waterNeeds}
                    difficulty={plant.difficulty}
                    zoneMin={plant.zoneMin}
                    zoneMax={plant.zoneMax}
                  />
                ))}
              </div>

              {/* Pagination */}
              {data.totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => {
                      goToPage(page - 1);
                    }}
                  >
                    <ChevronLeft className="size-4" />
                    Previous
                  </Button>
                  <span className="px-3 text-sm text-muted-foreground">
                    Page {data.page} of {data.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= data.totalPages}
                    onClick={() => {
                      goToPage(page + 1);
                    }}
                  >
                    Next
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
