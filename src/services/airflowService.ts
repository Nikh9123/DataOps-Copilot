import axios, { AxiosBasicCredentials, AxiosInstance } from "axios";
import { Connection } from "../models/connection";

export type AirflowDagInfo = {
  dagId: string;
  description?: string;
  isPaused: boolean;
  schedule: string;
  owners: string[];
  tags: string[];
  fileToken?: string;
  lastRunId?: string;
  lastRunState?: string;
};

export type AirflowDagRunInfo = {
  runId: string;
  state: string;
  runType?: string;
  logicalDate?: string;
  startDate?: string;
  endDate?: string;
};

export type AirflowTaskInstanceInfo = {
  taskId: string;
  state: string;
  tryNumber: number;
  maxTries: number;
  durationSec: number | null;
};

export type AirflowDagDetails = AirflowDagInfo & {
  timezone?: string;
  maxActiveTasks?: number;
  maxActiveRuns?: number;
};

export class AirflowService {
  async listDAGs(connection: Connection): Promise<AirflowDagInfo[]> {
    const client = this.createClient(connection);
    const response = await client.get<{ dags?: Array<Record<string, unknown>> }>("/dags", {
      params: {
        limit: 100,
        order_by: "-dag_id"
      }
    });

    return (response.data.dags ?? []).map((dag) => this.mapDag(dag));
  }

  async getDAGDetails(connection: Connection, dagId: string): Promise<AirflowDagDetails> {
    const client = this.createClient(connection);
    const response = await client.get<Record<string, unknown>>(`/dags/${encodeURIComponent(dagId)}`);

    const dag = this.mapDag(response.data);
    return {
      ...dag,
      timezone: toOptionalString(response.data.timezone),
      maxActiveTasks: toOptionalNumber(response.data.max_active_tasks),
      maxActiveRuns: toOptionalNumber(response.data.max_active_runs)
    };
  }

  async listDAGRuns(connection: Connection, dagId: string): Promise<AirflowDagRunInfo[]> {
    const client = this.createClient(connection);
    const response = await client.get<{ dag_runs?: Array<Record<string, unknown>> }>(
      `/dags/${encodeURIComponent(dagId)}/dagRuns`,
      {
        params: {
          limit: 25,
          order_by: "-start_date"
        }
      }
    );

    return (response.data.dag_runs ?? []).map((run) => ({
      runId: String(run.dag_run_id ?? "unknown"),
      state: String(run.state ?? "unknown"),
      runType: toOptionalString(run.run_type),
      logicalDate: toOptionalString(run.logical_date),
      startDate: toOptionalString(run.start_date),
      endDate: toOptionalString(run.end_date)
    }));
  }

  async getTaskInstances(connection: Connection, dagId: string, runId: string): Promise<AirflowTaskInstanceInfo[]> {
    const client = this.createClient(connection);
    const response = await client.get<{ task_instances?: Array<Record<string, unknown>> }>(
      `/dags/${encodeURIComponent(dagId)}/dagRuns/${encodeURIComponent(runId)}/taskInstances`
    );

    return (response.data.task_instances ?? []).map((task) => ({
      taskId: String(task.task_id ?? "unknown"),
      state: String(task.state ?? "unknown"),
      tryNumber: toNumber(task.try_number) ?? 0,
      maxTries: toNumber(task.max_tries) ?? 0,
      durationSec: toNumber(task.duration)
    }));
  }

  async getTaskLog(connection: Connection, dagId: string, runId: string, taskId: string, tryNumber: number): Promise<string> {
    const client = this.createClient(connection);
    const tryNum = Math.max(1, tryNumber);
    try {
      const response = await client.get(
        `/dags/${encodeURIComponent(dagId)}/dagRuns/${encodeURIComponent(runId)}/taskInstances/${encodeURIComponent(taskId)}/logs/${tryNum}`,
        { params: { full_content: true } }
      );
      const data = response.data as Record<string, unknown> | string;
      if (data && typeof data === "object" && typeof (data as Record<string, unknown>).content === "string") {
        return (data as Record<string, unknown>).content as string;
      }
      return String(data ?? "");
    } catch (err) {
      return `[Log unavailable: ${AirflowService.getAirflowError(err)}]`;
    }
  }

  async triggerDAG(connection: Connection, dagId: string): Promise<AirflowDagRunInfo> {
    const client = this.createClient(connection);
    const response = await client.post<Record<string, unknown>>(`/dags/${encodeURIComponent(dagId)}/dagRuns`, {});

    return {
      runId: String(response.data.dag_run_id ?? "unknown"),
      state: String(response.data.state ?? "queued"),
      runType: toOptionalString(response.data.run_type),
      logicalDate: toOptionalString(response.data.logical_date),
      startDate: toOptionalString(response.data.start_date),
      endDate: toOptionalString(response.data.end_date)
    };
  }

  private createClient(connection: Connection): AxiosInstance {
    const baseURL = this.normalizeBaseUrl(connection.config.account);
    const token = connection.config.accessToken?.trim();
    const username = connection.config.username?.trim();
    const password = connection.config.password?.trim();

    if (!token && (!username || !password)) {
      throw new Error("Airflow credentials are missing. Use username/password or bearer token.");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    let auth: AxiosBasicCredentials | undefined;

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else {
      auth = {
        username: username!,
        password: password!
      };
    }

    return axios.create({
      baseURL,
      timeout: 30000,
      headers,
      auth
    });
  }

  private normalizeBaseUrl(account: string): string {
    let value = account.trim().replace(/\/$/, "");
    if (!/^https?:\/\//i.test(value)) {
      value = `http://${value}`;
    }

    if (/\/api\/v1$/i.test(value)) {
      return value;
    }

    return `${value}/api/v1`;
  }

  private mapDag(dag: Record<string, unknown>): AirflowDagInfo {
    const owners = Array.isArray(dag.owners) ? dag.owners.map((item) => String(item)) : [];
    const tags = Array.isArray(dag.tags)
      ? dag.tags.map((item) => String((item as Record<string, unknown>)?.name ?? item))
      : [];

    const lastRun = (dag.latest_dag_run as Record<string, unknown> | undefined) ?? undefined;

    return {
      dagId: String(dag.dag_id ?? "unknown"),
      description: toOptionalString(dag.description),
      isPaused: Boolean(dag.is_paused),
      schedule: toOptionalString(dag.schedule_interval) ?? "None",
      owners,
      tags,
      fileToken: toOptionalString(dag.file_token),
      lastRunId: toOptionalString(lastRun?.dag_run_id),
      lastRunState: toOptionalString(lastRun?.state)
    };
  }

  static getAirflowError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const payload = error.response?.data as Record<string, unknown> | undefined;
      const detail = payload?.detail;
      if (typeof detail === "string" && detail.trim()) {
        return detail;
      }

      if (typeof payload?.message === "string" && payload.message.trim()) {
        return payload.message;
      }

      return error.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = toNumber(value);
  return parsed === null ? undefined : parsed;
}
