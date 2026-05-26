"use client";

/**
 * CalendarView — month-grid view of project issues by date (Phase A item 3).
 *
 * Renders the active month as a 7-column grid (always 6 rows so the height
 * never jumps between months). Each cell shows the date number + chips for
 * issues that fall on that day:
 *
 *   - due_date wins when present (most semantically meaningful)
 *   - start_date is the fallback so unscheduled-but-started issues still
 *     show up; if both are present, due_date is used
 *
 * Issues with NEITHER date are listed in a footer "Unscheduled" strip so
 * users can see what's missing dates without having to switch views.
 *
 * Navigation chrome (prev / today / next + month label) lives at the top,
 * mirroring Gantt's header so the affordance feels native. Click on a chip
 * navigates to the issue detail; click on a date cell is a no-op (could
 * later open quick-create with that date prefilled — deferred).
 *
 * Pure client-side — operates on the same issue array the Board / List
 * views consume. No new fetch, no backend changes.
 */

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Issue } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { AppLink } from "../../navigation";
import { useWorkspacePaths } from "@multica/core/paths";
import { StatusIcon } from ".";

// ISO weekday: Monday = 1. Most multica users are in Asia/Korea; a Monday-
// start week matches the local convention. Hardcoded for now; future
// preference store can override if/when needed.
const WEEK_START = 1;

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarView({ issues }: { issues: Issue[] }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [anchor, setAnchor] = useState<Date>(() => startOfMonth(today));

  const monthLabel = useMemo(
    () =>
      anchor.toLocaleString(undefined, {
        year: "numeric",
        month: "long",
      }),
    [anchor],
  );

  // Build a 42-day grid (6 weeks × 7 days) anchored at the first WEEK_START
  // day on or before the 1st of the month. Always 6 rows so the layout
  // doesn't pop between 28/29/30/31-day months.
  const grid = useMemo(() => buildMonthGrid(anchor), [anchor]);

  // Bucket issues by yyyy-mm-dd of their primary date (due > start).
  const byDay = useMemo(() => bucketIssuesByDay(issues), [issues]);

  // Unscheduled tray for the bottom — issues without either date.
  const unscheduled = useMemo(
    () => issues.filter((i) => !i.due_date && !i.start_date),
    [issues],
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAnchor(addMonths(anchor, -1))}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAnchor(startOfMonth(today))}
        >
          Today
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAnchor(addMonths(anchor, 1))}
          aria-label="Next month"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <h2 className="ml-2 text-sm font-medium">{monthLabel}</h2>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-7 auto-rows-fr border-l border-t">
          {grid.map((day) => {
            const key = ymd(day);
            const dayIssues = byDay.get(key) ?? [];
            const inMonth = day.getMonth() === anchor.getMonth();
            const isToday = sameDay(day, today);
            return (
              <div
                key={key}
                className={cn(
                  "min-h-[100px] border-r border-b p-1.5 flex flex-col gap-1",
                  !inMonth && "bg-muted/30",
                )}
              >
                <div
                  className={cn(
                    "text-[11px] tabular-nums w-5 h-5 flex items-center justify-center rounded",
                    isToday && "bg-primary text-primary-foreground font-medium",
                    !inMonth && "text-muted-foreground",
                  )}
                >
                  {day.getDate()}
                </div>
                <div className="flex flex-col gap-0.5 overflow-hidden">
                  {dayIssues.slice(0, 4).map((issue) => (
                    <IssueChip key={issue.id} issue={issue} />
                  ))}
                  {dayIssues.length > 4 && (
                    <div className="text-[10px] text-muted-foreground px-1">
                      +{dayIssues.length - 4} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Unscheduled tray */}
      {unscheduled.length > 0 && (
        <div className="border-t bg-muted/20 px-4 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
            Unscheduled ({unscheduled.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {unscheduled.slice(0, 20).map((issue) => (
              <IssueChip key={issue.id} issue={issue} />
            ))}
            {unscheduled.length > 20 && (
              <span className="text-[10px] text-muted-foreground px-1">
                +{unscheduled.length - 20} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IssueChip({ issue }: { issue: Issue }) {
  const paths = useWorkspacePaths();
  const isDone = issue.status === "done" || issue.status === "cancelled";
  return (
    <AppLink
      href={paths.issueDetail(issue.id)}
      className={cn(
        "flex items-center gap-1 px-1 py-0.5 rounded text-[10px] hover:bg-accent transition-colors min-w-0",
        isDone && "opacity-60",
      )}
      title={`${issue.identifier} — ${issue.title}`}
    >
      <StatusIcon status={issue.status} className="h-3 w-3 shrink-0" />
      <span className="truncate flex-1">{issue.title}</span>
    </AppLink>
  );
}

// ---------------------------------------------------------------------------
// Date helpers — kept native to avoid a date-fns dep here. Operations are
// month-grid trivial; if more views land, lift these into a shared module.
// ---------------------------------------------------------------------------

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildMonthGrid(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  // JS getDay: Sun=0, Mon=1, …, Sat=6. Shift to Mon-start (0..6 with Mon=0).
  const firstDow = (first.getDay() - WEEK_START + 7) % 7;
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - firstDow);
  const out: Date[] = [];
  for (let i = 0; i < 42; i++) {
    out.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  return out;
}

function bucketIssuesByDay(issues: Issue[]): Map<string, Issue[]> {
  const byDay = new Map<string, Issue[]>();
  for (const issue of issues) {
    const primary = issue.due_date ?? issue.start_date;
    if (!primary) continue;
    const key = ymd(new Date(primary));
    const bucket = byDay.get(key);
    if (bucket) bucket.push(issue);
    else byDay.set(key, [issue]);
  }
  return byDay;
}
