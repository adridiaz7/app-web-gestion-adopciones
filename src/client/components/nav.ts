import type { SessionUser } from "../api/auth.js";
import type { NavItem } from "./app-layout.js";

/** Sections of the sidebar for each role. Each task adds the sections of its screens. */
export function navFor(role: SessionUser["role"]): NavItem[] {
  const home: NavItem = { href: "/inicio", label: "Inicio" };
  switch (role) {
    case "ADMIN":
      return [home, { href: "/admin/protectoras", label: "Protectoras" }];
    case "SHELTER":
      return [home, { href: "/protectora/mascotas", label: "Mis mascotas" }];
    case "ADOPTER":
      return [home, { href: "/mascotas", label: "Explorar" }];
  }
}
