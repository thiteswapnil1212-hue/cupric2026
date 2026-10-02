export function normalizeDatabaseTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("Supabase returned an invalid timestamp.");
  }
  return timestamp.toISOString();
}
