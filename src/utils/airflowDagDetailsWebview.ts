import * as vscode from "vscode";
import { AirflowDagDetails, AirflowDagRunInfo, AirflowTaskInstanceInfo } from "../services/airflowService";
import { AirflowAdvisorResult } from "../services/geminiAirflowAdvisor";

export function showAirflowDagDetailsWebview(
  dag: AirflowDagDetails,
  runs: AirflowDagRunInfo[],
  tasks: AirflowTaskInstanceInfo[],
  advisor?: AirflowAdvisorResult
): void {
  const panel = vscode.window.createWebviewPanel(
    "dataops.airflowDagDetails",
    `Airflow DAG - ${dag.dagId}`,
    vscode.ViewColumn.Beside,
    { enableFindWidget: true }
  );

  panel.webview.html = renderAirflowDetails(dag, runs, tasks, advisor);
}

function renderAirflowDetails(
  dag: AirflowDagDetails,
  runs: AirflowDagRunInfo[],
  tasks: AirflowTaskInstanceInfo[],
  advisor?: AirflowAdvisorResult
): string {
  const infoRows = [
    ["DAG", dag.dagId],
    ["Schedule", dag.schedule],
    ["Paused", dag.isPaused ? "Yes" : "No"],
    ["Owners", dag.owners.join(", ") || "unknown"],
    ["Last Run", dag.lastRunId ?? "none"],
    ["Last Status", dag.lastRunState ?? "unknown"]
  ]
    .map(([k, v]) => `<div class=\"row\"><span class=\"label\">${escapeHtml(String(k))}</span><span class=\"value\">${escapeHtml(String(v))}</span></div>`)
    .join("");

  const runsRows = runs.length
    ? runs
        .slice(0, 15)
        .map(
          (run) =>
            `<tr><td>${escapeHtml(run.runId)}</td><td>${escapeHtml(run.state)}</td><td>${escapeHtml(run.startDate ?? "-")}</td><td>${escapeHtml(run.endDate ?? "-")}</td></tr>`
        )
        .join("")
    : "<tr><td colspan=\"4\">No runs found</td></tr>";

  const taskRows = tasks.length
    ? tasks
        .map(
          (task) =>
            `<tr><td>${escapeHtml(task.taskId)}</td><td>${escapeHtml(task.state)}</td><td>${escapeHtml(`${task.tryNumber}/${task.maxTries}`)}</td><td>${escapeHtml(task.durationSec === null ? "-" : `${task.durationSec}s`)}</td></tr>`
        )
        .join("")
    : "<tr><td colspan=\"4\">No task instances found</td></tr>";

  const issues = advisor?.issues.length
    ? `<ul>${advisor.issues.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p>No major issues detected.</p>";

  const suggestions = advisor?.suggestions.length
    ? `<ul>${advisor.suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p>No suggestions available.</p>";

  return `<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"UTF-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />
  <title>${escapeHtml(dag.dagId)}</title>
  <style>
    body {
      font-family: var(--vscode-font-family, "Segoe UI", sans-serif);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 16px;
    }
    h1, h2, h3 { margin: 0 0 10px; }
    h1 { font-size: 18px; }
    h2 { font-size: 15px; margin-top: 16px; }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    }
    .row {
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 12px;
      padding: 6px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .row:last-child { border-bottom: none; }
    .label { color: var(--vscode-descriptionForeground); }
    .value { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid var(--vscode-panel-border); padding: 8px 6px; text-align: left; }
    th { color: var(--vscode-descriptionForeground); font-weight: 600; }
    ul { margin: 0; padding-left: 18px; }
    li { margin: 4px 0; }
    .recommendation {
      margin-top: 10px;
      padding: 10px;
      border-radius: 6px;
      background: rgba(77, 163, 255, 0.12);
      border: 1px solid rgba(77, 163, 255, 0.3);
    }
  </style>
</head>
<body>
  <h1>Airflow DAG - ${escapeHtml(dag.dagId)}</h1>
  <section class=\"card\">${infoRows}</section>

  <section class=\"card\">
    <h2>Recent Runs</h2>
    <table>
      <thead><tr><th>Run ID</th><th>Status</th><th>Start</th><th>End</th></tr></thead>
      <tbody>${runsRows}</tbody>
    </table>
  </section>

  <section class=\"card\">
    <h2>Task Status</h2>
    <table>
      <thead><tr><th>Task</th><th>Status</th><th>Tries</th><th>Duration</th></tr></thead>
      <tbody>${taskRows}</tbody>
    </table>
  </section>

  <section class=\"card\">
    <h2>AI Pipeline Advisor</h2>
    <h3>Issues</h3>
    ${issues}
    <h3>Suggestions</h3>
    ${suggestions}
    ${advisor?.recommendation ? `<div class=\"recommendation\"><strong>Recommendation:</strong> ${escapeHtml(advisor.recommendation)}</div>` : ""}
  </section>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
