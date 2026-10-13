import { useEffect, useId, useRef, useState } from "react";
import { ImagePlus, Link2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COMPANY_IMAGE_ACCEPT,
  COMPANY_IMAGE_PERSISTENCE_NOTE,
  removeCompanyLogoObject,
  uploadCompanyLogo,
  validateCompanyImageFile,
  validateCompanyImageUrl,
} from "@/lib/company-image";
import { isStorageObjectPath, resolveDisplayUrl } from "@/lib/hirehub-storage";

type CompanyImagePickerProps = {
  canPersist?: boolean;
  companyId?: string | null;
  recruiterId?: string | null;
  /** Stored logo_url (path or https). */
  initialLogoUrl?: string | null;
  /** Called with the value to persist in companies.logo_url (path or https, never signed). */
  onLogoChange?: (logoUrl: string | null) => void;
};

export function CompanyImagePicker({
  canPersist = false,
  companyId = null,
  recruiterId = null,
  initialLogoUrl = null,
  onLogoChange,
}: CompanyImagePickerProps) {
  const fileInputId = useId();
  const urlInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [storedValue, setStoredValue] = useState<string | null>(initialLogoUrl);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [brokenPreview, setBrokenPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStoredValue(initialLogoUrl);
  }, [initialLogoUrl]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (objectUrl) {
        setPreviewUrl(objectUrl);
        return;
      }
      if (!storedValue) {
        setPreviewUrl(null);
        return;
      }
      try {
        const url = await resolveDisplayUrl(storedValue, "logo");
        if (!cancelled) setPreviewUrl(url);
      } catch {
        if (!cancelled) setPreviewUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storedValue, objectUrl]);

  const emit = (next: string | null) => {
    setStoredValue(next);
    onLogoChange?.(next);
  };

  const clearPreview = async () => {
    const previous = storedValue;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl(null);
    setPreviewUrl(null);
    setFileName(null);
    setBrokenPreview(false);
    setError(null);
    setUrlDraft("");
    if (fileRef.current) fileRef.current.value = "";
    emit(null);

    if (canPersist && previous && isStorageObjectPath(previous)) {
      try {
        await removeCompanyLogoObject(previous);
      } catch {
        /* best-effort */
      }
    }
  };

  const applyUrl = () => {
    const result = validateCompanyImageUrl(urlDraft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl(null);
    setFileName(null);
    setBrokenPreview(false);
    setError(null);
    setPreviewUrl(result.url);
    emit(result.url);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = async (file: File | undefined) => {
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
    setFileName(file.name);
    setUrlDraft("");
    setBrokenPreview(false);
    setError(null);

    if (!canPersist || !companyId || !recruiterId) {
      return;
    }

    setBusy(true);
    try {
      const previous = storedValue;
      const uploaded = await uploadCompanyLogo(file, companyId);
      emit(uploaded.storagePath);
      if (previous && isStorageObjectPath(previous) && previous !== uploaded.storagePath) {
        try {
          await removeCompanyLogoObject(previous);
        } catch {
          /* best-effort */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-dashed border-border/80 bg-surface/50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-signal-soft text-signal">
          <ImagePlus className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">Company logo</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Upload a JPEG, PNG, WebP, or GIF (max 2 MB), or paste an image URL. SVG is not allowed.
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
            <Label htmlFor={urlInputId}>Image URL (optional)</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={urlInputId}
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="https://…"
                inputMode="url"
              />
              <Button type="button" variant="outline" onClick={applyUrl} disabled={busy}>
                <Link2 /> Use URL
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
              disabled={busy || (canPersist && !companyId)}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-signal-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-signal"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            {canPersist && !companyId && (
              <p className="text-xs text-muted-foreground">Save the company profile first, then upload a logo.</p>
            )}
            {fileName && <p className="truncate text-xs text-muted-foreground">Selected: {fileName}</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || (canPersist && !companyId)}
              onClick={() => fileRef.current?.click()}
            >
              <Upload />
              {previewUrl ? "Replace" : "Choose file"}
            </Button>
            {previewUrl && (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void clearPreview()}>
                <Trash2 /> Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {busy && <p className="text-xs text-muted-foreground">Uploading logo…</p>}

      {!canPersist && (
        <p className="rounded-lg border border-status-interview/30 bg-status-interview-soft/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {COMPANY_IMAGE_PERSISTENCE_NOTE}
        </p>
      )}
    </div>
  );
}
