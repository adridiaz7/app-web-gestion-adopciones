import type { DiscardsResponse, FavoritesResponse } from "../../shared/api.js";
import { apiRequest } from "./client.js";

/** CU-12: the adopter's favourites, most recent first. */
export const listFavorites = () => apiRequest<FavoritesResponse>("GET", "/adopter/favorites");

/** RN-73: the same favourite as in discover mode. */
export const addFavorite = (petId: number) => apiRequest<unknown>("PUT", `/adopter/favorites/${String(petId)}`);

export const removeFavorite = (petId: number) => apiRequest<undefined>("DELETE", `/adopter/favorites/${String(petId)}`);

/** CU-12: discards still in force. */
export const listDiscards = () => apiRequest<DiscardsResponse>("GET", "/adopter/discards");

export const recoverDiscard = (petId: number) => apiRequest<undefined>("DELETE", `/adopter/discards/${String(petId)}`);
