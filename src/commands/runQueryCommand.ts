import * as vscode from "vscode";
import { ConnectionManager } from "../services/connectionManager";
import { SecretStorageService } from "../services/secretStorageService";
import { SnowflakeService } from "../services/snowflakeService";
import { getSqlFromActiveEditor } from "../utils/editor";
import { getConnectionWithCredentials } from "../utils/connectionCredentials";
import { showTableResultWebview } from "../utils/webviewTableRenderer";

export function registerRunQueryCommand(
  connectionManager: ConnectionManager,
  secretStorageService: SecretStorageService,
  snowflakeService: SnowflakeService,
  outputChannel: vscode.OutputChannel
): vscode.Disposable {
  return vscode.commands.registerCommand("dataops.runQuery", async () => {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showErrorMessage("No active editor. Open a SQL file and try again.");
      return;
    }

    const activeConnection = connectionManager.getActiveConnection();
    if (!activeConnection) {
      vscode.window.showErrorMessage("No active connection. Use 'DataOps: Switch Active Connection' first.");
      return;
    }

    if (activeConnection.type !== "snowflake") {
      vscode.window.showWarningMessage("Only Snowflake query execution is currently supported.");
      return;
    }

    const sql = getSqlFromActiveEditor();
    if (!sql) {
      vscode.window.showErrorMessage("Query is empty. Select SQL text or add SQL to the current editor.");
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Running query...",
        cancellable: false
      },
      async () => {
        try {
          const connectionForExecution = await getConnectionWithCredentials(activeConnection, secretStorageService);
          const result = await snowflakeService.executeQuery(connectionForExecution, sql);

          outputChannel.appendLine(`[${new Date().toISOString()}] Connection: ${activeConnection.name}`);
          outputChannel.appendLine(`Execution time: ${result.executionTimeMs ?? 0} ms`);
          outputChannel.appendLine(`Rows returned: ${result.rowCount}`);
          outputChannel.appendLine("-".repeat(80));
          outputChannel.show(true);

          showTableResultWebview(
            `Query Results - ${activeConnection.name}`,
            result.columns,
            result.rows,
            `Rows: ${result.rowCount} | Time: ${result.executionTimeMs ?? 0} ms`
          );

          vscode.window.showInformationMessage(
            `Query completed in ${result.executionTimeMs ?? 0} ms. ${result.rowCount} rows returned.`
          );
        } catch (error) {
          const message = SnowflakeService.getSnowflakeError(error);
          outputChannel.appendLine(`[${new Date().toISOString()}] Query failed: ${message}`);
          outputChannel.show(true);
          vscode.window.showErrorMessage(`Query failed: ${message}`);
        }
      }
    );
  });
}
