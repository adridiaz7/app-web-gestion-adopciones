import type { AdopterProfileResponse, AdopterProfileUpdate, ShelterProfileResponse, ShelterProfileUpdate } from "../../shared/api.js";
import { apiRequest } from "./client.js";

/** CU-06 · the adopter's own profile. */
export const getAdopterProfile = () => apiRequest<AdopterProfileResponse>("GET", "/adopter/profile");

export const saveAdopterProfile = (body: AdopterProfileUpdate) => apiRequest<AdopterProfileResponse>("PUT", "/adopter/profile", body);

/** CU-06 · the shelter's own profile. */
export const getShelterProfile = () => apiRequest<ShelterProfileResponse>("GET", "/shelter/profile");

export const saveShelterProfile = (body: ShelterProfileUpdate) => apiRequest<ShelterProfileResponse>("PUT", "/shelter/profile", body);

export function uploadShelterLogo(file: File): Promise<ShelterProfileResponse> {
  const form = new FormData();
  form.append("logo", file);
  return apiRequest<ShelterProfileResponse>("POST", "/shelter/profile/logo", form);
}

export const deleteShelterLogo = () => apiRequest<ShelterProfileResponse>("DELETE", "/shelter/profile/logo");
