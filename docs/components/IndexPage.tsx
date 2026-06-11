import type { DocEntry } from "../shared";
import { CATEGORIES } from "../shared";

export function IndexPage({ docs }: { docs: DocEntry[] }) {
  const grouped = new Map<string, DocEntry[]>();
  for (const d of docs) {
    const list = grouped.get(d.category) || [];
    list.push(d);
    grouped.set(d.category, list);
  }

  const catOrder = Object.entries(CATEGORIES).sort(
    (a, b) => a[1].order - b[1].order,
  );

  return (
    <div>
      <div className="page-header">
        <h1>Atom Neo — Documentation</h1>
        <p className="desc">{docs.length} documents — AI Agent 开发参考</p>
      </div>

      {catOrder.map(([key, { label }]) => {
        const entries = grouped.get(key);
        if (!entries || !entries.length) return null;
        return (
          <div key={key}>
            <h2 className="index-cat-title">{label}</h2>
            <div className="index-grid">
              {entries.map((d) => (
                <a key={d.slug} href={`/${d.slug}`} className="index-card">
                  <h3>{d.title}</h3>
                  <p>{d.description || ""}</p>
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
