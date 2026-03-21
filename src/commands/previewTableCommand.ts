import * as vscode from "vscode";
import { TablePreviewRequest } from "../providers/connectionsTreeDataProvider";
import { ConnectionManager } from "../services/connectionManager";
import { SecretStorageService } from "../services/secretStorageService";
import { SnowflakeService } from "../services/snowflakeService";
import { getConnectionWithCredentials } from "../utils/connectionCredentials";
import { showTableResultWebview } from "../utils/webviewTableRenderer";

export function registerPreviewTableCommand(
  connectionManager: ConnectionManager,
  secretStorageService: SecretStorageService,
  snowflakeService: SnowflakeService
): vscode.Disposable {
  return vscode.commands.registerCommand("dataops.previewTableFromTree", async (request?: TablePreviewRequest) => {
    if (!request?.connectionId || !request.database || !request.schema || !request.table) {
      vscode.window.showErrorMessage("Table preview request is missing required metadata.");
      return;
    }

    const baseConnection = connectionManager.getConnectionById(request.connectionId);
    if (!baseConnection) {
      vscode.window.showErrorMessage("Connection not found for this table preview.");
      return;
    }

    if (baseConnection.type !== "snowflake") {
      vscode.window.showErrorMessage("Table preview is currently supported only for Snowflake connections.");
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Loading preview for ${request.table}...`,
        cancellable: false
      },
      async () => {
        try {
          const connectionWithCredentials = await getConnectionWithCredentials(baseConnection, secretStorageService);
          const preview = await snowflakeService.previewTable(
            connectionWithCredentials,
            request.database,
            request.schema,
            request.table
          );

          showTableResultWebview(
            `Preview - ${request.table}`,
            preview.columns,
            preview.rows,
            `${request.database}.${request.schema}.${request.table} | Rows: ${preview.rowCount} | Time: ${
              preview.executionTimeMs ?? 0
            } ms`
          );
        } catch (error) {
          const message = SnowflakeService.getSnowflakeError(error);
          vscode.window.showErrorMessage(`Table preview failed: ${message}`);
        }
      }
    );
  });
}
