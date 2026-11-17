import { describe, expect, it, vi } from "vitest";
import { fetchGeminiGeneratedText } from "@/lib/ai/gemini-generate";
import { GEMINI_ASSISTANT_MODEL } from "@/lib/ai/job-assistant";

describe("fetchGeminiGeneratedText", () => {
  it("uses the current Gemini Flash assistant model id", () => {
    expect(GEMINI_ASSISTANT_MODEL).toBe("gemini-3.8-flash");
  });

  it("maps retired/missing model (404 NOT_FOUND) to a clear config error", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              status: "NOT_FOUND",
              code: 404,
              message: "This model models/gemini-2.0-flash is no longer available.",
            },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
    );

    const result = await fetchGeminiGeneratedText("Hello", "test-key", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      model: "gemini-2.0-flash",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/model is unavailable/i);
    expect(result.category).toBe("config");
    expect(result.message).not.toMatch(/test-key|AIza|sk-/i);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("retries with a fallback model after transient 503 UNAVAILABLE", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Recovered answer." }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await fetchGeminiGeneratedText("Hello", "test-key", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      model: "gemini-3.8-flash",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("Recovered answer.");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls through to a lite model after primary timeout", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async () => {
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        throw err;
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Lite fallback answer." }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await fetchGeminiGeneratedText("What is React?", "test-key", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      model: "gemini-3.8-flash",
      timeoutMs: 50,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("Lite fallback answer.");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns generated text on success without echoing the api key", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Grounded answer." }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const result = await fetchGeminiGeneratedText("Question?", "secret-gemini-key", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({
      ok: true,
      text: "Grounded answer.",
      model: GEMINI_ASSISTANT_MODEL,
    });
    expect(JSON.stringify(result)).not.toContain("secret-gemini-key");

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? "{}")) as {
      generationConfig?: {
        thinkingConfig?: { thinkingLevel?: string };
        temperature?: unknown;
      };
    };
    // Gemini 3.8 Flash defaults to medium thinking — chat must force low for latency.
    expect(body.generationConfig?.thinkingConfig?.thinkingLevel).toBe("low");
    expect(body.generationConfig?.temperature).toBeUndefined();
  });

  it("maps AbortSignal timeout to timeout category and tries lite fallbacks", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    });

    const result = await fetchGeminiGeneratedText("Hello", "test-key", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.category).toBe("timeout");
    expect(result.message).toMatch(/took too long/i);
    // Primary + lite fallbacks all timed out.
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
  });

  it("accepts complete answers even when finishReason is MAX_TOKENS", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: "MAX_TOKENS",
                content: {
                  parts: [
                    {
                      text: "React is a JavaScript library for building user interfaces. It is commonly used for interactive web apps.",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const result = await fetchGeminiGeneratedText("What is React?", "test-key", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toMatch(/React is a JavaScript library/i);
  });

  it("rejects clearly truncated answers only when finishReason is MAX_TOKENS", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: "MAX_TOKENS",
                content: {
                  parts: [
                    {
                      text: "While our current context doesn't list specific details or active job openings for it, React",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const result = await fetchGeminiGeneratedText("What is React?", "test-key", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      model: "gemini-3.8-flash",
    });

    // Primary fails as empty/truncated; fallback may also fail the same way — either way not ok.
    expect(result.ok).toBe(false);
  });
});
