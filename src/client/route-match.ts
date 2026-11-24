// Pure route matching, with no DOM, so it can be unit-tested in Node.

/** Parameters captured from the path, like { id: "7" } for /mascotas/:id. */
export type RouteParams = Record<string, string>;

const segments = (path: string): string[] => path.split("/").filter((segment) => segment !== "");

/** Whether `path` matches `pattern` (with `:name` parameters). Returns the parameters, or null. */
export function matchPath(pattern: string, path: string): RouteParams | null {
  const expected = segments(pattern);
  const actual = segments(path);
  if (expected.length !== actual.length) return null;

  const params: RouteParams = {};
  for (const [i, part] of expected.entries()) {
    const value = actual[i] ?? "";
    if (part.startsWith(":")) params[part.slice(1)] = decodeURIComponent(value);
    else if (part !== value) return null;
  }
  return params;
}
