export type MenuRoute =
  | { name: "home" }
  | { name: "session" }
  | { name: "history" }
  | { name: "core-server" }
  | { name: "gateway-shortcut" }
  | { name: "gateway-real"; back: "gateway-shortcut" | "configure" }
  | { name: "configure" }
  | { name: "workspace"; after: "configure" | "gateway-shortcut" | "gateway-real" }
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

/**
 * Parent context not already represented by the page title. Returning undefined
 * removes the breadcrumb row entirely; only Gateway configuration, Workspace,
 * Providers and Theme need a parent trail.
 */
export function breadcrumbFor(route: MenuRoute): string | undefined {
  switch (route.name) {
    case "home":
    case "session":
    case "history":
    case "core-server":
    case "gateway-shortcut":
    case "configure":
    case "backup":
    case "backup-export":
    case "backup-import":
      return undefined;
    case "gateway-real":
      return route.back === "gateway-shortcut" ? "Home / Gateway / Configuration"
        : "Home / Configure / Gateway";
    case "workspace":
      return route.after === "gateway-shortcut" ? "Home / Gateway / Workspace"
        : route.after === "gateway-real" ? "Gateway / Workspace"
          : "Home / Configure / Workspace";
  }
}
