/**
 * Display helpers for seeker assistant chat — never show raw job UUIDs in the UI.
 */

const JOB_UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

const CONFIRM_JOB_UUID_RE =
  /Please confirm apply to job\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/gi;

/** Strip UUIDs and normalize confirm-apply lines for user-visible chat bubbles. */
export function formatSeekerChatUserQuestion(
  question: string,
  jobTitleById?: ReadonlyMap<string, string> | Record<string, string> | null,
): string {
  const raw = question.trim();
  if (!raw) return "";

  const lookup = (id: string): string | undefined => {
    if (!jobTitleById) return undefined;
    if (jobTitleById instanceof Map) return jobTitleById.get(id);
    return jobTitleById[id];
  };

  // Prefer the last confirm line — older Confirm dumps packed prior turns + UUID.
  const confirms = [...raw.matchAll(CONFIRM_JOB_UUID_RE)];
  if (confirms.length > 0) {
    const id = confirms[confirms.length - 1]![1]!;
    const title = lookup(id)?.trim();
    return title ? `Please confirm apply to ${title}` : "Please confirm apply";
  }

  // "Please confirm apply to Software Developer" (already titled) — keep the last such line.
  const titledConfirm = [
    ...raw.matchAll(/Please confirm apply to\s+([^\n]+)/gi),
  ];
  if (titledConfirm.length > 0) {
    const title = titledConfirm[titledConfirm.length - 1]![1]?.trim() ?? "";
    // Reset lastIndex — JOB_UUID_RE is global.
    JOB_UUID_RE.lastIndex = 0;
    if (title && !JOB_UUID_RE.test(title)) {
      return `Please confirm apply to ${title}`;
    }
  }

  return raw
    .replace(JOB_UUID_RE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** Remove UUIDs from text used as conversationContext (identity hints stay). */
export function stripJobUuidsFromText(text: string): string {
  return text
    .replace(CONFIRM_JOB_UUID_RE, "Please confirm apply")
    .replace(JOB_UUID_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
