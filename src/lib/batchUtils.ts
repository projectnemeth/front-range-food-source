export async function getCurrentBatchId(): Promise<string | null> {
  const response = await fetch("/api/settings", { cache: "no-store" });
  if (!response.ok) throw new Error("serverError");
  return (await response.json()).currentBatchId;
}
