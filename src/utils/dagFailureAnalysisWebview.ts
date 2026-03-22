import * as vscode from "vscode";
import { AirflowTaskInstanceInfo } from "../services/airflowService";
import { FailedDagAnalysisResult, FailedTaskLogEntry } from "../services/geminiAirflowAdvisor";

export function showDagFailureAnalysisWebview(
  dagId: string,
  runId: string,
  analyzedTasks: AirflowTaskInstanceInfo[],
  taskLogs: FailedTaskLogEntry[],
  analysis: FailedDagAnalysisResult
): void {
  const panel = vscode.window.createWebviewPanel(
    "dataops.dagFailureAnalysis",
    `AI Failure Analysis — ${dagId}`,
    vscode.ViewColumn.Beside,
    { enableFindWidget: true }
  );

  panel.webview.html = renderFailureAnalysis(dagId, runId, analyzedTasks, taskLogs, analysis);
}

function renderFailureAnalysis(
  dagId: string,
  runId: string,
  analyzedTasks: AirflowTaskInstanceInfo[],
  taskLogs: FailedTaskLogEntry[],
  analysis: FailedDagAnalysisResult
): string {
  const themeClass = `status-${analysis.overallStatus}`;
  const heading = analysis.overallStatus === "error" ? "AI Error Analysis" : "AI Log Summary";
  const summaryHeading = analysis.overallStatus === "error" ? "Root Cause" : "Run Summary";
  const taskSectionHeading = analysis.overallStatus === "error" ? "Task Analysis" : "Task Summaries";
  const taskCards = analysis.failedTasks.length
    ? analysis.failedTasks
        .map((ft) => {
          const logEntry = taskLogs.find((l) => l.taskId === ft.taskId);
          const logPreview = logEntry ? getLogPreview(logEntry.log) : "";
          return `
          <div class="task-card">
            <div class="task-header">
              <span class="task-state">${escapeHtml(ft.state)}</span>
              <span class="task-id">${escapeHtml(ft.taskId)}</span>
            </div>
            <div class="task-error">
              <strong>${analysis.overallStatus === "error" ? "Details:" : "Summary:"}</strong>
              <code>${escapeHtml(ft.error || "No specific summary extracted")}</code>
            </div>
            <div class="task-suggestion">
              <strong>${analysis.overallStatus === "error" ? "Suggested action:" : "Validation:"}</strong> ${escapeHtml(ft.suggestion || "No suggestion available")}
            </div>
            ${logPreview ? `
            <details class="log-details">
              <summary>View raw log (last 30 lines)</summary>
              <pre class="log-block">${escapeHtml(logPreview)}</pre>
            </details>` : ""}
          </div>`;
        })
        .join("")
      : analyzedTasks
        .map((t) => {
          const logEntry = taskLogs.find((l) => l.taskId === t.taskId);
          const logPreview = logEntry ? getLogPreview(logEntry.log) : "";
          return `
          <div class="task-card">
            <div class="task-header">
              <span class="task-id">${escapeHtml(t.taskId)}</span>
              <span class="task-state">${escapeHtml(t.state)}</span>
            </div>
            ${logPreview ? `
            <details class="log-details">
              <summary>View raw log (last 30 lines)</summary>
              <pre class="log-block">${escapeHtml(logPreview)}</pre>
            </details>` : ""}
          </div>`;
        })
        .join("");

  const fixItems = analysis.suggestedFixes.length
    ? `<ol>${analysis.suggestedFixes.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ol>`
    : "<p class='muted'>No specific fixes suggested.</p>";

  const nextStepItems = analysis.nextSteps.length
    ? `<ol>${analysis.nextSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>`
    : "<p class='muted'>No next steps available.</p>";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI DAG Failure Analysis</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family, "Segoe UI", sans-serif);
      font-size: 13px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 16px;
    }
    h1 { font-size: 17px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 0 0 10px; font-weight: 600; }
    .meta { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 16px; }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 14px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    }
    .status-error .root-cause-card {
      border-color: rgba(255, 80, 80, 0.5);
      background: rgba(255, 60, 60, 0.08);
    }
    .status-error .root-cause-card h2 {
      color: #f48771;
    }
    .status-warning .root-cause-card {
      border-color: rgba(255, 191, 71, 0.45);
      background: rgba(255, 191, 71, 0.08);
    }
    .status-warning .root-cause-card h2 {
      color: #d7ba7d;
    }
    .status-ok .root-cause-card {
      border-color: rgba(78, 201, 176, 0.45);
      background: rgba(78, 201, 176, 0.08);
    }
    .status-ok .root-cause-card h2 {
      color: #4ec9b0;
    }
    .root-cause-card {
      transition: background 120ms ease, border-color 120ms ease;
    }
    .root-cause-text {
      font-size: 14px;
      font-weight: 600;
      word-break: break-word;
    }
    .error-summary {
      margin-top: 10px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.6;
    }
    /* Task failure cards */
    .task-card {
      border: 1px solid var(--vscode-panel-border);
      border-left: 4px solid rgba(255, 80, 80, 0.6);
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 10px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    }
    .task-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .task-id {
      font-weight: 700;
      font-size: 13px;
    }
    .task-state {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--vscode-badge-background, rgba(127, 127, 127, 0.2));
      color: var(--vscode-badge-foreground, var(--vscode-editor-foreground));
    }
    .task-error {
      margin-bottom: 8px;
      line-height: 1.5;
    }
    .task-error code {
      display: block;
      margin-top: 4px;
      padding: 6px 8px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      word-break: break-all;
      white-space: pre-wrap;
    }
    .task-suggestion {
      line-height: 1.5;
      color: var(--vscode-editor-foreground);
    }
    /* Log preview */
    .log-details {
      margin-top: 10px;
    }
    .log-details summary {
      cursor: pointer;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      user-select: none;
    }
    .log-block {
      margin-top: 8px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre;
      max-height: 300px;
      overflow-y: auto;
    }
    /* Fix and next steps */
    ol { margin: 0; padding-left: 20px; }
    ol li { margin: 6px 0; line-height: 1.5; }
    .muted { color: var(--vscode-descriptionForeground); }
    .badge {
      display: inline-block;
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 10px;
      background: rgba(255, 80, 80, 0.2);
      color: #f48771;
      margin-left: 8px;
      vertical-align: middle;
    }
    .ai-footer {
      margin-top: 18px;
      padding: 8px 12px;
      border-radius: 6px;
      background: rgba(77, 163, 255, 0.08);
      border: 1px solid rgba(77, 163, 255, 0.25);
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body class="${themeClass}">
  <h1>${heading}</h1>
  <p class="meta">
    DAG: <strong>${escapeHtml(dagId)}</strong> &nbsp;|&nbsp;
    Run: <strong>${escapeHtml(runId)}</strong> &nbsp;|&nbsp;
    Analyzed tasks: <strong>${analyzedTasks.length}</strong>
  </p>

  <section class="card root-cause-card">
    <h2>${summaryHeading}</h2>
    <div class="root-cause-text">${escapeHtml(analysis.rootCause)}</div>
    ${analysis.errorSummary ? `<div class="error-summary">${escapeHtml(analysis.errorSummary)}</div>` : ""}
  </section>

  <section class="card">
    <h2>${taskSectionHeading} <span class="badge">${analyzedTasks.length}</span></h2>
    ${taskCards}
  </section>

  <section class="card">
    <h2>${analysis.overallStatus === "error" ? "Suggested Fixes" : "Validation Steps"}</h2>
    ${fixItems}
  </section>

  <section class="card">
    <h2>Next Steps</h2>
    ${nextStepItems}
  </section>

  <div class="ai-footer">
    Analysis powered by DataOps Copilot AI &mdash; review suggestions before applying to production.
  </div>
</body>
</html>`;
}

/** Returns the last 30 lines of a log string for preview. */
function getLogPreview(log: string): string {
  const lines = log.split("\n");
  return lines.slice(-30).join("\n").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
