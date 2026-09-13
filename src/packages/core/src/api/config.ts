import { z } from "zod";

interface ConfigRuntimeLike {
  appConfig: Record<string, unknown>;
  updateRuntimeConfig?(patch: unknown): Record<string, unknown>;
  resetRuntimeConfig?(): Record<string, unknown>;
}

export { isAdminRequest } from "@atom-neo/shared";

export function configGetHandler(runtime: ConfigRuntimeLike): Response {
  return Response.json(runtime.appConfig);
}

export async function configPatchHandler(runtime: ConfigRuntimeLike, req: Request): Promise<Response> {
  if (!runtime.updateRuntimeConfig) return Response.json({ error: "Runtime config updates unavailable" }, { status: 501 });
  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    return Response.json(runtime.updateRuntimeConfig(body));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({
        error: "Invalid config patch",
        issues: err.issues.map(i => ({ path: i.path.join("."), message: i.message })),
      }, { status: 400 });
    }
    return Response.json({ error: String(err) }, { status: 400 });
  }
}

export function configResetHandler(runtime: ConfigRuntimeLike): Response {
  if (!runtime.resetRuntimeConfig) return Response.json({ error: "Runtime config resets unavailable" }, { status: 501 });
  return Response.json(runtime.resetRuntimeConfig());
}
