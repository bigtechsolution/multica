"use client";

/**
 * DrawioPreview — inline .drawio attachment renderer.
 *
 * Phase A item 2. Renders a diagrams.net viewer iframe and posts the
 * attachment's XML body into it. Visual model mirrors HtmlAttachmentPreview
 * (iframe body = the card, floating right-top toolbar with Preview /
 * Open-in-new-tab / Download on hover).
 *
 * Loads the XML via the same `/api/attachments/:id/content` proxy that
 * HTML/markdown attachments use — backend whitelists `.drawio` in
 * isTextPreviewable + extContentTypes (handler/file.go). Re-uses the
 * shared useAttachmentHtmlText hook so the modal Preview opening this
 * file after the inline render doesn't refetch.
 *
 * Viewer: embed.diagrams.net with `?embed=1&proto=json` so we drive it
 * via postMessage. No file is sent in the URL (large diagrams exceed URL
 * length limits). The iframe sends `{ event: "init" }` on load; we reply
 * with `{ action: "load", xml }` to render the diagram. `noSaveBtn=1` +
 * `noExitBtn=1` strip the editor chrome since this is a read-only view.
 *
 * Network dependency: requires reachability to embed.diagrams.net. For
 * an air-gapped fork (Sovereign tier), the fallback is the existing
 * Download button + the attachment-preview-modal text view. A future
 * self-hosted viewer would replace VIEWER_URL with an internal mount.
 *
 * Sandbox: `allow-scripts` is enough — postMessage is cross-origin by
 * design and does not require allow-same-origin. Withholding it keeps
 * the iframe in an opaque origin, denying it read access to host cookies
 * / localStorage.
 */

import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Maximize2 } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import { paths, useWorkspaceSlug } from "@multica/core/paths";
import { useT } from "../i18n";
import { useNavigation } from "../navigation";
import { useAttachmentHtmlText } from "./hooks/use-attachment-html-text";

const VIEWER_URL =
  "https://embed.diagrams.net/?embed=1&proto=json&ui=min&spin=1&noSaveBtn=1&noExitBtn=1&saveAndExit=0";

// Reserved iframe height — matches HtmlAttachmentPreview so the two
// preview kinds line up visually when mixed in a comment thread.
const PREVIEW_HEIGHT = "h-[480px]";
const ERROR_PLACEHOLDER_HEIGHT = "h-20";

interface DrawioPreviewProps {
  attachmentId: string;
  filename: string;
  onPreview: () => void;
  onDownload: () => void;
}

export function DrawioPreview({
  attachmentId,
  filename,
  onPreview,
  onDownload,
}: DrawioPreviewProps) {
  const { t } = useT("editor");
  const slug = useWorkspaceSlug();
  const navigation = useNavigation();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const query = useAttachmentHtmlText(attachmentId);
  const isError = !query.isLoading && (!!query.error || !query.data?.text);
  const xml = query.data?.text;

  // diagrams.net signals readiness with { event: "init" }. We can't post
  // before this — early posts are dropped. Track readiness so the effect
  // below can fire `load` once both sides are settled.
  const [viewerReady, setViewerReady] = useState(false);
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : null;
        if (data?.event === "init") setViewerReady(true);
      } catch {
        // Non-JSON message — not from drawio, ignore.
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Post the XML once both viewer + content are ready. Re-runs on attachment
  // swap so opening a second .drawio doesn't keep showing the first.
  useEffect(() => {
    if (!viewerReady || !xml || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      JSON.stringify({
        action: "load",
        xml,
        // autosave 0 — we never persist edits from this viewer
        autosave: 0,
        // Title shown in the embedded chrome
        title: filename,
      }),
      "*",
    );
  }, [viewerReady, xml, filename]);

  const canOpenInNewTab = !!slug && !!attachmentId;
  const handleOpenInNewTab = () => {
    if (!slug) return;
    const nameQuery = filename ? `?name=${encodeURIComponent(filename)}` : "";
    const path = `${paths.workspace(slug).attachmentPreview(attachmentId)}${nameQuery}`;
    if (navigation.openInNewTab) {
      navigation.openInNewTab(path, filename, { activate: true });
      return;
    }
    const url = navigation.getShareableUrl(path);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="group/drawio-preview relative my-1"
      onMouseDown={(e) => e.stopPropagation()}
      data-testid="drawio-preview"
    >
      {isError ? (
        <div
          className={cn(
            "flex items-center justify-center rounded border border-dashed border-destructive/40 bg-destructive/5 text-xs text-destructive",
            ERROR_PLACEHOLDER_HEIGHT,
          )}
          data-testid="drawio-preview-error"
        >
          {t(($) => $.attachment.drawio_error)}
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          src={VIEWER_URL}
          title={filename}
          sandbox="allow-scripts"
          className={cn(
            "w-full overflow-hidden rounded border bg-card",
            PREVIEW_HEIGHT,
          )}
        />
      )}
      <div
        className={cn(
          "absolute right-2 top-2 flex items-center gap-0.5 rounded-md border border-border bg-background/95 p-0.5 shadow-sm transition-opacity",
          isError
            ? "opacity-100"
            : "opacity-0 group-hover/drawio-preview:opacity-100",
        )}
      >
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t(($) => $.attachment.preview)}
          aria-label={t(($) => $.attachment.preview)}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPreview();
          }}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        {canOpenInNewTab && (
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={t(($) => $.attachment.open_in_new_tab)}
            aria-label={t(($) => $.attachment.open_in_new_tab)}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleOpenInNewTab();
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t(($) => $.image.download)}
          aria-label={t(($) => $.image.download)}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDownload();
          }}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
