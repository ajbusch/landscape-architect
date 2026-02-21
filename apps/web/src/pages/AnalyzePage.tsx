import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { PhotoDropzone } from '@/components/PhotoDropzone';
import { LocationSearch } from '@/components/LocationSearch';
import type { LocationData } from '@/components/LocationSearch';
import { submitAnalysis, pollAnalysis, ApiError } from '@/services/api';
import { Loader2, AlertCircle, X } from 'lucide-react';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

const STATUS_MESSAGES: Record<string, string> = {
  pending: 'Starting analysis...',
  analyzing: 'Analyzing your yard...',
  matching: 'Finding the perfect plants for you...',
};

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      default:
        return err.message || 'Something went wrong. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

export function AnalyzePage(): React.JSX.Element {
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<File | null>(null);
  const [location, setLocation] = useState<LocationData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const canSubmit = photo !== null && location !== null && !submitting && !polling;
  const isProcessing = submitting || polling;

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    setPolling(false);
    setStatusMessage(null);
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    stopPolling();
    setSubmitting(false);
    setError(null);
  }, [stopPolling]);

  const startPolling = useCallback(
    (analysisId: string) => {
      setPolling(true);
      setStatusMessage(STATUS_MESSAGES.pending ?? 'Processing...');
      cancelledRef.current = false;

      pollIntervalRef.current = setInterval(() => {
        if (cancelledRef.current) return;

        void pollAnalysis(analysisId)
          .then((analysis) => {
            if (cancelledRef.current) return;

            switch (analysis.status) {
              case 'pending':
              case 'analyzing':
              case 'matching':
                setStatusMessage(STATUS_MESSAGES[analysis.status] ?? 'Processing...');
                break;
              case 'complete':
                stopPolling();
                void navigate(`/analyze/${analysisId}`);
                break;
              case 'failed':
                stopPolling();
                setError(analysis.error ?? 'Analysis failed. Please try again.');
                break;
            }
          })
          .catch((err: unknown) => {
            if (cancelledRef.current) return;
            stopPolling();
            setError(getErrorMessage(err));
          });
      }, POLL_INTERVAL_MS);

      // Safety timeout
      pollTimeoutRef.current = setTimeout(() => {
        if (!cancelledRef.current) {
          stopPolling();
          setError('Analysis is taking longer than expected. Please try again.');
        }
      }, POLL_TIMEOUT_MS);
    },
    [navigate, stopPolling],
  );

  const handleSubmit = useCallback(async () => {
    if (!photo || !location) return;

    setSubmitting(true);
    setError(null);
    cancelledRef.current = false;

    try {
      const { id } = await submitAnalysis(
        photo,
        location.latitude,
        location.longitude,
        location.locationName,
      );
      setSubmitting(false);
      startPolling(id);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      setSubmitting(false);
    }
  }, [photo, location, startPolling]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Analyze Your Yard</CardTitle>
          <CardDescription>
            Upload a photo of your yard and enter your location to get personalized plant
            recommendations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-medium">Yard Photo</p>
            <PhotoDropzone file={photo} onFileChange={setPhoto} disabled={isProcessing} />
          </div>

          <LocationSearch
            location={location}
            onLocationChange={setLocation}
            disabled={isProcessing}
            onSubmit={() => void handleSubmit()}
          />

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {isProcessing ? (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted/50 p-4">
                <Loader2 className="size-5 animate-spin text-primary" />
                <span className="text-sm font-medium">
                  {statusMessage ?? 'Starting analysis...'}
                </span>
              </div>
              <Button variant="outline" className="w-full" onClick={handleCancel}>
                <X className="size-4" />
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              className="w-full"
              size="lg"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
            >
              Analyze My Yard
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
