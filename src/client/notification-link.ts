import type { NotificationLink } from "../shared/api.js";

type Role = "ADOPTER" | "SHELTER" | "ADMIN";

/**
 * CU-34, RN-142: the screen a notification opens for that role, or null if it opens nothing
 * (no link, or a screen that does not exist yet, such as adoptions).
 */
export function notificationHref(link: NotificationLink | null, role: Role): string | null {
  if (!link) return null;
  if ("visitId" in link) {
    if (role === "ADOPTER") return "/visitas";
    if (role === "SHELTER") return "/protectora/solicitudes";
    return null;
  }
  if ("petId" in link) {
    if (role === "ADOPTER") return `/mascotas/${String(link.petId)}`;
    if (role === "SHELTER") return `/protectora/mascotas/${String(link.petId)}`;
  }
  return null;
}
