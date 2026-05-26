import { describe, it, expect } from "vitest";
import { CalloutExtension } from "./callout";

// Pure-data tests on the tokenize / renderMarkdown hooks. Skips the full
// TipTap editor + ProseMirror schema integration — that path is exercised
// by the existing markdown-paste round-trip tests; here we just pin the
// markdown contract so a refactor that drops [!TIP] support fails loud.

const callout = CalloutExtension as any;

describe("CalloutExtension — markdown tokenizer", () => {
  const tokenize = (src: string) => callout.config.markdownTokenizer.tokenize(src);
  const start = (src: string) => callout.config.markdownTokenizer.start(src);

  it("matches the NOTE label", () => {
    const tok = tokenize("> [!NOTE] hello world\n");
    expect(tok?.type).toBe("callout");
    expect(tok?.attributes).toEqual({ variant: "info", body: "hello world" });
  });

  it("maps TIP → success, WARNING → warning, CAUTION → error", () => {
    expect(tokenize("> [!TIP] x\n")?.attributes.variant).toBe("success");
    expect(tokenize("> [!WARNING] x\n")?.attributes.variant).toBe("warning");
    expect(tokenize("> [!CAUTION] x\n")?.attributes.variant).toBe("error");
    expect(tokenize("> [!IMPORTANT] x\n")?.attributes.variant).toBe("info");
  });

  it("trims trailing whitespace from body", () => {
    const tok = tokenize("> [!NOTE]   spaced body   \n");
    expect(tok?.attributes.body).toBe("spaced body");
  });

  it("returns undefined for non-callout lines", () => {
    expect(tokenize("> regular blockquote\n")).toBeUndefined();
    expect(tokenize("plain text\n")).toBeUndefined();
    expect(tokenize("> [!UNKNOWN] x\n")).toBeUndefined();
  });

  it("start() finds the right offset", () => {
    expect(start("plain\n> [!NOTE] body\n")).toBe("plain\n".length);
    expect(start("no callout here")).toBe(-1);
  });
});

describe("CalloutExtension — renderMarkdown roundtrip", () => {
  const render = (node: any) => callout.config.renderMarkdown(node);

  it("renders info as NOTE", () => {
    expect(render({ attrs: { variant: "info", body: "hello" } })).toBe(
      "> [!NOTE] hello",
    );
  });

  it("renders success as TIP, warning as WARNING, error as CAUTION", () => {
    expect(render({ attrs: { variant: "success", body: "x" } })).toBe("> [!TIP] x");
    expect(render({ attrs: { variant: "warning", body: "x" } })).toBe(
      "> [!WARNING] x",
    );
    expect(render({ attrs: { variant: "error", body: "x" } })).toBe(
      "> [!CAUTION] x",
    );
  });

  it("falls back to NOTE when variant is unknown", () => {
    expect(render({ attrs: { variant: "weird", body: "x" } })).toBe(
      "> [!NOTE] x",
    );
  });

  it("roundtrips tokenize → render", () => {
    const sources = [
      "> [!NOTE] alpha\n",
      "> [!TIP] beta\n",
      "> [!WARNING] gamma\n",
      "> [!CAUTION] delta\n",
    ];
    for (const src of sources) {
      const tok = callout.config.markdownTokenizer.tokenize(src);
      const rendered = render({ attrs: tok?.attributes });
      // Re-tokenize the rendered output and expect matching attrs.
      const re = callout.config.markdownTokenizer.tokenize(rendered + "\n");
      expect(re?.attributes).toEqual(tok?.attributes);
    }
  });
});
