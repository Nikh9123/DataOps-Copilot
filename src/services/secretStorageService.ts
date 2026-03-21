import * as vscode from "vscode";
import { StoredConnectionMetadata, StoredConnectionSecret } from "../models/connection";

const CONNECTIONS_METADATA_KEY = "dataops.connections.metadata";
const ACTIVE_CONNECTION_KEY = "dataops.connections.active";
const SECRET_PREFIX = "dataops.connection.secret.";

export class SecretStorageService {
  constructor(
    private readonly secretStorage: vscode.SecretStorage,
    private readonly globalState: vscode.Memento
  ) {}

  async saveConnection(id: string, data: StoredConnectionSecret): Promise<void> {
    await this.secretStorage.store(`${SECRET_PREFIX}${id}`, JSON.stringify(data));
  }

  async getConnection(id: string): Promise<StoredConnectionSecret | undefined> {
    const payload = await this.secretStorage.get(`${SECRET_PREFIX}${id}`);
    if (!payload) {
      return undefined;
    }

    try {
      return JSON.parse(payload) as StoredConnectionSecret;
    } catch {
      return undefined;
    }
  }

  async deleteConnection(id: string): Promise<void> {
    await this.secretStorage.delete(`${SECRET_PREFIX}${id}`);
  }

  async saveConnectionMetadata(connection: StoredConnectionMetadata): Promise<void> {
    const existing = await this.getConnectionMetadataList();
    const next = existing.filter((item) => item.id !== connection.id);
    next.push(connection);

    await this.globalState.update(CONNECTIONS_METADATA_KEY, next);
  }

  async getConnectionMetadataList(): Promise<StoredConnectionMetadata[]> {
    return this.globalState.get<StoredConnectionMetadata[]>(CONNECTIONS_METADATA_KEY, []);
  }

  async deleteConnectionMetadata(id: string): Promise<void> {
    const existing = await this.getConnectionMetadataList();
    const next = existing.filter((item) => item.id !== id);
    await this.globalState.update(CONNECTIONS_METADATA_KEY, next);
  }

  async saveActiveConnectionId(id: string | undefined): Promise<void> {
    await this.globalState.update(ACTIVE_CONNECTION_KEY, id);
  }

  async getActiveConnectionId(): Promise<string | undefined> {
    return this.globalState.get<string>(ACTIVE_CONNECTION_KEY);
  }
}
