import * as vscode from "vscode";
import { Connection } from "../models/connection";

export class ConnectionManager {
  private readonly connections = new Map<string, Connection>();
  private activeConnectionId: string | undefined;

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeConnections = this.changeEmitter.event;

  addConnection(connection: Connection): void {
    this.connections.set(connection.id, connection);

    if (!this.activeConnectionId) {
      this.activeConnectionId = connection.id;
    }

    this.changeEmitter.fire();
  }

  removeConnection(id: string): void {
    const wasActive = this.activeConnectionId === id;
    this.connections.delete(id);

    if (wasActive) {
      this.activeConnectionId = this.getConnections()[0]?.id;
    }

    this.changeEmitter.fire();
  }

  setActiveConnection(id: string): boolean {
    if (!this.connections.has(id)) {
      return false;
    }

    this.activeConnectionId = id;
    this.changeEmitter.fire();
    return true;
  }

  getActiveConnection(): Connection | undefined {
    if (!this.activeConnectionId) {
      return undefined;
    }

    return this.connections.get(this.activeConnectionId);
  }

  getActiveConnectionId(): string | undefined {
    return this.activeConnectionId;
  }

  getConnections(): Connection[] {
    return Array.from(this.connections.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  getConnectionById(id: string): Connection | undefined {
    return this.connections.get(id);
  }

  clear(): void {
    this.connections.clear();
    this.activeConnectionId = undefined;
    this.changeEmitter.fire();
  }
}
