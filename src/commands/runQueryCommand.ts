import * as vscode from "vscode";
import { ConnectionManager } from "../services/connectionManager";
import { SecretStorageService } from "../services/secretStorageService";
import { SnowflakeService } from "../services/snowflakeService";
import { DatabricksSqlService } from "../services/databricksSqlService";
import { QueryHistoryService } from "../services/queryHistoryService";
import { QueryCostAnalyzer } from "../services/queryCostAnalyzer";
import { AiCostEstimatorService } from "../services/aiCostEstimatorService";
import { predictQueryCost } from "./predictQueryCostCommand";
import { getSqlFromActiveEditor } from "../utils/editor";
import { getConnectionWithCredentials } from "../utils/connectionCredentials";
import { showTableResultWebview, QueryMetrics } from "../utils/webviewTableRenderer";

export function registerRunQueryCommand(
  connectionManager: ConnectionManager,
  secretStorageService: SecretStorageService,
  snowflakeService: SnowflakeService,
  databricksSqlService: DatabricksSqlService,
  outputChannel: vscode.OutputChannel,
  queryHistoryService: QueryHistoryService,
  queryCostAnalyzer: QueryCostAnalyzer,
  aiCostEstimatorService?: AiCostEstimatorService
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

    if (activeConnection.type === "airflow") {
      vscode.window.showErrorMessage("Run Query is not supported for Airflow connections.");
      return;
    }

    const sql = getSqlFromActiveEditor();
    if (!sql) {
      vscode.window.showErrorMessage("Query is empty. Select SQL text or add SQL to the current editor.");
      return;
    }

    const prediction = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Estimating query cost...",
        cancellable: false
      },
      async () => predictQueryCost(sql, queryCostAnalyzer, aiCostEstimatorService)
    );
    const icon = prediction.costLevel === "HIGH" ? "🔴" : prediction.costLevel === "MEDIUM" ? "🟡" : "🟢";
    const issueText = prediction.issues.slice(0, 2).map((item) => `• ${item}`).join("\n");
    const suggestionText = prediction.suggestions.slice(0, 2).map((item) => `• ${item}`).join("\n");
    const proceed = await vscode.window.showWarningMessage(
      [
        `Estimated Cost: ${prediction.costLevel} ${icon}`,
        `Scan Size: ${prediction.scanSize}`,
        issueText ? `Issues:\n${issueText}` : "",
        suggestionText ? `Suggestions:\n${suggestionText}` : "",
        "Proceed with query execution?"
      ]
        .filter(Boolean)
        .join("\n\n"),
      { modal: true },
      "Run anyway",
      "Cancel"
    );

    if (proceed !== "Run anyway") {
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
          const result =
            activeConnection.type === "databricks"
              ? await databricksSqlService.executeQuery(connectionForExecution, sql)
              : await snowflakeService.executeQuery(connectionForExecution, sql);

          outputChannel.appendLine(`[${new Date().toISOString()}] Connection: ${activeConnection.name}`);
          outputChannel.appendLine(`Execution time: ${result.executionTimeMs ?? 0} ms`);
          outputChannel.appendLine(`Rows returned: ${result.rowCount}`);
          outputChannel.appendLine("-".repeat(80));
          outputChannel.show(true);

          const metrics: QueryMetrics = {
            sql,
            rowCount: result.rowCount,
            executionTimeMs: result.executionTimeMs ?? 0,
            costLevel: prediction.costLevel,
            scanSize: prediction.scanSize,
            costIssues: prediction.issues.slice(0, 3)
          };

          showTableResultWebview(
            `Query Results \u2014 ${activeConnection.name}`,
            result.columns,
            result.rows,
            undefined,
            metrics
          );

          await queryHistoryService.addEntry({
            query: sql,
            timestamp: Date.now(),
            connectionName: activeConnection.name,
            rowCount: result.rowCount,
            executionTimeMs: result.executionTimeMs ?? 0
          });

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
