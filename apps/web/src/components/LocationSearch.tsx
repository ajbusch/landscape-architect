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

function loadGoogleMaps(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- google is only defined after script loads
    if (typeof google !== 'undefined' && google.maps !== undefined) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="maps.googleapis.com"]',
    );
    if (existing) {
      existing.addEventListener('load', () => {
        resolve();
      });
      existing.addEventListener('error', () => {
        reject(new Error('Failed to load Google Maps'));
      });
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.onload = (): void => {
      resolve();
    };
    script.onerror = (): void => {
      reject(new Error('Failed to load Google Maps'));
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
  const containerRef = useRef<HTMLDivElement>(null);
  const pacRef = useRef<google.maps.places.PlaceAutocompleteElement | null>(null);
  const [placesAvailable, setPlacesAvailable] = useState<boolean | null>(null);
  const [resetKey, setResetKey] = useState(0);

  // Fallback mode state
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');

  // Load Google Maps + Places library on mount
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      setPlacesAvailable(false);
      return;
    }

    loadGoogleMaps(apiKey)
      .then(() => google.maps.importLibrary('places'))
      .then(() => {
        setPlacesAvailable(true);
      })
      .catch(() => {
        setPlacesAvailable(false);
      });
  }, []);

  // Store latest onLocationChange in a ref to avoid re-creating the element on callback changes
  const onLocationChangeRef = useRef(onLocationChange);
  onLocationChangeRef.current = onLocationChange;

  // Create and mount PlaceAutocompleteElement
  useEffect(() => {
    if (!placesAvailable || !containerRef.current) return;

    // Clean up previous element
    if (pacRef.current && containerRef.current.contains(pacRef.current)) {
      containerRef.current.removeChild(pacRef.current);
    }
    pacRef.current = null;

    const pac = new google.maps.places.PlaceAutocompleteElement({
      types: ['(regions)'],
    });

    pac.addEventListener('gmp-select', ((
      event: Event & { placePrediction: google.maps.places.PlacePrediction },
    ) => {
      const prediction = event.placePrediction;
      const place = prediction.toPlace();

      void place
        .fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] })
        .then(({ place: fetched }) => {
          const loc = fetched.location;
          let lat: number | null = null;
          let lng: number | null = null;
          if (loc) {
            lat = 'lat' in loc && typeof loc.lat === 'function' ? loc.lat() : null;
            lng = 'lng' in loc && typeof loc.lng === 'function' ? loc.lng() : null;
          }
          const name = fetched.formattedAddress ?? fetched.displayName ?? '';

          if (name) {
            onLocationChangeRef.current({
              latitude: lat,
              longitude: lng,
              locationName: name,
            });
          }
        })
        .catch(() => {
          // fetchFields failed — fall back to the prediction text
          const name = prediction.text.text;
          if (name) {
            onLocationChangeRef.current({
              latitude: null,
              longitude: null,
              locationName: name,
            });
          }
        });
    }) as EventListener);

    containerRef.current.appendChild(pac);
    pacRef.current = pac;

    return (): void => {
      if (pacRef.current?.parentElement) {
        pacRef.current.parentElement.removeChild(pacRef.current);
      }
      pacRef.current = null;
    };
  }, [placesAvailable, resetKey]);

  // Fallback handlers (same as original)
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
      if (location) {
        onLocationChange(null);
      }
    },
    [location, onLocationChange],
  );

  const handleBlur = useCallback(() => {
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
    if (placesAvailable) {
      // Re-create the PlaceAutocompleteElement (no official clear API)
      setResetKey((k) => k + 1);
    } else {
      setInputValue('');
      fallbackInputRef.current?.focus();
    }
  }, [onLocationChange, placesAvailable]);

  const showConfirmed = location !== null;

  return (
    <div className="space-y-2">
      <Label htmlFor="location-search">Location</Label>

      {/* Loading state */}
      {placesAvailable === null && (
        <div className="relative">
          <div className="border-input h-9 w-full rounded-md border bg-transparent px-3 py-1">
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Places mode */}
      {placesAvailable === true && (
        <div className="relative">
          <div
            ref={containerRef}
            data-testid="location-search-places"
            className={`location-search-places${showConfirmed ? ' hidden' : ''}${disabled ? ' pointer-events-none opacity-50' : ''}`}
          />
          {showConfirmed && (
            <div className="border-input flex h-9 w-full items-center rounded-md border bg-transparent px-3 py-1 text-sm">
              <span className="truncate">{location.locationName}</span>
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto shrink-0"
                  onClick={handleClear}
                  aria-label="Clear location"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Fallback mode */}
      {placesAvailable === false && (
        <div className="relative">
          <Input
            ref={fallbackInputRef}
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
      )}

      {showConfirmed && (
        <p id="location-confirmed" className="flex items-center gap-1 text-sm text-emerald-600">
          <MapPin className="size-3.5" />
          {location.locationName}
          {location.latitude === null && (
            <span className="text-xs text-muted-foreground">(approximate)</span>
          )}
        </p>
      )}
      {placesAvailable === false && !showConfirmed && (
        <p className="text-xs text-muted-foreground">
          Type your city or region name. Suggestions are unavailable.
        </p>
      )}
    </div>
  );
}
