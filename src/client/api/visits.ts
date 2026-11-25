import type {
  AdopterVisitsResponse,
  AvailableSlotsResponse,
  RejectVisitRequest,
  ShelterInboxResponse,
  VisitRequest,
  VisitRequestResponse,
  VisitStatusResponse,
} from "../../shared/api.js";
import { apiRequest } from "./client.js";

/** RN-194: the slots the adopter can choose for a pet. */
export const getAvailableSlots = (petId: number) => apiRequest<AvailableSlotsResponse>("GET", `/adopter/pets/${String(petId)}/slots`);

/** CU-23 */
export const requestVisit = (body: VisitRequest) => apiRequest<VisitRequestResponse>("POST", "/adopter/visits", body);

/** CU-24 */
export const confirmVisit = (id: number) => apiRequest<VisitStatusResponse>("POST", `/shelter/visits/${String(id)}/confirm`);

/** CU-24, RN-96: the reason is optional. */
export const rejectVisit = (id: number, body: RejectVisitRequest) => apiRequest<VisitStatusResponse>("POST", `/shelter/visits/${String(id)}/reject`, body);

/** CU-25, RN-100: the shelter cancels a confirmed visit. */
export const cancelVisitAsShelter = (id: number) => apiRequest<VisitStatusResponse>("POST", `/shelter/visits/${String(id)}/cancel`);

/** CU-25, RN-97: the adopter cancels with 24 h or more left. */
export const cancelVisit = (id: number) => apiRequest<VisitStatusResponse>("POST", `/adopter/visits/${String(id)}/cancel`);

/** CU-21: the adopter's visits and quotas. */
export const listMyVisits = () => apiRequest<AdopterVisitsResponse>("GET", "/adopter/visits");

/** CU-22: the shelter's inbox. */
export const getInbox = () => apiRequest<ShelterInboxResponse>("GET", "/shelter/inbox");

/** CU-26: the adopter did not come to a confirmed visit. */
export const registerNoShow = (id: number) => apiRequest<VisitStatusResponse>("POST", `/shelter/visits/${String(id)}/no-show`);
