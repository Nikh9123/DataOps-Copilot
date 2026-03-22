import axios from "axios";
import { Connection } from "../models/connection";
import { DatabricksApiClient } from "./databricksApiClient";

export type DatabricksAppInfo = {
  id: string;
  name: string;
  state: string;
  url?: string;
  statusMessage?: string;
  errorCode?: string;
};

export class DatabricksAppsService {
  constructor(private readonly client = new DatabricksApiClient()) {}

  async listApps(connection: Connection): Promise<DatabricksAppInfo[]> {
    const endpoints = this.getListEndpoints();
    let lastError: unknown;

    for (const endpoint of endpoints) {
      try {
        const response = await this.client.get<{ apps?: Array<Record<string, unknown>> }>(connection, endpoint);
        return (response.apps ?? []).map((app) => this.mapApp(app));
      } catch (error) {
        lastError = error;
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          continue;
        }

        throw error;
      }
    }

    // Workspace may not have Databricks Apps API enabled.
    if (axios.isAxiosError(lastError) && lastError.response?.status === 404) {
      return [];
    }

    throw lastError ?? new Error("Failed to load Databricks apps.");
  }

  async getAppDetails(connection: Connection, appId: string): Promise<DatabricksAppInfo> {
    const endpoints = this.getDetailEndpoints(appId);
    let lastError: unknown;

    for (const endpoint of endpoints) {
      try {
        const response = await this.client.get<Record<string, unknown>>(connection, endpoint);
        return this.mapApp(response);
      } catch (error) {
        lastError = error;
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          continue;
        }

        throw error;
      }
    }

    throw lastError ?? new Error(`Failed to load Databricks app details for ${appId}.`);
  }

  private getListEndpoints(): string[] {
    return ["/api/2.0/apps", "/api/2.0/preview/apps"];
  }

  private getDetailEndpoints(appId: string): string[] {
    const encoded = encodeURIComponent(appId);
    return [
      `/api/2.0/apps/${encoded}`,
      `/api/2.0/apps/get?app_id=${encoded}`,
      `/api/2.0/preview/apps/${encoded}`,
      `/api/2.0/preview/apps/get?app_id=${encoded}`
    ];
  }

  private mapApp(app: Record<string, unknown>): DatabricksAppInfo {
    const id = String(app.app_id ?? app.id ?? app.name ?? "unknown");
    const name = String(app.name ?? app.display_name ?? app.app_id ?? app.id ?? "App");
    const state = String(app.state ?? app.status ?? app.lifecycle_state ?? "UNKNOWN");
    const url =
      typeof app.url === "string"
        ? app.url
        : typeof app.app_url === "string"
          ? app.app_url
          : undefined;
    const statusMessage =
      typeof app.status_message === "string"
        ? app.status_message
        : typeof app.message === "string"
          ? app.message
          : typeof app.reason === "string"
            ? app.reason
            : undefined;
    const errorCode = typeof app.error_code === "string" ? app.error_code : undefined;

    return {
      id,
      name,
      state,
      url,
      statusMessage,
      errorCode
    };
  }
}
