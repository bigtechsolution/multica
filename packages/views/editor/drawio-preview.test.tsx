import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { getAttachmentTextContentMock } = vi.hoisted(() => ({
  getAttachmentTextContentMock: vi.fn(),
}));

vi.mock("@multica/core/api", () => ({
  api: { getAttachmentTextContent: getAttachmentTextContentMock },
  PreviewTooLargeError: class extends Error {},
  PreviewUnsupportedError: class extends Error {},
}));

vi.mock("../i18n", () => ({
  useT: () => ({
    t: (sel: (s: Record<string, Record<string, string>>) => string) =>
      sel({
        image: { download: "Download" },
        attachment: {
          preview: "Preview",
          drawio_error: "Couldn't load the diagram preview.",
          open_in_new_tab: "Open in new tab",
        },
      }),
  }),
}));

vi.mock("../navigation", () => ({
  useNavigation: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/issues",
    searchParams: new URLSearchParams(),
    openInNewTab: vi.fn(),
    getShareableUrl: (p: string) => `https://app.example${p}`,
  }),
}));

vi.mock("@multica/core/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@multica/core/paths")>();
  return {
    ...actual,
    useWorkspaceSlug: () => "acme",
  };
});

import { DrawioPreview } from "./drawio-preview";

function renderWithQuery(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("DrawioPreview", () => {
  it("renders the diagrams.net iframe when XML loads", async () => {
    getAttachmentTextContentMock.mockResolvedValueOnce({
      text: '<mxfile><diagram name="x"><mxGraphModel/></diagram></mxfile>',
      originalContentType: "application/vnd.jgraph.mxfile+xml",
    });

    renderWithQuery(
      <DrawioPreview
        attachmentId="att-1"
        filename="diagram.drawio"
        onPreview={() => undefined}
        onDownload={() => undefined}
      />,
    );

    const iframe = await waitFor(() => {
      const f = document.querySelector("iframe") as HTMLIFrameElement | null;
      expect(f).toBeTruthy();
      return f!;
    });
    expect(iframe.getAttribute("src")).toContain("embed.diagrams.net");
    expect(iframe.getAttribute("src")).toContain("proto=json");
    // Sandbox should restrict to scripts only — no same-origin.
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("title")).toBe("diagram.drawio");
  });

  it("shows error placeholder when the content fetch fails", async () => {
    getAttachmentTextContentMock.mockRejectedValueOnce(new Error("boom"));

    renderWithQuery(
      <DrawioPreview
        attachmentId="att-2"
        filename="broken.drawio"
        onPreview={() => undefined}
        onDownload={() => undefined}
      />,
    );

    await waitFor(() => {
      const err = document.querySelector("[data-testid='drawio-preview-error']");
      expect(err).toBeTruthy();
    });
    // Toolbar should be pinned open in error state (still hover-only without).
    expect(screen.getByLabelText("Download")).toBeTruthy();
    expect(screen.getByLabelText("Preview")).toBeTruthy();
  });

  it("fires onDownload when the Download button is clicked", async () => {
    getAttachmentTextContentMock.mockResolvedValueOnce({
      text: '<mxfile/>',
      originalContentType: "application/vnd.jgraph.mxfile+xml",
    });
    const onDownload = vi.fn();
    renderWithQuery(
      <DrawioPreview
        attachmentId="att-3"
        filename="d.drawio"
        onPreview={() => undefined}
        onDownload={onDownload}
      />,
    );
    const btn = await screen.findByLabelText("Download");
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });
});

describe("getPreviewKind — drawio", () => {
  it("returns 'drawio' for .drawio extension regardless of content type", async () => {
    const { getPreviewKind } = await import("./utils/preview");
    expect(getPreviewKind("text/plain", "diagram.drawio")).toBe("drawio");
    expect(getPreviewKind("text/xml", "x.drawio")).toBe("drawio");
    expect(getPreviewKind("application/vnd.jgraph.mxfile+xml", "x.drawio")).toBe("drawio");
  });

  it("returns 'drawio' for the canonical MIME with any filename", async () => {
    const { getPreviewKind } = await import("./utils/preview");
    expect(getPreviewKind("application/vnd.jgraph.mxfile+xml", "anything.bin")).toBe("drawio");
  });
});
