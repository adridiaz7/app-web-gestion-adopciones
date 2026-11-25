import type { SlotRequest, SlotResponse, SlotsResponse } from "../../shared/api.js";
import { apiRequest } from "./client.js";

/** CU-18: the shelter's calendar. */
export const listSlots = () => apiRequest<SlotsResponse>("GET", "/shelter/slots");

/** CU-19 */
export const createSlot = (body: SlotRequest) => apiRequest<SlotResponse>("POST", "/shelter/slots", body);

/** CU-20: a new day or time voids the slot's visits (RN-111). */
export const updateSlot = (id: number, body: SlotRequest) => apiRequest<SlotResponse>("PUT", `/shelter/slots/${String(id)}`, body);

export const deleteSlot = (id: number) => apiRequest<undefined>("DELETE", `/shelter/slots/${String(id)}`);
