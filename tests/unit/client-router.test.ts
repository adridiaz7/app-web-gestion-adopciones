import { describe, expect, it } from "vitest";
import { matchPath } from "../../src/client/route-match.js";

describe("T-09 client router: matchPath", () => {
  it("T-09: matches a static path exactly", () => {
    expect(matchPath("/iniciar-sesion", "/iniciar-sesion")).toEqual({});
    expect(matchPath("/iniciar-sesion", "/registro")).toBeNull();
  });

  it("T-09: ignores a trailing slash", () => {
    expect(matchPath("/registro/adoptante", "/registro/adoptante/")).toEqual({});
    expect(matchPath("/", "/")).toEqual({});
  });

  it("T-09: captures named parameters, decoded", () => {
    expect(matchPath("/mascotas/:id", "/mascotas/7")).toEqual({ id: "7" });
    expect(matchPath("/protectoras/:name", "/protectoras/Gatos%20Txiki")).toEqual({ name: "Gatos Txiki" });
  });

  it("T-09: needs the same number of segments", () => {
    expect(matchPath("/mascotas/:id", "/mascotas")).toBeNull();
    expect(matchPath("/mascotas/:id", "/mascotas/7/fotos")).toBeNull();
  });
});
