"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/* ============================================================
 * RichText — chat message renderer with real code-block styling.
 * Fenced ```code``` renders as a dark terminal card with a language
 * label + copy button; inline `code`, **bold** and links are styled.
 * Unterminated fences (mid-stream content) render as code too.
 * ============================================================ */

type Block = { kind: "code"; lang: string; code: string } | { kind: "text"; text: string };

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const re = /```([A-Za-z0-9_+#.\-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m.index > last) blocks.push({ kind: "text", text: content.slice(last, m.index) });
    blocks.push({ kind: "code", lang: m[1] || "", code: m[2] });
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    const rest = content.slice(last);
    const fenceCount = (rest.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) {
      // stream was cut inside a code block — render what we have
      const idx = rest.lastIndexOf("```");
      if (idx > 0) blocks.push({ kind: "text", text: rest.slice(0, idx) });
      const after = rest.slice(idx + 3);
      const langMatch = /^([A-Za-z0-9_+#.\-]*)\n?/.exec(after);
      const lang = langMatch ? langMatch[1] : "";
      const code = langMatch ? after.slice(langMatch[0].length) : after;
      blocks.push({ kind: "code", lang, code });
    } else {
      blocks.push({ kind: "text", text: rest });
    }
  }
  return blocks;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="my-2.5 overflow-hidden rounded-xl border border-stone-800/40 bg-stone-900 shadow-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-stone-400">
          {lang || "code"}
        </span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-stone-400 transition-colors hover:bg-white/10 hover:text-stone-100"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="di-scroll overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-stone-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function InlineText({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(https?:\/\/[^\s<>"')]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(<span key={k++}>{text.slice(last, m.index)}</span>);
    const tok = m[0];
    if (tok.startsWith("`")) {
      nodes.push(
        <code
          key={k++}
          className="mx-0.5 rounded-md border border-stone-800/30 bg-stone-900 px-1.5 py-0.5 font-mono text-[12.5px] text-stone-100"
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("**")) {
      nodes.push(
        <strong key={k++} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>
      );
    } else {
      nodes.push(
        <a
          key={k++}
          href={tok}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {tok}
        </a>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(<span key={k++}>{text.slice(last)}</span>);
  return <>{nodes}</>;
}

export function RichText({ content, className }: { content: string; className?: string }) {
  const blocks = parseBlocks(content);
  return (
    <div className={className}>
      {blocks.map((b, i) =>
        b.kind === "code" ? (
          <CodeBlock key={i} lang={b.lang} code={b.code.replace(/\n$/, "")} />
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            <InlineText text={b.text} />
          </p>
        )
      )}
    </div>
  );
}
