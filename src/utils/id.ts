import { randomUUID } from "crypto";

export function createConnectionId(): string {
  return randomUUID();
}
