export type FieldChanges = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

/** RN-208: only the given fields that changed, with their old and new values. */
export function fieldChanges<T extends object>(before: T, after: T, fields: readonly (keyof T & string)[]): FieldChanges {
  const diff: FieldChanges = { before: {}, after: {} };
  for (const field of fields) {
    if (before[field] !== after[field]) {
      diff.before[field] = before[field];
      diff.after[field] = after[field];
    }
  }
  return diff;
}

export const hasChanges = (diff: FieldChanges): boolean => Object.keys(diff.after).length > 0;
