import type { AvailableSlotsResponse, VisitRequest, VisitRequestResponse } from "../../shared/api.js";
import { apiRequest } from "./client.js";

/** RN-194: the slots the adopter can choose for a pet. */
export const getAvailableSlots = (petId: number) => apiRequest<AvailableSlotsResponse>("GET", `/adopter/pets/${String(petId)}/slots`);

/** CU-23 */
export const requestVisit = (body: VisitRequest) => apiRequest<VisitRequestResponse>("POST", "/adopter/visits", body);
