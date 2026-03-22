import * as vscode from "vscode";
import { Connection } from "../models/connection";
import { DatabricksClusterInfo } from "../services/databricksClusterService";
import { DatabricksAppInfo, DatabricksAppsService } from "../services/databricksAppsService";
import { DatabricksJobsService, DatabricksRunInfo } from "../services/databricksJobsService";
import { DatabricksWarehouseInfo } from "../services/databricksWarehouseService";
import { DatabricksQueryHistoryEntry } from "../services/databricksQueryHistoryService";
import { DatabricksClusterService } from "../services/databricksClusterService";
import { DatabricksWarehouseService } from "../services/databricksWarehouseService";
import { DatabricksQueryHistoryService } from "../services/databricksQueryHistoryService";
import { DatabricksMetadataService, DatabricksCatalogInfo, DatabricksSchemaInfo, DatabricksTableInfo } from "../services/databricksMetadataService";

export type DatabricksNodeType =
  | "databricksComputeRoot"
  | "databricksAppsRoot"
  | "databricksApp"
  | "databricksCatalogsRoot"
  | "databricksCatalog"
  | "databricksSchemasRoot"
  | "databricksSchema"
  | "databricksTablesRoot"
  | "databricksTable"
  | "databricksClustersRoot"
  | "databricksCluster"
  | "databricksJobsRoot"
  | "databricksJob"
  | "databricksWarehousesRoot"
  | "databricksWarehouse"
  | "databricksQueryHistoryRoot"
  | "databricksQueryHistoryEntry";

export type DatabricksNodePayload = {
  connectionId: string;
  catalog?: string;
  schema?: string;
  table?: string;
  app?: DatabricksAppInfo;
  cluster?: DatabricksClusterInfo;
  run?: DatabricksRunInfo;
  warehouse?: DatabricksWarehouseInfo;
  queryHistory?: DatabricksQueryHistoryEntry;
};

export type DatabricksVirtualNode = {
  nodeType: DatabricksNodeType | "loading" | "info" | "error";
  label: string;
  description?: string;
  iconName?: string;
  collapsibleState: vscode.TreeItemCollapsibleState;
  payload?: Partial<DatabricksNodePayload>;
  contextValue?: string;
  command?: {
    command: string;
    title: string;
    arguments?: unknown[];
  };
};

export class DatabricksTreeProvider implements vscode.Disposable {
  private readonly appsCache = new Map<string, DatabricksAppInfo[]>();
  private readonly clustersCache = new Map<string, DatabricksClusterInfo[]>();
  private readonly jobsCache = new Map<string, DatabricksRunInfo[]>();
  private readonly warehousesCache = new Map<string, DatabricksWarehouseInfo[]>();
  private readonly queryHistoryCache = new Map<string, DatabricksQueryHistoryEntry[]>();
  private readonly catalogsCache = new Map<string, DatabricksCatalogInfo[]>();
  private readonly databricksSchemasCache = new Map<string, DatabricksSchemaInfo[]>();
  private readonly databricksTablesCache = new Map<string, DatabricksTableInfo[]>();
  private readonly loadingKeys = new Set<string>();
  private readonly errorKeys = new Map<string, string>();

  constructor(
    private readonly appsService: DatabricksAppsService,
    private readonly clusterService: DatabricksClusterService,
    private readonly jobsService: DatabricksJobsService,
    private readonly warehouseService: DatabricksWarehouseService,
    private readonly queryHistoryService: DatabricksQueryHistoryService,
    private readonly metadataService: DatabricksMetadataService,
    private readonly resolveConnection: (connectionId: string) => Promise<Connection>,
    private readonly refreshCallback: () => void
  ) {}

  dispose(): void {
    // No resources to dispose.
  }

  clearCaches(): void {
    this.appsCache.clear();
    this.clustersCache.clear();
    this.jobsCache.clear();
    this.warehousesCache.clear();
    this.queryHistoryCache.clear();
    this.catalogsCache.clear();
    this.databricksSchemasCache.clear();
    this.databricksTablesCache.clear();
    this.loadingKeys.clear();
    this.errorKeys.clear();
  }

