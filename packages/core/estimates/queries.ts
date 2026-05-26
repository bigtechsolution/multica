import { queryOptions } from "@tanstack/react-query";

import { api } from "../api";
import type { ListEstimatesParams } from "../types";

// Workspace-scoped query keys for architecture cost estimates (Stage J).
// Every key starts with `wsId` so switching workspaces flips the whole
// cache subtree automatically — no manual invalidation needed.
export const estimateKeys = {
  all: (wsId: string) => ["estimates", wsId] as const,
  list: (wsId: string, params: ListEstimatesQueryParams = {}) =>
    [...estimateKeys.all(wsId), "list", params] as const,
};

/** Subset of ListEstimatesParams that the hook accepts. workspace_id is
 *  derived from the wsId arg, not passed in by callers. */
export type ListEstimatesQueryParams = Pick<ListEstimatesParams, "limit" | "offset">;

export function estimateListOptions(
  wsId: string,
  params: ListEstimatesQueryParams = {},
) {
  return queryOptions({
    queryKey: estimateKeys.list(wsId, params),
    queryFn: () =>
      api.listEstimates({
        workspace_id: wsId,
        limit: params.limit,
        offset: params.offset,
      }),
    // Estimates are cheap to refetch but rarely change — a short stale
    // window is fine. The Cost Trend page mounts once per visit.
    staleTime: 30_000,
  });
}
