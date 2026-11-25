import { describe, expect, it } from "vitest";
import { galleryQueryString } from "../../src/client/gallery-query.js";

describe("T-14 client: gallery filters to query string", () => {
  it("RN-205: no filters at all means any pet: an empty query", () => {
    expect(galleryQueryString({})).toBe("");
  });

  it("RN-189: sends only the chosen filters, empty values left out", () => {
    expect(galleryQueryString({ speciesId: "2", breedId: "", size: "SMALL", sex: "", provinceId: "46", minAgeMonths: "", maxAgeMonths: "24" })).toBe(
      "?speciesId=2&size=SMALL&provinceId=46&maxAgeMonths=24",
    );
  });

  it("RN-205: a minimum age of 0 months is a real filter value", () => {
    expect(galleryQueryString({ minAgeMonths: "0" })).toBe("?minAgeMonths=0");
  });
});
