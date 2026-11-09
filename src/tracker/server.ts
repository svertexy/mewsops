import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import type { Db } from "../db/index.js";
import { createApiServer } from "../app.js";
import { actorFromVerifiedSession } from "../api/session.js";
import type { AnalyzeReport } from "../api/processing.js";
import { createTrackerSessions } from "./session.js";
import { trackerDescriptions } from "./store.js";
import { DomainError, type Actor } from "../domain/index.js";

export type AnalysisMode = "manual" | "fixture" | "live";
const assets: Record<string, string> = {
  "/style.css": "text/css", "/app.js": "text/javascript",
  "/map.webp": "image/webp", "/calico1.jpg": "image/jpeg", "/calico2.jpg": "image/jpeg",
};
const webRoot = new URL("../../mobile/web/", import.meta.url);
const loginPage = new URL("../../mobile/host/tracker-login.html", import.meta.url);

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}
function redirect(res: ServerResponse, path: string) {
  res.writeHead(303, { Location: path });
  res.end();
}

export function createConnectedTracker(db: Db, uploadDir: string, analysisMode: AnalysisMode, analyzeReport?: AnalyzeReport, options?: { sessions?: ReturnType<typeof createTrackerSessions>; awaitAnalysis?: boolean }) {
  const sessions = options?.sessions ?? createTrackerSessions();
  const api = createApiServer({
    db, uploadDir, analyzeReport, vettedDemoDescriptions: trackerDescriptions,
    tracker: { analysisMode, processorUserId: "beatriz", awaitAnalysis: options?.awaitAnalysis }, timeoutMs: 45000,
    verifiedSubject: async req => sessions.get(req),
  });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = (req.url ?? "/").split("?")[0];
    const method = req.method;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const origin = req.headers.origin;
    if (method === "POST" && origin && origin !== "http://" + req.headers.host &&
        origin !== "https://" + req.headers.host) return json(res, 403, { error: "Cross-origin write denied" });
    if (path === "/login" && (method === "GET" || method === "POST")) {
      res.setHeader("Referrer-Policy", "same-origin");
      let invalid = false;
      if (method === "POST") {
        if (req.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded")
          return json(res, 415, { error: "Use the sign-in form" });
        let body = "";
        for await (const part of req.iterator({ destroyOnReturn: false })) {
          body += part.toString();
          if (body.length > 512) { req.resume(); return json(res, 413, { error: "Sign-in form too large" }); }
        }
        const form = new URLSearchParams(body);
        const cookie = sessions.login(req, (form.get("user") ?? "").trim().toLowerCase(), form.get("code") ?? "");
        if (cookie) { res.setHeader("Set-Cookie", cookie); return redirect(res, "/"); }
        invalid = true;
      }
      const page = await readFile(loginPage, "utf8");
      res.writeHead(invalid ? 401 : 200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page.replace("<!-- login-error -->", invalid ? '<p role="alert" class="error">Check the name and its access code.</p>' : ""));
    }
    if (path === "/style.css" && method === "GET") {
      res.setHeader("Content-Type", "text/css");
      return res.end(await readFile(new URL("style.css", webRoot)));
    }
    if (path === "/api/tracker/logout" && method === "POST") {
      const current = sessions.get(req);
      if (current && req.headers["x-mews-user"] !== current.userId)
        return json(res, 409, { error: { code: "ACCOUNT_CHANGED", message: "Account changed in another tab. Refresh before continuing." } });
      res.setHeader("Set-Cookie", sessions.logout(req));
      return json(res, 200, { ok: true });
    }
    const person = sessions.get(req);
    if (!person) {
      if (path === "/" && method === "GET") return redirect(res, "/login");
      return json(res, 401, { error: "Sign in to the rescue tracker" });
    }
    let actor: Actor;
    try {
      actor = actorFromVerifiedSession(db, person);
    } catch (error) {
      if (!(error instanceof DomainError) || error.status !== 401) throw error;
      res.setHeader("Set-Cookie", sessions.logout(req));
      return json(res, 401, { error: "Sign in with an active rescue account" });
    }
    if (path === "/api/tracker/session" && method === "GET") {
      const member = db.prepare("SELECT name FROM users WHERE id=?").get(actor.id) as { name: string };
      return json(res, 200, { userId: actor.id, display: member.name, role: actor.role === "staff" ? "founder" : "volunteer", analysisMode });
    }
    if (path.startsWith("/api/") && ((req.headers["x-mews-user"] && req.headers["x-mews-user"] !== person.userId) ||
        (method !== "GET" && req.headers["x-mews-user"] !== person.userId)))
      return json(res, 409, { error: { code: "ACCOUNT_CHANGED", message: "Account changed in another tab. Refresh before continuing." } });
    const colonyPhoto = path === "/api/tracker/reference/marigold" || path === "/calico1.jpg" || path === "/calico2.jpg";
    if (colonyPhoto && actor.role !== "staff" && !actor.assignedColonyIds.includes("colony-1"))
      return json(res, 403, { error: "Colony access required" });
    if (path === "/api/tracker/reference/marigold" && method === "GET") {
      res.setHeader("Content-Type", "image/jpeg");
      return res.end(await readFile(new URL("calico1.jpg", webRoot)));
    }
    if (path.startsWith("/api/tracker/") || path === "/api/health" ||
        path === "/api/media" || /^\/api\/media\/[^/]+$/.test(path)) return api.emit("request", req, res);
    if (path === "/" && method === "GET") {
      const html = await readFile(new URL("index.html", webRoot), "utf8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(html.replace("<head>", "<head><script>window.MEWS_CONNECTED=true</script>"));
    }
    if (method === "GET" && Object.hasOwn(assets, path)) {
      res.setHeader("Content-Type", assets[path]);
      return res.end(await readFile(new URL(path.slice(1), webRoot)));
    }
    json(res, 404, { error: "Unknown route" });
  }
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (res.headersSent) return res.destroy();
      json(res, 500, { error: "Tracker request could not be completed" });
    });
  });
  return { server, accounts: sessions.accounts };
}
