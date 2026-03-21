import * as vscode from "vscode";
import { ConnectionManager } from "../services/connectionManager";
import { SecretStorageService } from "../services/secretStorageService";
import { createConnectionId } from "../utils/id";
import { Connection, DataPlatformType, StoredConnectionMetadata } from "../models/connection";

export function registerAddConnectionCommand(
  connectionManager: ConnectionManager,
  secretStorageService: SecretStorageService
): vscode.Disposable {
  return vscode.commands.registerCommand("dataops.addConnection", async () => {
    const selectedType = await vscode.window.showQuickPick(
      [
        { label: "Snowflake", value: "snowflake" as DataPlatformType },
        { label: "Databricks", value: "databricks" as DataPlatformType }
      ],
      {
        placeHolder: "Select a platform"
      }
    );

    if (!selectedType) {
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: "Connection name",
      validateInput: (value) => (value.trim() ? undefined : "Connection name is required")
    });
    if (!name) {
      return;
    }

    const account = await vscode.window.showInputBox({
      prompt: "Account URL or host (e.g. xy12345.us-east-1.snowflakecomputing.com)",
      validateInput: (value) => (value.trim() ? undefined : "Account is required")
    });
    if (!account) {
      return;
    }

    const username = await vscode.window.showInputBox({
      prompt: "Username",
      validateInput: (value) => (value.trim() ? undefined : "Username is required")
    });
    if (!username) {
      return;
    }

    const credential = await vscode.window.showInputBox({
      prompt: "Password",
      password: true,
      validateInput: (value) => (value.trim() ? undefined : "A credential value is required")
    });
    if (!credential) {
      return;
    }

    const id = createConnectionId();
    const metadata: StoredConnectionMetadata = {
      id,
      name: name.trim(),
      type: selectedType.value,
      config: {
        account: account.trim(),
        username: username.trim()
      }
    };

    await secretStorageService.saveConnection(id, {
      password: credential.trim()
    });
    await secretStorageService.saveConnectionMetadata(metadata);

    const connection: Connection = {
      ...metadata,
      config: {
        ...metadata.config
      }
    };

    connectionManager.addConnection(connection);

    if (!connectionManager.getActiveConnection()) {
      connectionManager.setActiveConnection(id);
    }

    await secretStorageService.saveActiveConnectionId(connectionManager.getActiveConnectionId());

    void vscode.commands.executeCommand("dataops.refreshConnections");
    vscode.window.showInformationMessage(`Added connection: ${name}`);
  });
}
