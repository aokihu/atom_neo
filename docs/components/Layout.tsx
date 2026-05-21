import type { DocEntry, CategoryMap } from "../shared";

const STYLES = `
:root {
  --spacing: 0.25rem;
  --radius: 0.5rem;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  --default-transition-duration: 0.15s;
  --default-transition-timing-function: ease;
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-linear: linear;
  --cursor-interactive: pointer;
  --cursor-disabled: not-allowed;
  --disabled-opacity: 0.5;
  --border-width-field: 1px;
  --ring-offset-width: 2px;
  --animate-pulse: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
[data-theme=dark], .dark {
  --background: #0a0a0f;
  --foreground: #cdd6f4;
  --surface: #12121a;
  --surface-secondary: #161622;
  --surface-tertiary: #1c1c28;
  --default: #1e1e2e;
  --default-foreground: #cdd6f4;
  --default-hover: #252538;
  --muted: #6c7086;
  --border: #1e1e2e;
  --separator: #1e1e2e;
  --separator-tertiary: #262636;
  --accent: #89b4fa;
  --accent-foreground: #0a0a0f;
  --accent-soft: rgba(137, 180, 250, 0.15);
  --accent-soft-foreground: #89b4fa;
  --accent-hover: #74a4f0;
  --success: #a6e3a1;
  --success-foreground: #0a0a0f;
  --success-soft: rgba(166, 227, 161, 0.15);
  --success-soft-foreground: #a6e3a1;
  --warning: #fab387;
  --warning-foreground: #0a0a0f;
  --warning-soft: rgba(250, 179, 135, 0.15);
  --warning-soft-foreground: #fab387;
  --danger: #f38ba8;
  --danger-foreground: #0a0a0f;
  --danger-soft: rgba(243, 138, 168, 0.15);
  --danger-soft-foreground: #f38ba8;
  --focus: #89b4fa;
  --overlay: #12121a;
  --overlay-foreground: #cdd6f4;
  --overlay-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
  --surface-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--background); color: var(--foreground); line-height: 1.75; font-size: 15px; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.app { display: flex; min-height: 100vh; }
.sidebar { width: 260px; flex-shrink: 0; background: var(--surface); border-right: 1px solid var(--border); padding: 24px 20px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
.sidebar-cat { font-size: 13px; color: var(--accent); text-transform: uppercase; letter-spacing: 1.5px; margin: 20px 0 8px; }
.sidebar-cat:first-of-type { margin-top: 0; }
.sidebar-link { display: block; padding: 5px 0; color: var(--muted); font-size: 13px; transition: color .15s; }
.sidebar-link:hover, .sidebar-link.active { color: var(--accent); text-decoration: none; }
.sidebar-home { display: block; padding: 6px 12px; margin-bottom: 20px; color: var(--accent); font-size: 13px; background: var(--surface-secondary); border: 1px solid var(--border); border-radius: 6px; transition: border-color .15s, background .15s; }
.sidebar-home:hover { border-color: var(--accent); background: rgba(137,180,250,.08); text-decoration: none; }
.main { flex: 1; padding: 48px 64px; min-width: 0; }
.main h1 { font-size: 28px; margin-bottom: 8px; letter-spacing: -.5px; }
.main h2 { font-size: 20px; margin-top: 40px; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.main h3 { font-size: 16px; margin-top: 28px; margin-bottom: 8px; color: var(--accent); }
.main h4 { font-size: 14px; margin-top: 20px; margin-bottom: 6px; }
.main p { margin-bottom: 14px; }
.main code { font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace; font-size: 13px; background: #11111b; padding: 2px 6px; border-radius: 4px; }
.main pre { background: #11111b; border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; overflow-x: auto; margin: 16px 0; }
.main pre code { background: none; padding: 0; font-size: 13px; line-height: 1.6; }
.main pre code.hljs { display: block; overflow-x: auto; padding: 0; color: #c9d1d9; background: none; }

/* Code block with language label */
.code-block { margin: 20px 0; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: #11111b; }
.code-block__header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; background: var(--surface); border-bottom: 1px solid var(--border); }
.code-block__lang { font-size: 11px; font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: 0.5px; }
.code-block pre { margin: 0; border: none; border-radius: 0; padding: 16px 20px; background: transparent; }

/* highlight.js GitHub Dark theme */
.hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_{color:#ff7b72}
.hljs-title,.hljs-title.class_,.hljs-title.class_.inherited__,.hljs-title.function_{color:#d2a8ff}
.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-variable{color:#79c0ff}
.hljs-meta .hljs-string,.hljs-regexp,.hljs-string{color:#a5d6ff}
.hljs-built_in,.hljs-symbol{color:#ffa657}
.hljs-code,.hljs-comment,.hljs-formula{color:#8b949e}
.hljs-name,.hljs-quote,.hljs-selector-pseudo,.hljs-selector-tag{color:#7ee787}
.hljs-subst{color:#c9d1d9}
.hljs-section{color:#1f6feb;font-weight:700}
.hljs-bullet{color:#f2cc60}
.hljs-emphasis{color:#c9d1d9;font-style:italic}
.hljs-strong{color:#c9d1d9;font-weight:700}
.hljs-addition{color:#aff5b4;background-color:#033a16}
.hljs-deletion{color:#ffdcd7;background-color:#67060c}
.main table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
.main th, .main td { padding: 10px 14px; text-align: left; border: 1px solid var(--border); }
.main th { background: var(--surface); font-weight: 600; }
.main blockquote { border-left: 3px solid var(--accent); padding: 10px 16px; margin: 16px 0; background: rgba(137,180,250,.05); border-radius: 0 8px 8px 0; color: var(--muted); font-size: 14px; }
.main blockquote p:last-child { margin-bottom: 0; }
.main ul, .main ol { padding-left: 24px; margin-bottom: 14px; }
.main li { margin-bottom: 4px; }
.main hr { border: none; border-top: 1px solid var(--border); margin: 32px 0; }
.main img { max-width: 100%; border-radius: 8px; }

.callout { display: flex; gap: 12px; padding: 16px 20px; border-radius: 10px; margin: 20px 0; font-size: 14px; line-height: 1.7; }
.callout-icon { flex-shrink: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
.callout-body { flex: 1; min-width: 0; }
.callout-title { font-weight: 600; margin-bottom: 6px; font-size: 14px; }
.callout-content p:last-child { margin-bottom: 0; }
.callout-content p { margin-bottom: 8px; }
.callout-info { background: rgba(137,180,250,.06); border: 1px solid rgba(137,180,250,.15); }
.callout-info .callout-icon { color: var(--accent); }
.callout-info .callout-title { color: var(--accent); }
.callout-warn { background: rgba(250,179,135,.06); border: 1px solid rgba(250,179,135,.15); }
.callout-warn .callout-icon { color: var(--warning); }
.callout-warn .callout-title { color: var(--warning); }
.callout-err { background: rgba(243,138,168,.06); border: 1px solid rgba(243,138,168,.15); }
.callout-err .callout-icon { color: var(--danger); }
.callout-err .callout-title { color: var(--danger); }
.callout-ok { background: rgba(166,227,161,.06); border: 1px solid rgba(166,227,161,.15); }
.callout-ok .callout-icon { color: var(--success); }
.callout-ok .callout-title { color: var(--success); }
.callout-tip { background: rgba(203,166,247,.06); border: 1px solid rgba(203,166,247,.15); }
.callout-tip .callout-icon { color: #cba6f7; }
.callout-tip .callout-title { color: #cba6f7; }

/* Purpose block */
.purpose-block { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; background: rgba(137,180,250,.04); border: 1px solid rgba(137,180,250,.1); border-radius: 8px; margin: 16px 0; font-size: 14px; }
.purpose-label { flex-shrink: 0; font-size: 11px; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 8px; background: rgba(137,180,250,.1); border-radius: 4px; }

/* Table wrapper */
.table-wrapper { overflow-x: auto; margin: 20px 0; border: 1px solid var(--border); border-radius: 10px; }
.table-wrapper table { width: 100%; border-collapse: collapse; margin: 0; font-size: 13px; }
.table-wrapper th, .table-wrapper td { padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--border); }
.table-wrapper th { background: var(--surface); font-weight: 600; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
.table-wrapper tr:last-child td { border-bottom: none; }
.table-wrapper tr:hover td { background: rgba(137,180,250,.04); }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin: 16px 0; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 18px 20px; transition: border-color .15s; }
.card:hover { border-color: var(--accent); }
.card h4 { font-size: 15px; margin: 0 0 6px; }
.card p { font-size: 13px; color: var(--muted); margin: 0; }

.index-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }
.index-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px 24px; transition: border-color .15s; text-decoration: none; display: block; }
.index-card:hover { border-color: var(--accent); text-decoration: none; }
.index-card h3 { font-size: 16px; margin: 0 0 6px; color: var(--foreground); display: flex; align-items: center; gap: 8px; }
.index-card p { font-size: 13px; color: var(--muted); margin: 0; }

.page-header { margin-bottom: 32px; }
.page-header h1 { font-size: 30px; line-height: 1.3; margin-bottom: 8px; letter-spacing: -.5px; }
.page-header .desc { color: var(--muted); font-size: 14px; margin-top: 4px; }
.page-meta { display: flex; gap: 16px; margin-top: 12px; }
.meta-item { font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 4px; }
.meta-icon { font-size: 13px; }

/* Doc layout: TOC + body */
.doc-layout { display: flex; gap: 40px; align-items: flex-start; }
.doc-body { flex: 1; min-width: 0; }
.doc-toc { flex-shrink: 0; width: 200px; position: sticky; top: 24px; padding-left: 20px; border-left: 1px solid var(--border); }
.doc-toc__title { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
.doc-toc__list { list-style: none; padding: 0; }
.doc-toc__item { margin-bottom: 6px; }
.doc-toc__item a { font-size: 13px; color: var(--muted); transition: color .15s; display: block; line-height: 1.5; }
.doc-toc__item a:hover { color: var(--accent); text-decoration: none; }
.doc-toc__item--h3 { padding-left: 14px; }
.doc-toc__item--h3 a { font-size: 12px; }

/* Doc content spacing */
.doc-content h2:first-child { margin-top: 0; }

.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.badge-blue { background: rgba(137,180,250,.15); color: var(--accent); }
.badge-green { background: rgba(166,227,161,.15); color: var(--success); }
.badge-orange { background: rgba(250,179,135,.15); color: var(--warning); }
.badge-purple { background: rgba(203,166,247,.15); color: #cba6f7; }

.timeline { position: relative; padding-left: 28px; border-left: 2px solid var(--border); margin: 16px 0 16px 8px; }
.timeline-item { position: relative; margin-bottom: 20px; padding-left: 20px; }
.timeline-item::before { content: ''; position: absolute; left: -35px; top: 5px; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); }
.timeline-item h4 { margin: 0 0 4px; font-size: 14px; }
.timeline-item p { font-size: 13px; color: var(--muted); margin: 0 0 2px; }
.timeline-item .meta { font-size: 11px; color: var(--muted); opacity: .7; }

.progress-section { margin-bottom: 32px; }
.progress-section h2 { margin-top: 0; margin-bottom: 16px; font-size: 18px; }
.progress-overall { display: flex; gap: 20px; align-items: center; margin-bottom: 28px; flex-wrap: wrap; }
.progress-ring { width: 80px; height: 80px; flex-shrink: 0; }
.progress-ring-circle { fill: none; stroke: var(--border); stroke-width: 6; }
.progress-ring-fill { fill: none; stroke: var(--accent); stroke-width: 6; stroke-linecap: round; transition: stroke-dashoffset .6s ease; }
.progress-ring-text { fill: var(--foreground); font-size: 18px; font-weight: 700; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-anchor: middle; dominant-baseline: central; }
.progress-stats { display: flex; flex-direction: column; gap: 4px; }
.progress-stats .stat { font-size: 14px; }
.progress-stats .stat span { font-weight: 600; }
.progress-stats .stat-done span { color: var(--success); }
.progress-stats .stat-wip span { color: var(--warning); }
.progress-stats .stat-pending span { color: var(--muted); }

.progress-bar-wrap { height: 6px; background: var(--border); border-radius: 3px; margin: 8px 0 20px; overflow: hidden; }
.progress-bar-fill { height: 100%; border-radius: 3px; transition: width .6s ease; }
.progress-bar-fill.green { background: linear-gradient(90deg, var(--success), var(--accent)); }
.progress-bar-fill.orange { background: linear-gradient(90deg, var(--warning), var(--accent)); }

.phase-list { display: flex; flex-direction: column; gap: 6px; }
.phase-item { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; font-size: 13px; transition: border-color .2s; }
.phase-item:hover { border-color: var(--accent); }
.phase-status { width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; }
.phase-status.done { background: rgba(166,227,161,.2); color: var(--success); }
.phase-status.wip { background: rgba(250,179,135,.2); color: var(--warning); }
.phase-status.pending { background: rgba(108,112,134,.15); color: var(--muted); }
.phase-label { flex: 1; }
.phase-label small { color: var(--muted); font-size: 11px; display: block; margin-top: 2px; }
.phase-pct { font-weight: 600; font-size: 12px; min-width: 40px; text-align: right; }
.phase-pct.done { color: var(--success); }
.phase-pct.wip { color: var(--warning); }
.phase-pct.pending { color: var(--muted); }

/* Doc section */
.doc-section { margin-bottom: 40px; }

/* Package grid */

/* Architecture layers diagram */
.arch-layers { display: flex; flex-direction: column; gap: 12px; margin: 16px 0; }
.arch-layer { padding: 18px 24px; border-radius: 10px; border: 1px solid; }
.arch-layer__label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
.arch-layer__desc { font-size: 14px; color: var(--muted); }
.arch-layer__sub { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.arch-layer-tui { background: rgba(188,140,255,.06); border-color: rgba(188,140,255,.2); }
.arch-layer-tui .arch-layer__label { color: #cba6f7; }
.arch-layer-gateway { background: rgba(210,153,34,.06); border-color: rgba(210,153,34,.2); }
.arch-layer-gateway .arch-layer__label { color: var(--warning); }
.arch-layer-core { background: rgba(88,166,255,.06); border-color: rgba(88,166,255,.2); }
.arch-layer-core .arch-layer__label { color: var(--accent); }

/* Package card grid */
.pkg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; margin: 16px 0; }
.pkg-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px 24px; transition: border-color .15s; }
.pkg-card:hover { border-color: var(--accent); }
.pkg-card__header { margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.pkg-card__desc { font-size: 13px; color: var(--muted); margin: 0 0 14px; line-height: 1.6; }
.pkg-card .code-block { margin: 0; }
.pkg-card .code-block pre { max-height: 300px; overflow-y: auto; }
.pkg-dep-name { display: inline-flex; align-items: center; }
.dep-list { display: inline-flex; gap: 4px; flex-wrap: wrap; }

.muted { color: var(--muted); }

/* Step cards */
.step-card { display: flex; gap: 16px; padding: 16px 20px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 12px; transition: border-color .15s; }
.step-card:hover { border-color: var(--accent); }
.step-card__number { width: 32px; height: 32px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex-shrink: 0; }
.step-card__body { flex: 1; min-width: 0; }
.step-card__body h4 { font-size: 15px; margin: 0 0 4px; }

/* Dependency graph */
.dep-graph { display: flex; align-items: center; gap: 0; flex-wrap: wrap; margin: 16px 0; }
.dep-graph__chain { display: flex; align-items: center; gap: 0; }
.dep-graph__branch { display: flex; flex-direction: column; gap: 4px; }
.dep-node { padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; background: var(--surface); border: 1px solid var(--border); white-space: nowrap; }
.dep-node--highlight { color: var(--accent); border-color: var(--accent); }
.dep-node--secondary { color: var(--muted); }
.dep-node--terminal { color: var(--success); border-color: var(--success); }
.dep-arrow { color: var(--muted); font-size: 16px; padding: 0 6px; }

/* Error flow & diagram */
.error-flow { display: flex; flex-direction: column; gap: 0; margin: 16px 0; position: relative; }
.error-flow__layer { padding: 14px 20px; border-radius: 8px; border-left: 4px solid; margin-bottom: 2px; background: var(--surface); }
.error-flow__layer--element { border-color: var(--accent); }
.error-flow__layer--pipeline { border-color: var(--success); }
.error-flow__layer--engine { border-color: var(--warning); }
.error-flow__layer--http { border-color: var(--accent); }
.error-flow__layer--ws { border-color: var(--success); }
.error-flow__layer--client { border-color: var(--warning); opacity: .7; }
.error-flow__label { font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.error-flow__desc { font-size: 12px; color: var(--muted); }
.error-flow__arrow, .error-flow__split { text-align: center; color: var(--muted); font-size: 14px; padding: 2px 0; }
.error-flow__split { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.error-diagram { position: relative; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; margin: 16px 0; }
.error-diagram__node { padding: 8px 14px; border-radius: 6px; font-size: 12px; text-align: center; font-weight: 600; margin: 4px 0; }
.error-diagram__node--element { background: var(--accent-soft); color: var(--accent); }
.error-diagram__node--pipeline { background: rgba(166,227,161,.15); color: var(--success); }
.error-diagram__node--engine { background: rgba(250,179,135,.15); color: var(--warning); }
.error-diagram__node--http, .error-diagram__node--ws { background: var(--accent-soft); color: var(--accent); }
.error-diagram__node--client { background: rgba(108,112,134,.15); color: var(--muted); }
.error-diagram__label, .error-diagram__desc { font-size: 11px; color: var(--muted); text-align: center; }
.error-diagram__arrow, .error-diagram__branch, .error-diagram__merge { text-align: center; color: var(--muted); padding: 2px 0; font-size: 12px; }
.error-diagram__branch-arm { padding: 4px 12px; border-radius: 6px; font-size: 11px; text-align: center; }
.error-diagram__branch-arm--left { background: var(--accent-soft); color: var(--accent); }
.error-diagram__branch-arm--right { background: rgba(166,227,161,.15); color: var(--success); }

/* Checklist */
.checklist { display: flex; flex-direction: column; gap: 8px; }
.checklist__item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 6px; font-size: 13px; }
.checklist__item--done { color: var(--success); }

/* Issue cards */
.issue-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin: 16px 0; }
.issue-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
.issue-card__icon { font-size: 20px; margin-bottom: 6px; }
.issue-card__title { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
.issue-card__body { font-size: 12px; color: var(--muted); }

/* Precedence flow */
.precedence-flow { display: flex; align-items: center; gap: 0; flex-wrap: wrap; margin: 16px 0; }
.prec-step { padding: 10px 16px; border-radius: 8px; text-align: center; font-size: 12px; font-weight: 600; background: var(--surface); border: 1px solid var(--border); }
.prec-step--highest { border-color: var(--success); color: var(--success); }
.prec-step--lowest { border-color: var(--muted); color: var(--muted); }
.prec-arrow { color: var(--muted); font-size: 16px; padding: 0 4px; }
.prec-label { font-size: 10px; color: var(--muted); margin-top: 4px; }

/* BAD/GOOD panels */
.bad-good { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
.bad-panel { background: rgba(243,138,168,.06); border: 1px solid rgba(243,138,168,.2); border-radius: 10px; padding: 16px; }
.good-panel { background: rgba(166,227,161,.06); border: 1px solid rgba(166,227,161,.2); border-radius: 10px; padding: 16px; }
.panel-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
.bad-panel .panel-label { color: var(--danger); }
.good-panel .panel-label { color: var(--success); }

/* Anti-pattern */
.anti-pattern { padding: 12px 16px; background: rgba(243,138,168,.06); border: 1px solid rgba(243,138,168,.15); border-radius: 8px; margin: 8px 0; font-size: 13px; }
.anti-pattern__title { font-weight: 600; color: var(--danger); margin-bottom: 4px; font-size: 12px; }

/* Timeline (page variant) */
.timeline__item { display: flex; gap: 16px; padding: 12px 16px; border-left: 2px solid var(--border); margin-left: 8px; position: relative; }
.timeline__item::before { content: ''; position: absolute; left: -7px; top: 16px; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); }
.timeline__item--done { border-color: var(--success); }
.timeline__item--done::before { background: var(--success); }
.timeline__label { font-weight: 600; font-size: 13px; }
.timeline__desc { font-size: 12px; color: var(--muted); }
.timeline__step { font-size: 11px; color: var(--accent); font-weight: 600; width: 24px; flex-shrink: 0; }
.timeline__body { flex: 1; }

/* Resource box */
.resource-box { padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; margin: 12px 0; }
.resource-box__title { font-weight: 600; font-size: 14px; margin-bottom: 8px; color: var(--accent); }
.resource-box__content { font-size: 13px; color: var(--muted); line-height: 1.7; }

/* Phase detail cards (development plan) */
.phase-detail { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin: 24px 0; }
.phase-detail__header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.phase-detail__header h3 { font-size: 18px; margin: 0; color: var(--foreground); }
.phase-detail__meta { font-size: 12px; color: var(--muted); }
.phase-detail__desc { font-size: 14px; color: var(--muted); margin-bottom: 16px; }
.phase-tasks { display: flex; flex-direction: column; gap: 0; }
.phase-task-item { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.phase-task-item:last-child { border-bottom: none; }
.phase-task-item__bullet { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex-shrink: 0; margin-top: 6px; }
.phase-task-item__content { flex: 1; min-width: 0; }
.phase-task-item__name { font-size: 14px; font-weight: 600; }
.phase-task-item__file { font-size: 11px; color: var(--accent); display: inline-block; margin: 2px 0; }
.phase-task-item__desc { font-size: 12px; color: var(--muted); }

/* Plan overall progress ring */
.plan-overall { display: flex; align-items: center; gap: 32px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 32px; margin: 24px 0; }
.plan-overall__ring-wrap { flex-shrink: 0; }
.plan-ring { width: 120px; height: 120px; }
.plan-ring__track { fill: none; stroke: var(--border); stroke-width: 8; }
.plan-ring__fill { fill: none; stroke: var(--accent); stroke-width: 8; stroke-linecap: round; }
.plan-ring__pct { fill: var(--foreground); font-size: 22px; font-weight: 700; text-anchor: middle; font-family: inherit; }
.plan-ring__label { fill: var(--muted); font-size: 11px; text-anchor: middle; font-family: inherit; }
.plan-overall__title { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
.plan-overall__stats { display: flex; gap: 16px; }
.plan-stat { font-size: 13px; padding: 3px 10px; border-radius: 6px; }
.plan-stat--done { color: var(--success); background: rgba(166,227,161,.1); }
.plan-stat--pending { color: var(--muted); background: rgba(108,112,134,.1); }
.plan-stat--est { color: var(--accent); background: rgba(137,180,250,.1); }

/* Phase roadmap timeline */
.plan-roadmap { position: relative; padding-left: 48px; margin: 24px 0; }
.plan-roadmap__line { position: absolute; left: 21px; top: 12px; bottom: 12px; width: 2px; background: var(--border); }
.plan-phase { position: relative; margin-bottom: 20px; }
.plan-phase:last-child { margin-bottom: 0; }
.plan-phase--done .plan-roadmap__line { background: var(--success); }
.plan-phase__marker { position: absolute; left: -36px; top: 18px; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; z-index: 1; border: 2px solid var(--border); background: var(--background); color: var(--muted); }
.plan-phase--done .plan-phase__marker { border-color: var(--success); color: var(--success); background: rgba(166,227,161,.1); }
.plan-phase--wip .plan-phase__marker { border-color: var(--warning); color: var(--warning); background: rgba(250,179,135,.1); animation: pulse 2s infinite; }
.plan-phase__card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px; transition: border-color .15s; }
.plan-phase__card:hover { border-color: var(--accent); }
.plan-phase--done .plan-phase__card { opacity: .6; }
.plan-phase__head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.plan-phase__name { font-size: 16px; }
.plan-phase__est { font-size: 11px; color: var(--muted); margin-left: auto; }
.plan-phase__desc { font-size: 13px; color: var(--muted); margin-bottom: 12px; }
.plan-phase__bar-wrap { height: 4px; background: var(--border); border-radius: 2px; margin-bottom: 6px; overflow: hidden; }
.plan-phase__bar { height: 100%; border-radius: 2px; background: linear-gradient(90deg, var(--accent), var(--success)); transition: width .6s ease; }
.plan-phase--wip .plan-phase__bar { background: linear-gradient(90deg, var(--warning), var(--accent)); }
.plan-phase--done .plan-phase__bar { background: var(--success); }
.plan-phase__meta { font-size: 11px; color: var(--muted); margin-bottom: 12px; }
.plan-phase__tasks { display: flex; gap: 6px; flex-wrap: wrap; }
.plan-task-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--border); font-size: 8px; display: flex; align-items: center; justify-content: center; cursor: default; }
.plan-task-dot--done { background: var(--success); color: var(--background); }

@media(max-width:800px) { .sidebar { display: none } .main { margin-left: 0; padding: 24px } }
`;

export function Layout({
  children,
  title,
  activeSlug,
  categories,
  allDocs,
}: {
  children: React.ReactNode;
  title: string;
  activeSlug: string;
  categories: { label: string; docs: DocEntry[] }[];
  allDocs: { slug: string; title: string; description: string; category: string }[];
}) {
  const fullTitle = title === "Atom Neo Docs" ? title : `${title} — Atom Neo Docs`;

  return (
    <html lang="zh-CN" data-theme="dark">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{fullTitle}</title>
        <link rel="stylesheet" href="/_styles/heroui.css" />
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      </head>
      <body>
        <div className="app">
          <aside className="sidebar">
            <a href="/" className="sidebar-home">← 返回首页</a>
            <div className="sidebar-cat" style={{ marginTop: 0 }}>Atom Neo Docs</div>
            {categories.map(cat => (
              <div key={cat.label}>
                <div className="sidebar-cat">{cat.label}</div>
                {cat.docs.map(d => (
                  <a
                    key={d.slug}
                    href={`/${d.slug}`}
                    className={`sidebar-link${activeSlug === d.slug ? " active" : ""}`}
                  >
                    {d.title}
                  </a>
                ))}
              </div>
            ))}
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
