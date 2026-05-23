import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { issueKeys } from "./queries";
import { useWorkspaceId } from "../hooks";
import type { Issue } from "../types";

/**
 * Per-issue Layer-3 LLM routing override. Maps to issue.metadata.llm_override
 * on the server; resolver reads it at dispatch and forces the agent to run
 * on a runtime of the chosen class — overriding both the agent's L1 default
 * and the workspace's L2 policy.
 *
 * "default" means "no override" — the row is cleared via DELETE.
 */
export type LLMOverride = "default" | "local" | "cloud";

const METADATA_KEY = "llm_override";

export function readLLMOverride(issue: Issue | undefined): LLMOverride {
  const raw = issue?.metadata?.[METADATA_KEY];
  if (raw === "local" || raw === "cloud") return raw;
  return "default";
}

export function useSetIssueLLMOverride(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (next: LLMOverride) => {
      if (next === "default") {
        await api.deleteIssueMetadata(issueId, METADATA_KEY);
      } else {
        await api.setIssueMetadata(issueId, METADATA_KEY, next);
      }
      return next;
    },
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: issueKeys.detail(wsId, issueId) });
      const prev = qc.getQueryData<Issue>(issueKeys.detail(wsId, issueId));
      if (prev) {
        const nextMetadata = { ...(prev.metadata ?? {}) };
        if (next === "default") {
          delete nextMetadata[METADATA_KEY];
        } else {
          nextMetadata[METADATA_KEY] = next;
        }
        qc.setQueryData<Issue>(issueKeys.detail(wsId, issueId), {
          ...prev,
          metadata: nextMetadata,
        });
      }
      return { prev };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.prev) qc.setQueryData(issueKeys.detail(wsId, issueId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.detail(wsId, issueId) });
    },
  });
}
