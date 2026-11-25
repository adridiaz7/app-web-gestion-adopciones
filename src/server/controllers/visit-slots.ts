import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { RecurringSlotsResponse, ShelterSlot, SlotResponse, SlotsResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { createRecurringSlots, createSlot, deleteSlot, listSlots, updateSlot, type VisitSlot } from "../services/visit-slots.js";

const INVALID_DATE = "La fecha no es válida.";
const INVALID_CAPACITY = "Indica un número entero de plazas, como mínimo 1.";

/** RN-78: date and times as ISO instants (the screen sends them from Madrid time), and places. */
const slotSchema = z.object({
  startsAt: z.iso.datetime({ offset: true, error: INVALID_DATE }).transform((value) => new Date(value)),
  endsAt: z.iso.datetime({ offset: true, error: INVALID_DATE }).transform((value) => new Date(value)),
  capacity: z.number({ error: INVALID_CAPACITY }).int({ error: INVALID_CAPACITY }).min(1, { error: INVALID_CAPACITY }).max(1000, { error: "No puede tener más de 1000 plazas." }),
});

function shelterId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

function toResponse(slot: VisitSlot): ShelterSlot {
  return { ...slot, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() };
}

/** CU-18 · GET /api/shelter/slots */
export const getSlots: RequestHandler = async (req, res) => {
  const body: SlotsResponse = { slots: (await listSlots(shelterId(req.user))).map(toResponse) };
  res.json(body);
};

/** CU-19 · POST /api/shelter/slots */
export const postSlot: RequestHandler = async (req, res) => {
  const data = slotSchema.parse(req.body ?? {});
  const body: SlotResponse = { slot: toResponse(await createSlot(shelterId(req.user), data)) };
  res.status(201).json(body);
};

const INVALID_SLOT = "El turno no es válido.";
const idParamsSchema = z.object({
  id: z.coerce
    .number({ error: INVALID_SLOT })
    .int({ error: INVALID_SLOT })
    .positive({ error: INVALID_SLOT })
    .max(Number.MAX_SAFE_INTEGER, { error: INVALID_SLOT }),
});

/** CU-20 · PUT /api/shelter/slots/:id */
export const putSlot: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const data = slotSchema.parse(req.body ?? {});
  const body: SlotResponse = { slot: toResponse(await updateSlot(shelterId(req.user), id, data)) };
  res.json(body);
};

/** CU-20 · DELETE /api/shelter/slots/:id */
export const deleteSlotHandler: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  await deleteSlot(shelterId(req.user), id);
  res.status(204).end();
};

const INVALID_DAY = "La fecha no es válida.";
const INVALID_TIME = "Indica la hora en formato HH:MM.";
const INVALID_WEEKDAY = "El día de la semana no es válido.";

/** CU-50 · Madrid dates and times, ISO weekdays (1 = Monday … 7 = Sunday) and places. */
const recurringSchema = z.object({
  startDate: z.iso.date({ error: INVALID_DAY }),
  endDate: z.iso.date({ error: INVALID_DAY }),
  weekdays: z
    .array(z.number({ error: INVALID_WEEKDAY }).int({ error: INVALID_WEEKDAY }).min(1, { error: INVALID_WEEKDAY }).max(7, { error: INVALID_WEEKDAY }), {
      error: "Elige al menos un día de la semana.",
    })
    .min(1, { error: "Elige al menos un día de la semana." })
    .refine((days) => new Set(days).size === days.length, { error: "No repitas los días de la semana." }),
  startTime: z.string({ error: INVALID_TIME }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: INVALID_TIME }),
  endTime: z.string({ error: INVALID_TIME }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: INVALID_TIME }),
  capacity: slotSchema.shape.capacity,
});

/** CU-50 · POST /api/shelter/slots/recurring */
export const postRecurringSlots: RequestHandler = async (req, res) => {
  const data = recurringSchema.parse(req.body ?? {});
  const result = await createRecurringSlots(shelterId(req.user), data);
  const body: RecurringSlotsResponse = {
    slots: result.slots.map(toResponse),
    skipped: result.skipped.map((slot) => ({ startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() })),
  };
  res.status(201).json(body);
};
