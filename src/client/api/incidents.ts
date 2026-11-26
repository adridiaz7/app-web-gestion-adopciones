import type { AdminIncident, AdminIncidentsResponse, OpenIncidentRequest, OpenIncidentResponse } from "../../shared/api.js";
import { apiRequest } from "./client.js";

/** CU-36 · an adopter or a shelter reports the other side. */
export const openIncident = (body: OpenIncidentRequest) => apiRequest<OpenIncidentResponse>("POST", "/incidents", body);

/** CU-37 · the administrator's list, by status. */
export const listIncidents = (status: AdminIncident["status"]) => apiRequest<AdminIncidentsResponse>("GET", `/admin/incidents?status=${status}`);

export const changeIncidentStatus = (id: number, body: { status: "IN_REVIEW" } | { status: "RESOLVED" | "DISMISSED"; resolution: string }) =>
  apiRequest<unknown>("POST", `/admin/incidents/${String(id)}/status`, body);

/** CU-38 · the administrator corrects a no-show to completed. */
export const correctAttendance = (visitId: number) => apiRequest<unknown>("POST", `/admin/visits/${String(visitId)}/correct-attendance`);
