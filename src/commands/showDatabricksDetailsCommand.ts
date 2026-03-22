import * as vscode from "vscode";
import { ConnectionManager } from "../services/connectionManager";
import { SecretStorageService } from "../services/secretStorageService";
import { DatabricksClusterService } from "../services/databricksClusterService";
import { DatabricksAppsService } from "../services/databricksAppsService";
import { GeminiAdvisorService } from "../services/geminiAdvisorService";
import { getConnectionWithCredentials } from "../utils/connectionCredentials";
import { showDatabricksDetailsWebview } from "../utils/databricksDetailsWebview";

type DatabricksDetailsInput = {
  connectionId?: string;
  app?: import("../services/databricksAppsService").DatabricksAppInfo;
  cluster?: import("../services/databricksClusterService").DatabricksClusterInfo;
  run?: import("../services/databricksJobsService").DatabricksRunInfo;
  warehouse?: import("../services/databricksWarehouseService").DatabricksWarehouseInfo;
  payload?: DatabricksDetailsInput;
};

export function registerShowDatabricksDetailsCommand(
  connectionManager: ConnectionManager,
  secretStorageService: SecretStorageService,
  databricksAppsService: DatabricksAppsService,
  databricksClusterService: DatabricksClusterService,
  geminiAdvisorService?: GeminiAdvisorService
): vscode.Disposable {
  return vscode.commands.registerCommand("dataops.showDatabricksDetails", async (input?: DatabricksDetailsInput) => {
    const normalized = normalizeInput(input);
    if (!normalized.connectionId) {
      vscode.window.showErrorMessage("Databricks resource metadata is missing.");
      return;
    }

    const baseConnection = connectionManager.getConnectionById(normalized.connectionId);
    if (!baseConnection || baseConnection.type !== "databricks") {
      vscode.window.showErrorMessage("Databricks connection not found.");
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Loading Databricks details...",
        cancellable: false
      },
      async () => {
        try {
          const connection = await getConnectionWithCredentials(baseConnection, secretStorageService);

          if (normalized.app) {
            const details = await safeGetAppDetails(databricksAppsService, connection, normalized.app);
            const advisor = await safeAnalyze(geminiAdvisorService, {
              workloadType: "databricks app",
              appName: details.name,
              appState: details.state,
              appStatusMessage: details.statusMessage,
              failureReason: details.errorCode
            });

            showDatabricksDetailsWebview(
              `App — ${details.name}`,
              {
                "App ID": details.id,
                State: details.state,
                URL: details.url ?? "not available",
                "Status Message": details.statusMessage ?? "none",
                "Error Code": details.errorCode ?? "none"
              },
              advisor
            );
            return;
          }

          if (normalized.cluster) {
            const details = await databricksClusterService.getClusterDetails(connection, normalized.cluster.clusterId);
            const advisor = await safeAnalyze(geminiAdvisorService, {
              workloadType: "cluster monitoring",
              clusterState: details.state,
              numWorkers: details.numWorkers
            });

            showDatabricksDetailsWebview(
              `Cluster — ${details.name}`,
              {
                "Cluster ID": details.clusterId,
                State: details.state,
                Workers: details.numWorkers === null ? "unknown" : String(details.numWorkers),
                Autoscale: details.autoscale
                  ? `${details.autoscale.minWorkers} → ${details.autoscale.maxWorkers}`
                  : "disabled"
              },
              advisor
            );
            return;
          }

          if (normalized.run) {
            const advisor = await safeAnalyze(geminiAdvisorService, {
              workloadType: "job run",
              clusterState: normalized.run.state,
              jobDurationMs: normalized.run.durationMs
            });

            showDatabricksDetailsWebview(
              `Job — ${normalized.run.jobId}`,
              {
                "Run ID": normalized.run.runId,
                "Job ID": normalized.run.jobId,
                State: normalized.run.state,
                "Start Time": normalized.run.startTime ? new Date(normalized.run.startTime).toLocaleString() : "unknown",
                Duration: normalized.run.durationMs === null ? "unknown" : `${normalized.run.durationMs} ms`
              },
              advisor
            );
            return;
          }

          if (normalized.warehouse) {
            const advisor = await safeAnalyze(geminiAdvisorService, {
              workloadType: "sql warehouse",
              clusterState: normalized.warehouse.state,
              warehouseSize: normalized.warehouse.size
            });

            showDatabricksDetailsWebview(
              `Warehouse — ${normalized.warehouse.name}`,
              {
                "Warehouse ID": normalized.warehouse.id,
                State: normalized.warehouse.state,
                Size: normalized.warehouse.size,
                "Cluster Count": normalized.warehouse.clusterCount === null ? "unknown" : String(normalized.warehouse.clusterCount)
              },
              advisor
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Failed to load Databricks details: ${message}`);
        }
      }
    );
  });
}

function normalizeInput(input?: DatabricksDetailsInput): DatabricksDetailsInput {
  if (input?.payload) {
    return input.payload;
  }

  return input ?? {};
}

async function safeAnalyze(
  geminiAdvisorService: GeminiAdvisorService | undefined,
  input: import("../services/geminiAdvisorService").DatabricksAdvisorInput
): Promise<import("../services/geminiAdvisorService").DatabricksAdvisorResult | undefined> {
  if (!geminiAdvisorService) {
    return undefined;
  }

  try {
    return await geminiAdvisorService.analyze(input);
  } catch {
    return undefined;
  }
}

async function safeGetAppDetails(
  databricksAppsService: DatabricksAppsService,
  connection: import("../models/connection").Connection,
  app: import("../services/databricksAppsService").DatabricksAppInfo
): Promise<import("../services/databricksAppsService").DatabricksAppInfo> {
  try {
    return await databricksAppsService.getAppDetails(connection, app.id);
  } catch {
    return app;
  }
}
