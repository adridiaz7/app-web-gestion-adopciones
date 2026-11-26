// Pure helper for the notice under a disabled "Solicitar adopción", with no DOM, so it can be unit-tested in Node.
import type { AdoptionIneligibilityReason } from "../shared/api.js";

/** T-52: the link that goes with the reason, if any (RN-119: the open request is in "Mis visitas"). */
export function adoptionNoticeLink(reason: AdoptionIneligibilityReason): { href: string; label: string } | null {
  return reason === "OPEN_REQUEST" ? { href: "/visitas", label: "Ver mi solicitud" } : null;
}
