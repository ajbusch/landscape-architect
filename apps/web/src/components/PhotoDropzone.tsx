import { useCallback, useRef, useState } from 'react';
import { Upload, X, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

interface PhotoDropzoneProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
  error?: string | null;
}

function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return 'File must be JPEG, PNG, or HEIC format.';
  }
  if (file.size > MAX_SIZE_BYTES) {
    return 'File must be under 20MB.';
  }
  return null;
}

export function PhotoDropzone({
  file,
  onFileChange,
  disabled,
  error,
}: PhotoDropzoneProps): React.JSX.Element {
  const [dragOver, setDragOver] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (selected: File) => {
      const err = validateFile(selected);
      if (err) {
        setValidationError(err);
        return;
      }
      setValidationError(null);
      onFileChange(selected);
      const url = URL.createObjectURL(selected);
      setPreview(url);
    },
    [onFileChange],
  );

  const handleRemove = useCallback(() => {
    onFileChange(null);
    setPreview(null);
    setValidationError(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }, [onFileChange]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const dropped = e.dataTransfer.files[0];
      if (dropped) handleFile(dropped);
    },
    [disabled, handleFile],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) setDragOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) handleFile(selected);
    },
    [handleFile],
  );

  const displayError = validationError ?? error;

  if (file && preview) {
    return (
      <div className="space-y-2">
        <div className="relative overflow-hidden rounded-lg border">
          <img src={preview} alt="Yard photo preview" className="h-64 w-full object-cover" />
          {!disabled && (
            <Button
              type="button"
              variant="destructive"
              size="icon-sm"
              className="absolute right-2 top-2"
              onClick={handleRemove}
              aria-label="Remove photo"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{file.name}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload photo"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors',
          dragOver && 'border-primary bg-primary/5',
          !dragOver &&
            !disabled &&
            'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
          disabled && 'cursor-not-allowed opacity-50',
          displayError && 'border-destructive',
        )}
      >
        {dragOver ? (
          <ImageIcon className="size-10 text-primary" />
        ) : (
          <Upload className="size-10 text-muted-foreground" />
        )}
        <div className="text-center">
          <p className="text-sm font-medium">
            {dragOver ? 'Drop your photo here' : 'Drag & drop your yard photo'}
          </p>
          <p className="text-xs text-muted-foreground">
            or click to browse. JPEG, PNG, or HEIC up to 20MB
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.heic,.heif"
        onChange={handleInputChange}
        className="hidden"
        disabled={disabled}
        data-testid="photo-input"
      />
      {displayError && (
        <p className="text-sm text-destructive" role="alert">
          {displayError}
        </p>
      )}
    </div>
  );
}
