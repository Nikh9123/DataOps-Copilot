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

export type FailedTaskLogEntry = {
  taskId: string;
  state: string;
  tryNumber: number;
  log: string;
};

export type FailedDagAnalysisResult = {
  overallStatus: "error" | "warning" | "ok";
  rootCause: string;
  errorSummary: string;
  failedTasks: Array<{
    taskId: string;
      state: string;
    error: string;
    suggestion: string;
  }>;
  suggestedFixes: string[];
  nextSteps: string[];
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

  async analyzeFailedLogs(input: {
    dagId: string;
    runId: string;
    failedTasks: FailedTaskLogEntry[];
  }): Promise<FailedDagAnalysisResult> {
    const tasksForPrompt = input.failedTasks.slice(0, 8);
    const taskSections = input.failedTasks
      .slice(0, 8)
      .map((t) => {
        const lines = t.log.split("\n");
        const trimmed = lines.slice(-50).join("\n");
        return `Task: ${t.taskId} | state: ${t.state} | attempt #${t.tryNumber}\n${trimmed}`;
      })
      .join("\n\n---\n\n");

    const prompt = [
      "You are an expert Airflow engineer summarizing Airflow DAG run logs.",
      "",
      `DAG ID: ${input.dagId}`,
      `Run ID: ${input.runId}`,
      `Tasks included: ${tasksForPrompt.map((t) => `${t.taskId}:${t.state}`).join(", ")}`,
      "",
      "=== TASK LOGS ===",
      taskSections,
      "",
      "=== ANALYSIS REQUIRED ===",
      "1. Decide if the run shows an actual error, warning, or normal successful execution",
      "2. Write a concise 2-3 sentence summary of what happened in the logs",
      "3. If there is an error, identify the root cause with exact error details; if there is no error, summarize the main activity instead",
      "4. For each included task, provide a short summary. If a task failed, include the exact error and a concrete fix. If it succeeded, summarize what it did",
      "5. Provide actionable suggested fixes only when needed; otherwise provide validation steps",
      "6. Provide the next steps the engineer should take",
      "",
      "Return ONLY valid JSON in this exact shape:",
      "{",
      '  "overallStatus": "error",',
      '  "rootCause": "one concise line identifying the root cause or main outcome",',
      '  "errorSummary": "2-3 sentence narrative summary of what happened",',
      '  "failedTasks": [{"taskId": "...", "state": "failed", "error": "exact error or concise task summary", "suggestion": "specific concrete fix or validation step"}],',
      '  "suggestedFixes": ["actionable fix or validation step 1", "actionable fix or validation step 2"],',
      '  "nextSteps": ["next step 1", "next step 2"]',
      "}"
    ].join("\n");

    const raw = await this.aiProvider.createChatCompletion(
      [
        {
          role: "system",
          content:
            "You are an Airflow DAG log analysis expert. Analyze logs carefully and return valid JSON only. No markdown fences. No extra text."
        },
        { role: "user", content: prompt }
      ],
      0.1
    );

    return this.parseFailedLogAnalysis(raw);
  }

  private parseFailedLogAnalysis(raw: string): FailedDagAnalysisResult {
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
      throw new Error("AI failure log analysis returned invalid JSON.");
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("AI failure log analysis returned malformed data.");
    }

    const obj = parsed as Record<string, unknown>;
    const overallStatusRaw = typeof obj.overallStatus === "string" ? obj.overallStatus.toLowerCase() : "warning";

    return {
      overallStatus:
        overallStatusRaw === "error" || overallStatusRaw === "warning" || overallStatusRaw === "ok"
          ? overallStatusRaw
          : "warning",
      rootCause: typeof obj.rootCause === "string" ? obj.rootCause : "Root cause could not be determined.",
      errorSummary: typeof obj.errorSummary === "string" ? obj.errorSummary : "",
      failedTasks: Array.isArray(obj.failedTasks)
        ? obj.failedTasks
            .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
            .map((item) => ({
              taskId: typeof item.taskId === "string" ? item.taskId : "unknown",
              state: typeof item.state === "string" ? item.state : "unknown",
              error: typeof item.error === "string" ? item.error : "",
              suggestion: typeof item.suggestion === "string" ? item.suggestion : ""
            }))
        : [],
      suggestedFixes: Array.isArray(obj.suggestedFixes)
        ? obj.suggestedFixes.filter((i): i is string => typeof i === "string")
        : [],
      nextSteps: Array.isArray(obj.nextSteps)
        ? obj.nextSteps.filter((i): i is string => typeof i === "string")
        : []
    };
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
