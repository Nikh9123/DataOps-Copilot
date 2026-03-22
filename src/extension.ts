import * as vscode from "vscode";
import { registerAddConnectionCommand } from "./commands/addConnectionCommand";
import { registerPreviewTableCommand } from "./commands/previewTableCommand";
import { registerGenerateQueryCommand } from "./commands/generateQueryCommand";
import { registerOptimizeQueryCommand } from "./commands/optimizeQueryCommand";
import { registerPredictQueryCostCommand } from "./commands/predictQueryCostCommand";
import { registerRemoveConnectionCommand } from "./commands/removeConnectionCommand";
import { registerRunQueryCommand } from "./commands/runQueryCommand";
import { registerShowAirflowDagDetailsCommand } from "./commands/showAirflowDagDetailsCommand";
import { registerShowDatabricksDetailsCommand } from "./commands/showDatabricksDetailsCommand";
import { registerSwitchConnectionCommand } from "./commands/switchConnectionCommand";
import { registerTriggerDAGCommand } from "./commands/triggerDAGCommand";
import { registerHistoryCommands } from "./commands/queryHistoryCommand";
import { AirflowTreeProvider } from "./providers/airflowTreeProvider";
import { Connection } from "./models/connection";
import { ConnectionsTreeDataProvider } from "./providers/connectionsTreeDataProvider";
import { DatabricksTreeProvider } from "./providers/databricksTreeProvider";
import { HistoryTreeDataProvider } from "./providers/historyTreeProvider";
import { AirflowService } from "./services/airflowService";
import { ConnectionManager } from "./services/connectionManager";
import { SecretStorageService } from "./services/secretStorageService";
import { SnowflakeService } from "./services/snowflakeService";
import { QueryHistoryService } from "./services/queryHistoryService";
import { AiProviderFactory } from "./services/aiProvider";
import { AiOptimizerService } from "./services/aiOptimizerService";
import { AiQueryGeneratorService } from "./services/aiQueryGeneratorService";
import { AiCostEstimatorService } from "./services/aiCostEstimatorService";
import { DatabricksClusterService } from "./services/databricksClusterService";
import { DatabricksJobsService } from "./services/databricksJobsService";
import { DatabricksWarehouseService } from "./services/databricksWarehouseService";
import { DatabricksQueryHistoryService } from "./services/databricksQueryHistoryService";
import { DatabricksMetadataService } from "./services/databricksMetadataService";
import { DatabricksSqlService } from "./services/databricksSqlService";
import { GeminiAirflowAdvisorService } from "./services/geminiAirflowAdvisor";
import { GeminiAdvisorService } from "./services/geminiAdvisorService";
import { QueryCostAnalyzer } from "./services/queryCostAnalyzer";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const connectionManager = new ConnectionManager();
  const secretStorageService = new SecretStorageService(context.secrets, context.globalState);
  const snowflakeService = new SnowflakeService();
  const databricksClusterService = new DatabricksClusterService();
  const databricksJobsService = new DatabricksJobsService();
  const databricksWarehouseService = new DatabricksWarehouseService();
  const databricksQueryHistoryService = new DatabricksQueryHistoryService();
  const databricksMetadataService = new DatabricksMetadataService();
  const databricksSqlService = new DatabricksSqlService();
  const airflowService = new AirflowService();
  const queryHistoryService = new QueryHistoryService(context.globalState);
  const queryCostAnalyzer = new QueryCostAnalyzer();

  let aiOptimizerService: AiOptimizerService | undefined;
  let aiQueryGeneratorService: AiQueryGeneratorService | undefined;
  let aiCostEstimatorService: AiCostEstimatorService | undefined;
  let geminiAdvisorService: GeminiAdvisorService | undefined;
  let geminiAirflowAdvisorService: GeminiAirflowAdvisorService | undefined;

  try {
    const aiProvider = AiProviderFactory.fromEnvironment();
    aiOptimizerService = new AiOptimizerService(aiProvider);
    aiQueryGeneratorService = new AiQueryGeneratorService(aiProvider);
    aiCostEstimatorService = new AiCostEstimatorService(aiProvider);
    geminiAdvisorService = new GeminiAdvisorService(aiProvider);
    geminiAirflowAdvisorService = new GeminiAirflowAdvisorService(aiProvider);
  } catch {
    // AI commands will be registered with setup hints when env vars are missing.
  }

  const outputChannel = vscode.window.createOutputChannel("DataOps Copilot");
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "dataops.switchConnection";
  statusBarItem.tooltip = "Switch active DataOps connection";

  const databricksTreeProvider = new DatabricksTreeProvider(
    databricksClusterService,
    databricksJobsService,
    databricksWarehouseService,
    databricksQueryHistoryService,
    databricksMetadataService,
    async (connectionId) => {
      const baseConnection = connectionManager.getConnectionById(connectionId);
      if (!baseConnection || baseConnection.type !== "databricks") {
        throw new Error("Databricks connection not found.");
      }

      return secretStorageService.getConnection(connectionId).then((secret) => {
        if (!secret?.accessToken && !secret?.password) {
          throw new Error("Credentials not found for the selected connection.");
        }

        return {
          ...baseConnection,
          config: {
            ...baseConnection.config,
            accessToken: secret.accessToken,
            password: secret.password
          }
        };
      });
    },
    () => treeProvider.refresh()
  );
  const airflowTreeProvider = new AirflowTreeProvider(
    airflowService,
    async (connectionId) => {
      const baseConnection = connectionManager.getConnectionById(connectionId);
      if (!baseConnection || baseConnection.type !== "airflow") {
        throw new Error("Airflow connection not found.");
      }

      return secretStorageService.getConnection(connectionId).then((secret) => {
        if (!secret?.accessToken && !secret?.password) {
          throw new Error("Credentials not found for the selected connection.");
        }

        return {
          ...baseConnection,
          config: {
            ...baseConnection.config,
            accessToken: secret.accessToken,
            password: secret.password
          }
        };
      });
    },
    () => treeProvider.refresh()
  );
  const treeProvider = new ConnectionsTreeDataProvider(
    connectionManager,
    secretStorageService,
    snowflakeService,
    databricksTreeProvider,
    airflowTreeProvider
  );
  const historyProvider = new HistoryTreeDataProvider(queryHistoryService);

  const treeViewDisposable = vscode.window.registerTreeDataProvider("dataops.connectionsView", treeProvider);
  const historyViewDisposable = vscode.window.registerTreeDataProvider("dataops.historyView", historyProvider);

  context.subscriptions.push(
    outputChannel,
    statusBarItem,
    treeViewDisposable,
    historyViewDisposable,
    queryHistoryService,
    treeProvider,
    databricksTreeProvider,
    airflowTreeProvider
  );

  const refreshUi = () => {
    treeProvider.refresh();

    const active = connectionManager.getActiveConnection();
    const platform =
      active?.type === "snowflake"
        ? "Snowflake"
        : active?.type === "databricks"
          ? "Databricks"
          : active?.type === "airflow"
            ? "Airflow"
            : undefined;

    statusBarItem.text = active
      ? `$(pass-filled) ${platform ?? active.type}: ${active.name}`
      : "$(circle-slash) DataOps: No connection";
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
    registerRemoveConnectionCommand(connectionManager, secretStorageService),
    registerSwitchConnectionCommand(connectionManager, secretStorageService),
    registerRunQueryCommand(
      connectionManager,
      secretStorageService,
      snowflakeService,
      databricksSqlService,
      outputChannel,
      queryHistoryService,
      queryCostAnalyzer,
      aiCostEstimatorService
    ),
    registerPreviewTableCommand(
      connectionManager,
      secretStorageService,
      snowflakeService,
      databricksSqlService,
      queryHistoryService
    ),
    registerPredictQueryCostCommand(queryCostAnalyzer, aiCostEstimatorService),
    registerShowDatabricksDetailsCommand(
      connectionManager,
      secretStorageService,
      databricksClusterService,
      geminiAdvisorService
    ),
    registerShowAirflowDagDetailsCommand(
      connectionManager,
      secretStorageService,
      airflowService,
      geminiAirflowAdvisorService
    ),
    registerTriggerDAGCommand(connectionManager, secretStorageService, airflowService),
    registerOptimizeQueryCommand(
      aiOptimizerService ??
        new AiOptimizerService({
          async createChatCompletion(): Promise<string> {
            throw new Error(
              "AI provider not configured. Set DATAOPS_OPENAI_API_KEY (or DATAOPS_GEMINI_API_KEY + DATAOPS_AI_PROVIDER=gemini)."
            );
          }
        })
    ),
    registerGenerateQueryCommand(
      connectionManager,
      secretStorageService,
      snowflakeService,
      aiQueryGeneratorService ??
        new AiQueryGeneratorService({
          async createChatCompletion(): Promise<string> {
            throw new Error(
              "AI provider not configured. Set DATAOPS_OPENAI_API_KEY (or DATAOPS_GEMINI_API_KEY + DATAOPS_AI_PROVIDER=gemini)."
            );
          }
        })
    ),
    ...registerHistoryCommands(queryHistoryService, connectionManager, secretStorageService, snowflakeService),
    vscode.commands.registerCommand("dataops.refreshConnections", () => {
      treeProvider.hardRefresh();
      refreshUi();
      void vscode.window.setStatusBarMessage("DataOps: Refreshed all connections and metadata", 2500);
    }),
    vscode.commands.registerCommand("dataops.refreshDatabricksServices", () => {
      databricksTreeProvider.clearCaches();
      treeProvider.refresh();
      refreshUi();
    }),
    vscode.commands.registerCommand("dataops.refreshAirflow", () => {
      airflowTreeProvider.clearCaches();
      treeProvider.refresh();
      refreshUi();
    })
  );
}

export function deactivate(): void {
  // No-op: VS Code disposes subscriptions registered in activate().
}
