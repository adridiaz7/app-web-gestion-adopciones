import { startRouter, type Route } from "./router.js";
import { renderAccountType } from "./views/account-type.js";
import { renderAdminShelters } from "./views/admin-shelters.js";
import { renderCheckEmail } from "./views/check-email.js";
import { renderHome, renderNotFound, renderRoot } from "./views/home.js";
import { renderLogin } from "./views/login.js";
import { renderForgotPassword, renderResetPassword } from "./views/password-recovery.js";
import { renderRegisterAdopter, renderRegisterShelter } from "./views/register.js";
import { renderMyPets, renderPetForm } from "./views/shelter-pets.js";
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
  { path: "/admin/protectoras", render: renderAdminShelters },
  { path: "/protectora/mascotas", render: renderMyPets },
  { path: "/protectora/mascotas/nueva", render: renderPetForm },
  { path: "/protectora/mascotas/:id", render: renderPetForm },
];

const root = document.getElementById("app");
if (root) startRouter(root, routes, renderNotFound);
