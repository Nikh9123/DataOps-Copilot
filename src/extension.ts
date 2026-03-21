import * as vscode from "vscode";
import { registerAddConnectionCommand } from "./commands/addConnectionCommand";
import { registerPreviewTableCommand } from "./commands/previewTableCommand";
import { registerRunQueryCommand } from "./commands/runQueryCommand";
import { registerSwitchConnectionCommand } from "./commands/switchConnectionCommand";
import { Connection } from "./models/connection";
import { ConnectionsTreeDataProvider } from "./providers/connectionsTreeDataProvider";
import { ConnectionManager } from "./services/connectionManager";
import { SecretStorageService } from "./services/secretStorageService";
import { SnowflakeService } from "./services/snowflakeService";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const connectionManager = new ConnectionManager();
  const secretStorageService = new SecretStorageService(context.secrets, context.globalState);
  const snowflakeService = new SnowflakeService();

  const outputChannel = vscode.window.createOutputChannel("DataOps Copilot");
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "dataops.switchConnection";
  statusBarItem.tooltip = "Switch active DataOps connection";

  const treeProvider = new ConnectionsTreeDataProvider(connectionManager, secretStorageService, snowflakeService);
  const treeViewDisposable = vscode.window.registerTreeDataProvider("dataops.connectionsView", treeProvider);

  context.subscriptions.push(outputChannel, statusBarItem, treeViewDisposable);

  const refreshUi = () => {
    treeProvider.refresh();

    const active = connectionManager.getActiveConnection();
    statusBarItem.text = active
      ? `$(database) Connected: ${active.name}`
      : "$(database) Connected: none";
    statusBarItem.show();
  };

  const persistedConnections = await secretStorageService.getConnectionMetadataList();
  persistedConnections.forEach((connection) => {
    const inMemory: Connection = {
      ...connection,
      config: {
        ...connection.config
      }
    };

    connectionManager.addConnection(inMemory);
  });

  const persistedActiveId = await secretStorageService.getActiveConnectionId();
  if (persistedActiveId) {
    connectionManager.setActiveConnection(persistedActiveId);
  }

  refreshUi();

  connectionManager.onDidChangeConnections(() => {
    refreshUi();
  });

  context.subscriptions.push(
    registerAddConnectionCommand(connectionManager, secretStorageService),
    registerSwitchConnectionCommand(connectionManager, secretStorageService),
    registerRunQueryCommand(connectionManager, secretStorageService, snowflakeService, outputChannel),
    registerPreviewTableCommand(connectionManager, secretStorageService, snowflakeService),
    vscode.commands.registerCommand("dataops.refreshConnections", () => {
      refreshUi();
    })
  );
}

export function deactivate(): void {
  // No-op: VS Code disposes subscriptions registered in activate().
}
