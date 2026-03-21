export function quoteIdentifier(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function quoteQualifiedIdentifier(parts: string[]): string {
  return parts.map((part) => quoteIdentifier(part)).join(".");
}
