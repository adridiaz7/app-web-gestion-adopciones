import type { ShelterPageResponse, SheltersResponse } from "../../shared/api.js";
import { apiRequest } from "./client.js";

/** CU-13: `name` and `provinceId` are optional ("" = any). */
export function searchShelters(name: string, provinceId: string): Promise<SheltersResponse> {
  const params = new URLSearchParams();
  if (name) params.set("name", name);
  if (provinceId) params.set("provinceId", provinceId);
  const query = params.toString();
  return apiRequest<SheltersResponse>("GET", `/shelters${query ? `?${query}` : ""}`);
}

export const getShelterPage = (id: number) => apiRequest<ShelterPageResponse>("GET", `/shelters/${String(id)}`);
