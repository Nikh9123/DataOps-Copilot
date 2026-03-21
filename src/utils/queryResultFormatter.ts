import { QueryExecutionResult } from "../models/query";

export function formatQueryResult(result: QueryExecutionResult): string {
  if (result.rowCount === 0) {
    return "Query executed successfully. No rows returned.";
  }

  const header = result.columns.join("\t");
  const rows = result.rows.map((row) => result.columns.map((column) => String(row[column] ?? "")).join("\t"));

  return [header, ...rows].join("\n");
}
