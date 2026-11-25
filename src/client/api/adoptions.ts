import type { AdoptionRequest, AdoptionRequestResponse, HouseholdResponse } from "../../shared/api.js";
import { apiRequest } from "./client.js";

/** RN-207: the household data of the profile, to prefill the form. */
export const getHousehold = () => apiRequest<HouseholdResponse>("GET", "/adopter/household");

/** CU-27 */
export const requestAdoption = (body: AdoptionRequest) => apiRequest<AdoptionRequestResponse>("POST", "/adopter/adoptions", body);
