import { useCallback, useEffect, useState } from 'react';
import { ZipCodeSchema } from '@landscape-architect/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { lookupZone, ApiError } from '@/services/api';
import { Loader2 } from 'lucide-react';

interface ZipCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  zone: string | null;
  onZoneResolved: (zone: string | null) => void;
  disabled?: boolean;
  onSubmit?: () => void;
}

export function ZipCodeInput({
  value,
  onChange,
  zone,
  onZoneResolved,
  disabled,
  onSubmit,
}: ZipCodeInputProps): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/[^\d-]/g, '').slice(0, 10);
      onChange(raw);
      setError(null);
      onZoneResolved(null);
    },
    [onChange, onZoneResolved],
  );

  useEffect(() => {
    const result = ZipCodeSchema.safeParse(value);
    if (!result.success) {
      if (value.length >= 5) {
        setError('Enter a valid 5-digit ZIP code.');
      }
      return;
    }

    setError(null);
    setLoading(true);
    const controller = new AbortController();

    lookupZone(value)
      .then((res) => {
        if (!controller.signal.aborted) {
          onZoneResolved(`Zone ${res.zone}`);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLoading(false);
          if (err instanceof ApiError && err.status === 404) {
            setError('No zone data found for this ZIP code.');
          } else {
            setError('Could not look up zone. Try again.');
          }
          onZoneResolved(null);
        }
      });

    return () => {
      controller.abort();
    };
  }, [value, onZoneResolved]);

  return (
    <div className="space-y-2">
      <Label htmlFor="zip-code">ZIP Code</Label>
      <div className="relative">
        <Input
          id="zip-code"
          type="text"
          inputMode="numeric"
          placeholder="e.g. 28202"
          value={value}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit?.();
            }
          }}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'zip-error' : zone ? 'zip-zone' : undefined}
          className="pr-10"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {error && (
        <p id="zip-error" className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {zone && !error && (
        <p id="zip-zone" className="text-sm text-emerald-600">
          {zone}
        </p>
      )}
    </div>
  );
}
