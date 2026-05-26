"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Button } from "@multica/ui/components/ui/button";
import { Card, CardContent } from "@multica/ui/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@multica/ui/components/ui/radio-group";
import { Switch } from "@multica/ui/components/ui/switch";
import { toast } from "sonner";
import { api } from "@multica/core/api";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentWorkspace } from "@multica/core/paths";
import {
  memberListOptions,
  workspaceKeys,
} from "@multica/core/workspace/queries";
import type {
  LLMPolicyMode,
  Workspace,
  WorkspaceSettings,
} from "@multica/core/types";
import { useT } from "../../i18n";

const POLICY_OPTIONS: LLMPolicyMode[] = ["hybrid", "local_only", "cloud_first"];

/**
 * Owner-only LLM routing & redaction controls. Edits workspace.settings via
 * PATCH /api/workspaces/:id, preserving any unknown keys the server has
 * stored. Non-owners see a read-only summary.
 *
 * Backed by the resolver in server/internal/llmpolicy/ — see
 * project_design_decisions.md §6 for the 3-layer model.
 */
export function LlmTab() {
  const { t } = useT("settings");
  const user = useAuthStore((s) => s.user);
  const workspace = useCurrentWorkspace();
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentMember = members.find((m) => m.user_id === user?.id) ?? null;
  const isOwner = currentMember?.role === "owner";

  const settings = (workspace?.settings ?? {}) as WorkspaceSettings;
  const [policy, setPolicy] = useState<LLMPolicyMode>(
    settings.llm_policy ?? "hybrid",
  );
  // Server default for redact_before_external is true when unset — surface
  // that default in the toggle so users see the live behaviour, not a
  // misleading "false".
  const [redact, setRedact] = useState<boolean>(
    settings.redact_before_external ?? true,
  );
  const [externalProvider, setExternalProvider] = useState<string>(
    settings.external_provider ?? "",
  );
  const [budget, setBudget] = useState<string>(
    settings.external_monthly_budget_usd != null
      ? String(settings.external_monthly_budget_usd)
      : "",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    const s = (workspace.settings ?? {}) as WorkspaceSettings;
    setPolicy(s.llm_policy ?? "hybrid");
    setRedact(s.redact_before_external ?? true);
    setExternalProvider(s.external_provider ?? "");
    setBudget(
      s.external_monthly_budget_usd != null
        ? String(s.external_monthly_budget_usd)
        : "",
    );
  }, [workspace]);

  const hasChanges = (() => {
    if (!workspace) return false;
    const s = (workspace.settings ?? {}) as WorkspaceSettings;
    if ((s.llm_policy ?? "hybrid") !== policy) return true;
    if ((s.redact_before_external ?? true) !== redact) return true;
    if ((s.external_provider ?? "") !== externalProvider.trim()) return true;
    const currentBudget =
      s.external_monthly_budget_usd != null
        ? String(s.external_monthly_budget_usd)
        : "";
    if (currentBudget !== budget.trim()) return true;
    return false;
  })();

  // Validate budget input — empty is allowed (treated as unset); non-empty
  // must be a non-negative number. Block save on invalid.
  const budgetTrimmed = budget.trim();
  const parsedBudget = budgetTrimmed === "" ? null : Number(budgetTrimmed);
  const budgetInvalid =
    budgetTrimmed !== "" &&
    (Number.isNaN(parsedBudget) || (parsedBudget as number) < 0);

  const handleSave = async () => {
    if (!workspace || !isOwner || budgetInvalid) return;
    setSaving(true);
    try {
      // Merge with existing settings to preserve unknown keys other
      // subsystems own. Strip empty / null values for keys with a meaningful
      // "unset" state so the JSONB column stays compact.
      const existing = (workspace.settings ?? {}) as WorkspaceSettings;
      const nextSettings: Record<string, unknown> = { ...existing };
      nextSettings.llm_policy = policy;
      nextSettings.redact_before_external = redact;
      if (externalProvider.trim() === "") {
        delete nextSettings.external_provider;
      } else {
        nextSettings.external_provider = externalProvider.trim();
      }
      if (parsedBudget == null) {
        delete nextSettings.external_monthly_budget_usd;
      } else {
        nextSettings.external_monthly_budget_usd = parsedBudget;
      }

      const updated = await api.updateWorkspace(workspace.id, {
        settings: nextSettings,
      });
      qc.setQueryData(workspaceKeys.list(), (old: Workspace[] | undefined) =>
        old?.map((ws) => (ws.id === updated.id ? updated : ws)),
      );
      toast.success(t(($) => $.llm.toast_saved));
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t(($) => $.llm.toast_save_failed),
      );
    } finally {
      setSaving(false);
    }
  };

  if (!workspace) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">{t(($) => $.llm.section_title)}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t(($) => $.llm.section_description)}
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-6">
          <div>
            <Label className="text-sm font-medium">{t(($) => $.llm.policy_label)}</Label>
            <p className="text-xs text-muted-foreground mt-1 mb-3">
              {t(($) => $.llm.policy_help)}
            </p>
            <RadioGroup
              value={policy}
              onValueChange={(next) => {
                if (typeof next === "string" && POLICY_OPTIONS.includes(next as LLMPolicyMode)) {
                  setPolicy(next as LLMPolicyMode);
                }
              }}
              disabled={!isOwner}
              className="gap-3"
            >
              {POLICY_OPTIONS.map((p) => {
                let title: string;
                let desc: string;
                if (p === "hybrid") {
                  title = t(($) => $.llm.policy_hybrid_title);
                  desc = t(($) => $.llm.policy_hybrid_description);
                } else if (p === "local_only") {
                  title = t(($) => $.llm.policy_local_only_title);
                  desc = t(($) => $.llm.policy_local_only_description);
                } else {
                  title = t(($) => $.llm.policy_cloud_first_title);
                  desc = t(($) => $.llm.policy_cloud_first_description);
                }
                return (
                  <label
                    key={p}
                    htmlFor={`llm-policy-${p}`}
                    className="flex items-start gap-3 cursor-pointer"
                  >
                    <RadioGroupItem id={`llm-policy-${p}`} value={p} />
                    <div className="flex-1 -mt-0.5">
                      <div className="text-sm font-medium">{title}</div>
                      <div className="text-xs text-muted-foreground">{desc}</div>
                    </div>
                  </label>
                );
              })}
            </RadioGroup>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <Label htmlFor="redact-toggle" className="text-sm font-medium">
                {t(($) => $.llm.redact_label)}
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                {t(($) => $.llm.redact_help)}
              </p>
            </div>
            <Switch
              id="redact-toggle"
              checked={redact}
              onCheckedChange={setRedact}
              disabled={!isOwner}
            />
          </div>

          <div>
            <Label htmlFor="external-provider" className="text-sm font-medium">
              {t(($) => $.llm.external_provider_label)}
            </Label>
            <p className="text-xs text-muted-foreground mt-1 mb-2">
              {t(($) => $.llm.external_provider_help)}
            </p>
            <Input
              id="external-provider"
              value={externalProvider}
              onChange={(e) => setExternalProvider(e.target.value)}
              placeholder="claude"
              disabled={!isOwner}
              className="max-w-xs"
            />
          </div>

          <div>
            <Label htmlFor="budget" className="text-sm font-medium">
              {t(($) => $.llm.budget_label)}
            </Label>
            <p className="text-xs text-muted-foreground mt-1 mb-2">
              {t(($) => $.llm.budget_help)}
            </p>
            <Input
              id="budget"
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="0"
              disabled={!isOwner}
              aria-invalid={budgetInvalid || undefined}
              className="max-w-xs"
            />
            {budgetInvalid && (
              <p className="text-xs text-destructive mt-1">
                {t(($) => $.llm.budget_invalid)}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {!isOwner && (
        <p className="text-xs text-muted-foreground">
          {t(($) => $.llm.owner_only_notice)}
        </p>
      )}

      {isOwner && (
        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saving || budgetInvalid}
          >
            <Save className="h-4 w-4 mr-1" />
            {saving ? t(($) => $.llm.saving) : t(($) => $.llm.save)}
          </Button>
        </div>
      )}
    </div>
  );
}
