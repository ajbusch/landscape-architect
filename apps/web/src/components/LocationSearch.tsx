import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { MapPin, X, Loader2 } from 'lucide-react';

export interface LocationData {
  latitude: number | null;
  longitude: number | null;
  locationName: string;
}

interface LocationSearchProps {
  location: LocationData | null;
  onLocationChange: (location: LocationData | null) => void;
  disabled?: boolean;
  onSubmit?: () => void;
}

function isGooglePlacesLoaded(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- google is only defined after script loads
  return typeof google !== 'undefined' && google.maps?.places !== undefined;
}

function loadGooglePlaces(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isGooglePlacesLoaded()) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.async = true;
    script.onload = (): void => {
      resolve();
    };
    script.onerror = (): void => {
      reject(new Error('Failed to load Google Places'));
    };
    document.head.appendChild(script);
  });
}

export function LocationSearch({
  location,
  onLocationChange,
  disabled,
  onSubmit,
}: LocationSearchProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [placesAvailable, setPlacesAvailable] = useState<boolean | null>(null);
  const [inputValue, setInputValue] = useState('');

  // Load Google Places on mount
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      setPlacesAvailable(false);
      return;
    }

    loadGooglePlaces(apiKey)
      .then(() => {
        setPlacesAvailable(true);
      })
      .catch(() => {
        setPlacesAvailable(false);
      });
  }, []);

  // Attach autocomplete once Places is loaded and input is mounted
  useEffect(() => {
    if (!placesAvailable || !inputRef.current || autocompleteRef.current) return;

    const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
      types: ['(regions)'],
    });

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place.geometry?.location) {
        // User pressed Enter without selecting — treat as fallback
        return;
      }

      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const name = place.formatted_address ?? place.name ?? '';

      if (name) {
        onLocationChange({
          latitude: lat,
          longitude: lng,
          locationName: name,
        });
        setInputValue(name);
      }
    });

    autocompleteRef.current = autocomplete;
  }, [placesAvailable, onLocationChange]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
      // Clear selected location when user types
      if (location) {
        onLocationChange(null);
      }
    },
    [location, onLocationChange],
  );

  const handleBlur = useCallback(() => {
    // If user typed something but didn't select from Places dropdown, use fallback
    const trimmed = inputValue.trim();
    if (trimmed && !location) {
      onLocationChange({
        latitude: null,
        longitude: null,
        locationName: trimmed,
      });
    }
  }, [inputValue, location, onLocationChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // If no location selected yet, use fallback with typed text
        const trimmed = inputValue.trim();
        if (!location && trimmed) {
          onLocationChange({
            latitude: null,
            longitude: null,
            locationName: trimmed,
          });
        }
        onSubmit?.();
      }
    },
    [inputValue, location, onLocationChange, onSubmit],
  );

  const handleClear = useCallback(() => {
    onLocationChange(null);
    setInputValue('');
    inputRef.current?.focus();
  }, [onLocationChange]);

  const showConfirmed = location !== null;

  return (
    <div className="space-y-2">
      <Label htmlFor="location-search">Location</Label>
      <div className="relative">
        <Input
          ref={inputRef}
          id="location-search"
          type="text"
          placeholder="e.g. Charlotte, North Carolina"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-describedby={showConfirmed ? 'location-confirmed' : undefined}
          className="pr-10"
        />
        {placesAvailable === null && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {showConfirmed && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-1 top-1/2 -translate-y-1/2"
            onClick={handleClear}
            aria-label="Clear location"
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      {showConfirmed && (
        <p id="location-confirmed" className="flex items-center gap-1 text-sm text-emerald-600">
          <MapPin className="size-3.5" />
          {location.locationName}
          {location.latitude === null && (
            <span className="text-xs text-muted-foreground">(approximate)</span>
          )}
        </p>
      )}
      {placesAvailable === false && (
        <p className="text-xs text-muted-foreground">
          Type your city or region name. Suggestions are unavailable.
        </p>
      )}
    </div>
  );
}
