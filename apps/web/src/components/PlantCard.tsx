import { Link } from 'react-router';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sun, Droplets, Gauge, Thermometer, Leaf } from 'lucide-react';

const LIGHT_LABELS: Record<string, string> = {
  full_sun: 'Full Sun',
  partial_shade: 'Partial Shade',
  full_shade: 'Full Shade',
};

const WATER_LABELS: Record<string, string> = {
  low: 'Low Water',
  moderate: 'Moderate Water',
  high: 'High Water',
};

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export interface PlantCardProps {
  id: string;
  commonName: string;
  scientificName: string;
  photoUrl?: string;
  reason?: string;
  light: string;
  waterNeeds: string;
  difficulty: string;
  zoneMin: string;
  zoneMax: string;
}

export function PlantCard({
  id,
  commonName,
  scientificName,
  photoUrl,
  reason,
  light,
  waterNeeds,
  difficulty,
  zoneMin,
  zoneMax,
}: PlantCardProps): React.JSX.Element {
  return (
    <Link to={`/plants/${id}`} className="block no-underline">
      <Card className="h-full transition-shadow hover:shadow-md">
        <div className="aspect-[4/3] overflow-hidden rounded-t-xl bg-muted">
          {photoUrl ? (
            <img src={photoUrl} alt={commonName} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Leaf className="size-12 text-muted-foreground/40" />
            </div>
          )}
        </div>
        <CardContent className="space-y-3 pt-4">
          <div>
            <h4 className="font-semibold">{commonName}</h4>
            <p className="text-sm italic text-muted-foreground">{scientificName}</p>
          </div>
          {reason && <p className="text-sm text-muted-foreground">{reason}</p>}
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="gap-1">
              <Sun className="size-3" />
              {LIGHT_LABELS[light] ?? light}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Droplets className="size-3" />
              {WATER_LABELS[waterNeeds] ?? waterNeeds}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Gauge className="size-3" />
              {DIFFICULTY_LABELS[difficulty] ?? difficulty}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Thermometer className="size-3" />
              {zoneMin}–{zoneMax}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
