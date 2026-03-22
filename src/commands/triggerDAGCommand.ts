import * as vscode from "vscode";
import { ConnectionManager } from "../services/connectionManager";
import { SecretStorageService } from "../services/secretStorageService";
import { AirflowService } from "../services/airflowService";
import { getConnectionWithCredentials } from "../utils/connectionCredentials";

type TriggerDagInput = {
  connectionId?: string;
  dagId?: string;
  payload?: TriggerDagInput;
};

export function registerTriggerDAGCommand(
  connectionManager: ConnectionManager,
  secretStorageService: SecretStorageService,
  airflowService: AirflowService
): vscode.Disposable {
  return vscode.commands.registerCommand("dataops.triggerDAG", async (input?: TriggerDagInput) => {
    const normalized = normalizeInput(input);
    const activeConnection = connectionManager.getActiveConnection();

    const fallbackConnectionId =
      activeConnection?.type === "airflow"
        ? activeConnection.id
        : connectionManager
            .getConnections()
            .find((connection) => connection.type === "airflow")
            ?.id;

    const connectionId = normalized.connectionId ?? fallbackConnectionId;
    if (!connectionId) {
      vscode.window.showErrorMessage("No Airflow connection found. Add an Airflow connection first.");
      return;
    }

    const baseConnection = connectionManager.getConnectionById(connectionId);
    if (!baseConnection || baseConnection.type !== "airflow") {
      vscode.window.showErrorMessage("Airflow connection not found.");
      return;
    }

    const connection = await getConnectionWithCredentials(baseConnection, secretStorageService);

    let dagId = normalized.dagId;
    if (!dagId) {
      const dags = await airflowService.listDAGs(connection);
      const picked = await vscode.window.showQuickPick(
        dags.map((dag) => ({
          label: dag.dagId,
          description: dag.isPaused ? "Paused" : dag.lastRunState ?? "No recent runs"
        })),
        {
          placeHolder: "Select a DAG to trigger"
        }
      );

      if (!picked) {
        return;
      }

      dagId = picked.label;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Trigger DAG '${dagId}' now?`,
      { modal: true },
      "Trigger"
    );

    if (confirm !== "Trigger") {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Triggering DAG ${dagId}...`,
        cancellable: false
      },
      async () => {
        try {
          const run = await airflowService.triggerDAG(connection, dagId as string);
          vscode.window.showInformationMessage(`Triggered DAG '${dagId}'. Run ID: ${run.runId} (${run.state}).`);
          void vscode.commands.executeCommand("dataops.refreshAirflow");
        } catch (error) {
          const message = AirflowService.getAirflowError(error);
          vscode.window.showErrorMessage(`Failed to trigger DAG '${dagId}': ${message}`);
        }
      }
    );
  });
}

function normalizeInput(input?: TriggerDagInput): TriggerDagInput {
  if (input?.payload) {
    return input.payload;
  }

  return input ?? {};
}
