import { MarkdownContent, extractHeadings, estimateReadTime } from "./MarkdownContent";

export function DocPage({
  slug,
  title,
  content,
  category,
  description,
}: {
  slug: string;
  title: string;
  content: string;
  category?: string;
  description?: string;
}) {
  const headings = extractHeadings(content);
  const readTime = estimateReadTime(content);

  return (
    <div className="doc-page">
      <div className="page-header">
        {category && <span className={`badge badge-${categoryColor(category)}`}>{category}</span>}
        <h1>{title || slug}</h1>
        {description && <p className="desc">{description}</p>}
        <div className="page-meta">
          <span className="meta-item">
            <span className="meta-icon" aria-hidden="true">📖</span> {readTime} min read
          </span>
        </div>
      </div>

      <div className="doc-layout">
        {headings.length > 0 && (
          <nav className="doc-toc">
            <div className="doc-toc__title">On this page</div>
            <ul className="doc-toc__list">
              {headings.map((h, idx) => (
                <li
                  key={idx}
                  className={`doc-toc__item doc-toc__item--h${h.level}`}
                >
                  <a href={`#${h.id}`}>{h.title}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <div className="doc-body">
          <MarkdownContent content={content} />
        </div>
      </div>
    </div>
  );
}

function categoryColor(cat: string): string {
  const map: Record<string, string> = {
    overview: "blue",
    conventions: "purple",
    subsystems: "green",
    integration: "orange",
    guide: "blue",
  };
  return map[cat] || "blue";
}
