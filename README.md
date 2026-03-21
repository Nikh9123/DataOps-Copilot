# DataOps Copilot

DataOps Copilot is a VS Code extension that enables data engineers to manage multiple data platform connections and execute Snowflake SQL directly from the editor.

## Features

- Multi-account connection management
- Secure credential storage using VS Code SecretStorage
- Snowflake query execution from the active editor
- Sidebar tree view for DataOps connections
- Command palette integration
- Extensible architecture for future services (Databricks, BigQuery)

## Commands

- `DataOps: Add Connection` (`dataops.addConnection`)
- `DataOps: Switch Active Connection` (`dataops.switchConnection`)
- `DataOps: Run Active SQL Query` (`dataops.runQuery`)

## Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Compile:
   ```bash
   npm run compile
   ```
3. Launch extension host in VS Code:
   - Open this folder
   - Press `F5`

## Notes

- Credentials are stored in VS Code's secure SecretStorage API.
- Connection metadata (name, type, account, username) is stored in global state.
- Query output is written to the `DataOps Copilot` output channel.
