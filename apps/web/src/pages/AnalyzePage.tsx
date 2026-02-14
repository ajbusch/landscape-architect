import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { ZipCodeSchema } from '@landscape-architect/shared';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { PhotoDropzone } from '@/components/PhotoDropzone';
import { ZipCodeInput } from '@/components/ZipCodeInput';
import { submitAnalysis, ApiError } from '@/services/api';
import { Loader2, AlertCircle } from 'lucide-react';

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 422:
        return 'This photo does not appear to be a yard or landscape. Please upload a photo of your outdoor space.';
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      case 504:
        return 'The analysis is taking too long. Please try again.';
      default:
        return err.message || 'Something went wrong. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

export function AnalyzePage(): React.JSX.Element {
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<File | null>(null);
  const [zipCode, setZipCode] = useState('');
  const [zone, setZone] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isZipValid = ZipCodeSchema.safeParse(zipCode).success;
  const canSubmit = photo !== null && zone !== null && isZipValid && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!photo || !isZipValid) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await submitAnalysis(photo, zipCode);
      void navigate(`/analyze/${result.id}`);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      setSubmitting(false);
    }
  }, [photo, isZipValid, zipCode, navigate]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Analyze Your Yard</CardTitle>
          <CardDescription>
            Upload a photo of your yard and enter your ZIP code to get personalized plant
            recommendations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-medium">Yard Photo</p>
            <PhotoDropzone file={photo} onFileChange={setPhoto} disabled={submitting} />
          </div>

          <ZipCodeInput
            value={zipCode}
            onChange={setZipCode}
            zone={zone}
            onZoneResolved={setZone}
            disabled={submitting}
          />

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            className="w-full"
            size="lg"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              'Analyze My Yard'
            )}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
