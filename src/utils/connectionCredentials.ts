import { Connection } from "../models/connection";
import { SecretStorageService } from "../services/secretStorageService";

export async function getConnectionWithCredentials(
  baseConnection: Connection,
  secretStorageService: SecretStorageService
): Promise<Connection> {
  const secret = await secretStorageService.getConnection(baseConnection.id);
  if (!secret?.password && !secret?.accessToken) {
    throw new Error("Credentials not found for the selected connection.");
  }

  return {
    ...baseConnection,
    config: {
      ...baseConnection.config,
      password: secret.password,
      accessToken: secret.accessToken
    }
  };
}
