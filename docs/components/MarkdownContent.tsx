import React from "react";
import hljs from "highlight.js";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let idx = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/^\*(.+?)\*/);
    const codeMatch = remaining.match(/^`(.+?)`/);
    const linkMatch = remaining.match(/^\[(.+?)\]\((.+?)\)/);

    const matches = [
      { type: "bold", match: boldMatch, pos: boldMatch ? 0 : Infinity },
      { type: "italic", match: italicMatch, pos: italicMatch ? 0 : Infinity },
      { type: "code", match: codeMatch, pos: codeMatch ? 0 : Infinity },
      { type: "link", match: linkMatch, pos: linkMatch ? 0 : Infinity },
    ];

    const earliest = matches.reduce((a, b) => (a.pos < b.pos ? a : b));

    if (earliest.pos === Infinity) {
      if (remaining) parts.push(<React.Fragment key={`t${idx++}`}>{remaining}</React.Fragment>);
      break;
    }

    const prefix = remaining.slice(0, earliest.pos);
    if (prefix) parts.push(<React.Fragment key={`p${idx++}`}>{prefix}</React.Fragment>);

    switch (earliest.type) {
      case "bold": {
        const m = earliest.match!;
        parts.push(<strong key={`b${idx++}`}>{parseInline(m[1])}</strong>);
        remaining = remaining.slice(m[0].length);
        break;
      }
      case "italic": {
        const m = earliest.match!;
        parts.push(<em key={`i${idx++}`}>{parseInline(m[1])}</em>);
        remaining = remaining.slice(m[0].length);
        break;
      }
      case "code": {
        const m = earliest.match!;
        parts.push(<code key={`c${idx++}`}>{m[1]}</code>);
        remaining = remaining.slice(m[0].length);
        break;
      }
      case "link": {
        const m = earliest.match!;
        parts.push(
          <a key={`l${idx++}`} href={m[2]}>
            {parseInline(m[1])}
          </a>,
        );
        remaining = remaining.slice(m[0].length);
        break;
      }
      default:
        remaining = remaining.slice(1);
    }
  }

  return parts.length === 1 ? parts[0] : <React.Fragment key={`inline-${idx++}`}>{parts}</React.Fragment>;
}

function highlightCode(lang: string, raw: string): string {
  if (lang === "mermaid") return `<span class="hljs-meta">${raw.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>`;
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(raw, { language: lang }).value;
    }
  } catch { /* ignore */ }
  return hljs.highlightAuto(raw).value;
}

