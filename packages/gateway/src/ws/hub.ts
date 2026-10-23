import { logger } from '@aidev/adapters';
import { WorkspaceServerMessageSchema, type WorkspaceServerMessage } from '@aidev/protocol';
import type { WebSocket } from 'ws';

const WS_OPEN = 1;

/** Per-project sockets for `git.changed` and `project.activity`. */
export class WorkspaceHub {
  private readonly sockets = new Map<string, Set<WebSocket>>();

  add(projectId: string, socket: WebSocket): void {
    let peers = this.sockets.get(projectId);
    if (!peers) {
      peers = new Set();
      this.sockets.set(projectId, peers);
    }
    peers.add(socket);
  }

  remove(projectId: string, socket: WebSocket): void {
    const peers = this.sockets.get(projectId);
    if (!peers) return;
    peers.delete(socket);
    if (peers.size === 0) this.sockets.delete(projectId);
  }

  broadcast(projectId: string, message: WorkspaceServerMessage): void {
    const sockets = this.sockets.get(projectId);
    if (!sockets) return;
    const payload = encode(message);
    if (!payload) return;
    for (const socket of sockets) write(socket, payload);
  }
}

function encode(message: WorkspaceServerMessage): string | undefined {
  const parsed = WorkspaceServerMessageSchema.safeParse(message);
  if (!parsed.success) {
    logger.error(parsed.error.issues.map((issue) => issue.message).join('; '));
    return undefined;
  }
  return JSON.stringify(parsed.data);
}

function write(socket: WebSocket, payload: string): void {
  if (socket.readyState !== WS_OPEN) return;
  try {
    socket.send(payload);
  } catch {
    // The client went away.
  }
}
