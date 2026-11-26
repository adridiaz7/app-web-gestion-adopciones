import type {
  AdminShelterResponse,
  AdminSheltersResponse,
  AdminUsersResponse,
  SuspendUserRequest,
  SuspensionResponse,
  ValidationStatus,
} from "../../shared/api.js";
import { apiRequest } from "./client.js";

export const listShelters = (status: ValidationStatus) =>
  apiRequest<AdminSheltersResponse>("GET", `/admin/shelters?status=${status}`);

export const validateShelter = (id: number) =>
  apiRequest<AdminShelterResponse>("POST", `/admin/shelters/${String(id)}/validate`);

export const rejectShelter = (id: number, reason: string) =>
  apiRequest<AdminShelterResponse>("POST", `/admin/shelters/${String(id)}/reject`, { reason });

export const revokeShelter = (id: number, reason: string) =>
  apiRequest<AdminShelterResponse>("POST", `/admin/shelters/${String(id)}/revoke`, { reason });

/** CU-40: adopters and shelters, by name or email. */
export const listUsers = (query: string) => apiRequest<AdminUsersResponse>("GET", `/admin/users?q=${encodeURIComponent(query)}`);

/** CU-40, RN-155: the reason is required, the detail optional. */
export const suspendUser = (id: number, body: SuspendUserRequest) => apiRequest<SuspensionResponse>("POST", `/admin/users/${String(id)}/suspend`, body);

/** CU-40, RN-156 */
export const reactivateUser = (id: number) => apiRequest<undefined>("POST", `/admin/users/${String(id)}/reactivate`);

/** CU-41, RN-163: only an available pet. */
export const removePet = (id: number) => apiRequest<undefined>("POST", `/admin/pets/${String(id)}/remove`);
