"use client";

/**
 * Callout — block node for highlighting passages with a tone (info / warning
 * / success / error). Phase A item 5 (item 4 had code + math already in the
 * editor; callout is the missing piece).
 *
 * Markdown form mirrors GitHub Alerts:
 *
 *   > [!NOTE] Body text on the same line, ends at \n
 *   > [!WARNING] ...
 *   > [!TIP] ...     → maps to "success" variant
 *   > [!IMPORTANT] ... → maps to "info" variant
 *   > [!CAUTION] ...   → maps to "error" variant
 *
 * Body is plain text for the MVP — agents and humans both write callouts
 * as one-liners in practice. A future iteration can promote the content
 * model to inline+ for bold/italic/links inside the callout body.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Info, AlertTriangle, CheckCircle2, AlertOctagon } from "lucide-react";

export type CalloutVariant = "info" | "warning" | "success" | "error";

const VARIANT_CONFIG: Record<
  CalloutVariant,
  { icon: typeof Info; classes: string; labelClass: string }
> = {
  info: {
    icon: Info,
    classes: "border-blue-500/30 bg-blue-500/5",
    labelClass: "text-blue-600 dark:text-blue-400",
  },
  warning: {
    icon: AlertTriangle,
    classes: "border-amber-500/30 bg-amber-500/5",
    labelClass: "text-amber-600 dark:text-amber-400",
  },
  success: {
    icon: CheckCircle2,
    classes: "border-emerald-500/30 bg-emerald-500/5",
    labelClass: "text-emerald-600 dark:text-emerald-400",
  },
  error: {
    icon: AlertOctagon,
    classes: "border-red-500/30 bg-red-500/5",
    labelClass: "text-red-600 dark:text-red-400",
  },
};

function CalloutView({ node }: NodeViewProps) {
  const variant = (node.attrs.variant as CalloutVariant) ?? "info";
  const body = String(node.attrs.body ?? "");
  const config = VARIANT_CONFIG[variant] ?? VARIANT_CONFIG.info;
  const Icon = config.icon;
  return (
    <NodeViewWrapper
      data-type="callout"
      data-variant={variant}
      className={`my-2 flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${config.classes}`}
    >
      <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${config.labelClass}`} />
      <div className="flex-1 min-w-0 whitespace-pre-wrap break-words">
        {body}
      </div>
    </NodeViewWrapper>
  );
}

// GitHub Alert label → our variant. CAUTION is harsher than WARNING, so
// map it to error (red); IMPORTANT becomes info (blue) since it's about
// emphasis rather than danger. TIP → success (green).
const LABEL_TO_VARIANT: Record<string, CalloutVariant> = {
  NOTE: "info",
  IMPORTANT: "info",
  TIP: "success",
  WARNING: "warning",
  CAUTION: "error",
};

const VARIANT_TO_LABEL: Record<CalloutVariant, string> = {
  info: "NOTE",
  warning: "WARNING",
  success: "TIP",
  error: "CAUTION",
};

export const CalloutExtension = Node.create({
  name: "callout",
  group: "block",
  atom: true,
  defining: true,
  selectable: true,

  addAttributes() {
    return {
      variant: { default: "info", rendered: false },
      body: { default: "", rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
        getAttrs: (el) => {
          const node = el as HTMLElement;
          return {
            variant: (node.getAttribute("data-variant") as CalloutVariant) ?? "info",
            body: node.getAttribute("data-body") ?? node.textContent ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "callout",
        "data-variant": node.attrs.variant,
        "data-body": node.attrs.body,
      }),
      node.attrs.body,
    ];
  },

  // Tokeniser hooks consumed by the project's markdown-paste pipeline;
  // mirrors the math + mention + file-card extensions.
  markdownTokenizer: {
    name: "callout",
    level: "block" as const,
    start(src: string) {
      return src.search(/^> \[!(NOTE|IMPORTANT|TIP|WARNING|CAUTION)\]/m);
    },
    tokenize(src: string) {
      const match = src.match(
        /^> \[!(NOTE|IMPORTANT|TIP|WARNING|CAUTION)\][ \t]*(.*)(?:\n|$)/,
      );
      if (!match) return undefined;
      const label = match[1] ?? "NOTE";
      const body = (match[2] ?? "").trim();
      return {
        type: "callout",
        raw: match[0],
        attributes: { variant: LABEL_TO_VARIANT[label] ?? "info", body },
      };
    },
  },

  parseMarkdown: (token: any, helpers: any) => {
    return helpers.createNode("callout", token.attributes);
  },

  renderMarkdown: (node: any) => {
    const variant: CalloutVariant = node.attrs?.variant ?? "info";
    const label = VARIANT_TO_LABEL[variant] ?? "NOTE";
    const body = String(node.attrs?.body ?? "");
    return `> [!${label}] ${body}`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});
