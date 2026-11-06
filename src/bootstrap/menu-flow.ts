// Navigation and parameter collection for the one-shot startup menu.
import { isIP } from "node:net";
import { buildAppCommand, parsePort, parseSandboxPath, type BootArguments } from "./cli";
import { MENU_COMMANDS, parseMenuParameters, type MenuCommand, type MenuHistory, type MenuParameters } from "./menu-history";

type Field = "sandbox" | "host" | "port" | "coreServer" | "corePort" | "clients" | "session";
type Draft = Record<Field, string>;
type Page = "menu" | "start" | "gateway" | MenuCommand;
export type MenuRequest = { command: MenuCommand; args: BootArguments; parameters: MenuParameters };
export type MenuView = { title: string; items?: string[]; field?: Field; label?: string; value?: string };

const STEPS: Record<MenuCommand, Field[]> = {
  chat: ["sandbox", "session"], core: ["sandbox", "host", "port"], config: ["sandbox"],
  "core-gateway": ["sandbox", "host", "port"],
  "gateway-start": ["sandbox", "clients"], "gateway-stop": ["sandbox", "clients"],
  attach: ["coreServer", "corePort"],
};
const LABELS: Record<Field, string> = {
  sandbox: "工作目录", host: "监听地址", port: "监听端口 (0 = 随机)",
  coreServer: "远程地址 (hostname / IP)", corePort: "端口", clients: "Client ID (留空 = all)", session: "会话",
};
const MENUS = {
  menu: ["start >", "config >", "gateway >", "attach >", "exit"],
  start: ["chat >", "core >"], gateway: ["run >", "start clients >", "stop clients >"],
};
const TARGETS: Record<keyof typeof MENUS, (Page | "exit")[]> = {
  menu: ["start", "config", "gateway", "attach", "exit"], start: ["chat", "core"],
  gateway: ["core-gateway", "gateway-start", "gateway-stop"],
};

export function parseServerHost(value: string): string {
  const host = value.trim().replace(/^\[([^\]]+)\]$/, "$1");
  if (!isIP(host) && !/^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(host)) throw new Error("请输入 hostname 或 IP 地址，不含协议、路径和端口");
  return host;
}

export function formatMenuCommand(args: BootArguments, prefix = buildAppCommand([])): string {
  const flags: string[] = [];
  if (args.config) flags.push("--config");
  else if (args.mode) flags.push("--mode", args.mode);
  if (args.mode === "tui") flags.push("--core-server", args.coreServer!, "--core-port", String(args.corePort));
  else if (args.mode === "gateway") {
    flags.push("--action", args.action!);
    if (args.clients) flags.push("--clients", args.clients);
  } else if (!args.config) flags.push("--host", args.host, "--port", String(args.port));
  flags.push("--sandbox", args.sandbox);
  if (args.continueSession) flags.push("--continue");
  return [...prefix, ...flags].map(value => /^[\w./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`).join(" ");
}

export class MenuFlow {
  page: Page = "menu";
  step = 0;
  selected = 0;
  error = "";
  readonly drafts: Record<MenuCommand, Draft>;

  constructor(readonly base: BootArguments, history: MenuHistory = {}) {
    this.drafts = Object.fromEntries(MENU_COMMANDS.map(command => {
      const saved = history[command];
      return [command, {
        sandbox: base.sandboxExplicit ? base.sandbox : saved?.sandbox ?? base.sandbox,
        host: saved?.host ?? base.host, port: String(saved?.port ?? base.port),
        coreServer: saved?.coreServer ?? "127.0.0.1", corePort: String(saved?.corePort ?? 3100),
        clients: saved?.clients ?? "", session: saved?.continueSession ? "continue" : "new",
      }];
    })) as Record<MenuCommand, Draft>;
  }

  view(): MenuView {
    if (this.page === "menu" || this.page === "start" || this.page === "gateway") {
      return { title: this.page === "menu" ? "menu" : `menu / ${this.page}`, items: MENUS[this.page] };
    }
    const field = STEPS[this.page][this.step];
    return {
      title: `menu / ${this.page} / ${LABELS[field]}`, field, label: LABELS[field], value: this.drafts[this.page][field],
      ...(field === "session" ? { items: ["new", "continue"] } : {}),
    };
  }

  setValue(value: string): void {
    const { field } = this.view();
    if (field) this.drafts[this.page as MenuCommand][field] = value;
  }

  back(): boolean {
    this.error = "";
    if (this.page === "menu") return false;
    if (this.page === "start" || this.page === "gateway") this.page = "menu";
    else if (this.step > 0) this.step--;
    else this.page = this.page === "core" || this.page === "chat" ? "start"
      : this.page === "config" || this.page === "attach" ? "menu" : "gateway";
    this.resetSelection();
    return true;
  }

  submit(value?: string): MenuRequest | "exit" | undefined {
    this.error = "";
    if (this.page === "menu" || this.page === "start" || this.page === "gateway") {
      const target = TARGETS[this.page][this.selected];
      if (target === "exit") return "exit";
      this.page = target;
      this.step = 0;
      this.resetSelection();
      return;
    }
    const command = this.page;
    const field = STEPS[command][this.step];
    const entered = (value ?? (field === "session" ? this.selected === 1 ? "continue" : "new" : this.drafts[command][field])).trim();
    const parsed = field === "sandbox" ? parseSandboxPath(entered)
      : field === "port" || field === "corePort" ? String(parsePort(entered, field === "port"))
      : field === "host" || field === "coreServer" ? parseServerHost(entered)
      : field === "clients" && entered === "all" ? "" : entered;
    this.drafts[command][field] = parsed;
    if (this.step < STEPS[command].length - 1) {
      this.step++;
      this.resetSelection();
      return;
    }
    const draft = this.drafts[command];
    const parameters = parseMenuParameters(command, {
      sandbox: draft.sandbox, host: draft.host, port: Number(draft.port), coreServer: draft.coreServer,
      corePort: Number(draft.corePort), clients: draft.clients || undefined, continueSession: draft.session === "continue",
    });
    const args: BootArguments = {
      ...this.base, ...parameters, menu: false, config: command === "config", mode: undefined,
    };
    if (command === "core" || command === "core-gateway") args.mode = command;
    if (command === "attach") args.mode = "tui";
    if (command === "gateway-start" || command === "gateway-stop") {
      args.mode = "gateway";
      args.action = command === "gateway-start" ? "start" : "stop";
    }
    return { command, args, parameters };
  }

  private resetSelection(): void {
    this.selected = this.view().field === "session" && this.view().value === "continue" ? 1 : 0;
  }
}
