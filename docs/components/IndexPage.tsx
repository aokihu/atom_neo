import { ProgressSection } from "./ProgressSection";
import type { DocEntry } from "../shared";
import { CATEGORIES } from "../shared";

export function IndexPage({ docs }: { docs: DocEntry[] }) {
  const cats = [...new Set(docs.map(d => d.category))];
  const catLabels = Object.fromEntries(
    Object.entries(CATEGORIES).map(([k, v]) => [k, v.label]),
  );

  return (
    <div>
      <div className="page-header">
        <h1>Atom Neo — Documentation</h1>
        <p className="desc">{docs.length} documents — AI Agent 开发参考</p>
      </div>

      <ProgressSection />

      <div className="index-grid">
        {docs.map(d => (
          <a key={d.slug} href={`/${d.slug}`} className="index-card">
            <h3>{d.title}</h3>
            <p>{d.description || ""}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
