// Plain terminal prompts, restored before the selected application takes over.
import { emitKeypressEvents, type Key } from "node:readline";
import { MenuFlow, type MenuRequest } from "./menu-flow";

export function buildMenuScreen(flow: MenuFlow, columns: number, cursor: number) {
  const view = flow.view();
  const clipLine = (line: string) => {
    if (Bun.stringWidth(line) < columns) return line;
    const characters = Array.from(line);
    while (characters.length && Bun.stringWidth(characters.join("")) > columns - 2) characters.pop();
    return characters.join("") + "…";
  };
  const wrapHelp = (text: string) => {
    const rows: string[] = [];
    let row = "";
    for (const character of text) {
      if (row && Bun.stringWidth(row + character) > Math.max(1, columns - 4)) {
        rows.push(row.trimEnd());
        row = "";
      }
      row += character;
    }
    rows.push(row.trimEnd());
    return rows;
  };
  const helpLine = (line: string) => line ? `  \x1b[2m${line}\x1b[0m` : "";
  const lines = ["  atom menu", "", `  ${view.title === "menu" ? "选择要执行的命令" : view.title}`, ""].map(clipLine);
  let inputCursor: { row: number; column: number } | undefined;
  if (view.field) {
    lines.push(clipLine(`  [${view.step}/${view.total}] ${view.label}`));
    lines.push(...(view.help ?? []).flatMap(wrapHelp).map(helpLine));
    if (!view.items) lines.push("");
  }
  if (view.items) {
    lines.push(...view.items.map((item, i) => i === flow.selected ? `  \x1b[7m❯ ${item}\x1b[0m` : `    ${item}`));
    const description = (view.description ?? []).flatMap(wrapHelp);
    if (description.length > 2) description[1] += "…";
    lines.push("", ...[description[0] ?? "", description[1] ?? ""].map(helpLine));
  } else {
    const characters = Array.from(view.value ?? "");
    const width = Math.max(4, columns - 6);
    let start = cursor;
    while (start > 0 && Bun.stringWidth(characters.slice(start - 1, cursor).join("")) < width - 1) start--;
    let visible = characters.slice(start).join("");
    while (Bun.stringWidth(visible) > width) visible = Array.from(visible).slice(0, -1).join("");
    inputCursor = { row: lines.length + 1, column: 5 + Bun.stringWidth(characters.slice(start, cursor).join("")) };
    lines.push(`  ${start ? "…" : ">"} ${visible}`);
    lines.push(...wrapHelp("回车沿用当前值，也可直接修改。").map(helpLine));
  }
  const action = view.field && view.step === view.total ? "执行" : "继续";
  const hint = view.items
    ? `↑ ↓ 选择  Enter / → ${view.field ? action : "进入"}  ${flow.page === "menu" ? "Esc 退出" : "← / Esc 返回"}`
    : `Enter ${action}  Esc 上一步  Ctrl+U 清空`;
  if (flow.error) lines.push("", `  ! ${flow.error}`);
  lines.push("", `  ${hint}`, "  Ctrl+C 退出");
  return { lines, cursor: inputCursor };
}

export function startMenu(flow: MenuFlow): Promise<MenuRequest | null> {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY || !output.isTTY) return Promise.reject(new Error("menu requires an interactive terminal; use --help for direct commands"));

  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw;
    let cursor = Array.from(flow.view().value ?? "").length;
    let pasting = false;
    let finished = false;

    const finish = (request: MenuRequest | null, error?: unknown) => {
      if (finished) return;
      finished = true;
      input.off("keypress", onKey);
      input.off("end", cancel);
      input.off("error", onError);
      process.off("SIGTERM", cancel);
      output.off("resize", render);
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\x1b[?2004l\x1b[?25h\x1b[?1049l");
      if (error) reject(error); else resolve(request);
    };
    const cancel = () => finish(null);
    const onError = (error: Error) => finish(null, error);
    const render = () => {
      if (finished) return;
      const screen = buildMenuScreen(flow, output.columns || 80, cursor);
      output.write(`\x1b[?25l\x1b[H${screen.lines.map(line => `\x1b[2K${line}`).join("\n")}\x1b[J`);
      if (screen.cursor) {
        output.write(`\x1b[${screen.cursor.row};${screen.cursor.column}H\x1b[?25h`);
      }
    };
    const onKey = (text: string | undefined, key: Key & { code?: string }) => {
      if (finished) return;
      if (key.sequence === "\x1b[200~") { pasting = true; return; }
      if (key.sequence === "\x1b[201~") { pasting = false; return; }
      if (key.ctrl && (key.name === "c" || key.name === "d")) { cancel(); return; }
      const view = flow.view();
      if (!pasting && (key.name === "escape" || (key.name === "left" && view.items && flow.page !== "menu"))) {
        if (!flow.back()) { cancel(); return; }
        cursor = Array.from(flow.view().value ?? "").length;
        render();
        return;
      }
      const isSubmitKey = key.name === "return" || key.name === "enter" || (key.name === "right" && Boolean(view.items));
      if (view.items) {
        if (pasting) return;
        if (key.name === "up" || key.name === "down") {
          flow.selected = (flow.selected + (key.name === "down" ? 1 : view.items.length - 1)) % view.items.length;
        }
        if (key.name === "home") flow.selected = 0;
        if (key.name === "end") flow.selected = view.items.length - 1;
        if (view.field && flow.selected < view.items.length - 1) flow.setValue(view.items[flow.selected]);
      } else {
        const chars = Array.from(view.value ?? "");
        if (key.name === "left") cursor = Math.max(0, cursor - 1);
        else if (key.name === "right") cursor = Math.min(chars.length, cursor + 1);
        else if (key.name === "home" || (key.ctrl && key.name === "a")) cursor = 0;
        else if (key.name === "end" || (key.ctrl && key.name === "e")) cursor = chars.length;
        else if (key.name === "backspace" && cursor > 0) chars.splice(--cursor, 1);
        else if (key.name === "delete") chars.splice(cursor, 1);
        else if (key.ctrl && key.name === "u") { chars.splice(0, cursor); cursor = 0; }
        else if (key.ctrl && key.name === "w") {
          const before = chars.slice(0, cursor).join("");
          const count = Array.from(before.match(/\s*\S+\s*$/)?.[0] ?? "").length;
          chars.splice(cursor - count, count); cursor -= count;
        } else if ((!key.ctrl && !key.meta && !key.code && text && !isSubmitKey) || (pasting && isSubmitKey)) {
          const inserted = Array.from(pasting && isSubmitKey ? " " : text!.replace(/[\x00-\x1f\x7f-\x9f]/g, ""));
          chars.splice(cursor, 0, ...inserted); cursor += inserted.length;
        }
        flow.setValue(chars.join(""));
      }
      if (isSubmitKey && !pasting) {
        try {
          const request = flow.submit();
          if (request) { finish(request === "exit" ? null : request); return; }
          cursor = Array.from(flow.view().value ?? "").length;
        } catch (error) {
          flow.error = error instanceof Error ? error.message : String(error);
        }
      }
      render();
    };

    emitKeypressEvents(input);
    input.on("keypress", onKey);
    input.once("end", cancel);
    input.once("error", onError);
    process.once("SIGTERM", cancel);
    output.on("resize", render);
    input.setRawMode(true);
    input.resume();
    output.write("\x1b[?1049h\x1b[?2004h");
    render();
  });
}
