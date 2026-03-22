import * as vscode from "vscode";
import { Connection } from "../models/connection";
import { AirflowDagInfo, AirflowDagRunInfo, AirflowService, AirflowTaskInstanceInfo } from "../services/airflowService";

export type AirflowNodeType =
  | "airflowDagsRoot"
  | "airflowDag"
  | "airflowDagRunsRoot"
  | "airflowDagRun"
  | "airflowDagTasksRoot"
  | "airflowTask";

export type AirflowNodePayload = {
  connectionId: string;
  dagId?: string;
  runId?: string;
  dag?: AirflowDagInfo;
  run?: AirflowDagRunInfo;
  task?: AirflowTaskInstanceInfo;
};

export type AirflowVirtualNode = {
  nodeType: AirflowNodeType | "loading" | "info" | "error";
  label: string;
  description?: string;
  iconName?: string;
  collapsibleState: vscode.TreeItemCollapsibleState;
  payload?: Partial<AirflowNodePayload>;
  contextValue?: string;
  command?: {
    command: string;
    title: string;
    arguments?: unknown[];
  };
};

export class AirflowTreeProvider implements vscode.Disposable {
  private readonly dagsCache = new Map<string, AirflowDagInfo[]>();
  private readonly runsCache = new Map<string, AirflowDagRunInfo[]>();
  private readonly tasksCache = new Map<string, AirflowTaskInstanceInfo[]>();
  private readonly loadingKeys = new Set<string>();
  private readonly errorKeys = new Map<string, string>();

  constructor(
    private readonly airflowService: AirflowService,
    private readonly resolveConnection: (connectionId: string) => Promise<Connection>,
    private readonly refreshCallback: () => void
  ) {}

  dispose(): void {}

  clearCaches(): void {
    this.dagsCache.clear();
    this.runsCache.clear();
    this.tasksCache.clear();
    this.loadingKeys.clear();
    this.errorKeys.clear();
  }

  getConnectionRoots(connectionId: string): AirflowVirtualNode[] {
    return [
      {
        nodeType: "airflowDagsRoot",
        label: "DAGs",
        iconName: "symbol-method",
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        payload: { connectionId }
      }
    ];
  }

  getChildren(nodeType: AirflowNodeType, payload: Partial<AirflowNodePayload>): AirflowVirtualNode[] {
    const connectionId = payload.connectionId;
    if (!connectionId) {
      return [this.createInfoNode("Connection unavailable")];
    }

    switch (nodeType) {
      case "airflowDagsRoot":
        return this.getSectionChildren(
          `airflowDags::${connectionId}`,
          this.dagsCache.get(connectionId),
          () => this.loadDags(connectionId),
          (dags) =>
            dags.map((dag) => ({
              nodeType: "airflowDag",
              label: dag.dagId,
              description: dag.lastRunState ?? (dag.isPaused ? "PAUSED" : "ACTIVE"),
              iconName: this.getStateIcon(dag.lastRunState ?? (dag.isPaused ? "PAUSED" : "ACTIVE")),
              collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
              payload: { connectionId, dagId: dag.dagId, dag },
              contextValue: /failed/i.test(dag.lastRunState ?? "") ? "dataops.airflowDag.failed" : "dataops.airflowDag",
              command: {
                command: "dataops.showAirflowDagDetails",
                title: "Show Airflow DAG Details",
                arguments: [{ connectionId, dagId: dag.dagId }]
              }
            }))
        );
      case "airflowDag":
        if (!payload.dagId) {
          return [this.createInfoNode("DAG unavailable")];
        }

        return [
          {
            nodeType: "airflowDagRunsRoot",
            label: "Runs",
            iconName: "history",
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            payload: { connectionId, dagId: payload.dagId }
          },
          {
            nodeType: "airflowDagTasksRoot",
            label: "Tasks",
            iconName: "checklist",
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            payload: { connectionId, dagId: payload.dagId }
          }
        ];
      case "airflowDagRunsRoot":
        if (!payload.dagId) {
          return [this.createInfoNode("DAG unavailable")];
        }

        return this.getSectionChildren(
          `airflowRuns::${connectionId}::${payload.dagId}`,
          this.runsCache.get(`airflowRuns::${connectionId}::${payload.dagId}`),
          () => this.loadRuns(connectionId, payload.dagId as string),
          (runs) =>
            runs.map((run) => ({
              nodeType: "airflowDagRun",
              label: run.runId,
              description: run.state,
              iconName: this.getStateIcon(run.state),
              collapsibleState: vscode.TreeItemCollapsibleState.None,
              payload: { connectionId, dagId: payload.dagId, runId: run.runId, run },
              contextValue: /failed/i.test(run.state) ? "dataops.airflowDagRun.failed" : "dataops.airflowDagRun"
            }))
        );
      case "airflowDagTasksRoot":
        if (!payload.dagId) {
          return [this.createInfoNode("DAG unavailable")];
        }

        const runsKey = `airflowRuns::${connectionId}::${payload.dagId}`;
        const cachedRuns = this.runsCache.get(runsKey);
        const latestRunId = cachedRuns?.[0]?.runId;

        if (!latestRunId) {
          if (!this.loadingKeys.has(runsKey)) {
            void this.loadRuns(connectionId, payload.dagId as string);
          }
          return [this.createInfoNode("No run available yet. Expand Runs and refresh if needed.")];
        }

        return this.getSectionChildren(
          `airflowTasks::${connectionId}::${payload.dagId}::${latestRunId}`,
          this.tasksCache.get(`airflowTasks::${connectionId}::${payload.dagId}::${latestRunId}`),
          () => this.loadTasks(connectionId, payload.dagId as string, latestRunId),
          (tasks) =>
            tasks.map((task) => ({
              nodeType: "airflowTask",
              label: task.taskId,
              description: `${task.state} • try ${task.tryNumber}/${task.maxTries}`,
              iconName: this.getStateIcon(task.state),
              collapsibleState: vscode.TreeItemCollapsibleState.None,
              payload: { connectionId, dagId: payload.dagId, runId: latestRunId, task },
              contextValue: "dataops.airflowTask"
            }))
        );
      default:
        return [];
    }
  }

