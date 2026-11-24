import { login } from "../api/auth.js";
import { authPage } from "../components/auth-layout.js";
import { field, onSubmit, submitButton, textValue } from "../components/form.js";
import { h, mount } from "../dom.js";
import { navigate } from "../router.js";

/** CU-04 · /iniciar-sesion */
export function renderLogin(root: HTMLElement): void {
  const form = h(
    "form",
    { class: "form" },
    field({ name: "email", label: "Email", type: "email", autocomplete: "email" }),
    field({
      name: "password",
      label: "Contraseña",
      type: "password",
      autocomplete: "current-password",
      aside: h("a", { class: "link link--small", href: "/recuperar-contrasena" }, "¿Has olvidado tu contraseña?"),
    }),
    submitButton("Iniciar sesión →"),
  );

  onSubmit(form, async () => {
    await login({ email: textValue(form, "email"), password: textValue(form, "password") });
    navigate("/inicio", { replace: true });
  });

  mount(
    root,
    authPage({
      overline: "Iniciar sesión",
      title: "Te damos la bienvenida",
      subtitle: "Entra para seguir buscando a tu compañero.",
      back: { href: "/", label: "Volver a la web" },
      content: [
        form,
        h("p", { class: "auth-card__alt" }, "¿Aún no tienes cuenta? ", h("a", { class: "link", href: "/registro" }, "Crear cuenta")),
      ],
    }),
  );
}
