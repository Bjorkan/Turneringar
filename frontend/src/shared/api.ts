export type ApiBody = BodyInit | Record<string, unknown> | null;
export type ApiOptions = Omit<RequestInit, "body"> & { body?: ApiBody };

export async function api<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method || "GET",
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : {};
  if (!response.ok) throw new Error(payload.detail || "Något gick fel.");
  return payload;
}

export function formPayload(form: HTMLFormElement): Record<string, FormDataEntryValue> {
  const payload: Record<string, FormDataEntryValue> = {};
  for (const [key, value] of new FormData(form).entries()) payload[key] = value;
  return payload;
}
