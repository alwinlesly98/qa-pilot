import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import { ARTIFACTS_DIR, HOST, PORT, WEB_DIST } from "./config";
import { api } from "./routes/api";
import { attachEvents } from "./runner/events";
import { recoverRuns } from "./runner/queue";
import { REPORTS_DIR } from "./services/suite";

recoverRuns();

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use("/api", api);
app.use("/artifacts", express.static(ARTIFACTS_DIR, { fallthrough: false }));
app.use("/reports", express.static(REPORTS_DIR, { fallthrough: false })); // Playwright HTML reports

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
}

const server = http.createServer(app);
attachEvents(new WebSocketServer({ server, path: "/ws" }));

server.listen(PORT, HOST, () => {
  console.log(`QA Pilot server running at http://localhost:${PORT}${HOST === "0.0.0.0" ? " (shared on the network)" : ""}`);
});
