import { useEffect, useId, useRef, useState } from "react";
import { ImagePlus, Link2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COMPANY_IMAGE_ACCEPT,
  COMPANY_IMAGE_PERSISTENCE_NOTE,
  validateCompanyImageFile,
  validateCompanyImageUrl,
} from "@/lib/company-image";

type CompanyImagePickerProps = {
  /** When false (current HireHub schema), preview works but nothing is persisted. */
  canPersist?: boolean;
};

export function CompanyImagePicker({ canPersist = false }: CompanyImagePickerProps) {
  const fileInputId = useId();
  const urlInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [brokenPreview, setBrokenPreview] = useState(false);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const clearPreview = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl(null);
    setPreviewUrl(null);
    setBrokenPreview(false);
    setError(null);
    setUrlDraft("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const applyUrl = () => {
    const result = validateCompanyImageUrl(urlDraft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl(null);
    setBrokenPreview(false);
    setError(null);
    setPreviewUrl(result.url);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const result = validateCompanyImageFile(file);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const next = URL.createObjectURL(file);
    setObjectUrl(next);
    setPreviewUrl(next);
    setUrlDraft("");
    setBrokenPreview(false);
    setError(null);
  };

  return (
    <div className="space-y-4 rounded-xl border border-dashed border-border/80 bg-surface/50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-signal-soft text-signal">
          <ImagePlus className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">Company logo / cover image</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Preview an image from a URL or your device. File pickers work in the browser without extra app
            permissions.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-card">
          {previewUrl && !brokenPreview ? (
            <img
              src={previewUrl}
              alt="Company logo preview"
              className="size-full object-cover"
              onError={() => {
                setBrokenPreview(true);
                setError("Could not load that image. Check the URL or try another file.");
              }}
            />
          ) : (
            <span className="px-2 text-center text-xs text-muted-foreground">No image</span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-2">
            <Label htmlFor={urlInputId}>Image URL</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={urlInputId}
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="https://…"
                inputMode="url"
              />
              <Button type="button" variant="outline" onClick={applyUrl}>
                <Link2 /> Preview URL
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={fileInputId}>Upload from device</Label>
            <input
              ref={fileRef}
              id={fileInputId}
              type="file"
              accept={COMPANY_IMAGE_ACCEPT}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-signal-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-signal"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <p className="text-xs text-muted-foreground">JPEG, PNG, WebP, GIF, or SVG · max 2 MB</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload /> Choose file
            </Button>
            {previewUrl && (
              <Button type="button" variant="outline" size="sm" onClick={clearPreview}>
                <Trash2 /> Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {!canPersist && (
        <p className="rounded-lg border border-status-interview/30 bg-status-interview-soft/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {COMPANY_IMAGE_PERSISTENCE_NOTE}
        </p>
      )}
    </div>
  );
}
