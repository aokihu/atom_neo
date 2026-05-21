import React from "react";
import hljs from "highlight.js";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, parseInline } from "./shared";

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
}

function MarkdownBody({ content }: { content: string }) {
  if (!content) return null;
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let inCode = false, codeLang = "", codeLines: string[] = [];
  let inTable = false, tableHeader: string[] = [], tableRows: string[][] = [];
  let $k = 0;

  function pushTable(key: string) {
    if (!inTable) return;
    elements.push(
      <div className="table-wrapper" key={key}>
        <table>
          <thead>
            <tr>{tableHeader.map((h, hi) => <th key={hi}>{parseInline(h)}</th>)}</tr>
          </thead>
          <tbody>
            {tableRows.map((row, ri) => (
              <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{parseInline(cell)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableHeader = []; tableRows = []; inTable = false;
  }

  function pushCode(key: string) {
    if (!inCode) return;
    let highlighted = "";
    try { highlighted = (codeLang && hljs.getLanguage(codeLang)) ? hljs.highlight(codeLines.join("\n"), { language: codeLang }).value : hljs.highlightAuto(codeLines.join("\n")).value; } catch { highlighted = codeLines.join("\n").replace(/</g, "&lt;"); }
    const labelMap: Record<string, string> = { ts: "TypeScript", tsx: "TSX", js: "JavaScript", jsx: "JSX", json: "JSON", bash: "Bash", sh: "Shell", yaml: "YAML", html: "HTML", css: "CSS", sql: "SQL", python: "Python", rust: "Rust", go: "Go", text: "Text", mermaid: "Mermaid" };
    const label = labelMap[codeLang] || codeLang || "Text";
    elements.push(
      <div className="code-block" key={key}>
        <div className="code-block__header"><span className="code-block__lang">{label}</span></div>
        <pre><code className={`hljs language-${codeLang || "plaintext"}`} dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
      </div>
    );
    codeLines = []; inCode = false;
  }

  function flushInline() {
    pushTable(`tb${$k++}`);
    pushCode(`cb${$k++}`);
  }

  for (i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flushInline();
      if (inCode) { pushCode(`cb${$k++}`); } else { inCode = true; codeLang = line.slice(3).trim(); }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (line.trim() === "") { flushInline(); continue; }

    if (inTable && line.match(/^\|[-:| ]+\|$/)) continue;
    if (line.startsWith("|") && line.endsWith("|")) {
      flushInline();
      if (!inTable) { inTable = true; tableHeader = line.split("|").slice(1, -1).map(s => s.trim()); }
      else { tableRows.push(line.split("|").slice(1, -1).map(s => s.trim())); }
      continue;
    }

    flushInline();

    if (line.startsWith("# ")) { elements.push(<h1 key={`h${$k++}`} id={slugify(line.slice(2))}>{parseInline(line.slice(2))}</h1>); continue; }
    if (line.startsWith("## ")) { elements.push(<h2 key={`h${$k++}`} id={slugify(line.slice(3))}>{parseInline(line.slice(3))}</h2>); continue; }
    if (line.startsWith("### ")) { elements.push(<h3 key={`h${$k++}`} id={slugify(line.slice(4))}>{parseInline(line.slice(4))}</h3>); continue; }
    if (line.startsWith("#### ")) { elements.push(<h4 key={`h${$k++}`} id={slugify(line.slice(5))}>{parseInline(line.slice(5))}</h4>); continue; }
    if (line.match(/^---/)) { elements.push(<hr key={`hr${$k++}`} />); continue; }

    if (line.startsWith("> ")) {
      const q: string[] = [line.slice(2)];
      while (i + 1 < lines.length && lines[i + 1].startsWith("> ")) q.push(lines[++i].slice(2));
      elements.push(<blockquote key={`q${$k++}`}><p>{q.map((l, li) => <React.Fragment key={li}>{li > 0 && <br />}{parseInline(l)}</React.Fragment>)}</p></blockquote>);
      continue;
    }

    if (line.match(/^[-*] /)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^[-*] /)) { items.push(parseInline(lines[i].replace(/^[-*] /, ""))); i++; }
      i--;
      elements.push(<ul key={`ul${$k++}`}>{items.map((it, j) => <li key={j}>{it}</li>)}</ul>);
      continue;
    }
    if (line.match(/^\d+\. /)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) { items.push(parseInline(lines[i].replace(/^\d+\. /, ""))); i++; }
      i--;
      elements.push(<ol key={`ol${$k++}`}>{items.map((it, j) => <li key={j}>{it}</li>)}</ol>);
      continue;
    }

    if (line.trim()) elements.push(<p key={`p${$k++}`}>{parseInline(line)}</p>);
  }
  flushInline();
  return <div className="doc-content">{elements}</div>;
}

export default function DefaultDocPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />
      <MarkdownBody content={content} />
    </div>
  );
}
