export type DateValue = string | number | Date | null | undefined;

export const statusText: Record<string, string> = {
  pending: "Planerad",
  scheduled: "Planerad",
  in_progress: "Pågår",
  paused: "Paus",
  completed: "Avslutad",
  ready: "Redo",
  draft: "Utkast",
};

export const eventText: Record<string, string> = {
  participant_added: "Deltagare tillagd",
  resource_added: "Resurs tillagd",
  settings_updated: "Inställningar uppdaterade",
  structure_generated: "Slutspel publicerat",
  bracket_seeded: "Slutspel seedat",
  schedule_updated: "Schema uppdaterat",
  score_updated: "Livepoäng uppdaterad",
  result_updated: "Resultat rapporterat",
};

const defaultDateFormat: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

export function parseDate(value: DateValue): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: DateValue, options: Intl.DateTimeFormatOptions = defaultDateFormat): string {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat("sv-SE", options).format(date) : String(value || "-");
}

export function formatTime(value: DateValue): string {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(date) : "-";
}

export function formatClock(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function sortBySchedule<T extends { id: number; scheduled_at?: string | null }>(matches: T[]): T[] {
  return [...matches].sort((a, b) => {
    if (!a.scheduled_at && !b.scheduled_at) return a.id - b.id;
    if (!a.scheduled_at) return 1;
    if (!b.scheduled_at) return -1;
    return a.scheduled_at.localeCompare(b.scheduled_at) || a.id - b.id;
  });
}

export function statusTone(status?: string | null): string {
  if (status === "completed") return "done";
  if (status === "in_progress") return "success";
  if (status === "paused") return "warning";
  if (status === "pending" || status === "scheduled") return "info";
  return "neutral";
}

export function initials(name: unknown): string {
  return (
    String(name || "T")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => (part[0] || "").toUpperCase())
      .join("") || "T"
  );
}

export const participantKindText = (kind?: string | null): string => (kind === "player" ? "Spelare" : "Lag");

export function resourceKindText(kind?: string | null): string {
  if (kind === "server") return "Server";
  if (kind === "table") return "Bord";
  return "Spelplan";
}
