// Plain terminal prompts, restored before the selected application takes over.
import { emitKeypressEvents, type Key } from "node:readline";
import { MenuFlow, type MenuRequest } from "./menu-flow";

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
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\x1b[?2004l\x1b[?25h\x1b[?1049l");
      if (error) reject(error); else resolve(request);
    };
    const cancel = () => finish(null);
    const onError = (error: Error) => finish(null, error);
    const render = () => {
      const view = flow.view();
      const lines = ["atom menu", "", view.title, ""];
      let column = 0;
      if (view.items) {
        lines.push(...view.items.map((item, i) => `${i === flow.selected ? "❯" : " "} ${item}`));
      } else {
        const characters = Array.from(view.value ?? "");
        const width = Math.max(4, (output.columns || 80) - 4);
        let start = cursor;
        while (start > 0 && Bun.stringWidth(characters.slice(start - 1, cursor).join("")) < width - 1) start--;
        let visible = characters.slice(start).join("");
        while (Bun.stringWidth(visible) > width) visible = Array.from(visible).slice(0, -1).join("");
        column = 3 + Bun.stringWidth(characters.slice(start, cursor).join(""));
        lines.push(view.label ?? "", `${start ? "…" : ">"} ${visible}`);
      }
      lines.push("", flow.error, "", view.items ? "↑ ↓ 选择  Enter 确认  Esc 返回  Ctrl+C 退出" : "Enter 继续  Esc 返回  Ctrl+C 退出");
      output.write(`\x1b[?25l\x1b[2J\x1b[H${lines.join("\n")}`);
      if (!view.items) {
        output.write(`\x1b[6;${column}H\x1b[?25h`);
      }
    };
    const onKey = (text: string | undefined, key: Key & { code?: string }) => {
      if (finished) return;
      if (key.sequence === "\x1b[200~") { pasting = true; return; }
      if (key.sequence === "\x1b[201~") { pasting = false; return; }
      if (key.ctrl && (key.name === "c" || key.name === "d")) { cancel(); return; }
      if (key.name === "escape" && !pasting) {
        if (!flow.back()) { cancel(); return; }
        cursor = Array.from(flow.view().value ?? "").length;
        render();
        return;
      }
      const view = flow.view();
      const isSubmitKey = key.name === "return" || key.name === "enter";
      if (view.items) {
        if (pasting) return;
        if (key.name === "up" || key.name === "down") {
          flow.selected = (flow.selected + (key.name === "down" ? 1 : view.items.length - 1)) % view.items.length;
        }
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
    input.setRawMode(true);
    input.resume();
    output.write("\x1b[?1049h\x1b[?2004h");
    render();
  });
}
