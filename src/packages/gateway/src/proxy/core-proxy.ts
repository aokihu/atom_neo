export class CoreProxy {
  #coreUrl: string;

  constructor(coreUrl: string) {
    this.#coreUrl = coreUrl.replace(/\/$/, "");
  }

  async proxy(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const target = this.#coreUrl + url.pathname + url.search;

    try {
      const res = await fetch(target, {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
      });

      return new Response(res.body, {
        status: res.status,
        headers: res.headers,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Gateway proxy error" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
}
