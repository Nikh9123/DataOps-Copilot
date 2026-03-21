import * as vscode from "vscode";

export function getSqlFromActiveEditor(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const selectedText = editor.document.getText(editor.selection).trim();
  if (selectedText) {
    return selectedText;
  }

  const wholeDocument = editor.document.getText().trim();
  return wholeDocument || undefined;
}
