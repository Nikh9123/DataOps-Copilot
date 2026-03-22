import { AiProvider } from "./aiProvider";
import { AirflowDagDetails, AirflowDagRunInfo, AirflowTaskInstanceInfo } from "./airflowService";

export type AirflowAdvisorInput = {
  dag: AirflowDagDetails;
  runs: AirflowDagRunInfo[];
  tasks: AirflowTaskInstanceInfo[];
};

export type AirflowAdvisorResult = {
  issues: string[];
  suggestions: string[];
  recommendation: string;
};

export class GeminiAirflowAdvisorService {
  constructor(private readonly aiProvider: AiProvider) {}

  async analyze(input: AirflowAdvisorInput): Promise<AirflowAdvisorResult> {
    const failedTasks = input.tasks.filter((task) => /failed|upstream_failed/i.test(task.state));
    const avgDuration =
      input.tasks.filter((task) => typeof task.durationSec === "number").reduce((acc, task) => acc + (task.durationSec ?? 0), 0) /
      Math.max(1, input.tasks.filter((task) => typeof task.durationSec === "number").length);

    const prompt = [
      "You are an Airflow pipeline expert.",
      "",
      "Analyze this DAG execution data:",
      `* DAG schedule: ${input.dag.schedule}`,
      `* DAG paused: ${input.dag.isPaused}`,
      `* Recent run states: ${input.runs.slice(0, 8).map((run) => `${run.runId}:${run.state}`).join(", ") || "none"}`,
      `* Failed tasks: ${failedTasks.map((task) => task.taskId).join(", ") || "none"}`,
      `* Average task duration (sec): ${Number.isFinite(avgDuration) ? avgDuration.toFixed(2) : "unknown"}`,
      `* Task retries/tries: ${input.tasks.map((task) => `${task.taskId}(try ${task.tryNumber}/${task.maxTries})`).join(", ") || "none"}`,
      "* dependencies: inferred from execution order and task states",
      "",
      "Provide:",
      "1. Pipeline issues",
      "2. Bottlenecks",
      "3. Optimization suggestions",
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

  private parse(raw: string): AirflowAdvisorResult {
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
      throw new Error("Gemini Airflow advisor returned invalid JSON.");
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Gemini Airflow advisor returned malformed data.");
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