  private getSectionChildren<T>(
    key: string,
    cached: T[] | undefined,
    loader: () => Promise<void>,
    render: (items: T[]) => AirflowVirtualNode[]
  ): AirflowVirtualNode[] {
    if (this.loadingKeys.has(key)) {
      return [this.createLoadingNode()];
    }

    if (this.errorKeys.has(key)) {
      return [this.createErrorNode(this.errorKeys.get(key) ?? "Failed to load Airflow resources")];
    }

    if (cached) {
      if (!cached.length) {
        return [this.createInfoNode("No resources found")];
      }
      return render(cached);
    }

    void loader();
    return [this.createLoadingNode()];
  }

  private async loadDags(connectionId: string): Promise<void> {
    await this.load(`airflowDags::${connectionId}`, async () => {
      const connection = await this.resolveConnection(connectionId);
      this.dagsCache.set(connectionId, await this.airflowService.listDAGs(connection));
    });
  }

  private async loadRuns(connectionId: string, dagId: string): Promise<void> {
    const key = `airflowRuns::${connectionId}::${dagId}`;
    await this.load(key, async () => {
      const connection = await this.resolveConnection(connectionId);
      this.runsCache.set(key, await this.airflowService.listDAGRuns(connection, dagId));
    });
  }

  private async loadTasks(connectionId: string, dagId: string, runId: string): Promise<void> {
    const key = `airflowTasks::${connectionId}::${dagId}::${runId}`;
    await this.load(key, async () => {
      const connection = await this.resolveConnection(connectionId);
      this.tasksCache.set(key, await this.airflowService.getTaskInstances(connection, dagId, runId));
    });
  }

  private async load(key: string, task: () => Promise<void>): Promise<void> {
    this.loadingKeys.add(key);
    this.errorKeys.delete(key);
    this.refreshCallback();

    try {
      await task();
    } catch (error) {
      this.errorKeys.set(key, error instanceof Error ? error.message : String(error));
    } finally {
      this.loadingKeys.delete(key);
      this.refreshCallback();
    }
  }

  private createLoadingNode(): AirflowVirtualNode {
    return {
      nodeType: "loading",
      label: "Loading...",
      iconName: "loading~spin",
      collapsibleState: vscode.TreeItemCollapsibleState.None
    };
  }

  private createInfoNode(message: string): AirflowVirtualNode {
    return {
      nodeType: "info",
      label: message,
      iconName: "info",
      collapsibleState: vscode.TreeItemCollapsibleState.None
    };
  }

  private createErrorNode(message: string): AirflowVirtualNode {
    return {
      nodeType: "error",
      label: `Error: ${message}`,
      iconName: "error",
      collapsibleState: vscode.TreeItemCollapsibleState.None
    };
  }

  private getStateIcon(state: string): string {
    const normalized = state.toUpperCase();
    if (normalized.includes("SUCCESS") || normalized.includes("ACTIVE") || normalized.includes("RUNNING")) {
      return "pass-filled";
    }

    if (normalized.includes("FAILED") || normalized.includes("ERROR") || normalized.includes("UPSTREAM_FAILED")) {
      return "error";
    }

    if (normalized.includes("QUEUED") || normalized.includes("SCHEDULED")) {
      return "clock";
    }

    if (normalized.includes("PAUSED")) {
      return "circle-slash";
    }

    return "history";
  }
}
