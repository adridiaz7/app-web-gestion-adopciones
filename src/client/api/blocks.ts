import type { AdopterBlockRequest, AdopterBlockResponse } from "../../shared/api.js";
import { apiRequest } from "./client.js";

const blockPath = (adopterId: number) => `/shelter/adopters/${String(adopterId)}/block`;

/** CU-35 · the shelter's active block of the adopter, or null. */
export const getAdopterBlock = (adopterId: number) => apiRequest<AdopterBlockResponse>("GET", blockPath(adopterId));

export const blockAdopter = (adopterId: number, body: AdopterBlockRequest) => apiRequest<AdopterBlockResponse>("POST", blockPath(adopterId), body);

export const unblockAdopter = (adopterId: number) => apiRequest<AdopterBlockResponse>("POST", `/shelter/adopters/${String(adopterId)}/unblock`);
