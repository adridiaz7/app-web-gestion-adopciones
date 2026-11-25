import type { Preferences, PreferencesResponse } from "../../shared/api.js";
import { apiRequest } from "./client.js";

/** CU-08: null preferences = never filled in. */
export const getPreferences = () => apiRequest<PreferencesResponse>("GET", "/adopter/preferences");

export const savePreferences = (body: Preferences) => apiRequest<PreferencesResponse>("PUT", "/adopter/preferences", body);
