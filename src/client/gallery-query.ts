// Pure helper for the gallery filters, with no DOM, so it can be unit-tested in Node.

/** The order of the filters in the address. RN-189, RN-205 (ages in months). */
const FILTERS = ["speciesId", "breedId", "size", "sex", "provinceId", "minAgeMonths", "maxAgeMonths"] as const;

export type GalleryFilterValues = Partial<Record<(typeof FILTERS)[number], string>>;

/** The query string for GET /api/pets: only the filters with a value ("" = any). */
export function galleryQueryString(values: GalleryFilterValues): string {
  const params = new URLSearchParams();
  for (const name of FILTERS) {
    const value = values[name];
    if (value) params.set(name, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
