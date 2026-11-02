import type { WebSocket, WebSocketServer } from "ws";

export type RunEvent =
  | { type: "run"; run: Record<string, unknown> }
  | { type: "result"; result: Record<string, unknown> }
  | { type: "step"; resultId: string; step: Record<string, unknown> }
  | { type: "thinking"; resultId: string; text: string }
  | { type: "frame"; resultId: string; data: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

const subscribers = new Map<string, Set<WebSocket>>();

export function attachEvents(wss: WebSocketServer) {
  wss.on("connection", (socket, req) => {
    const runId = new URL(req.url ?? "", "http://x").searchParams.get("runId");
    if (!runId) return socket.close();
    if (!subscribers.has(runId)) subscribers.set(runId, new Set());
    subscribers.get(runId)!.add(socket);
    socket.on("close", () => subscribers.get(runId)?.delete(socket));
  });
}

export function emit(runId: string, event: RunEvent) {
  const set = subscribers.get(runId);
  if (!set?.size) return;
  const payload = JSON.stringify(event);
  for (const socket of set) {
    // Drop video frames for slow clients instead of buffering them.
    if (event.type === "frame" && socket.bufferedAmount > 2_000_000) continue;
    socket.send(payload);
  }
}
