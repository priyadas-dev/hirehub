/**
 * Compatibility re-export.
 * Prefer `@/lib/integrations/deliver-application-integrations-after-notify`
 * so client code can import the createServerFn RPC stub without a `.server`
 * dynamic import (which fails silently in the browser).
 */
export {
  deliverApplicationIntegrationsAfterNotify,
  type DeliverApplicationIntegrationsAfterNotifyResult,
} from "@/lib/integrations/deliver-application-integrations-after-notify";
