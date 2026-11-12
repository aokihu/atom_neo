import { useCallback, useEffect, useState } from "react";
import type { ServerInfo } from "../../types";
import {
  buildRuntimePatch,
  headers,
  serverInfoFromConfig,
  settingsValuesFromConfig,
} from "./settings-model";
import type { RowKey } from "./settings-model";

interface UseSettingsConfigOptions {
  open: boolean;
  url: string;
  adminToken?: string;
  serverInfo: ServerInfo;
  onSaved: (info: ServerInfo) => void;
  onClose: () => void;
}

export function useSettingsConfig({ open, url, adminToken, serverInfo, onSaved, onClose }: UseSettingsConfigOptions) {
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [values, setValues] = useState<Record<RowKey, string>>({} as Record<RowKey, string>);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${url}/api/config`, { headers: headers(adminToken) });
      if (!res.ok) throw new Error(`GET /api/config → ${res.status}`);
      const cfg = await res.json();
      setConfig(cfg);
      setValues(settingsValuesFromConfig(cfg));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [url, adminToken]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const patch = useCallback(async (): Promise<void> => {
    if (!config) return;
    const body = buildRuntimePatch(values, config);

    setError(null);
    try {
      const res = await fetch(`${url}/api/config/runtime`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...headers(adminToken) },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `PATCH /api/config/runtime → ${res.status}`);
      }
      onSaved(serverInfoFromConfig(serverInfo, await res.json()));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [config, values, url, adminToken, serverInfo, onSaved, onClose]);

  const reset = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await fetch(`${url}/api/config/runtime`, {
        method: "DELETE",
        headers: headers(adminToken),
      });
      if (!res.ok) throw new Error(`DELETE /api/config/runtime → ${res.status}`);
      onSaved(serverInfoFromConfig(serverInfo, await res.json()));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [url, adminToken, serverInfo, onSaved, onClose]);

  return { config, values, setValues, error, load, patch, reset };
}
