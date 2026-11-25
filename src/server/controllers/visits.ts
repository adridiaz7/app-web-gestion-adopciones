import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { AvailableSlotsResponse, VisitRequestResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { listAvailableSlots, requestVisit } from "../services/visits.js";

const id = (message: string) =>
  z.coerce.number({ error: message }).int({ error: message }).positive({ error: message }).max(Number.MAX_SAFE_INTEGER, { error: message });
const strictId = (message: string) =>
  z.number({ error: message }).int({ error: message }).positive({ error: message }).max(Number.MAX_SAFE_INTEGER, { error: message });

const INVALID_PET = "La mascota no es válida.";
const INVALID_SLOT = "El turno no es válido.";

const petParamsSchema = z.object({ id: id(INVALID_PET) });
const visitRequestSchema = z.object({ petId: strictId(INVALID_PET), slotId: strictId(INVALID_SLOT) });

function adopterId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/** RN-194 · GET /api/adopter/pets/:id/slots */
export const getAvailableSlots: RequestHandler = async (req, res) => {
  const { id: petId } = petParamsSchema.parse(req.params);
  const slots = await listAvailableSlots(adopterId(req.user), petId);
  const body: AvailableSlotsResponse = {
    slots: slots.map((slot) => ({ ...slot, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() })),
  };
  res.json(body);
};

/** CU-23 · POST /api/adopter/visits */
export const postVisit: RequestHandler = async (req, res) => {
  const { petId, slotId } = visitRequestSchema.parse(req.body ?? {});
  const visit = await requestVisit(adopterId(req.user), petId, slotId);
  const body: VisitRequestResponse = { visit: { ...visit, startsAt: visit.startsAt.toISOString(), endsAt: visit.endsAt.toISOString() } };
  res.status(201).json(body);
};
