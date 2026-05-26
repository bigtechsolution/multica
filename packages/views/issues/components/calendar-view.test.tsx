import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../navigation", () => ({
  AppLink: ({ children, href, title, className }: { children: ReactNode; href: string; title?: string; className?: string }) => (
    <a href={href} title={title} className={className}>{children}</a>
  ),
}));
vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({ issueDetail: (id: string) => `/ws/issue/${id}` }),
}));
vi.mock(".", () => ({
  StatusIcon: ({ status, className }: { status: string; className?: string }) => (
    <span data-testid="status-icon" className={className}>{status}</span>
  ),
}));

import { CalendarView } from "./calendar-view";

function mkIssue(id: string, title: string, due_date: string | null, start_date: string | null = null, status = "todo") {
  return {
    id,
    workspace_id: "ws-1",
    title,
    description: null,
    status,
    priority: "none",
    assignee_type: null,
    assignee_id: null,
    creator_type: "user",
    creator_id: "u-1",
    parent_issue_id: null,
    project_id: "p-1",
    position: 0,
    start_date,
    due_date,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    number: 1,
    identifier: "MUL-1",
    metadata: {},
  } as any;
}

// Pin "today" so the calendar's initial anchor is deterministic.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-15T12:00:00Z"));
});

describe("CalendarView", () => {
  it("renders the current month label and weekday headers", () => {
    render(<CalendarView issues={[]} />);
    // Month label format depends on locale; just assert the year is there.
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toMatch(/2026/);
    expect(screen.getByText("Mon")).toBeTruthy();
    expect(screen.getByText("Sun")).toBeTruthy();
  });

  it("places an issue with due_date on the correct cell", () => {
    const issue = mkIssue("i1", "Due today issue", "2026-05-15T00:00:00Z");
    render(<CalendarView issues={[issue]} />);
    const chip = screen.getByTitle(/MUL-1 — Due today issue/);
    expect(chip).toBeTruthy();
  });

  it("falls back to start_date when due_date is absent", () => {
    const issue = mkIssue("i1", "Start-only issue", null, "2026-05-10T00:00:00Z");
    render(<CalendarView issues={[issue]} />);
    expect(screen.getByTitle(/Start-only issue/)).toBeTruthy();
  });

  it("lists issues with neither date in the Unscheduled tray", () => {
    const issue = mkIssue("i1", "Floating", null, null);
    render(<CalendarView issues={[issue]} />);
    expect(screen.getByText(/Unscheduled \(1\)/)).toBeTruthy();
    expect(screen.getByTitle(/Floating/)).toBeTruthy();
  });

  it("Today button resets the anchor to the current month", () => {
    const issue = mkIssue("i1", "May issue", "2026-05-15T00:00:00Z");
    render(<CalendarView issues={[issue]} />);
    // Click Next twice — anchor moves to July.
    fireEvent.click(screen.getByLabelText("Next month"));
    fireEvent.click(screen.getByLabelText("Next month"));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toMatch(/July|7/);
    fireEvent.click(screen.getByText("Today"));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toMatch(/May|5/);
  });

  it("collapses overflow with +N more when >4 issues fall on one day", () => {
    const issues = Array.from({ length: 6 }, (_, i) =>
      mkIssue(`i${i}`, `Issue ${i}`, "2026-05-15T00:00:00Z"),
    );
    render(<CalendarView issues={issues} />);
    expect(screen.getByText("+2 more")).toBeTruthy();
  });
});
