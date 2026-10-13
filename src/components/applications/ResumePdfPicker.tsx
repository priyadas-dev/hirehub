import { useEffect, useId, useRef, useState } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  RESUME_PDF_ACCEPT,
  RESUME_PDF_PERSISTENCE_NOTE,
  removeResumeObject,
  uploadResumePdf,
  validateResumePdfFile,
} from "@/lib/resume-upload";
import { resolveDisplayUrl } from "@/lib/hirehub-storage";

export type ResumePickerValue = {
  storagePath: string | null;
  fileName: string | null;
  /** True when this value came from an application-only override upload. */
  isApplicationOverride?: boolean;
};

type ResumePdfPickerProps = {
  seekerId: string;
  canPersist?: boolean;
  /** Existing profile or application resume metadata. */
  initial?: ResumePickerValue | null;
  onChange?: (value: ResumePickerValue | null) => void;
  /** When true, removing only clears the override — does not delete profile file unless owned here. */
  applicationOverride?: boolean;
};

type UploadPhase = "idle" | "uploading" | "error" | "blocked";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ResumePdfPicker({
  seekerId,
  canPersist = false,
  initial = null,
  onChange,
  applicationOverride = false,
}: ResumePdfPickerProps) {
  const fileInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState<ResumePickerValue | null>(initial);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<UploadPhase>(canPersist ? "idle" : "blocked");
  const [progress, setProgress] = useState(0);
  const [viewUrl, setViewUrl] = useState<string | null>(null);

  useEffect(() => {
    setValue(initial);
  }, [initial?.storagePath, initial?.fileName]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!value?.storagePath) {
        setViewUrl(null);
        return;
      }
      try {
        const url = await resolveDisplayUrl(value.storagePath, "resume");
        if (!cancelled) setViewUrl(url);
      } catch {
        if (!cancelled) setViewUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value?.storagePath]);

  const emit = (next: ResumePickerValue | null) => {
    setValue(next);
    onChange?.(next);
  };

  const clearFile = async () => {
    setError(null);
    setLocalFile(null);
    setProgress(0);
    setPhase(canPersist ? "idle" : "blocked");
    if (fileRef.current) fileRef.current.value = "";

    const previous = value;
    emit(null);

    // Only delete Storage objects created as an application override from this picker.
    if (
      canPersist &&
      applicationOverride &&
      previous?.isApplicationOverride &&
      previous.storagePath
    ) {
      try {
        await removeResumeObject(previous.storagePath);
      } catch {
        /* best-effort cleanup */
      }
    }
  };

  const onFile = async (picked: File | undefined) => {
    if (!picked) return;
    const result = validateResumePdfFile(picked);
    if (!result.ok) {
      setError(result.error);
      setPhase("error");
      return;
    }

    setLocalFile(picked);
    setError(null);

    if (!canPersist) {
      setPhase("blocked");
      onChange?.({ storagePath: null, fileName: picked.name, isApplicationOverride: applicationOverride });
      return;
    }

    setPhase("uploading");
    setProgress(30);
    try {
      const uploaded = await uploadResumePdf(picked, seekerId);
      setProgress(100);
      setPhase("idle");
      emit({
        storagePath: uploaded.storagePath,
        fileName: uploaded.fileName,
        isApplicationOverride: applicationOverride,
      });
    } catch (e) {
      setPhase("error");
      setProgress(0);
      setError(e instanceof Error ? e.message : "Upload failed.");
    }
  };

  const displayName = value?.fileName || localFile?.name;

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-border/80 bg-surface/50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-signal-soft text-signal">
          <FileText className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {applicationOverride ? "Resume PDF for this application" : "Resume PDF"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {applicationOverride
              ? "Optional: upload a different PDF for this job only. Your profile resume stays unchanged."
              : "Upload one PDF to your profile (max 5 MB). It will be preselected when you apply."}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={fileInputId}>{applicationOverride ? "Override resume" : "Upload resume"}</Label>
        <input
          ref={fileRef}
          id={fileInputId}
          type="file"
          accept={RESUME_PDF_ACCEPT}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-signal-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-signal"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>

      {displayName && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
          <FileText className="size-4 shrink-0 text-signal" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium" title={displayName}>
            {displayName}
          </span>
          {localFile && <span className="text-xs text-muted-foreground">{formatBytes(localFile.size)}</span>}
          {viewUrl && (
            <a
              href={viewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-signal underline-offset-4 hover:underline"
            >
              Preview
            </a>
          )}
        </div>
      )}

      {phase === "uploading" && (
        <div className="space-y-1" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">Uploading… {progress}%</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload />
          {displayName ? "Replace" : "Choose PDF"}
        </Button>
        {displayName && (
          <Button type="button" variant="outline" size="sm" onClick={() => void clearFile()}>
            <Trash2 /> Remove
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {!canPersist && (
        <p className="rounded-lg border border-status-interview/30 bg-status-interview-soft/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {RESUME_PDF_PERSISTENCE_NOTE}
        </p>
      )}
    </div>
  );
}
