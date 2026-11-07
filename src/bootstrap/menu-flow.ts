// Navigation and parameter collection for the one-shot startup menu.
import { isIP } from "node:net";
import { buildAppCommand, parsePort, parseSandboxPath, type BootArguments } from "./cli";
import { MENU_COMMANDS, parseMenuParameters, type MenuCommand, type MenuHistory, type MenuParameters } from "./menu-history";

type Field = "sandbox" | "host" | "port" | "coreServer" | "corePort" | "clients" | "session";
type Draft = Record<Field, string>;
type MenuPage = "menu" | "start" | "gateway";
type Page = MenuPage | MenuCommand;
type MenuItem = { label: string; target: Exclude<Page, "menu"> | "exit" | "back"; description: readonly string[] };
export type MenuRequest = { command: MenuCommand; args: BootArguments; parameters: MenuParameters };
export type MenuView = {
  title: string; items?: string[]; description?: readonly string[]; help?: readonly string[];
  field?: Field; label?: string; value?: string; step?: number; total?: number;
};

const STEPS: Record<MenuCommand, Field[]> = {
  chat: ["sandbox", "session"], core: ["sandbox", "host", "port"], config: ["sandbox"],
  "core-gateway": ["sandbox", "host", "port"],
  "gateway-start": ["sandbox", "clients"], "gateway-stop": ["sandbox", "clients"],
  attach: ["coreServer", "corePort"],
};
const LABELS: Record<Field, string> = {
  sandbox: "工作目录", host: "监听地址", port: "监听端口",
  coreServer: "远程地址", corePort: "端口", clients: "Client ID", session: "会话",
};
const FIELD_HELP: Record<Field, readonly string[]> = {
  sandbox: ["应用配置和运行数据所在的目录。", "不同目录对应各自的配置与实例。"],
  host: ["Core 接受连接时使用的本机地址。", "127.0.0.1 限本机；0.0.0.0 供其他主机连接。"],
  port: ["供其他终端连接 Core 时使用的端口。", "默认 3100；填写 0 自动分配。"],
  coreServer: ["Core 所在主机的 IP 地址或域名。", "远程连接需双方配置 ATOM_ADMIN_TOKEN。"],
  corePort: ["目标 Core 当前使用的监听端口。", "默认 3100；有效范围 1–65535。"],
  clients: ["填写已配置的 Client ID。", "留空或填写 all，操作全部 Client。"],
  session: ["选择本次对话的起点。"],
};
const BACK_ITEM: MenuItem = { label: "‹ back", target: "back", description: ["返回上一级菜单。", "已填写的内容会保留。"] };
const MENUS: Record<MenuPage, MenuItem[]> = {
  menu: [
    { label: "start >", target: "start", description: ["启动本机 Atom Neo。", "选择进入聊天，或仅运行 Core 服务。"] },
    { label: "config >", target: "config", description: ["配置模型、供应商和界面设置。", "进入现有配置向导，完成后统一保存。"] },
    { label: "gateway >", target: "gateway", description: ["管理网关服务与平台接入。", "启动 Core + Gateway，或启停平台 Client。"] },
    { label: "attach >", target: "attach", description: ["连接已运行的 Core，进入聊天界面。", "填写目标主机的地址和端口。"] },
    { label: "exit", target: "exit", description: ["结束本次启动向导。"] },
  ],
  start: [
    { label: "chat >", target: "chat", description: ["启动 Core 并进入聊天界面。", "可新建会话或继续上次会话。"] },
    { label: "core >", target: "core", description: ["运行 Core 服务，供其他终端连接。", "服务会在当前终端保持运行。"] },
    BACK_ITEM,
  ],
  gateway: [
    { label: "run >", target: "core-gateway", description: ["启动 Core 与 Gateway 服务。", "按配置接入平台 Client，在当前终端保持运行。"] },
    { label: "start clients >", target: "gateway-start", description: ["启动已配置的平台 Client。", "可操作指定 Client 或全部 Client。"] },
    { label: "stop clients >", target: "gateway-stop", description: ["停止已配置的平台 Client。", "Core 和 Gateway 服务保持运行。"] },
    BACK_ITEM,
  ],
};
const SESSION_ITEMS = [
  { label: "new", description: ["新建聊天会话。", "已有会话继续保留。"] },
  { label: "continue", description: ["继续最近一次 TUI 会话。", "没有历史会话时自动新建。"] },
  BACK_ITEM,
];
const PATHS: Record<MenuCommand, string[]> = {
  chat: ["start", "chat"], core: ["start", "core"], config: ["config"],
  "core-gateway": ["gateway", "run"], "gateway-start": ["gateway", "start clients"],
  "gateway-stop": ["gateway", "stop clients"], attach: ["attach"],
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
      const items = MENUS[this.page];
      return {
        title: this.page === "menu" ? "menu" : `menu / ${this.page}`,
        items: items.map(item => item.label), description: items[this.selected]?.description,
      };
    }
    const field = STEPS[this.page][this.step];
    return {
      title: ["menu", ...PATHS[this.page]].join(" / "), field, label: LABELS[field], value: this.drafts[this.page][field],
      step: this.step + 1, total: STEPS[this.page].length,
      help: FIELD_HELP[field],
      ...(field === "session" ? { items: SESSION_ITEMS.map(item => item.label), description: SESSION_ITEMS[this.selected]?.description } : {}),
    };
  }

  setValue(value: string): void {
    const { field } = this.view();
    if (field) this.drafts[this.page as MenuCommand][field] = value;
  }

  back(): boolean {
    this.error = "";
    if (this.page === "menu") return false;
    const previous = this.page;
    if (this.page === "start" || this.page === "gateway") this.page = "menu";
    else if (this.step > 0) this.step--;
    else this.page = this.page === "core" || this.page === "chat" ? "start"
      : this.page === "config" || this.page === "attach" ? "menu" : "gateway";
    this.resetSelection();
    if (this.page === "menu" || this.page === "start" || this.page === "gateway") {
      this.selected = Math.max(0, MENUS[this.page].findIndex(item => item.target === previous));
    }
    return true;
  }

  submit(value?: string): MenuRequest | "exit" | undefined {
    this.error = "";
    if (this.page === "menu" || this.page === "start" || this.page === "gateway") {
      const target = MENUS[this.page][this.selected].target;
      if (target === "exit") return "exit";
      if (target === "back") { this.back(); return; }
      this.page = target;
      this.step = 0;
      this.resetSelection();
      return;
    }
    const command = this.page;
    const field = STEPS[command][this.step];
    if (field === "session" && this.selected === 2) { this.back(); return; }
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
