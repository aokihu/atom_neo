import { CMDS } from "../CommandMenu";
import type { Command } from "../CommandMenu";

export function resolveCommand(text: string): Command | null {
  return CMDS.find(command => command.name === text) ?? null;
}

export interface CommandHandlers {
  onQuit?: () => void;
  onHelp?: () => void;
  onClear?: () => void;
  onCompact?: () => void;
  onSettings?: () => void;
}

export function dispatchCommand(name: string, handlers: CommandHandlers): void {
  switch (name) {
    case "/quit": handlers.onQuit?.(); break;
    case "/help": handlers.onHelp?.(); break;
    case "/clear": handlers.onClear?.(); break;
    case "/compact": handlers.onCompact?.(); break;
    case "/settings": handlers.onSettings?.(); break;
  }
}
