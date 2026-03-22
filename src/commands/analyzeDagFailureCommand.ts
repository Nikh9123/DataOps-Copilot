import * as vscode from "vscode";
import { ConnectionManager } from "../services/connectionManager";
import { SecretStorageService } from "../services/secretStorageService";
import { AirflowService, AirflowTaskInstanceInfo } from "../services/airflowService";
import { FailedTaskLogEntry, GeminiAirflowAdvisorService } from "../services/geminiAirflowAdvisor";
import { getConnectionWithCredentials } from "../utils/connectionCredentials";
import { showDagFailureAnalysisWebview } from "../utils/dagFailureAnalysisWebview";

type AnalyzeDagFailureInput = {
  connectionId?: string;
  dagId?: string;
  runId?: string;
  payload?: AnalyzeDagFailureInput;
};

export function registerAnalyzeDagFailureCommand(
  connectionManager: ConnectionManager,
  secretStorageService: SecretStorageService,
  airflowService: AirflowService,
  advisorService?: GeminiAirflowAdvisorService
): vscode.Disposable {
  return vscode.commands.registerCommand("dataops.analyzeDagFailure", async (input?: AnalyzeDagFailureInput) => {
    if (!advisorService) {
      vscode.window.showErrorMessage(
        "AI provider is not configured. Set DATAOPS_AI_PROVIDER and the relevant API key in your .env file."
      );
      return;
    }

    const normalized = normalizeInput(input);
    if (!normalized.connectionId || !normalized.dagId) {
      vscode.window.showErrorMessage("Airflow DAG context is missing. Try right-clicking a DAG node.");
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
        title: `Analyzing DAG logs for ${normalized.dagId}…`,
        cancellable: false
      },
      async (progress) => {
        try {
          const connection = await getConnectionWithCredentials(baseConnection, secretStorageService);

          // Resolve target run — prefer explicit runId, then the most recent failed run,
          // otherwise fall back to the latest run so successful runs can still be summarized.
          progress.report({ message: "Fetching run history…" });
          let runId = normalized.runId;
          if (!runId) {
            const runs = await airflowService.listDAGRuns(connection, normalized.dagId as string);
            const failedRun = runs.find((r) => /failed/i.test(r.state));
            runId = failedRun?.runId ?? runs[0]?.runId;
          }

          if (!runId) {
            vscode.window.showWarningMessage(`No runs found for DAG "${normalized.dagId}".`);
            return;
          }

          // Collect task instances and analyze relevant task logs even for successful runs.
          progress.report({ message: "Fetching task instances…" });
          const tasks = await airflowService.getTaskInstances(connection, normalized.dagId as string, runId);
          const failedTasks = tasks.filter((t) => /failed|upstream_failed/i.test(t.state));
          const tasksToAnalyze = selectTasksForAnalysis(tasks, failedTasks);

          if (!tasksToAnalyze.length) {
            vscode.window.showInformationMessage(`No task logs are available yet for run "${runId}".`);
            return;
          }

          // Fetch logs for the selected tasks in parallel.
          progress.report({ message: `Fetching logs for ${tasksToAnalyze.length} task(s)…` });
          const taskLogs: FailedTaskLogEntry[] = await Promise.all(
            tasksToAnalyze.map(async (task) => ({
              taskId: task.taskId,
              state: task.state,
              tryNumber: Math.max(1, task.tryNumber),
              log: await airflowService.getTaskLog(
                connection,
                normalized.dagId as string,
                runId as string,
                task.taskId,
                Math.max(1, task.tryNumber)
              )
            }))
          );

          // Send the selected task logs to AI for summary / error analysis.
          progress.report({ message: "Running AI log analysis…" });
          const analysis = await advisorService.analyzeFailedLogs({
            dagId: normalized.dagId as string,
            runId,
            failedTasks: taskLogs
          });

          showDagFailureAnalysisWebview(normalized.dagId as string, runId, tasksToAnalyze, taskLogs, analysis);
        } catch (error) {
          const message = AirflowService.getAirflowError(error);
          vscode.window.showErrorMessage(`DAG log analysis failed: ${message}`);
        }
      }
    );
  });
}

function selectTasksForAnalysis(
  tasks: AirflowTaskInstanceInfo[],
  failedTasks: AirflowTaskInstanceInfo[]
): AirflowTaskInstanceInfo[] {
  if (failedTasks.length) {
    return failedTasks.slice(0, 8);
  }

  const preferredStates = ["success", "running", "queued"];
  const prioritized = preferredStates.flatMap((state) => tasks.filter((task) => task.state.toLowerCase().includes(state)));
  const uniqueTasks = new Map<string, AirflowTaskInstanceInfo>();

  for (const task of [...prioritized, ...tasks]) {
    if (!uniqueTasks.has(task.taskId)) {
      uniqueTasks.set(task.taskId, task);
    }
  }

  return Array.from(uniqueTasks.values()).slice(0, 8);
}

function normalizeInput(input?: AnalyzeDagFailureInput): AnalyzeDagFailureInput {
  if (input?.payload) {
    return input.payload;
  }
  return input ?? {};
}
