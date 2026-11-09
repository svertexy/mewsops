import type { AddressInfo } from "node:net";
import { it, expect } from "vitest";
import { createDatabase } from "../../src/db/index.js";
import { createConnectedTracker } from "../../src/tracker/server.js";

it("rejects reports and uploads when another tab has changed the signed-in account", async () => {
  const db = createDatabase(":memory:");
  const {server, accounts} = createConnectedTracker(db, "unused", "manual");
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    async function login(user: string) {
      const code = accounts.find(account => account.person.userId === user)!.code;
      const response = await fetch(base + "/login", {method:"POST", redirect:"manual",
        headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:new URLSearchParams({user, code})});
      expect(response.status).toBe(303);
      return response.headers.get("set-cookie")!.split(";")[0];
    }
    const luz = await login("luz");
    const nico = await login("nico");
    const report = {clientRequestId:"account-check",c:0,text:"A fictional sighting",time:new Date().toISOString(),mediaIds:[]};
    const send = (cookie: string, expected?: string) => fetch(base + "/api/tracker/reports", {method:"POST",
      headers:{cookie,"Content-Type":"application/json",...(expected && {"X-Mews-User":expected})}, body:JSON.stringify(report)});
    const before = (db.prepare("SELECT COUNT(*) AS n FROM reports").get() as {n:number}).n;
    const switched = await send(nico, "luz");
    expect(switched.status).toBe(409);
    expect((await switched.json()).error.code).toBe("ACCOUNT_CHANGED");
    expect((await send(nico)).status).toBe(409);
    const upload = await fetch(base + "/api/media", {method:"POST",headers:{cookie:nico,"Content-Type":"image/png","X-Mews-User":"luz"},body:"not an image"});
    expect(upload.status).toBe(409);
    expect((db.prepare("SELECT COUNT(*) AS n FROM reports").get() as {n:number}).n).toBe(before);
    expect((await send(luz, "luz")).status).toBe(201);
    expect((db.prepare("SELECT actor_id FROM reports WHERE client_request_id=?").get("account-check") as {actor_id:string}).actor_id).toBe("luz");
    const logout = await fetch(base + "/api/tracker/logout", {method:"POST",headers:{cookie:nico,"X-Mews-User":"luz"}});
    expect(logout.status).toBe(409);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});
