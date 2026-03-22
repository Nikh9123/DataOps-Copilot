import * as vscode from "vscode";
import { ConnectionManager } from "../services/connectionManager";
import { SecretStorageService } from "../services/secretStorageService";
import { AirflowService } from "../services/airflowService";
import { GeminiAirflowAdvisorService } from "../services/geminiAirflowAdvisor";
import { getConnectionWithCredentials } from "../utils/connectionCredentials";
import { showAirflowDagDetailsWebview } from "../utils/airflowDagDetailsWebview";

type ShowDagDetailsInput = {
  connectionId?: string;
  dagId?: string;
  runId?: string;
  payload?: ShowDagDetailsInput;
};

export function registerShowAirflowDagDetailsCommand(
  connectionManager: ConnectionManager,
  secretStorageService: SecretStorageService,
  airflowService: AirflowService,
  advisorService?: GeminiAirflowAdvisorService
): vscode.Disposable {
  return vscode.commands.registerCommand("dataops.showAirflowDagDetails", async (input?: ShowDagDetailsInput) => {
    const normalized = normalizeInput(input);
    if (!normalized.connectionId || !normalized.dagId) {
      vscode.window.showErrorMessage("Airflow DAG context is missing.");
      return;
    }

    const baseConnection = connectionManager.getConnectionById(normalized.connectionId);
    if (!baseConnection || baseConnection.type !== "airflow") {
      vscode.window.showErrorMessage("Airflow connection not found.");
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Loading DAG details for ${normalized.dagId}...`,
        cancellable: false
      },
      async () => {
        try {
          const connection = await getConnectionWithCredentials(baseConnection, secretStorageService);
          const details = await airflowService.getDAGDetails(connection, normalized.dagId as string);
          const runs = await airflowService.listDAGRuns(connection, normalized.dagId as string);
          const runId = normalized.runId ?? runs[0]?.runId;
          const tasks = runId ? await airflowService.getTaskInstances(connection, normalized.dagId as string, runId) : [];

          const advisor = advisorService ? await safeAnalyze(advisorService, details, runs, tasks) : undefined;
          showAirflowDagDetailsWebview(details, runs, tasks, advisor);
        } catch (error) {
          const message = AirflowService.getAirflowError(error);
          vscode.window.showErrorMessage(`Failed to load Airflow DAG details: ${message}`);
        }
      }
    );
  });
}

function normalizeInput(input?: ShowDagDetailsInput): ShowDagDetailsInput {
  if (input?.payload) {
    return input.payload;
  }

  return input ?? {};
}

async function safeAnalyze(
  advisorService: GeminiAirflowAdvisorService,
  dag: import("../services/airflowService").AirflowDagDetails,
  runs: import("../services/airflowService").AirflowDagRunInfo[],
  tasks: import("../services/airflowService").AirflowTaskInstanceInfo[]
): Promise<import("../services/geminiAirflowAdvisor").AirflowAdvisorResult | undefined> {
  try {
    return await advisorService.analyze({ dag, runs, tasks });
  } catch {
    return undefined;
  }
}
