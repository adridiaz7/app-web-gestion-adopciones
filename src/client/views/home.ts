import { currentUser } from "../api/auth.js";
import { appLayout } from "../components/app-layout.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { navigate } from "../router.js";

/** /inicio: start page of the logged-in area. The sections of each role arrive with their tasks. */
export async function renderHome(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }

  mount(
    root,
    appLayout(user, [{ href: "/inicio", label: "Inicio" }], [
      h("p", { class: "overline" }, "Inicio"),
      h("h1", { class: "display" }, "Hola de nuevo"),
      notice("info", "Has iniciado sesión", `Estás dentro con ${user.email}.`),
    ]),
  );
}

/** Any address the app does not know. */
export function renderNotFound(root: HTMLElement): void {
  mount(
    root,
    h(
      "main",
      { class: "not-found" },
      h("h1", {}, "No encontramos esta página"),
      h("p", {}, "Puede que la dirección esté mal escrita o que la página ya no exista."),
      h("a", { class: "button button--primary", href: "/" }, "Ir al inicio"),
    ),
  );
}

/** /: with a session, the logged-in area; without one, the login (the public gallery arrives in T-14). */
export async function renderRoot(): Promise<void> {
  navigate((await currentUser()) ? "/inicio" : "/iniciar-sesion", { replace: true });
}
