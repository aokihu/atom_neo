import { createMCPClient } from "@ai-sdk/mcp";
import type { Logger } from "@atom-neo/shared";

export type MCPServerConfig = {
  name: string;
  transport:
    | { type: "http"; url: string; headers?: Record<string, string> }
    | { type: "sse"; url: string; headers?: Record<string, string> }
    | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string>; cwd?: string };
};

export type MCPServerStatus = {
  name: string;
  online: boolean;
  toolNames: string[];
};

export type MCPClient = Awaited<ReturnType<typeof createMCPClient>>;

export async function initMCPClients(
  configs: MCPServerConfig[],
  logger?: Logger,
): Promise<{ clients: MCPClient[]; matchedConfigs: MCPServerConfig[] }> {
  const clients: MCPClient[] = [];
  const matchedConfigs: MCPServerConfig[] = [];

  for (const cfg of configs) {
    try {
      const client = await createMCPClient({ transport: cfg.transport as any });
      clients.push(client);
      matchedConfigs.push(cfg);
      logger?.info("mcp client connected", { name: cfg.name, transport: cfg.transport.type });
    } catch (err: any) {
      logger?.warn("mcp client connection failed", { name: cfg.name, error: err?.message ?? String(err) });
    }
  }

  return { clients, matchedConfigs };
}

export async function fetchMCPTools(
  clients: MCPClient[],
  matchedConfigs: MCPServerConfig[],
  logger?: Logger,
): Promise<{ tools: Record<string, any>; toolServers: Record<string, string> }> {
  const tools: Record<string, any> = {};
  const toolServers: Record<string, string> = {};

  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    const serverName = matchedConfigs[i]?.name ?? `mcp-${i}`;
    try {
      const toolSet = await client.tools();
      for (const name of Object.keys(toolSet)) {
        if (tools[name]) {
          logger?.warn("mcp tool name conflict", { name, existingServer: toolServers[name], newServer: serverName });
        }
        tools[name] = toolSet[name];
        toolServers[name] = serverName;
      }
      logger?.info("mcp tools fetched", { server: serverName, count: Object.keys(toolSet).length });
    } catch (err: any) {
      logger?.warn("mcp tools fetch failed", { server: serverName, error: err?.message ?? String(err) });
    }
  }

  return { tools, toolServers };
}

export async function closeMCPClients(clients: MCPClient[]): Promise<void> {
  await Promise.all(clients.map(c => c.close().catch(() => {})));
}

export function getMCPToolNames(clients: MCPClient[], matchedConfigs: MCPServerConfig[], toolServers: Record<string, string>): MCPServerStatus[] {
  const serverTools = new Map<string, string[]>();
  for (const [toolName, serverName] of Object.entries(toolServers)) {
    const list = serverTools.get(serverName) ?? [];
    list.push(toolName);
    serverTools.set(serverName, list);
  }

  return matchedConfigs.map(cfg => ({
    name: cfg.name,
    online: clients.some(() => serverTools.has(cfg.name)),
    toolNames: serverTools.get(cfg.name) ?? [],
  }));
}

export async function checkMCPHealth(
  clients: MCPClient[],
  matchedConfigs: MCPServerConfig[],
  toolServers: Record<string, string>,
  logger?: Logger,
): Promise<MCPServerStatus[]> {
  const results: MCPServerStatus[] = [];
  const serverTools = new Map<string, string[]>();
  for (const [toolName, serverName] of Object.entries(toolServers)) {
    const list = serverTools.get(serverName) ?? [];
    list.push(toolName);
    serverTools.set(serverName, list);
  }

  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    const cfg = matchedConfigs[i];
    if (!cfg) continue;
    let online = false;
    try {
      await client.listResources();
      online = true;
    } catch {
      try {
        await client.tools();
        online = true;
      } catch { /* offline */ }
    }
    results.push({
      name: cfg.name,
      online,
      toolNames: serverTools.get(cfg.name) ?? [],
    });
  }

  return results;
}

export function startMCPHealthCheck(
  clients: MCPClient[],
  matchedConfigs: MCPServerConfig[],
  toolServers: Record<string, string>,
  onStatusChange: (statuses: MCPServerStatus[]) => void,
  logger?: Logger,
): () => void {
  const INTERVAL_MS = 30_000;
  let lastOnline: Record<string, boolean> = {};
  for (const cfg of matchedConfigs) lastOnline[cfg.name] = true;

  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  const run = async () => {
    if (stopped || clients.length === 0) return;
    try {
      const statuses = await checkMCPHealth(clients, matchedConfigs, toolServers, logger);
      const changed = statuses.some(s => lastOnline[s.name] !== s.online);
      if (changed) {
        for (const s of statuses) lastOnline[s.name] = s.online;
        onStatusChange(statuses);
      }
    } catch { /* ignore single check failure */ }
  };

  timer = setInterval(run, INTERVAL_MS);
  run(); // first run immediately

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}
