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
        { label: "Databricks", value: "databricks" as DataPlatformType },
        { label: "Airflow", value: "airflow" as DataPlatformType }
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
      prompt:
        selectedType.value === "databricks"
          ? "Workspace URL or host (e.g. adb-1234567890123456.7.azuredatabricks.net)"
          : selectedType.value === "airflow"
            ? "Airflow URL or host (e.g. http://localhost:8080)"
          : "Account URL or host (e.g. xy12345.us-east-1.snowflakecomputing.com)",
      validateInput: (value) => (value.trim() ? undefined : "Account is required")
    });
    if (!account) {
      return;
    }

    let airflowAuthType: "basic" | "token" | undefined;
    if (selectedType.value === "airflow") {
      const selectedAuth = await vscode.window.showQuickPick(
        [
          { label: "Basic Auth (username/password)", value: "basic" as const },
          { label: "Bearer Token", value: "token" as const }
        ],
        {
          placeHolder: "Select Airflow authentication method"
        }
      );

      if (!selectedAuth) {
        return;
      }

      airflowAuthType = selectedAuth.value;
    }

    const usernamePrompt =
      selectedType.value === "databricks"
        ? "Username or email"
        : selectedType.value === "airflow"
          ? airflowAuthType === "token"
            ? "Username (optional for token auth)"
            : "Username"
          : "Username";

    const usernameValidation = (value: string): string | undefined => {
      if (selectedType.value === "airflow" && airflowAuthType === "token") {
        return undefined;
      }

      return value.trim() ? undefined : "Username is required";
    };

    const usernameInput = await vscode.window.showInputBox({
      prompt: usernamePrompt,
      validateInput: usernameValidation
    });

    if (usernameInput === undefined) {
      return;
    }

    const username = usernameInput.trim() || "token-user";

    const warehouseId =
      selectedType.value === "databricks"
        ? await vscode.window.showInputBox({
            prompt: "SQL Warehouse ID (optional but recommended for SQL execution)",
            placeHolder: "e.g. 1234abcd5678efgh"
          })
        : undefined;

    const credentialPrompt =
      selectedType.value === "databricks"
        ? "Personal access token"
        : selectedType.value === "airflow" && airflowAuthType === "token"
          ? "Bearer token"
          : "Password";

    const credential = await vscode.window.showInputBox({
      prompt: credentialPrompt,
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
        username: username.trim(),
        warehouseId: warehouseId?.trim() || undefined,
        airflowAuthType
      }
    };

    await secretStorageService.saveConnection(
      id,
      selectedType.value === "databricks" || (selectedType.value === "airflow" && airflowAuthType === "token")
        ? {
            accessToken: credential.trim()
          }
        : {
            password: credential.trim()
          }
    );
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
