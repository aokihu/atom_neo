export type MenuRoute =
  | { name: "home" }
  | { name: "session" }
  | { name: "history" }
  | { name: "core-server" }
  | { name: "gateway-shortcut" }
  | { name: "gateway-real"; back: "advanced" | "gateway-shortcut" | "configure" }
  | { name: "configure" }
  | { name: "workspace"; after: "configure" | "gateway-shortcut" | "gateway-real" }
  | { name: "advanced" }
  | { name: "wizard"; view: "providers" | "theme"; back: "configure" | "advanced" }
  | { name: "backup" }
  | { name: "backup-export" }
  | { name: "backup-import" };

export function routeFor(initial: "home" | "configure" | "gateway", hasConfig: boolean): MenuRoute {
  if (initial === "configure") return { name: "configure" };
  if (initial === "gateway") {
    return hasConfig
      ? { name: "gateway-real", back: "configure" }
      : { name: "workspace", after: "gateway-real" };
  }
  return { name: "home" };
}

/** Human-readable route path for the shared top bar. */
export function breadcrumbFor(route: MenuRoute): string {
  switch (route.name) {
    case "home": return "Home";
    case "session": return "Home / Session";
    case "history": return "Home / Session / History";
    case "core-server": return "Home / Session / Core Server";
    case "gateway-shortcut": return "Home / Gateway";
    case "gateway-real":
      return route.back === "advanced" ? "Home / Configure / Advanced / Gateway"
        : route.back === "gateway-shortcut" ? "Home / Gateway / Configuration"
          : "Home / Configure / Gateway";
    case "configure": return "Home / Configure";
    case "workspace":
      return route.after === "gateway-shortcut" ? "Home / Gateway / Workspace"
        : route.after === "gateway-real" ? "Gateway / Workspace"
          : "Home / Configure / Workspace";
    case "advanced": return "Home / Configure / Advanced";
    case "wizard": return `Home / Configure / Advanced / ${route.view === "providers" ? "Providers & Models" : "Theme"}`;
    case "backup": return "Home / Backup";
    case "backup-export": return "Home / Backup / Export";
    case "backup-import": return "Home / Backup / Import";
  }
}
