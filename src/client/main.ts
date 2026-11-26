import { startRouter, type Route } from "./router.js";
import { renderAccountType } from "./views/account-type.js";
import { renderAdminShelters } from "./views/admin-shelters.js";
import { renderCheckEmail } from "./views/check-email.js";
import { renderGallery } from "./views/gallery.js";
import { renderHome, renderNotFound, renderRoot } from "./views/home.js";
import { renderLogin } from "./views/login.js";
import { renderForgotPassword, renderResetPassword } from "./views/password-recovery.js";
import { renderRegisterAdopter, renderRegisterShelter } from "./views/register.js";
import { renderPetProfile } from "./views/pet-profile.js";
import { renderProfile } from "./views/profile.js";
import { renderPreferences } from "./views/preferences.js";
import { renderDiscover } from "./views/discover.js";
import { renderFavorites } from "./views/favorites.js";
import { renderShelterProfile, renderShelterSearch } from "./views/shelters.js";
import { renderMyPets, renderPetForm } from "./views/shelter-pets.js";
import { renderShelterAdopter } from "./views/shelter-adopter.js";
import { renderShelterInbox } from "./views/shelter-inbox.js";
import { renderShelterSlots } from "./views/shelter-slots.js";
import { renderVisits } from "./views/visits.js";
import { renderNotifications } from "./views/notifications.js";
import { renderMessages } from "./views/messages.js";
import { renderAdoptionRequest } from "./views/adoption-request.js";
import { renderShelterCandidates } from "./views/shelter-candidates.js";
import { renderVerifyEmail } from "./views/verify-email.js";

const routes: Route[] = [
  { path: "/", render: renderRoot },
  { path: "/iniciar-sesion", render: renderLogin },
  { path: "/registro", render: renderAccountType },
  { path: "/registro/adoptante", render: renderRegisterAdopter },
  { path: "/registro/protectora", render: renderRegisterShelter },
  { path: "/revisa-tu-email", render: renderCheckEmail },
  { path: "/verificar-email", render: renderVerifyEmail },
  { path: "/recuperar-contrasena", render: renderForgotPassword },
  { path: "/restablecer-contrasena", render: renderResetPassword },
  { path: "/inicio", render: renderHome },
  { path: "/descubrir", render: renderDiscover },
  { path: "/mascotas", render: renderGallery },
  { path: "/mascotas/:id", render: renderPetProfile },
  { path: "/mascotas/:id/adoptar", render: renderAdoptionRequest },
  { path: "/protectoras", render: renderShelterSearch },
  { path: "/protectoras/:id", render: renderShelterProfile },
  { path: "/perfil", render: renderProfile },
  { path: "/perfil/preferencias", render: renderPreferences },
  { path: "/favoritos", render: renderFavorites },
  { path: "/admin/protectoras", render: renderAdminShelters },
  { path: "/protectora/mascotas", render: renderMyPets },
  { path: "/protectora/mascotas/nueva", render: renderPetForm },
  { path: "/protectora/mascotas/:id", render: renderPetForm },
  { path: "/protectora/mascotas/:id/candidatos", render: renderShelterCandidates },
  { path: "/protectora/turnos", render: renderShelterSlots },
  { path: "/protectora/solicitudes", render: renderShelterInbox },
  { path: "/protectora/adoptantes/:id", render: renderShelterAdopter },
  { path: "/visitas", render: renderVisits },
  { path: "/notificaciones", render: renderNotifications },
  { path: "/mensajes", render: renderMessages },
];

const root = document.getElementById("app");
if (root) startRouter(root, routes, renderNotFound);
