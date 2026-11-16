import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { captureDescribedError, initServerSentry } from "./lib/observability/sentry";

void initServerSentry();

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const captured = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(captured);
  captureDescribedError(captured, { boundary: "ssr_h3_swallowed" });
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Integration server-delegates — before TanStack router.
      const url = new URL(request.url);
      if (url.pathname === "/api/cron/sync-interview-rsvp") {
        const { handleInterviewRsvpCronRequest } = await import(
          "./lib/integrations/interview-rsvp-sync.run"
        );
        return handleInterviewRsvpCronRequest(request);
      }
      if (url.pathname === "/api/cron/renew-google-calendar-watch") {
        const { handleGoogleCalendarWatchRenewRequest } = await import(
          "./lib/integrations/google-calendar-watch-renew"
        );
        return handleGoogleCalendarWatchRenewRequest(request);
      }
      if (url.pathname === "/api/webhooks/google-calendar") {
        const { handleGoogleCalendarWebhookRequest } = await import(
          "./lib/integrations/google-calendar-webhook"
        );
        return handleGoogleCalendarWebhookRequest(request);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      captureDescribedError(error, { boundary: "ssr_fetch" });
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
