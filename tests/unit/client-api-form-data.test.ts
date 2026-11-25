import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../src/client/api/client.js";

describe("T-13 client API: uploading files", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("T-13: sends a FormData body as it is, letting the browser set the multipart content type", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ photos: [] }), { status: 201 })));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.append("photo", new Blob(["x"]), "foto.png");

    const result = await apiRequest("POST", "/shelter/pets/1/photos", form);

    expect(result).toEqual({ photos: [] });
    expect(fetchMock).toHaveBeenCalledWith("/api/shelter/pets/1/photos", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: form,
      credentials: "same-origin",
    });
  });
});
