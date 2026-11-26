import type { AdopterNoteResponse, AdopterNotesResponse } from "../../shared/api.js";
import { apiRequest } from "./client.js";

const notesPath = (adopterId: number) => `/shelter/adopters/${String(adopterId)}/notes`;

/** CU-52 · the shelter's internal notes about an adopter. */
export const listNotes = (adopterId: number) => apiRequest<AdopterNotesResponse>("GET", notesPath(adopterId));

export const addNote = (adopterId: number, body: string) => apiRequest<AdopterNoteResponse>("POST", notesPath(adopterId), { body });

export const editNote = (adopterId: number, noteId: number, body: string) =>
  apiRequest<AdopterNoteResponse>("PUT", `${notesPath(adopterId)}/${String(noteId)}`, { body });

export const deleteNote = (adopterId: number, noteId: number) => apiRequest<undefined>("DELETE", `${notesPath(adopterId)}/${String(noteId)}`);
