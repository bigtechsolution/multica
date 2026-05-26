"use client";

/**
 * TemplatePicker — workspace issue-template dropdown for the create dialog
 * (Phase A item 4).
 *
 * Lists workspace.issue_template rows (newest first); picking one fires
 * onPick with the full row so the caller can prefill its form state.
 * Renders nothing when the workspace has no templates — avoids cluttering
 * the create dialog with an empty dropdown.
 *
 * No backend mutation here — picking just prefills; the user can still
 * edit any field after.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@multica/ui/components/ui/popover";
import { api } from "@multica/core/api";
import type { IssueTemplate } from "@multica/core/types";

interface TemplatePickerProps {
  onPick: (template: IssueTemplate) => void;
}

export function TemplatePicker({ onPick }: TemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["issue-templates"],
    queryFn: () => api.listIssueTemplates(),
  });

  const templates = data?.templates ?? [];
  if (isLoading) return null;
  if (templates.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Use issue template"
          >
            <FileText className="h-3 w-3" />
            <span>From template</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        }
      />
      <PopoverContent align="start" className="w-64 p-1">
        <div className="max-h-64 overflow-y-auto">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => {
                onPick(tpl);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent transition-colors"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{tpl.name}</div>
                {tpl.title && (
                  <div className="text-muted-foreground truncate">
                    {tpl.title}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
