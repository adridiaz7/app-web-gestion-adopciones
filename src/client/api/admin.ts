import type { AdminShelterResponse, AdminSheltersResponse, ValidationStatus } from "../../shared/api.js";
import { apiRequest } from "./client.js";

export const listShelters = (status: ValidationStatus) =>
  apiRequest<AdminSheltersResponse>("GET", `/admin/shelters?status=${status}`);

export const validateShelter = (id: number) =>
  apiRequest<AdminShelterResponse>("POST", `/admin/shelters/${String(id)}/validate`);

export const rejectShelter = (id: number, reason: string) =>
  apiRequest<AdminShelterResponse>("POST", `/admin/shelters/${String(id)}/reject`, { reason });

export const revokeShelter = (id: number, reason: string) =>
  apiRequest<AdminShelterResponse>("POST", `/admin/shelters/${String(id)}/revoke`, { reason });
