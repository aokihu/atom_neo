/**
 * MCP lifecycle: async connect/fetch/health with stop guarding.
 * Every await re-checks `isStopping` so shutdown never leaks clients or timers.
 */
import type { Logger } from "@atom-neo/shared";
import { WsMessages } from "@atom-neo/shared";
import type { Broadcaster } from "./ws/broadcaster";
import {
  closeMCPClients,
  fetchMCPTools,
  initMCPClients,
  startMCPHealthCheck,
} from "./tools/mcp-manager";
import type { MCPServerConfig } from "./tools/mcp-manager";

export type McpServerInfo = {
  name: string;
  online: boolean;
  toolCount: number;
};

export type McpLifecycleDeps = {
  configs: MCPServerConfig[];
  logger: Logger;
  broadcaster: Broadcaster;
  isStopping: () => boolean;
  getTotalToolCount: () => number;
};

export type McpLifecycle = {
  toolRef: { current: Record<string, any> };
  getServerInfos(): McpServerInfo[];
  start(): void;
  stopHealth(): void;
  close(): Promise<void>;
};

export function createMcpLifecycle(deps: McpLifecycleDeps): McpLifecycle {
  const { configs, logger, broadcaster, isStopping } = deps;
  const toolRef: { current: Record<string, any> } = { current: {} };
  let serverInfos: McpServerInfo[] = [];
  let clients: Awaited<ReturnType<typeof initMCPClients>>["clients"] = [];
  let healthStop: () => void = () => {};

  return {
    toolRef,
    getServerInfos: () => serverInfos,
    start() {
      if (configs.length === 0) return;
      initMCPClients(configs, logger).then(async ({ clients: connected, matchedConfigs }) => {
        if (isStopping()) {
          await closeMCPClients(connected);
          return;
        }
        clients = connected;
        if (connected.length === 0) return;
        const { tools, toolServers } = await fetchMCPTools(connected, matchedConfigs, logger);
        if (isStopping()) {
          clients = [];
          await closeMCPClients(connected);
          return;
        }
        toolRef.current = tools;
        const names = Object.keys(tools);
        logger.info("mcp tools loaded", { mcpToolCount: names.length, totalTools: deps.getTotalToolCount() + names.length });

        serverInfos = matchedConfigs.map(cfg => ({
          name: cfg.name,
          online: true,
          toolCount: names.filter(n => toolServers[n] === cfg.name).length,
        }));

        broadcaster.broadcast(WsMessages.Server.MCPConnected, {
          servers: serverInfos,
          toolInfos: names.map(name => ({ name, source: "mcp" as const, description: (tools[name] as any)?.description ?? "", online: true })),
        });

        const stop = startMCPHealthCheck(connected, matchedConfigs, toolServers, (statuses) => {
          broadcaster.broadcast(WsMessages.Server.MCPToolStatus, { servers: statuses });
          for (const s of statuses) {
            const info = serverInfos.find(i => i.name === s.name);
            if (info) info.online = s.online;
          }
        }, logger);
        if (isStopping()) {
          stop();
          clients = [];
          await closeMCPClients(connected);
          return;
        }
        healthStop = stop;
      }).catch(err => logger.warn("mcp async init failed", { error: String(err) }));
    },
    stopHealth() {
      healthStop();
    },
    async close() {
      await closeMCPClients(clients);
    },
  };
}
