import * as vscode from "vscode";
import { ConnectionManager } from "../services/connectionManager";
import { SecretStorageService } from "../services/secretStorageService";

export function registerSwitchConnectionCommand(
  connectionManager: ConnectionManager,
  secretStorageService: SecretStorageService
): vscode.Disposable {
  return vscode.commands.registerCommand("dataops.switchConnection", async () => {
    const connections = connectionManager.getConnections();

    if (!connections.length) {
      vscode.window.showWarningMessage("No connections available. Add one first.");
      return;
    }

    const activeId = connectionManager.getActiveConnectionId();
    const picked = await vscode.window.showQuickPick(
      connections.map((connection) => ({
        label: connection.name,
        description: `${connection.type} • ${connection.config.account}`,
        detail: connection.id === activeId ? "Currently active" : undefined,
        id: connection.id
      })),
      { placeHolder: "Select the active connection" }
    );

    if (!picked) {
      return;
    }

    const switched = connectionManager.setActiveConnection(picked.id);
    if (!switched) {
      vscode.window.showErrorMessage("Could not set active connection.");
      return;
    }

    await secretStorageService.saveActiveConnectionId(picked.id);
    void vscode.commands.executeCommand("dataops.refreshConnections");
    vscode.window.showInformationMessage(`Active connection set to: ${picked.label}`);
  });
}
