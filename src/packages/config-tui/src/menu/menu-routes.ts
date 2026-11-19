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
  | { name: "wizard"; view: "providers" | "theme" }
  | { name: "backup" }
  | { name: "backup-export" }
  | { name: "backup-import" };

export function routeFor(initial: "home" | "configure" | "gateway", hasConfig: boolean, explicit: boolean): MenuRoute {
  if (initial === "configure") return { name: "configure" };
  if (initial === "gateway") {
    return explicit || hasConfig
      ? { name: "gateway-real", back: "configure" }
      : { name: "workspace", after: "gateway-real" };
  }
  return { name: "home" };
}
