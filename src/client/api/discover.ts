import type { DiscoverResponse, UndoDiscardRequest } from "../../shared/api.js";
import { apiRequest } from "./client.js";

/** CU-10: the next pet of discover mode. */
export const getDiscover = () => apiRequest<DiscoverResponse>("GET", "/adopter/discover");

export const favoritePet = (petId: number) => apiRequest<DiscoverResponse>("POST", `/adopter/discover/pets/${String(petId)}/favorite`);

export const discardPet = (petId: number) => apiRequest<DiscoverResponse>("POST", `/adopter/discover/pets/${String(petId)}/discard`);

/** RN-191: undoes the last discard; the pet comes back first. */
export const undoDiscard = (petId: number) =>
  apiRequest<DiscoverResponse>("POST", "/adopter/discover/undo", { petId } satisfies UndoDiscardRequest);
