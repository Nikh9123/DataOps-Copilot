import * as vscode from "vscode";
import { ConnectionManager } from "../services/connectionManager";
import { Connection } from "../models/connection";
import { SecretStorageService } from "../services/secretStorageService";
import { SnowflakeService } from "../services/snowflakeService";
import { getConnectionWithCredentials } from "../utils/connectionCredentials";

type ConnectionNodeType =
  | "connection"
  | "databasesRoot"
  | "database"
  | "schemasRoot"
  | "schema"
  | "tablesRoot"
  | "table"
  | "loading"
  | "info"
  | "error";

export type TablePreviewRequest = {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
};

type NodePayload = {
  connectionId?: string;
  database?: string;
  schema?: string;
  table?: string;
};

export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    readonly nodeType: ConnectionNodeType,
    readonly label: string,
    readonly collapsibleState: vscode.TreeItemCollapsibleState,
    readonly payload: NodePayload = {}
  ) {
    super(label, collapsibleState);
  }
}

export class ConnectionsTreeDataProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ConnectionTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly databasesCache = new Map<string, string[]>();
  private readonly schemasCache = new Map<string, string[]>();
  private readonly tablesCache = new Map<string, string[]>();

  private readonly loadingKeys = new Set<string>();
  private readonly errorKeys = new Map<string, string>();

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly secretStorageService: SecretStorageService,
    private readonly snowflakeService: SnowflakeService
  ) {
    this.connectionManager.onDidChangeConnections(() => this.refresh());
  }

  refresh(item?: ConnectionTreeItem): void {
    this.onDidChangeTreeDataEmitter.fire(item);
  }

  getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ConnectionTreeItem): Thenable<ConnectionTreeItem[]> {
    if (!element) {
      return Promise.resolve(this.getConnectionNodes());
    }

    if (element.nodeType === "connection" && element.payload.connectionId) {
      const connection = this.connectionManager.getConnectionById(element.payload.connectionId);
      if (!connection) {
        return Promise.resolve([this.createInfoNode("Connection unavailable")]);
      }

      if (connection.type !== "snowflake") {
        return Promise.resolve([this.createInfoNode("Metadata explorer available for Snowflake connections")]);
      }

      return Promise.resolve([this.createDatabasesRootNode(connection.id)]);
    }

    if (element.nodeType === "databasesRoot") {
      return Promise.resolve(this.getDatabasesChildren(element));
    }

    if (element.nodeType === "database") {
      const { connectionId, database } = element.payload;
      if (!connectionId || !database) {
        return Promise.resolve([]);
      }

      return Promise.resolve([this.createSchemasRootNode(connectionId, database)]);
    }

    if (element.nodeType === "schemasRoot") {
      return Promise.resolve(this.getSchemasChildren(element));
    }

    if (element.nodeType === "schema") {
      const { connectionId, database, schema } = element.payload;
      if (!connectionId || !database || !schema) {
        return Promise.resolve([]);
      }

      return Promise.resolve([this.createTablesRootNode(connectionId, database, schema)]);
    }

    if (element.nodeType === "tablesRoot") {
      return Promise.resolve(this.getTablesChildren(element));
    }

    return Promise.resolve([]);
  }

  private getConnectionNodes(): ConnectionTreeItem[] {
    const activeId = this.connectionManager.getActiveConnectionId();
    const connections = this.connectionManager.getConnections();

    if (!connections.length) {
      const emptyNode = new ConnectionTreeItem("info", "No connections configured", vscode.TreeItemCollapsibleState.None);
      emptyNode.iconPath = new vscode.ThemeIcon("info");
      return [emptyNode];
    }

    return connections.map((connection) => this.createConnectionNode(connection, activeId));
  }

  private createConnectionNode(connection: Connection, activeId?: string): ConnectionTreeItem {
    const node = new ConnectionTreeItem(
      "connection",
      connection.name,
      vscode.TreeItemCollapsibleState.Collapsed,
      { connectionId: connection.id }
    );
    node.tooltip = `${connection.name} (${connection.type})`;
    node.description = connection.id === activeId ? "active" : connection.type;
    node.iconPath = new vscode.ThemeIcon(connection.id === activeId ? "check" : "database");
    node.contextValue = "dataops.connection";
    node.command = {
      command: "dataops.switchConnection",
      title: "Switch Active Connection"
    };

    return node;
  }

  private getDatabasesChildren(parent: ConnectionTreeItem): ConnectionTreeItem[] {
    const connectionId = parent.payload.connectionId;
    if (!connectionId) {
      return [];
    }

    const key = this.buildDatabasesKey(connectionId);
    if (this.loadingKeys.has(key)) {
      return [this.createLoadingNode()];
    }

    if (this.errorKeys.has(key)) {
      return [this.createErrorNode(this.errorKeys.get(key) ?? "Failed to load databases")];
    }

    const cached = this.databasesCache.get(connectionId);
    if (cached) {
      if (!cached.length) {
        return [this.createInfoNode("No databases found")];
      }

      return cached.map((database) => this.createDatabaseNode(connectionId, database));
    }

    void this.loadDatabases(connectionId, parent, key);
    return [this.createLoadingNode()];
  }

  private getSchemasChildren(parent: ConnectionTreeItem): ConnectionTreeItem[] {
    const connectionId = parent.payload.connectionId;
    const database = parent.payload.database;
    if (!connectionId || !database) {
      return [];
    }

    const key = this.buildSchemasKey(connectionId, database);
    if (this.loadingKeys.has(key)) {
      return [this.createLoadingNode()];
    }

    if (this.errorKeys.has(key)) {
      return [this.createErrorNode(this.errorKeys.get(key) ?? "Failed to load schemas")];
    }

    const cached = this.schemasCache.get(key);
    if (cached) {
      if (!cached.length) {
        return [this.createInfoNode("No schemas found")];
      }

      return cached.map((schema) => this.createSchemaNode(connectionId, database, schema));
    }

    void this.loadSchemas(connectionId, database, parent, key);
    return [this.createLoadingNode()];
  }

  private getTablesChildren(parent: ConnectionTreeItem): ConnectionTreeItem[] {
    const connectionId = parent.payload.connectionId;
    const database = parent.payload.database;
    const schema = parent.payload.schema;

    if (!connectionId || !database || !schema) {
      return [];
    }

    const key = this.buildTablesKey(connectionId, database, schema);
    if (this.loadingKeys.has(key)) {
      return [this.createLoadingNode()];
    }

    if (this.errorKeys.has(key)) {
      return [this.createErrorNode(this.errorKeys.get(key) ?? "Failed to load tables")];
    }

    const cached = this.tablesCache.get(key);
    if (cached) {
      if (!cached.length) {
        return [this.createInfoNode("No tables found")];
      }

      return cached.map((table) => this.createTableNode(connectionId, database, schema, table));
    }

    void this.loadTables(connectionId, database, schema, parent, key);
    return [this.createLoadingNode()];
  }

  private async loadDatabases(connectionId: string, parent: ConnectionTreeItem, key: string): Promise<void> {
    this.loadingKeys.add(key);
    this.errorKeys.delete(key);
    this.refresh(parent);

    try {
      const connection = await this.resolveSnowflakeConnection(connectionId);
      const databases = await this.snowflakeService.getDatabases(connection);
      this.databasesCache.set(connectionId, databases);
    } catch (error) {
      const message = SnowflakeService.getSnowflakeError(error);
      this.errorKeys.set(key, message);
    } finally {
      this.loadingKeys.delete(key);
      this.refresh(parent);
    }
  }

  private async loadSchemas(
    connectionId: string,
    database: string,
    parent: ConnectionTreeItem,
    key: string
  ): Promise<void> {
    this.loadingKeys.add(key);
    this.errorKeys.delete(key);
    this.refresh(parent);

    try {
      const connection = await this.resolveSnowflakeConnection(connectionId);
      const schemas = await this.snowflakeService.getSchemas(connection, database);
      this.schemasCache.set(key, schemas);
    } catch (error) {
      const message = SnowflakeService.getSnowflakeError(error);
      this.errorKeys.set(key, message);
    } finally {
      this.loadingKeys.delete(key);
      this.refresh(parent);
    }
  }

  private async loadTables(
    connectionId: string,
    database: string,
    schema: string,
    parent: ConnectionTreeItem,
    key: string
  ): Promise<void> {
    this.loadingKeys.add(key);
    this.errorKeys.delete(key);
    this.refresh(parent);

    try {
      const connection = await this.resolveSnowflakeConnection(connectionId);
      const tables = await this.snowflakeService.getTables(connection, database, schema);
      this.tablesCache.set(key, tables);
    } catch (error) {
      const message = SnowflakeService.getSnowflakeError(error);
      this.errorKeys.set(key, message);
    } finally {
      this.loadingKeys.delete(key);
      this.refresh(parent);
    }
  }

  private async resolveSnowflakeConnection(connectionId: string): Promise<Connection> {
    const baseConnection = this.connectionManager.getConnectionById(connectionId);
    if (!baseConnection) {
      throw new Error("Connection not found.");
    }

    if (baseConnection.type !== "snowflake") {
      throw new Error("Only Snowflake metadata browsing is supported currently.");
    }

    return getConnectionWithCredentials(baseConnection, this.secretStorageService);
  }

  private createDatabasesRootNode(connectionId: string): ConnectionTreeItem {
    const node = new ConnectionTreeItem("databasesRoot", "Databases", vscode.TreeItemCollapsibleState.Collapsed, {
      connectionId
    });
    node.iconPath = new vscode.ThemeIcon("folder");
    return node;
  }

  private createDatabaseNode(connectionId: string, database: string): ConnectionTreeItem {
    const node = new ConnectionTreeItem("database", database, vscode.TreeItemCollapsibleState.Collapsed, {
      connectionId,
      database
    });
    node.iconPath = new vscode.ThemeIcon("database");
    return node;
  }

  private createSchemasRootNode(connectionId: string, database: string): ConnectionTreeItem {
    const node = new ConnectionTreeItem("schemasRoot", "Schemas", vscode.TreeItemCollapsibleState.Collapsed, {
      connectionId,
      database
    });
    node.iconPath = new vscode.ThemeIcon("folder");
    return node;
  }

  private createSchemaNode(connectionId: string, database: string, schema: string): ConnectionTreeItem {
    const node = new ConnectionTreeItem("schema", schema, vscode.TreeItemCollapsibleState.Collapsed, {
      connectionId,
      database,
      schema
    });
    node.iconPath = new vscode.ThemeIcon("symbol-namespace");
    return node;
  }

  private createTablesRootNode(connectionId: string, database: string, schema: string): ConnectionTreeItem {
    const node = new ConnectionTreeItem("tablesRoot", "Tables", vscode.TreeItemCollapsibleState.Collapsed, {
      connectionId,
      database,
      schema
    });
    node.iconPath = new vscode.ThemeIcon("folder");
    return node;
  }

  private createTableNode(connectionId: string, database: string, schema: string, table: string): ConnectionTreeItem {
    const node = new ConnectionTreeItem("table", table, vscode.TreeItemCollapsibleState.None, {
      connectionId,
      database,
      schema,
      table
    });
    node.iconPath = new vscode.ThemeIcon("table");
    node.command = {
      command: "dataops.previewTableFromTree",
      title: "Preview Table",
      arguments: [
        {
          connectionId,
          database,
          schema,
          table
        } satisfies TablePreviewRequest
      ]
    };

    return node;
  }

  private createLoadingNode(): ConnectionTreeItem {
    const node = new ConnectionTreeItem("loading", "Loading...", vscode.TreeItemCollapsibleState.None);
    node.iconPath = new vscode.ThemeIcon("loading~spin");
    return node;
  }

  private createInfoNode(message: string): ConnectionTreeItem {
    const node = new ConnectionTreeItem("info", message, vscode.TreeItemCollapsibleState.None);
    node.iconPath = new vscode.ThemeIcon("info");
    return node;
  }

  private createErrorNode(message: string): ConnectionTreeItem {
    const node = new ConnectionTreeItem("error", `Error: ${message}`, vscode.TreeItemCollapsibleState.None);
    node.iconPath = new vscode.ThemeIcon("error");
    return node;
  }

  private buildDatabasesKey(connectionId: string): string {
    return `db::${connectionId}`;
  }

  private buildSchemasKey(connectionId: string, database: string): string {
    return `schema::${connectionId}::${database}`;
  }

  private buildTablesKey(connectionId: string, database: string, schema: string): string {
    return `table::${connectionId}::${database}::${schema}`;
  }
}