  getConnectionRoots(connectionId: string): DatabricksVirtualNode[] {
    return [
      this.createRootNode("databricksComputeRoot", "Compute", connectionId, "server-environment"),
      this.createRootNode("databricksCatalogsRoot", "Catalogs", connectionId, "folder-library"),
      this.createRootNode("databricksJobsRoot", "Jobs", connectionId, "run"),
      this.createRootNode("databricksQueryHistoryRoot", "Query History", connectionId, "history")
    ];
  }

  getChildren(nodeType: DatabricksNodeType, payload: Partial<DatabricksNodePayload>): DatabricksVirtualNode[] {
    const connectionId = payload.connectionId;
    if (!connectionId) {
      return [this.createInfoNode("Connection unavailable")];
    }

    switch (nodeType) {
      case "databricksComputeRoot":
        return [
          {
            nodeType: "databricksWarehousesRoot",
            label: "SQL Warehouses",
            iconName: "database",
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            payload: { connectionId }
          },
          {
            nodeType: "databricksClustersRoot",
            label: "Clusters",
            iconName: "server-process",
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            payload: { connectionId }
          },
          {
            nodeType: "databricksAppsRoot",
            label: "Apps",
            iconName: "package",
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            payload: { connectionId }
          }
        ];
      case "databricksAppsRoot":
        return this.getSectionChildren(
          `apps::${connectionId}`,
          this.appsCache.get(connectionId),
          () => this.loadApps(connectionId),
          (apps) =>
            apps.map((app) => ({
              nodeType: "databricksApp",
              label: app.name,
              description: app.state,
              iconName: this.getStateIcon(app.state),
              collapsibleState: vscode.TreeItemCollapsibleState.None,
              payload: { connectionId, app },
              contextValue: "dataops.databricksApp",
              command: {
                command: "dataops.showDatabricksDetails",
                title: "Show Databricks App Details",
                arguments: [{ connectionId, app }]
              }
            }))
        );
      case "databricksApp":
        return [];
      case "databricksCatalogsRoot":
        return this.getSectionChildren(
          `catalogs::${connectionId}`,
          this.catalogsCache.get(connectionId),
          () => this.loadCatalogs(connectionId),
          (catalogs) =>
            catalogs.map((catalog) => ({
              nodeType: "databricksCatalog",
              label: catalog.name,
              iconName: "folder",
              collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
              payload: { connectionId, catalog: catalog.name }
            }))
        );
      case "databricksCatalog":
        if (!payload.catalog) {
          return [this.createInfoNode("Catalog unavailable")];
        }
        return [
          {
            nodeType: "databricksSchemasRoot",
            label: "Schemas",
            iconName: "folder",
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            payload: { connectionId, catalog: payload.catalog }
          }
        ];
      case "databricksSchemasRoot":
        if (!payload.catalog) {
          return [this.createInfoNode("Catalog unavailable")];
        }
        return this.getSectionChildren(
          `schemas::${connectionId}::${payload.catalog}`,
          this.databricksSchemasCache.get(`schemas::${connectionId}::${payload.catalog}`),
          () => this.loadSchemas(connectionId, payload.catalog as string),
          (schemas) =>
            schemas.map((schema) => ({
              nodeType: "databricksSchema",
              label: schema.name,
              iconName: "symbol-namespace",
              collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
              payload: { connectionId, catalog: payload.catalog, schema: schema.name }
            }))
        );
      case "databricksSchema":
        if (!payload.catalog || !payload.schema) {
          return [this.createInfoNode("Schema unavailable")];
        }
        return [
          {
            nodeType: "databricksTablesRoot",
            label: "Tables",
            iconName: "folder",
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            payload: { connectionId, catalog: payload.catalog, schema: payload.schema }
          }
        ];
      case "databricksTablesRoot":
        if (!payload.catalog || !payload.schema) {
          return [this.createInfoNode("Schema unavailable")];
        }
        return this.getSectionChildren(
          `tables::${connectionId}::${payload.catalog}::${payload.schema}`,
          this.databricksTablesCache.get(`tables::${connectionId}::${payload.catalog}::${payload.schema}`),
          () => this.loadTables(connectionId, payload.catalog as string, payload.schema as string),
          (tables) =>
            tables.map((table) => ({
              nodeType: "databricksTable",
              label: table.name,
              description: table.type,
              iconName: table.type.toUpperCase().includes("VIEW") ? "symbol-interface" : "table",
              collapsibleState: vscode.TreeItemCollapsibleState.None,
              payload: { connectionId, catalog: payload.catalog, schema: payload.schema, table: table.name },
              contextValue: "dataops.databricksTable",
              command: {
                command: "dataops.previewTable",
                title: "Preview Databricks Table",
                arguments: [
                  {
                    connectionId,
                    database: payload.catalog,
                    schema: payload.schema,
                    table: table.name,
                    catalog: payload.catalog,
                    platform: "databricks"
                  }
                ]
              }
            }))
        );
      case "databricksClustersRoot":
        return this.getSectionChildren(
          `clusters::${connectionId}`,
          this.clustersCache.get(connectionId),
          () => this.loadClusters(connectionId),
          (clusters) =>
            clusters.map((cluster) => ({
              nodeType: "databricksCluster",
              label: cluster.name,
              description: cluster.state,
              iconName: this.getStateIcon(cluster.state),
              collapsibleState: vscode.TreeItemCollapsibleState.None,
              payload: { connectionId, cluster },
              contextValue: "dataops.databricksCluster",
              command: {
                command: "dataops.showDatabricksDetails",
                title: "Show Databricks Cluster Details",
                arguments: [{ connectionId, cluster }]
              }
            }))
        );
      case "databricksJobsRoot":
        return this.getSectionChildren(
          `jobs::${connectionId}`,
          this.jobsCache.get(connectionId),
          () => this.loadRuns(connectionId),
          (runs) =>
            runs.map((run) => ({
              nodeType: "databricksJob",
              label: `Job ${run.jobId}`,
              description: run.state,
              iconName: this.getStateIcon(run.state),
              collapsibleState: vscode.TreeItemCollapsibleState.None,
              payload: { connectionId, run },
              contextValue: "dataops.databricksJob",
              command: {
                command: "dataops.showDatabricksDetails",
                title: "Show Databricks Job Details",
                arguments: [{ connectionId, run }]
              }
            }))
        );
      case "databricksWarehousesRoot":
        return this.getSectionChildren(
          `warehouses::${connectionId}`,
          this.warehousesCache.get(connectionId),
          () => this.loadWarehouses(connectionId),
          (warehouses) =>
            warehouses.map((warehouse) => ({
              nodeType: "databricksWarehouse",
              label: warehouse.name,
              description: warehouse.state,
              iconName: this.getStateIcon(warehouse.state),
              collapsibleState: vscode.TreeItemCollapsibleState.None,
              payload: { connectionId, warehouse },
              contextValue: "dataops.databricksWarehouse",
              command: {
                command: "dataops.showDatabricksDetails",
                title: "Show Databricks Warehouse Details",
                arguments: [{ connectionId, warehouse }]
              }
            }))
        );
      case "databricksQueryHistoryRoot":
        return this.getSectionChildren(
          `queryHistory::${connectionId}`,
          this.queryHistoryCache.get(connectionId),
          () => this.loadQueryHistory(connectionId),
          (queries) =>
            queries.map((query) => ({
              nodeType: "databricksQueryHistoryEntry",
              label: truncate(query.queryText),
              description: `${query.status} • ${query.user}`,
              iconName: this.getStateIcon(query.status),
              collapsibleState: vscode.TreeItemCollapsibleState.None,
              payload: { connectionId, queryHistory: query },
              contextValue: "dataops.databricksQueryHistory"
            }))
        );
      default:
        return [];
    }
  }

