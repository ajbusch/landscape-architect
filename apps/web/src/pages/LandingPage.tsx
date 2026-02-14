import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Camera,
  MapPin,
  Sparkles,
  TreeDeciduous,
  Sun,
  Droplets,
  Thermometer,
  ArrowRight,
  Leaf,
  Shrub,
  Flower2,
} from 'lucide-react';

const STEPS = [
  {
    icon: <Camera className="size-8" />,
    title: 'Upload a Photo',
    description: 'Snap a picture of your yard and upload it. We accept JPEG, PNG, and HEIC files.',
  },
  {
    icon: <MapPin className="size-8" />,
    title: 'Enter Your ZIP Code',
    description:
      "We'll look up your USDA hardiness zone so we recommend plants that thrive in your climate.",
  },
  {
    icon: <Sparkles className="size-8" />,
    title: 'Get Recommendations',
    description:
      'Our AI analyzes your yard and delivers personalized plant picks tailored to your space.',
  },
] as const;

const PREVIEW_FEATURES = [
  { icon: <TreeDeciduous className="size-4" />, label: 'Large Oak Tree', confidence: 'high' },
  { icon: <Shrub className="size-4" />, label: 'Boxwood Hedge', confidence: 'medium' },
  { icon: <Flower2 className="size-4" />, label: 'Front Garden Bed', confidence: 'high' },
] as const;

const PREVIEW_PLANTS = [
  {
    name: 'Black-Eyed Susan',
    scientific: 'Rudbeckia hirta',
    light: 'Full Sun',
    water: 'Low Water',
    zones: '3a–9b',
  },
  {
    name: 'Eastern Redbud',
    scientific: 'Cercis canadensis',
    light: 'Partial Shade',
    water: 'Moderate',
    zones: '4b–9a',
  },
  {
    name: 'Purple Coneflower',
    scientific: 'Echinacea purpurea',
    light: 'Full Sun',
    water: 'Low Water',
    zones: '3a–8b',
  },
] as const;

export function LandingPage(): React.JSX.Element {
  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-b from-green-50 to-background px-4 py-16 md:py-24">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl">
            Transform Your Yard with AI-Powered Plant Recommendations
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground md:text-xl">
            Upload a photo of your yard, enter your ZIP code, and get a personalized analysis with
            plant recommendations tailored to your climate, soil, and sunlight.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link to="/analyze">
              Analyze Your Yard
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* How It Works */}
      <section className="px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-3xl font-bold">How It Works</h2>
          <div className="grid gap-8 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.title} className="text-center">
                <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                  {step.icon}
                </div>
                <div className="mb-2 text-sm font-medium text-muted-foreground">
                  Step {String(i + 1)}
                </div>
                <h3 className="mb-2 text-xl font-semibold">{step.title}</h3>
                <p className="text-muted-foreground">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Preview */}
      <section className="bg-muted/50 px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-center text-3xl font-bold">See What You Get</h2>
          <p className="mx-auto mb-10 max-w-2xl text-center text-muted-foreground">
            Here&apos;s an example of the analysis and recommendations you&apos;ll receive for your
            yard.
          </p>

          {/* Mock summary */}
          <Card className="mb-6">
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Medium Yard</Badge>
                <Badge variant="secondary">Partial Shade</Badge>
                <Badge variant="secondary">Loamy Soil</Badge>
                <Badge variant="secondary">Zone 7b</Badge>
              </div>
              <p className="text-muted-foreground">
                A medium-sized backyard with good sun exposure and mature trees providing partial
                shade. The loamy soil is excellent for a wide variety of plants.
              </p>
            </CardContent>
          </Card>

          {/* Mock features */}
          <h3 className="mb-3 text-lg font-semibold">Identified Features</h3>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            {PREVIEW_FEATURES.map((f) => (
              <div
                key={f.label}
                className="flex items-center gap-3 rounded-lg border bg-background p-3"
              >
                <span className="text-muted-foreground">{f.icon}</span>
                <span className="font-medium">{f.label}</span>
                <Badge
                  variant={f.confidence === 'high' ? 'default' : 'secondary'}
                  className="ml-auto text-[10px]"
                >
                  {f.confidence}
                </Badge>
              </div>
            ))}
          </div>

          {/* Mock recommendations */}
          <h3 className="mb-3 text-lg font-semibold">Top Recommendations</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {PREVIEW_PLANTS.map((p) => (
              <Card key={p.name}>
                <div className="flex aspect-[4/3] items-center justify-center bg-muted">
                  <Leaf className="size-12 text-muted-foreground/40" />
                </div>
                <CardContent className="space-y-2 pt-4">
                  <div>
                    <h4 className="font-semibold">{p.name}</h4>
                    <p className="text-sm italic text-muted-foreground">{p.scientific}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Sun className="size-3" />
                      {p.light}
                    </Badge>
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Droplets className="size-3" />
                      {p.water}
                    </Badge>
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Thermometer className="size-3" />
                      {p.zones}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Browse Plants CTA */}
      <section className="px-4 py-16 text-center">
        <div className="mx-auto max-w-2xl">
          <Leaf className="mx-auto mb-4 size-12 text-primary" />
          <h2 className="text-3xl font-bold">Explore Our Plant Database</h2>
          <p className="mt-3 text-muted-foreground">
            Browse hundreds of plants filtered by your zone, light conditions, water needs, and
            more. Find the perfect plants for your yard.
          </p>
          <Button asChild variant="outline" size="lg" className="mt-6">
            <Link to="/plants">
              Browse Plants
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t px-4 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <p className="text-sm text-muted-foreground">Landscape Architect</p>
          <nav className="flex gap-6">
            <Link to="/plants" className="text-sm text-muted-foreground hover:text-foreground">
              Browse Plants
            </Link>
            <Link to="/analyze" className="text-sm text-muted-foreground hover:text-foreground">
              Analyze
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
