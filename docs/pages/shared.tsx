import React from "react";
import hljs from "highlight.js";
import { Badge as HeroBadge } from "@heroui/react";

export type DocPageProps = {
  content: string;
  title: string;
  description: string;
  category: string;
  slug: string;
};

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
}

export function parseInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let idx = 0;
  while (remaining.length > 0) {
    const bold = remaining.match(/^\*\*(.+?)\*\*/);
    const italic = remaining.match(/^\*(.+?)\*/);
    const code = remaining.match(/^`(.+?)`/);
    const link = remaining.match(/^\[(.+?)\]\((.+?)\)/);
    const matches = [
      { type: "bold", match: bold, pos: bold ? 0 : Infinity },
      { type: "italic", match: italic, pos: italic ? 0 : Infinity },
      { type: "code", match: code, pos: code ? 0 : Infinity },
      { type: "link", match: link, pos: link ? 0 : Infinity },
    ];
    const earliest = matches.reduce((a, b) => (a.pos < b.pos ? a : b));
    if (earliest.pos === Infinity) {
      if (remaining) parts.push(<React.Fragment key={`$t${idx++}`}>{remaining}</React.Fragment>);
      break;
    }
    if (earliest.pos > 0) parts.push(<React.Fragment key={`$p${idx++}`}>{remaining.slice(0, earliest.pos)}</React.Fragment>);
    const m = earliest.match!;
    switch (earliest.type) {
      case "bold": parts.push(<strong key={`$b${idx++}`}>{parseInline(m[1])}</strong>); break;
      case "italic": parts.push(<em key={`$i${idx++}`}>{parseInline(m[1])}</em>); break;
      case "code": parts.push(<code key={`$c${idx++}`}>{m[1]}</code>); break;
      case "link": parts.push(<a key={`$l${idx++}`} href={m[2]}>{parseInline(m[1])}</a>); break;
    }
    remaining = remaining.slice(m[0].length);
  }
  return parts.length === 1 ? parts[0] : <React.Fragment key={`$f${idx++}`}>{parts}</React.Fragment>;
}

export function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const labelMap: Record<string, string> = {
    ts: "TypeScript", tsx: "TSX", js: "JavaScript", jsx: "JSX",
    json: "JSON", bash: "Bash", sh: "Shell", yaml: "YAML", yml: "YAML",
    html: "HTML", css: "CSS", sql: "SQL", python: "Python", rust: "Rust",
    go: "Go", zig: "Zig", text: "Text", mermaid: "Mermaid",
  };
  const label = labelMap[lang] || lang || "Text";
  let highlighted = "";
  if (lang === "mermaid") {
    highlighted = code.replace(/</g, "&lt;");
  } else {
    try {
      highlighted = (lang && hljs.getLanguage(lang)) ? hljs.highlight(code, { language: lang }).value : hljs.highlightAuto(code).value;
    } catch {
      highlighted = code.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  }
  return (
    <div className="code-block" data-hljs="true">
      <div className="code-block__header">
        <span className="code-block__lang">{label}</span>
      </div>
      <pre><code className={`hljs language-${lang || "plaintext"}`} dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
    </div>
  );
}

export function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section className="doc-section" id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Callout({ type, title, children }: { type: "info" | "warn" | "tip" | "ok"; title?: string; children: React.ReactNode }) {
  const icons: Record<string, string> = { info: "ℹ", warn: "⚠", tip: "💡", ok: "✓" };
  return (
    <div className={`callout callout-${type}`}>
      <div className="callout-icon">{icons[type]}</div>
      <div className="callout-body">
        {title && <div className="callout-title">{title}</div>}
        <div className="callout-content">{children}</div>
      </div>
    </div>
  );
}

export function ComparisonTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Badge({ color, children }: { color: "blue" | "green" | "orange" | "purple" | "red"; children: React.ReactNode }) {
  const heroColor: Record<string, string> = { blue: "accent", green: "success", orange: "warning", purple: "accent", red: "danger" };
  return <HeroBadge color={heroColor[color] as any}>{children}</HeroBadge>;
}

export function PageHeader({ title, description, category, readTime }: { title: string; description?: string; category?: string; readTime?: number }) {
  const catColor: Record<string, string> = { overview: "blue", conventions: "purple", subsystems: "green", integration: "orange", guide: "blue" };
  return (
    <div className="page-header">
      {category && <Badge color={(catColor[category] || "blue") as "blue"}>{category}</Badge>}
      <h1>{title}</h1>
      {description && <p className="desc">{description}</p>}
      <div className="page-meta">
        {readTime && <span className="meta-item"><span className="meta-icon">📖</span> {readTime} min read</span>}
      </div>
    </div>
  );
}
