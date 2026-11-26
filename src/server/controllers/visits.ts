import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type {
  AdopterVisitsResponse,
  AvailableSlotsResponse,
  ShelterInboxResponse,
  VisitRequestResponse,
  VisitStatusResponse,
} from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import {
  cancelVisitByAdopter,
  cancelVisitByShelter,
  confirmVisit,
  getShelterInbox,
  listAdopterVisits,
  listAvailableSlots,
  rejectVisit,
  requestVisit,
  replaceVoidedVisit,
  listReplacementSlots,
  rescheduleVisit,
  type InboxVisit,
  type VisitStatusResult,
} from "../services/visits.js";
import { registerNoShow } from "../services/visit-attendance.js";

const id = (message: string) =>
  z.coerce.number({ error: message }).int({ error: message }).positive({ error: message }).max(Number.MAX_SAFE_INTEGER, { error: message });
const strictId = (message: string) =>
  z.number({ error: message }).int({ error: message }).positive({ error: message }).max(Number.MAX_SAFE_INTEGER, { error: message });

const INVALID_PET = "La mascota no es válida.";
const INVALID_SLOT = "El turno no es válido.";

const petParamsSchema = z.object({ id: id(INVALID_PET) });
const visitRequestSchema = z.object({ petId: strictId(INVALID_PET), slotId: strictId(INVALID_SLOT) });

/** The signed-in user (the role is checked by the router). */
function userId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/** RN-194 · GET /api/adopter/pets/:id/slots */
export const getAvailableSlots: RequestHandler = async (req, res) => {
  const { id: petId } = petParamsSchema.parse(req.params);
  const slots = await listAvailableSlots(userId(req.user), petId);
  const body: AvailableSlotsResponse = {
    slots: slots.map((slot) => ({ ...slot, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() })),
  };
  res.json(body);
};

/** CU-23 · POST /api/adopter/visits */
export const postVisit: RequestHandler = async (req, res) => {
  const { petId, slotId } = visitRequestSchema.parse(req.body ?? {});
  const visit = await requestVisit(userId(req.user), petId, slotId);
  const body: VisitRequestResponse = { visit: { ...visit, startsAt: visit.startsAt.toISOString(), endsAt: visit.endsAt.toISOString() } };
  res.status(201).json(body);
};

const INVALID_VISIT = "La visita no es válida.";
const visitParamsSchema = z.object({ id: id(INVALID_VISIT) });
/** RN-96: optional reason; blank means none. */
const rejectSchema = z.object({
  reason: z
    .string({ error: "El motivo no es válido." })
    .trim()
    .max(1000, { error: "El motivo no puede tener más de 1000 caracteres." })
    .optional()
    .transform((reason) => (reason ? reason : null)),
});

const statusBody = (result: VisitStatusResult): VisitStatusResponse => ({ visit: result });

/** CU-24 · POST /api/shelter/visits/:id/confirm */
export const postConfirmVisit: RequestHandler = async (req, res) => {
  const { id: visitId } = visitParamsSchema.parse(req.params);
  res.json(statusBody(await confirmVisit(userId(req.user), visitId)));
};

/** CU-24 · POST /api/shelter/visits/:id/reject */
export const postRejectVisit: RequestHandler = async (req, res) => {
  const { id: visitId } = visitParamsSchema.parse(req.params);
  const { reason } = rejectSchema.parse(req.body ?? {});
  res.json(statusBody(await rejectVisit(userId(req.user), visitId, reason)));
};

/** CU-25 · POST /api/shelter/visits/:id/cancel */
export const postShelterCancelVisit: RequestHandler = async (req, res) => {
  const { id: visitId } = visitParamsSchema.parse(req.params);
  res.json(statusBody(await cancelVisitByShelter(userId(req.user), visitId)));
};

/** CU-25 · POST /api/adopter/visits/:id/cancel */
export const postAdopterCancelVisit: RequestHandler = async (req, res) => {
  const { id: visitId } = visitParamsSchema.parse(req.params);
  res.json(statusBody(await cancelVisitByAdopter(userId(req.user), visitId)));
};

const rescheduleSchema = z.object({ slotId: strictId(INVALID_SLOT) });

/** CU-51 · POST /api/adopter/visits/:id/reschedule */
export const postRescheduleVisit: RequestHandler = async (req, res) => {
  const { id: visitId } = visitParamsSchema.parse(req.params);
  const { slotId } = rescheduleSchema.parse(req.body ?? {});
  const visit = await rescheduleVisit(userId(req.user), visitId, slotId);
  const body: VisitRequestResponse = { visit: { ...visit, startsAt: visit.startsAt.toISOString(), endsAt: visit.endsAt.toISOString() } };
  res.status(201).json(body);
};

/** CU-23, RN-111 · GET /api/adopter/visits/:id/replacement-slots */
export const getReplacementSlots: RequestHandler = async (req, res) => {
  const { id: visitId } = visitParamsSchema.parse(req.params);
  const slots = await listReplacementSlots(userId(req.user), visitId);
  const body: AvailableSlotsResponse = {
    slots: slots.map((slot) => ({ ...slot, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() })),
  };
  res.json(body);
};

/** CU-23, RN-111 · POST /api/adopter/visits/:id/replace */
export const postReplaceVisit: RequestHandler = async (req, res) => {
  const { id: visitId } = visitParamsSchema.parse(req.params);
  const { slotId } = rescheduleSchema.parse(req.body ?? {});
  const visit = await replaceVoidedVisit(userId(req.user), visitId, slotId);
  const body: VisitRequestResponse = { visit: { ...visit, startsAt: visit.startsAt.toISOString(), endsAt: visit.endsAt.toISOString() } };
  res.status(201).json(body);
};

/** CU-21 · GET /api/adopter/visits */
export const getAdopterVisits: RequestHandler = async (req, res) => {
  const { visits, quotas } = await listAdopterVisits(userId(req.user));
  const body: AdopterVisitsResponse = {
    visits: visits.map((visit) => ({ ...visit, startsAt: visit.startsAt.toISOString(), endsAt: visit.endsAt.toISOString() })),
    quotas: quotas.map((quota) => ({ ...quota, nextPlaceAt: quota.nextPlaceAt?.toISOString() ?? null })),
  };
  res.json(body);
};

const inboxVisit = (visit: InboxVisit): ShelterInboxResponse["pending"][number] => ({
  ...visit,
  startsAt: visit.startsAt.toISOString(),
  endsAt: visit.endsAt.toISOString(),
  respondBy: visit.respondBy?.toISOString() ?? null,
});

/** CU-22 · GET /api/shelter/inbox */
export const getInbox: RequestHandler = async (req, res) => {
  const { pending, upcoming } = await getShelterInbox(userId(req.user));
  const body: ShelterInboxResponse = { pending: pending.map(inboxVisit), upcoming: upcoming.map(inboxVisit) };
  res.json(body);
};

/** CU-26 · POST /api/shelter/visits/:id/no-show */
export const postNoShow: RequestHandler = async (req, res) => {
  const { id: visitId } = visitParamsSchema.parse(req.params);
  res.json(statusBody(await registerNoShow(userId(req.user), visitId)));
};
