/** Epoch milliseconds to a timestamptz parameter. */
export const toTs = (ms: number): string => new Date(ms).toISOString();
export const toTsOrNull = (ms: number | null): string | null => (ms === null ? null : toTs(ms));

/** A timestamptz column back to epoch milliseconds. */
export const fromTs = (value: unknown): number => new Date(value as string | Date).getTime();
export const fromTsOrNull = (value: unknown): number | null => (value == null ? null : fromTs(value));
