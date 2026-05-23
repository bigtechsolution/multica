"use client";

import { useEffect, useState } from "react";
import {
  readLLMOverride,
  useSetIssueLLMOverride,
  type LLMOverride,
} from "@multica/core/issues";
import type { Issue } from "@multica/core/types";

/**
 * Per-issue Layer-3 LLM routing picker. Three states: Default (no override),
 * Force Local (issue.metadata.llm_override = "local"), Force Cloud
 * (= "cloud"). The change takes effect on the next dispatch — this control
 * does NOT trigger a re-run. MCP-required agents silently keep their L1
 * default even when the user picks an opposing override (resolver logs
 * reason="mcp_required_skipped" on the routing_decision).
 */
export function LlmOverrideControl({ issue }: { issue: Issue }) {
  const current = readLLMOverride(issue);
  const setOverride = useSetIssueLLMOverride(issue.id);

  // Local mirror so the segmented control stays responsive even before the
  // optimistic cache update flushes — clicking a segment should highlight
  // instantly, no React-Query round trip.
  const [pending, setPending] = useState<LLMOverride | null>(null);
  useEffect(() => setPending(null), [current]);
  const value: LLMOverride = pending ?? current;

  const segments: { value: LLMOverride; label: string }[] = [
    { value: "default", label: "Default" },
    { value: "local", label: "Force Local" },
    { value: "cloud", label: "Force Cloud" },
  ];

  const onPick = (next: LLMOverride) => {
    if (next === value) return;
    setPending(next);
    setOverride.mutate(next, {
      onError: () => setPending(null),
    });
  };

  return (
    <div
      role="radiogroup"
      aria-label="LLM routing override"
      title="Applies on next dispatch. MCP-required agents silently keep their L1 default."
      className="inline-flex rounded-md border border-border/60 bg-background overflow-hidden"
    >
      {segments.map((s) => {
        const active = value === s.value;
        return (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(s.value)}
            disabled={setOverride.isPending && pending !== s.value}
            className={
              "px-2 py-0.5 text-[11px] font-medium transition-colors " +
              (active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground") +
              " disabled:opacity-50"
            }
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
