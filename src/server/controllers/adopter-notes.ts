import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { AdopterNoteResponse, AdopterNotesResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { addAdopterNote, editAdopterNote, listAdopterNotes, removeAdopterNote, type AdopterNote } from "../services/adopter-notes.js";

const id = (message: string) => z.coerce.number({ error: message }).int({ error: message }).positive({ error: message }).max(Number.MAX_SAFE_INTEGER, { error: message });

const adopterParams = z.object({ id: id("El adoptante no es válido.") });
const noteParams = adopterParams.extend({ noteId: id("La nota no es válida.") });

const EMPTY = "Escribe la nota.";
/** CU-52: a note cannot be empty. */
const noteSchema = z.object({
  body: z.string({ error: EMPTY }).trim().min(1, { error: EMPTY }).max(5000, { error: "No puede tener más de 5000 caracteres." }),
});

function shelterId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

const toJson = (note: AdopterNote): AdopterNoteResponse["note"] => ({ ...note, createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString() });

/** CU-52 · GET /api/shelter/adopters/:id/notes */
export const getNotes: RequestHandler = async (req, res) => {
  const { id: adopterId } = adopterParams.parse(req.params);
  const body: AdopterNotesResponse = { notes: (await listAdopterNotes(shelterId(req.user), adopterId)).map(toJson) };
  res.json(body);
};

/** CU-52 · POST /api/shelter/adopters/:id/notes */
export const postNote: RequestHandler = async (req, res) => {
  const { id: adopterId } = adopterParams.parse(req.params);
  const { body: text } = noteSchema.parse(req.body ?? {});
  const body: AdopterNoteResponse = { note: toJson(await addAdopterNote(shelterId(req.user), adopterId, text)) };
  res.status(201).json(body);
};

/** CU-52 · PUT /api/shelter/adopters/:id/notes/:noteId */
export const putNote: RequestHandler = async (req, res) => {
  const { id: adopterId, noteId } = noteParams.parse(req.params);
  const { body: text } = noteSchema.parse(req.body ?? {});
  const body: AdopterNoteResponse = { note: toJson(await editAdopterNote(shelterId(req.user), adopterId, noteId, text)) };
  res.json(body);
};

/** CU-52 · DELETE /api/shelter/adopters/:id/notes/:noteId */
export const deleteNoteHandler: RequestHandler = async (req, res) => {
  const { id: adopterId, noteId } = noteParams.parse(req.params);
  await removeAdopterNote(shelterId(req.user), adopterId, noteId);
  res.status(204).end();
};
