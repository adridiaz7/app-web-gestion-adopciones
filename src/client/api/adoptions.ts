import type {
  AdoptionRequest,
  AdoptionRequestResponse,
  AdoptionStatusResponse,
  CandidatesResponse,
  HouseholdResponse,
  RejectAdoptionRequest,
} from "../../shared/api.js";
import { apiRequest } from "./client.js";

/** RN-207: the household data of the profile, to prefill the form. */
export const getHousehold = () => apiRequest<HouseholdResponse>("GET", "/adopter/household");

/** CU-27 */
export const requestAdoption = (body: AdoptionRequest) => apiRequest<AdoptionRequestResponse>("POST", "/adopter/adoptions", body);

/** CU-28 */
export const listCandidates = (petId: number) => apiRequest<CandidatesResponse>("GET", `/shelter/pets/${String(petId)}/candidates`);

/** CU-29, RN-124 */
export const approveAdoption = (id: number) => apiRequest<AdoptionStatusResponse>("POST", `/shelter/adoptions/${String(id)}/approve`);

/** CU-29, RN-123: the reason is required. */
export const rejectAdoption = (id: number, body: RejectAdoptionRequest) =>
  apiRequest<AdoptionStatusResponse>("POST", `/shelter/adoptions/${String(id)}/reject`, body);
