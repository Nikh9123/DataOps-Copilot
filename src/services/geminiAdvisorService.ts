import { AiProvider } from "./aiProvider";

export type DatabricksAdvisorInput = {
  workloadType: string;
  clusterState?: string;
  numWorkers?: number | null;
  jobDurationMs?: number | null;
  queryExecutionTimeMs?: number | null;
  warehouseSize?: string;
  appName?: string;
  appState?: string;
  appStatusMessage?: string;
  failureReason?: string;
};

export type DatabricksAdvisorResult = {
  issues: string[];
  suggestions: string[];
  recommendation: string;
};

export class GeminiAdvisorService {
  constructor(private readonly aiProvider: AiProvider) {}

  async analyze(input: DatabricksAdvisorInput): Promise<DatabricksAdvisorResult> {
    const prompt = [
      "You are a Databricks performance expert.",
      "",
      "Analyze the following metrics:",
      `* cluster size (num_workers): ${input.numWorkers ?? "unknown"}`,
      `* cluster state: ${input.clusterState ?? "unknown"}`,
      `* job duration: ${input.jobDurationMs ?? "unknown"}`,
      `* query execution time: ${input.queryExecutionTimeMs ?? "unknown"}`,
      `* workload type: ${input.workloadType}`,
      `* warehouse size: ${input.warehouseSize ?? "unknown"}`,
      `* app name: ${input.appName ?? "unknown"}`,
      `* app state: ${input.appState ?? "unknown"}`,
      `* app status message: ${input.appStatusMessage ?? "unknown"}`,
      `* failure reason: ${input.failureReason ?? "unknown"}`,
      "",
      "Provide:",
      "1. Current status summary (running/stopped/failed and what it implies)",
      "2. Problems or failure causes (if any)",
      "3. Improvement recommendations",
      "",
      "Return JSON:",
      "{",
      '"issues": [],',
      '"suggestions": [],',
      '"recommendation": ""',
      "}"
    ].join("\n");

    const raw = await this.aiProvider.createChatCompletion(
      [
        { role: "system", content: "Return valid JSON only." },
        { role: "user", content: prompt }
      ],
      0.1
    );

    return this.parse(raw);
  }

  private parse(raw: string): DatabricksAdvisorResult {
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("Gemini advisor returned invalid JSON.");
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Gemini advisor returned malformed data.");
    }

    const obj = parsed as Record<string, unknown>;
    return {
      issues: Array.isArray(obj.issues) ? obj.issues.filter((item): item is string => typeof item === "string") : [],
      suggestions: Array.isArray(obj.suggestions)
        ? obj.suggestions.filter((item): item is string => typeof item === "string")
        : [],
      recommendation: typeof obj.recommendation === "string" ? obj.recommendation : "No recommendation available."
    };
  }
}
