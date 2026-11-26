import type {
  AdopterAdoptionsResponse,
  AdoptionRequest,
  AdoptionRequestResponse,
  AdoptionStatusResponse,
  CandidatesResponse,
  HouseholdResponse,
  RejectAdoptionRequest,
  ShelterAdoptionsResponse,
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

/** CU-21: the adopter's adoptions. */
export const listMyAdoptions = () => apiRequest<AdopterAdoptionsResponse>("GET", "/adopter/adoptions");

/** CU-22: the shelter's approved adoptions pending delivery and the completed ones. */
export const listShelterAdoptions = () => apiRequest<ShelterAdoptionsResponse>("GET", "/shelter/adoptions");

/** CU-30, RN-129: the reason is required. */
export const cancelMyAdoption = (id: number, body: RejectAdoptionRequest) =>
  apiRequest<AdoptionStatusResponse>("POST", `/adopter/adoptions/${String(id)}/cancel`, body);

/** CU-30, RN-129, RN-130: the shelter backs out of an approved adoption. */
export const cancelShelterAdoption = (id: number, body: RejectAdoptionRequest) =>
  apiRequest<AdoptionStatusResponse>("POST", `/shelter/adoptions/${String(id)}/cancel`, body);

/** CU-31, RN-126 */
export const deliverAdoption = (id: number) => apiRequest<AdoptionStatusResponse>("POST", `/shelter/adoptions/${String(id)}/deliver`);

/** CU-32, RN-131: the reason is required. */
export const returnAdoption = (id: number, body: RejectAdoptionRequest) =>
  apiRequest<AdoptionStatusResponse>("POST", `/shelter/adoptions/${String(id)}/return`, body);