  private getSectionChildren<T>(
    key: string,
    cached: T[] | undefined,
    loader: () => Promise<void>,
    render: (items: T[]) => DatabricksVirtualNode[]
  ): DatabricksVirtualNode[] {
    if (this.loadingKeys.has(key)) {
      return [this.createLoadingNode()];
    }

    if (this.errorKeys.has(key)) {
      return [this.createErrorNode(this.errorKeys.get(key) ?? "Failed to load Databricks resources")];
    }

    if (cached) {
      if (!cached.length) {
        return [this.createInfoNode("No resources found")];
      }
      return render(cached);
    }

    void loader();
    return [this.createLoadingNode()];
  }

  private async loadClusters(connectionId: string): Promise<void> {
    await this.load(`clusters::${connectionId}`, async () => {
      const connection = await this.resolveConnection(connectionId);
      this.clustersCache.set(connectionId, await this.clusterService.listClusters(connection));
    });
  }

  private async loadApps(connectionId: string): Promise<void> {
    await this.load(`apps::${connectionId}`, async () => {
      const connection = await this.resolveConnection(connectionId);
      this.appsCache.set(connectionId, await this.appsService.listApps(connection));
    });
  }

  private async loadCatalogs(connectionId: string): Promise<void> {
    await this.load(`catalogs::${connectionId}`, async () => {
      const connection = await this.resolveConnection(connectionId);
      this.catalogsCache.set(connectionId, await this.metadataService.listCatalogs(connection));
    });
  }

