/**
 * Lightweight markdown-ish renderer for assistant answers.
 * Supports paragraphs, **bold**, and simple -/* list lines. No HTML injection.
 */

type Segment = { type: "text" | "bold"; value: string };

function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ type: "text", value: text.slice(last, match.index) });
    }
    segments.push({ type: "bold", value: match[1] ?? "" });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments.length ? segments : [{ type: "text", value: text }];
}

function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((seg, i) =>
        seg.type === "bold" ? (
          <strong key={i} className="font-semibold text-foreground">
            {seg.value}
          </strong>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </>
  );
}

export function AssistantMarkdown({ text }: { text: string }) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;

  const lines = normalized.split("\n");
  const blocks: Array<{ type: "p" | "ul"; lines: string[] }> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (/^[-*•]\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length) {
        const cur = (lines[i] ?? "").trim();
        if (!cur) break;
        if (!/^[-*•]\s+/.test(cur)) break;
        items.push(cur.replace(/^[-*•]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", lines: items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? "";
      if (!cur.trim()) break;
      if (/^[-*•]\s+/.test(cur.trim())) break;
      para.push(cur);
      i += 1;
    }
    blocks.push({ type: "p", lines: para });
  }

  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground">
      {blocks.map((block, bi) =>
        block.type === "ul" ? (
          <ul key={bi} className="list-disc space-y-1.5 pl-5">
            {block.lines.map((item, li) => (
              <li key={li}>
                <InlineText text={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={bi}>
            {block.lines.map((line, li) => (
              <span key={li}>
                {li > 0 ? <br /> : null}
                <InlineText text={line} />
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