const LANG_LABELS: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  jsx: "JSX",
  json: "JSON",
  bash: "Bash",
  sh: "Shell",
  shell: "Shell",
  yaml: "YAML",
  yml: "YAML",
  markdown: "Markdown",
  md: "Markdown",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  sql: "SQL",
  python: "Python",
  py: "Python",
  rust: "Rust",
  go: "Go",
  zig: "Zig",
  c: "C",
  cpp: "C++",
  java: "Java",
  kotlin: "Kotlin",
  swift: "Swift",
  ruby: "Ruby",
  php: "PHP",
  text: "Text",
  txt: "Text",
  mermaid: "Mermaid",
  plaintext: "Text",
};

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const highlighted = highlightCode(lang, code);
  const label = LANG_LABELS[lang] || lang || "Text";

  return (
    <div className="code-block" data-hljs="true">
      <div className="code-block__header">
        <span className="code-block__lang">{label}</span>
      </div>
      <pre>
        <code
          className={`hljs language-${lang || "plaintext"}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}

function CalloutBox({
  type,
  icon,
  title,
  children,
}: {
  type: "info" | "warn" | "err" | "ok" | "tip";
  icon: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`callout callout-${type}`}>
      <div className="callout-icon">{icon}</div>
      <div className="callout-body">
        {title && <div className="callout-title">{title}</div>}
        <div className="callout-content">{children}</div>
      </div>
    </div>
  );
}

function TableView({
  header,
  rows,
  tblKey,
}: {
  header: string[];
  rows: string[][];
  tblKey: string;
}) {
  return (
    <div className="table-wrapper" key={tblKey}>
      <table>
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i}>{parseInline(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{parseInline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MarkdownContent({ content }: { content: string }) {
  if (!content) return null;

  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];
  let inTable = false;
  let tableHeader: string[] = [];
  let tableRows: string[][] = [];
  let inBlockquote = false;
  let blockquoteLines: string[] = [];

  function pushBlockquote() {
    if (!inBlockquote || blockquoteLines.length === 0) return;
    const full = blockquoteLines.join("\n");
    blockquoteLines = [];

    // Check if this is a callout block
    const calloutMatch = full.match(
      /^\s*\*\*(Note|Warning|Danger|Success|Tip|信息|警告|错误|成功|提示|IMPORTANT)\*\*[：:]\s*/,
    );
    if (calloutMatch) {
      const typeLabel = calloutMatch[1].toLowerCase();
      const body = full.slice(calloutMatch[0].length);
      const typeMap: Record<string, { type: "info" | "warn" | "err" | "ok" | "tip"; icon: string }> = {
        note: { type: "info", icon: "ℹ" },
        信息: { type: "info", icon: "ℹ" },
        important: { type: "info", icon: "ℹ" },
        warning: { type: "warn", icon: "⚠" },
        警告: { type: "warn", icon: "⚠" },
        danger: { type: "err", icon: "✕" },
        error: { type: "err", icon: "✕" },
        错误: { type: "err", icon: "✕" },
        success: { type: "ok", icon: "✓" },
        成功: { type: "ok", icon: "✓" },
        tip: { type: "tip", icon: "💡" },
        提示: { type: "tip", icon: "💡" },
      };
      const mapped = typeMap[typeLabel] || { type: "info" as const, icon: "ℹ" };
      elements.push(
        <CalloutBox type={mapped.type} icon={mapped.icon} title={calloutMatch[1]}>
          {body.split("\n").map((l, li) => (
            <React.Fragment key={li}>
              {li > 0 && <br />}
              {parseInline(l)}
            </React.Fragment>
          ))}
        </CalloutBox>,
      );
      return;
    }

    // Check if this is a **Purpose** / **用途** block
    const purposeMatch = full.match(/^\s*\*\*(Purpose|用途)\*\*[：:]\s*(.+)/);
    if (purposeMatch) {
      elements.push(
        <div className="purpose-block" key={`pb-${i}`}>
          <span className="purpose-label">{purposeMatch[1] === "用途" ? "用途" : "Purpose"}</span>
          <span>{parseInline(purposeMatch[2])}</span>
        </div>,
      );
      return;
    }

    elements.push(
      <blockquote key={`q-${i}`}>
        <p>
          {full.split("\n").map((l, li) => (
            <React.Fragment key={li}>
              {li > 0 && <br />}
              {parseInline(l)}
            </React.Fragment>
          ))}
        </p>
      </blockquote>,
    );
  }

  function pushInline() {
    pushBlockquote();
    inBlockquote = false;

    if (inCodeBlock) {
      elements.push(
        <CodeBlock
          key={`cb-${i}`}
          lang={codeBlockLang}
          code={codeBlockLines.join("\n")}
        />,
      );
      codeBlockLines = [];
      inCodeBlock = false;
    }
    if (inTable) {
      elements.push(<TableView header={tableHeader} rows={tableRows} tblKey={`tb-${i}`} />);
      tableHeader = [];
      tableRows = [];
      inTable = false;
    }
  }

  for (i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      if (inBlockquote) pushBlockquote();
      if (inCodeBlock) {
        pushInline();
      } else {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Table separator
    if (inTable && line.match(/^\|[-:| ]+\|$/)) continue;

    // Table row
    if (line.startsWith("|") && line.endsWith("|")) {
      if (inBlockquote) pushBlockquote();
      pushInline();
      if (!inTable) {
        inTable = true;
        tableHeader = line.split("|").slice(1, -1).map(s => s.trim());
      } else {
        tableRows.push(line.split("|").slice(1, -1).map(s => s.trim()));
      }
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const content = line.slice(2);
      if (!inBlockquote) {
        pushInline();
        inBlockquote = true;
      }
      blockquoteLines.push(content);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      pushInline();
      continue;
    }

    pushInline();

    // Headings
    if (line.startsWith("# ")) {
      elements.push(
        <h1 key={`h-${i}`} id={slugify(line.slice(2))}>
          {parseInline(line.slice(2))}
        </h1>,
      );
      continue;
    }
    if (line.startsWith("## ")) {
      const id = slugify(line.slice(3));
      elements.push(
        <h2 key={`h-${i}`} id={id}>
          {parseInline(line.slice(3))}
        </h2>,
      );
      continue;
    }
    if (line.startsWith("### ")) {
      const id = slugify(line.slice(4));
      elements.push(
        <h3 key={`h-${i}`} id={id}>
          {parseInline(line.slice(4))}
        </h3>,
      );
      continue;
    }
    if (line.startsWith("#### ")) {
      elements.push(
        <h4 key={`h-${i}`} id={slugify(line.slice(5))}>
          {parseInline(line.slice(5))}
        </h4>,
      );
      continue;
    }

    // HR
    if (line.match(/^---/)) {
      elements.push(<hr key={`hr-${i}`} />);
      continue;
    }

    // List items
    if (line.match(/^[-*] /)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(parseInline(lines[i].replace(/^[-*] /, "")));
        i++;
      }
      i--;
      elements.push(
        <ul key={`ul-${i}`}>
          {items.map((item, j) => (
            <li key={j}>{item}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (line.match(/^\d+\. /)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(parseInline(lines[i].replace(/^\d+\. /, "")));
        i++;
      }
      i--;
      elements.push(
        <ol key={`ol-${i}`}>
          {items.map((item, j) => (
            <li key={j}>{item}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph
    if (line.trim()) {
      elements.push(<p key={`p-${i}`}>{parseInline(line)}</p>);
    }
  }
  pushInline();

  return <div className="doc-content">{elements}</div>;
}

export function extractHeadings(content: string): { id: string; title: string; level: number }[] {
  const headings: { id: string; title: string; level: number }[] = [];
  const lines = content.split("\n");
  let inCodeBlock = false;
  for (const line of lines) {
    if (line.startsWith("```")) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;

    const h2 = line.match(/^## (.+)/);
    if (h2) {
      const title = h2[1].replace(/^Atom Next v2 — /, "").replace(/^Atom Neo — /, "");
      headings.push({ id: slugify(h2[1]), title, level: 2 });
      continue;
    }
    const h3 = line.match(/^### (.+)/);
    if (h3) {
      headings.push({ id: slugify(h3[1]), title: h3[1], level: 3 });
    }
  }
  return headings;
}

export function estimateReadTime(content: string): number {
  const words = content.replace(/```[\s\S]*?```/g, "").replace(/[#*`>\[\]()|_-]/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200)); // minutes, ~200 words/min for technical content
}
