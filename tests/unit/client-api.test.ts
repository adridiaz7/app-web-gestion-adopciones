import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "../../src/client/api/client.js";

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("T-09 client API: apiRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("T-09: sends JSON to /api with the session cookie and returns the JSON answer", async () => {
    const fetchMock = stubFetch(json(200, { user: { id: 1 } }));

    const result = await apiRequest("POST", "/auth/login", { email: "a@b.test" });

    expect(result).toEqual({ user: { id: 1 } });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: "a@b.test" }),
      credentials: "same-origin",
    });
  });

  it("T-09: sends no body on a GET", async () => {
    const fetchMock = stubFetch(json(200, {}));

    await apiRequest("GET", "/auth/me");

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
  });

  it("T-09: an answer without content resolves to undefined", async () => {
    stubFetch(new Response(null, { status: 204 }));

    expect(await apiRequest("POST", "/auth/logout")).toBeUndefined();
  });

  it("T-09: an error answer throws an ApiError with its status, message and fields", async () => {
    stubFetch(json(400, { error: "Los datos enviados no son válidos.", fields: { email: "Obligatorio." } }));

    const error = await apiRequest("POST", "/auth/login", {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      message: "Los datos enviados no son válidos.",
      fields: { email: "Obligatorio." },
    });
  });

  it("T-09: an error answer that is not JSON gets a generic message in Spanish", async () => {
    stubFetch(new Response("<html>", { status: 502 }));

    await expect(apiRequest("GET", "/auth/me")).rejects.toMatchObject({
      status: 502,
      message: "Ha ocurrido un error inesperado. Inténtalo de nuevo más tarde.",
      fields: {},
    });
  });

  it("T-09: a network failure throws an ApiError with status 0 and a message in Spanish", async () => {
    stubFetch(new TypeError("Failed to fetch"));

    await expect(apiRequest("GET", "/auth/me")).rejects.toMatchObject({
      status: 0,
      message: "No se ha podido conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.",
    });
  });
});
