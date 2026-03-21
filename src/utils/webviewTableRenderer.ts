import * as vscode from "vscode";

export function renderTableWebview(
  columns: string[],
  rows: Array<Record<string, unknown>>,
  title = "Query Results",
  subtitle?: string
): string {
  const escapedTitle = escapeHtml(title);
  const escapedSubtitle = subtitle ? escapeHtml(subtitle) : "";

  const tableHeader = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const tableBody = rows
    .map((row) => {
      const cells = columns
        .map((column) => `<td>${escapeHtml(String(row[column] ?? ""))}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle}</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    body {
      margin: 0;
      font-family: "Segoe UI", sans-serif;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }

    .container {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      height: 100vh;
      box-sizing: border-box;
    }

    h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }

    .subtitle {
      margin: 0;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .table-wrap {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      overflow: auto;
      flex: 1;
      min-height: 0;
    }

    table {
      border-collapse: collapse;
      width: max-content;
      min-width: 100%;
      font-size: 12px;
    }

    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--vscode-editorGroupHeader-tabsBackground);
      color: var(--vscode-editor-foreground);
      text-align: left;
      font-weight: 600;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    th,
    td {
      padding: 8px 10px;
      white-space: nowrap;
      border-right: 1px solid var(--vscode-panel-border);
      border-bottom: 1px solid var(--vscode-panel-border);
      vertical-align: top;
    }

    th:last-child,
    td:last-child {
      border-right: none;
    }

    tbody tr:nth-child(even) {
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-editorHoverWidget-background));
    }

    .empty {
      padding: 20px;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapedTitle}</h1>
    ${escapedSubtitle ? `<p class="subtitle">${escapedSubtitle}</p>` : ""}
    <div class="table-wrap">
      ${
        columns.length === 0
          ? `<div class="empty">No tabular result returned.</div>`
          : `<table><thead><tr>${tableHeader}</tr></thead><tbody>${tableBody}</tbody></table>`
      }
    </div>
  </div>
</body>
</html>`;
}

export function showTableResultWebview(
  panelTitle: string,
  columns: string[],
  rows: Array<Record<string, unknown>>,
  subtitle?: string
): void {
  const panel = vscode.window.createWebviewPanel("dataops.results", panelTitle, vscode.ViewColumn.Beside, {
    enableFindWidget: true
  });

  panel.webview.html = renderTableWebview(columns, rows, panelTitle, subtitle);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
