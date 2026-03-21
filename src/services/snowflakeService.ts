import * as snowflake from "snowflake-sdk";
import { Connection } from "../models/connection";
import { QueryExecutionResult } from "../models/query";
import { quoteIdentifier, quoteQualifiedIdentifier } from "../utils/identifier";

export class SnowflakeService {
  async executeQuery(connection: Connection, query: string): Promise<QueryExecutionResult> {
    const startedAt = Date.now();
    const { account, username, password } = this.getBasicCredentials(connection);

    const conn = snowflake.createConnection({
      account,
      username,
      password,
      application: "DataOpsCopilotVSCode"
    });

    const rows = await this.executeStatement(conn, query);
    const columns = this.extractColumns(rows);

    return {
      columns,
      rows,
      rowCount: rows.length,
      executionTimeMs: Date.now() - startedAt,
      raw: rows
    };
  }

  async getDatabases(connection: Connection): Promise<string[]> {
    const result = await this.executeQuery(connection, "SHOW DATABASES");
    return this.extractNameColumn(result, ["name"]);
  }

  async getSchemas(connection: Connection, database: string): Promise<string[]> {
    const sql = `SHOW SCHEMAS IN DATABASE ${quoteIdentifier(database)}`;
    const result = await this.executeQuery(connection, sql);
    return this.extractNameColumn(result, ["name"]);
  }

  async getTables(connection: Connection, database: string, schema: string): Promise<string[]> {
    const sql = `SHOW TABLES IN SCHEMA ${quoteQualifiedIdentifier([database, schema])}`;
    const result = await this.executeQuery(connection, sql);
    return this.extractNameColumn(result, ["name"]);
  }

  async previewTable(
    connection: Connection,
    database: string,
    schema: string,
    table: string
  ): Promise<QueryExecutionResult> {
    const fullyQualified = quoteQualifiedIdentifier([database, schema, table]);
    const sql = `SELECT * FROM ${fullyQualified} LIMIT 100`;
    return this.executeQuery(connection, sql);
  }

  private extractNameColumn(result: QueryExecutionResult, candidateColumns: string[]): string[] {
    const lookup = new Set(candidateColumns.map((item) => item.toLowerCase()));
    const matchedColumn = result.columns.find((column) => lookup.has(column.toLowerCase()));

    if (!matchedColumn) {
      return [];
    }

    return result.rows
      .map((row) => row[matchedColumn])
      .filter((value): value is string => typeof value === "string")
      .sort((a, b) => a.localeCompare(b));
  }

  private getBasicCredentials(connection: Connection): {
    account: string;
    username: string;
    password: string;
  } {
    const username = connection.config.username?.trim();
    const password = connection.config.password;

    if (!username || !password) {
      throw new Error("Snowflake username/password are required. Re-add the connection.");
    }

    return {
      account: this.normalizeAccount(connection.config.account),
      username,
      password
    };
  }

  private normalizeAccount(account: string): string {
    const cleaned = account
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\.snowflakecomputing\.com$/i, "")
      .replace(/\/$/, "");

    return cleaned;
  }

  private executeStatement(conn: snowflake.Connection, sqlText: string): Promise<Array<Record<string, unknown>>> {
    return new Promise((resolve, reject) => {
      conn.connect((connectError) => {
        if (connectError) {
          reject(connectError);
          return;
        }

        conn.execute({
          sqlText,
          complete: (statementError, _stmt, rows) => {
            conn.destroy((closeError) => {
              if (closeError) {
                // Connection close error is non-fatal for query results.
              }
            });

            if (statementError) {
              reject(statementError);
              return;
            }

            resolve((rows ?? []) as Array<Record<string, unknown>>);
          }
        });
      });
    });
  }

  private extractColumns(rows: Array<Record<string, unknown>>): string[] {
    if (!rows.length) {
      return [];
    }

    return Object.keys(rows[0]);
  }

  static getSnowflakeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