  private async loadSchemas(connectionId: string, catalog: string): Promise<void> {
    const key = `schemas::${connectionId}::${catalog}`;
    await this.load(key, async () => {
      const connection = await this.resolveConnection(connectionId);
      this.databricksSchemasCache.set(key, await this.metadataService.listSchemas(connection, catalog));
    });
  }

  private async loadTables(connectionId: string, catalog: string, schema: string): Promise<void> {
    const key = `tables::${connectionId}::${catalog}::${schema}`;
    await this.load(key, async () => {
      const connection = await this.resolveConnection(connectionId);
      this.databricksTablesCache.set(key, await this.metadataService.listTables(connection, catalog, schema));
    });
  }

  private async loadRuns(connectionId: string): Promise<void> {
    await this.load(`jobs::${connectionId}`, async () => {
      const connection = await this.resolveConnection(connectionId);
      this.jobsCache.set(connectionId, await this.jobsService.listRuns(connection));
    });
  }

  private async loadWarehouses(connectionId: string): Promise<void> {
    await this.load(`warehouses::${connectionId}`, async () => {
      const connection = await this.resolveConnection(connectionId);
      this.warehousesCache.set(connectionId, await this.warehouseService.listWarehouses(connection));
    });
  }

  private async loadQueryHistory(connectionId: string): Promise<void> {
    await this.load(`queryHistory::${connectionId}`, async () => {
      const connection = await this.resolveConnection(connectionId);
      this.queryHistoryCache.set(connectionId, await this.queryHistoryService.listQueries(connection));
    });
  }

  private async load(key: string, task: () => Promise<void>): Promise<void> {
    this.loadingKeys.add(key);
    this.errorKeys.delete(key);
    this.refreshCallback();

    try {
      await task();
    } catch (error) {
      this.errorKeys.set(key, error instanceof Error ? error.message : String(error));
    } finally {
      this.loadingKeys.delete(key);
      this.refreshCallback();
    }
  }

  private createRootNode(
    nodeType: DatabricksNodeType,
    label: string,
    connectionId: string,
    iconName: string
  ): DatabricksVirtualNode {
    return {
      nodeType,
      label,
      iconName,
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      payload: { connectionId }
    };
  }

  private createLoadingNode(): DatabricksVirtualNode {
    return {
      nodeType: "loading",
      label: "Loading...",
      iconName: "loading~spin",
      collapsibleState: vscode.TreeItemCollapsibleState.None
    };
  }

  private createInfoNode(message: string): DatabricksVirtualNode {
    return {
      nodeType: "info",
      label: message,
      iconName: "info",
      collapsibleState: vscode.TreeItemCollapsibleState.None
    };
  }

  private createErrorNode(message: string): DatabricksVirtualNode {
    return {
      nodeType: "error",
      label: `Error: ${message}`,
      iconName: "error",
      collapsibleState: vscode.TreeItemCollapsibleState.None
    };
  }

  private getStateIcon(state: string): string {
    const normalized = state.toUpperCase();
    if (normalized.includes("RUNNING") || normalized.includes("SUCCESS")) {
      return "pass-filled";
    }
    if (normalized.includes("TERMINATED") || normalized.includes("STOPPED") || normalized.includes("FAILED")) {
      return "error";
    }
    return "clock";
  }
}

function truncate(value: string, maxLength = 48): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}
