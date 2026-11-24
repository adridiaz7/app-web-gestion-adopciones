import { verifyEmail } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { authPage } from "../components/auth-layout.js";
import { notice } from "../components/notice.js";
import { h, mount, queryParam } from "../dom.js";

function page(content: Node[]): HTMLElement {
  return authPage({ overline: "Verificar email", title: "Verificación de tu email", icon: "✉", content });
}

/** CU-03 · /verificar-email?token=… (the link of the email). */
export async function renderVerifyEmail(root: HTMLElement): Promise<void> {
  mount(root, page([h("p", { class: "auth-card__subtitle" }, "Comprobando el enlace…")]));

  const loginLink = h("a", { class: "button button--primary button--block", href: "/iniciar-sesion" }, "Ir a iniciar sesión");
  try {
    const { message } = await verifyEmail({ token: queryParam("token") });
    mount(root, page([notice("success", "Email verificado", message), loginLink]));
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Ha ocurrido un error inesperado.";
    // 409: the email was already verified, so logging in is the way forward.
    if (error instanceof ApiError && error.status === 409) {
      mount(root, page([notice("info", message), loginLink]));
      return;
    }
    mount(
      root,
      page([
        notice("error", "No hemos podido verificar tu email", message),
        h("a", { class: "button button--secondary button--block", href: "/revisa-tu-email" }, "Pedir un enlace nuevo"),
      ]),
    );
  }
}
