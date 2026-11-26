import type { SessionUser } from "../api/auth.js";
import type { NavItem } from "./app-layout.js";

/** Sections of the sidebar for each role. Each task adds the sections of its screens. */
export function navFor(role: SessionUser["role"]): NavItem[] {
  const home: NavItem = { href: "/inicio", label: "Inicio" };
  switch (role) {
    case "ADMIN":
      return [home, { href: "/admin/protectoras", label: "Protectoras" }, { href: "/admin/incidencias", label: "Incidencias" }];
    case "SHELTER":
      return [home, { href: "/protectora/mascotas", label: "Mis mascotas" }, { href: "/protectora/solicitudes", label: "Solicitudes" }, { href: "/protectora/turnos", label: "Turnos" }, { href: "/mensajes", label: "Mensajes" }];
    case "ADOPTER":
      return [
        home,
        { href: "/descubrir", label: "Explorar" },
        { href: "/favoritos", label: "Favoritos" },
        { href: "/mensajes", label: "Mensajes" },
        { href: "/visitas", label: "Visitas" },
        { href: "/perfil/preferencias", label: "Preferencias" },
      ];
  }
}
