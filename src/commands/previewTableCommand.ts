import * as vscode from "vscode";
import { TablePreviewRequest } from "../providers/connectionsTreeDataProvider";
import { ConnectionManager } from "../services/connectionManager";
import { SecretStorageService } from "../services/secretStorageService";
import { SnowflakeService } from "../services/snowflakeService";
import { DatabricksSqlService } from "../services/databricksSqlService";
import { QueryHistoryService } from "../services/queryHistoryService";
import { getConnectionWithCredentials } from "../utils/connectionCredentials";
import { showTableResultWebview, QueryMetrics } from "../utils/webviewTableRenderer";

export function registerPreviewTableCommand(
  connectionManager: ConnectionManager,
  secretStorageService: SecretStorageService,
  snowflakeService: SnowflakeService,
  databricksSqlService: DatabricksSqlService,
  queryHistoryService: QueryHistoryService
): vscode.Disposable {
  // Accepts either:
  //   (a) a TablePreviewRequest object  — invoked from tree node click
  //   (b) positional string args (database, schema, table) — uses the active connection
  return vscode.commands.registerCommand(
    "dataops.previewTable",
    async (requestOrDatabase?: TablePreviewRequest | string, schema?: string, table?: string) => {
      let request: TablePreviewRequest;

      if (typeof requestOrDatabase === "object" && requestOrDatabase !== null) {
        request = requestOrDatabase;
      } else if (typeof requestOrDatabase === "string" && schema && table) {
        const active = connectionManager.getActiveConnection();
        if (!active) {
          vscode.window.showErrorMessage("No active connection. Use 'DataOps: Switch Active Connection' first.");
          return;
        }
        request = { connectionId: active.id, database: requestOrDatabase, schema, table };
      } else {
        vscode.window.showErrorMessage("Table preview request is missing required metadata.");
        return;
      }

      const baseConnection = connectionManager.getConnectionById(request.connectionId);
      if (!baseConnection) {
        vscode.window.showErrorMessage("Connection not found for this table preview.");
        return;
      }

      if (baseConnection.type === "airflow") {
        vscode.window.showErrorMessage("Table preview is not supported for Airflow connections.");
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Fetching preview for ${request.table}...`,
          cancellable: false
        },
        async () => {
          try {
            const connectionWithCredentials = await getConnectionWithCredentials(baseConnection, secretStorageService);
            const previewSql =
              baseConnection.type === "databricks"
                ? `SELECT * FROM \`${request.catalog ?? request.database}\`.\`${request.schema}\`.\`${request.table}\` LIMIT 100`
                : `SELECT * FROM "${request.database}"."${request.schema}"."${request.table}" LIMIT 100`;

            const preview =
              baseConnection.type === "databricks"
                ? await databricksSqlService.previewTable(
                    connectionWithCredentials,
                    request.catalog ?? request.database,
                    request.schema,
                    request.table
                  )
                : await snowflakeService.previewTable(
                    connectionWithCredentials,
                    request.database,
                    request.schema,
                    request.table
                  );
            const metrics: QueryMetrics = {
              sql: previewSql,
              rowCount: preview.rowCount,
              executionTimeMs: preview.executionTimeMs ?? 0
            };

            showTableResultWebview(
              `Preview \u2014 ${request.table}`,
              preview.columns,
              preview.rows,
              undefined,
              metrics
            );

            await queryHistoryService.addEntry({
              query: previewSql,
              timestamp: Date.now(),
              connectionName: baseConnection.name,
              rowCount: preview.rowCount,
              executionTimeMs: preview.executionTimeMs ?? 0
            });
          } catch (error) {
            const message = SnowflakeService.getSnowflakeError(error);
            vscode.window.showErrorMessage(`Table preview failed: ${message}`);
          }
        }
      );
    }
  );
}
