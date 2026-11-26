# Plan de desarrollo — Plataforma de adopción de mascotas (MVP)

> Lista ordenada de tareas que el agente **desarrollador** sigue de forma autónoma y el agente **revisor** valida cada noche. El orden es la prioridad para la demo: de arriba abajo.
>
> **Última actualización:** 26/11/2026

---

## 1. Cómo funciona

| Agente | Cuándo se ejecuta | Qué hace |
|---|---|---|
| **desarrollador** | Cada hora, de **06:00 a 23:00** | Resuelve primero los cambios que haya pedido el revisor y después avanza en las tareas pendientes. Trabaja con TDD, hace commits en la rama **`develop`** y actualiza este plan. |
| **revisor** | Una vez al día, a las **00:00** | Revisa todos los commits nuevos de `develop` desde la revisión anterior. Deja su informe en `docs/revisiones/AAAA-MM-DD.md` con un veredicto por tarea. |

Las ejecuciones las lanza el Programador de tareas de Windows con los scripts de `scripts/agents/` (ver [sección 6](#6-puesta-en-marcha)).

- Las tareas **nunca** se integran en `master` automáticamente: eso lo decide el responsable.
- Las respuestas del responsable a las preguntas de los agentes se escriben en la [sección 4](#4-preguntas-para-el-responsable).

### Estados de una tarea

| Estado | Significado | Quién lo pone |
|---|---|---|
| `PENDIENTE` | Sin empezar. | — |
| `EN_CURSO` | El desarrollador ha empezado y aún no ha terminado. | desarrollador |
| `EN_REVISION` | Terminada por el desarrollador, a la espera del revisor. | desarrollador |
| `CAMBIOS` | El revisor ha pedido cambios. | desarrollador, al leer la revisión |
| `APROBADA` | El revisor la ha aprobado y sus tests están bloqueados. | desarrollador, al leer la revisión |
| `BLOQUEADA` | No se puede avanzar hasta que el responsable decida algo (ver [sección 3](#3-decisiones-pendientes-que-bloquean-tareas)). | desarrollador o responsable |

---

## 2. Reglas del modo autónomo

### Qué hace el desarrollador en cada ejecución, por orden

1. **Leer la última revisión** (`docs/revisiones/`, la de fecha más reciente):
   - Tareas con veredicto **APROBADA**: bloquear sus tests con `node scripts/test-lock.ts lock --feature "<ID> <título>" <archivos de test que indica la revisión>` y marcarlas `APROBADA`.
   - Tareas con veredicto **CAMBIOS SOLICITADOS**: marcarlas `CAMBIOS` y **corregirlas antes que cualquier otra cosa**.
2. **Revisar las respuestas** del responsable en la [sección 4](#4-preguntas-para-el-responsable) y en la [sección 3](#3-decisiones-pendientes-que-bloquean-tareas). Si desbloquean alguna tarea, pasarla a `PENDIENTE`.
3. **Recuperar el trabajo a medias** de la ejecución anterior, si existe (`git stash list` → `wip-desarrollador`).
4. **Continuar** la tarea `EN_CURSO` o, si no hay ninguna, empezar la **primera `PENDIENTE`** de la lista cuyas dependencias estén en `EN_REVISION` o `APROBADA`.
5. Al terminar una tarea, marcarla `EN_REVISION`, hacer su commit y **seguir con la siguiente**, encadenando tareas durante unos **40 minutos** desde el inicio de la ejecución:
   - Terminar una fase no es motivo para parar.
   - Pasados los 40 minutos no se empieza otra tarea.
   - Si una tarea se alarga más de 50 minutos, se guarda lo que haya (commit de lo que esté en verde y stash del resto) y se termina.
   - Si no queda ninguna tarea disponible, se termina antes.

   Así cada ejecución aprovecha su coste fijo (leer la documentación) para hacer varias tareas.

### Commits

- Solo en la rama **`develop`**. Nunca en `master`, nunca `push` (lo hace el script), nunca reescribir el historial.
- Cada commit deja **todo en verde**: tests, linter, compilador y `node scripts/test-lock.ts check`. No se hacen commits con tests en rojo.
- Mensaje: `<tipo>(<ID>): <descripción en castellano>`, por ejemplo `feat(T-04): registro de adoptante con validación de mayoría de edad`. Tipos: `feat`, `fix`, `test`, `refactor`, `chore`, `docs`.
- Los cambios de estado de este plan van en el mismo commit que el trabajo al que se refieren.

### Al terminar cada ejecución

- El árbol de trabajo debe quedar **limpio**:
  - lo que esté en verde, en un commit;
  - el trabajo a medias que aún no está en verde, guardado con `git stash push -u -m wip-desarrollador`, para retomarlo en la siguiente ejecución.
- Si algo impide avanzar (una duda de la documentación, un test bloqueado que parece incorrecto, una decisión que no le corresponde), el desarrollador **no improvisa**:
  - escribe la pregunta en la [sección 4](#4-preguntas-para-el-responsable);
  - marca la tarea como `BLOQUEADA` si no puede seguir;
  - pasa a la siguiente tarea disponible.

### Tests bloqueados

Las reglas de `CLAUDE.md` se aplican igual en modo autónomo. En las ejecuciones programadas no hay nadie para aprobar un cambio en un test bloqueado, así que **cualquier intento se deniega automáticamente**. El desarrollador solo puede ejecutar `lock` (nunca `relock` ni `unlock`), y solo para tareas que el revisor haya aprobado.

---

## 3. Decisiones pendientes que bloquean tareas

| Decisión | Tareas afectadas | Estado |
|---|---|---|
| **Subida de archivos.** ¿Se añade la librería `multer` al stack y se guardan las fotos en `uploads/`, fuera de git? | T-13 (fotos de mascotas), la parte de fotos de T-29 (chat) y las fotos de T-42 (seed de la demo) | **Decidido (24/11/2026): sí, multer.** Fotos en `uploads/`, fuera de git, con nombre aleatorio; solo imágenes (comprobando el contenido, no solo la extensión) y tamaño máximo limitado. En la base de datos se guarda solo la ruta (RN-52). Express sirve `/uploads` como archivos estáticos. |
| **Preguntas del cuestionario de adopción** (RN-207). | T-30 | **Decidido (25/11/2026):** el formulario muestra los datos del hogar del perfil ya rellenados; siguen siendo obligatorios (RN-117) y se pueden corregir allí mismo. Además hay dos preguntas opcionales (motivo y gastos). Se añade `RENT_TO_OWN` a `housing_tenure`. Ver RN-27 y RN-207. |
| **Filtros de la galería:** ¿en una línea compacta (maqueta 02) o en un panel lateral con casillas, como en una tienda, que en el móvil se abre con un botón "Filtros"? | T-47, punto 4 | Pendiente del responsable. Mientras tanto, T-47 sigue la maqueta 02. |
| **Inicio del adoptante** (qué ve nada más iniciar sesión). Propuesta: avisos de lo que le falta (preferencias, datos del hogar), lo que tiene en marcha (próxima visita, solicitudes abiertas, favoritos que han cambiado de estado) y de 4 a 6 mascotas compatibles con un botón a Descubrir. | Nueva tarea cuando se decida | Pendiente del responsable. No se toca la pantalla de inicio actual. |
| **Revisión de la app por el responsable antes del pulido visual** (26/11/2026). Cuando T-32 y T-36 estén terminadas, el responsable revisa la app y decide los ajustes del pulido. | T-47 | Pendiente del responsable. T-47 queda `BLOQUEADA`; solo el responsable la pasa a `PENDIENTE`. |

Cuando el responsable decida, escribe la respuesta en la columna "Estado" y el desarrollador desbloqueará las tareas en su siguiente ejecución.

---

## 4. Preguntas para el responsable

> El desarrollador añade aquí sus dudas, con la fecha y la tarea. El responsable responde debajo de cada una. No se borran: quedan como registro.

**25/11/2026 · T-08 (no bloquea).** Al restablecer la contraseña (CU-05), ¿se cierran las sesiones abiertas de esa cuenta? Es lo habitual por seguridad (si alguien robó la contraseña, pierde el acceso), pero ninguna RN lo dice, así que de momento **no** se cierran. Si la respuesta es sí, se hará en una tarea aparte con tests nuevos.

> **Respuesta del responsable (25/11/2026):** Sí. Al restablecer la contraseña se cierran todas las sesiones abiertas de esa cuenta. Tarea **T-44**.

**25/11/2026 · T-11 (no bloquea).** RN-23 dice que las mascotas de una protectora con la validación revocada no se ven "hasta que vuelva a estar validada", pero CU-39 solo permite validar una protectora **pendiente**, y al revocar pasa a `REJECTED`. ¿Cómo vuelve una protectora rechazada o revocada a estar validada? Opciones: (a) el administrador puede validar también desde `REJECTED`; (b) la protectora pide una nueva revisión y vuelve a `PENDING`. De momento se ha implementado lo que dice CU-39: solo se valida desde `PENDING`.

> **Respuesta del responsable (25/11/2026):** Opción **(a)**: el administrador puede validar también una protectora `REJECTED` (rechazada o revocada). La opción (b) queda para el final, si hay tiempo. Tarea **T-45**.

**25/11/2026 · T-13 (no bloquea).** La decisión sobre multer dice "tamaño máximo limitado", pero no da el valor. Si no se indica otro, se usará **5 MB por foto**, configurable con una variable de entorno (`MAX_PHOTO_SIZE_MB`). Irá fuera de `config.rules`, porque no es un parámetro de la §16 de las reglas y el test bloqueado de T-01 compara `rules` completo. Formatos aceptados: JPEG, PNG y WebP, comprobando el contenido del archivo.

> **Respuesta del responsable (25/11/2026):** De acuerdo: 5 MB por foto, configurable con `MAX_PHOTO_SIZE_MB`, y formatos JPEG, PNG y WebP.

**25/11/2026 · T-45 (bloquea T-45).** T-45 pide que `POST /api/admin/shelters/:id/validate` acepte también una protectora `REJECTED`, y que no se modifiquen los tests de T-11. Pero el test de T-11 `"CU-39: rejects validating a shelter that is not pending"` (`tests/integration/admin-shelters.test.ts`, línea 97) comprueba justo lo contrario: que validar una protectora `REJECTED` responde 409 "La protectora no está pendiente de validación.". Las dos cosas no pueden cumplirse a la vez con el mismo endpoint. Opciones:
- **(a)** Autorizar el cambio de ese test de T-11: quitar `rejected` del bucle (sigue comprobando el 409 para una `VALIDATED`). Todavía no está bloqueado, pero el plan dice que no se toque.
- **(b)** Mantener `/validate` solo para `PENDING` y añadir un endpoint aparte, por ejemplo `POST /api/admin/shelters/:id/revalidate`, solo para `REJECTED`, con su propia acción de auditoría (`SHELTER_REVALIDATED`) y un botón "Volver a validar" en la pestaña de rechazadas.

Recomiendo (a), que es lo que dice la decisión. Mientras tanto, T-45 queda `BLOQUEADA`.

> **Respuesta del responsable (25/11/2026):** Opción **(a)**. Se autoriza cambiar ese test de T-11, que no está bloqueado: quitar `rejected` del bucle de `"CU-39: rejects validating a shelter that is not pending"`. El test sigue comprobando el 409 para una `VALIDATED`. El paso `REJECTED` → `VALIDATED` se cubre con tests nuevos. T-45 pasa a `PENDIENTE`.

**25/11/2026 · T-18 (no bloquea).** RN-191 dice que solo se puede deshacer el descarte inmediatamente anterior, "no una cadena de descartes". El modelo de datos define el último descarte como "el `DISCARDED` más reciente". Pero al deshacerlo se borra la fila, y entonces el descarte anterior pasa a ser el más reciente: por la API se podría encadenar. Sin una columna o tabla nueva, el servidor no puede distinguirlo. Se ha implementado así:
- el servidor solo deshace el `DISCARDED` más reciente (lo que dice el modelo de datos);
- la pantalla solo ofrece "Deshacer" justo después de descartar y lo oculta tras usarlo, así que desde la interfaz no se puede encadenar.

¿Basta con esto, o hay que impedirlo también en el servidor (por ejemplo, guardando en la sesión la mascota que se puede deshacer)?

> **Respuesta del responsable (25/11/2026):** Basta con esto. No se cambia nada.

**25/11/2026 · T-19 (no bloquea).** CU-12 tiene la excepción "la mascota ya no es visible para el adoptante (no disponible, bloqueo o protectora no validada o suspendida)", pero no dice qué pasa con esas mascotas en la lista de favoritos. Por otro lado, el mockup de favoritos muestra una favorita "RESERVADA" y RN-200 avisa de los cambios de estado de los favoritos, así que parece que siguen en la lista. Se ha implementado así:
- la lista muestra los favoritos con su estado (reservada, adoptada, de baja), y solo los disponibles enlazan a su ficha;
- se ocultan los de protectoras que han bloqueado al adoptante, que no están validadas, que están suspendidas o que se han eliminado (RN-23 y RN-77 dicen que esas mascotas "dejan de ser visibles");
- solo se puede añadir a favoritos una mascota visible (404 si no).

¿Es correcto, o los favoritos no disponibles deberían ocultarse también?

> **Respuesta del responsable (25/11/2026):** Es correcto. Los favoritos no disponibles siguen en la lista con su estado. No se cambia nada.

**25/11/2026 · T-46 (bloquea T-46).** La carpeta `db/seed-photos/` no existe en `develop`, así que, como indica la propia tarea, T-46 queda `BLOQUEADA` hasta que se suban las fotos (y `CREDITOS.md`). Cuando estén en `develop`, basta con pasarla a `PENDIENTE`.

**25/11/2026 · T-22 (no bloquea).** CU-23 y RN-111 dicen que la visita que **sustituye** a otra anulada porque la protectora modificó o eliminó el turno no necesita las 48 h y queda confirmada directamente, "porque la protectora ya había confirmado la visita original". Pero al modificar o eliminar un turno se anulan también las visitas que aún estaban **pendientes** (T-20, RN-111). No está claro:
- **(a)** si la sustitución directa vale solo cuando la visita anulada estaba **confirmada** (se sabe por `responded_at`), o también cuando estaba pendiente (y entonces, ¿la nueva queda pendiente o confirmada?);
- **(b)** si tiene que ser para **la misma mascota**, si hay un **plazo** para pedirla y si solo se puede sustituir **una vez** (`replaces_visit_id`);
- **(c)** si sigue aplicando el cupo (RN-90) y las demás comprobaciones (bloqueo, ausencia, plazas).

Propuesta: solo para visitas anuladas con motivo `SLOT_CANCELLED` que estaban confirmadas, para la misma mascota, una sola vez, sin la antelación de 48 h pero con el resto de reglas (plazas, bloqueo, ausencia y cupo, que no cambia porque la original anulada deja de contar). De momento **T-22 no incluye la sustitución**: toda solicitud cumple las 48 h y queda pendiente. Cuando se responda, se puede hacer en una tarea aparte con tests nuevos.

> **Respuesta del responsable (25/11/2026):** De acuerdo con la propuesta. Solo para visitas anuladas con motivo `SLOT_CANCELLED` que estaban confirmadas, para la misma mascota y una sola vez. Se salta la antelación de 48 h y queda confirmada directamente. Se aplican el resto de reglas: plazas, bloqueo, ausencia y cupo. Tarea **T-49**.

**25/11/2026 · T-23 (no bloquea).** El cupo (RN-90) solo cuenta las visitas confirmadas o realizadas, y RN-93 lo comprueba al **solicitar**. Pero las pendientes no cuentan, así que un adoptante puede tener a la vez, por ejemplo, 5 solicitudes pendientes en la misma protectora; si la protectora las confirma todas, superaría las 3 visitas. ¿Hay que comprobar también el cupo al **confirmar** (CU-24), y responder con un error a la protectora si ya está lleno? De momento **no** se comprueba al confirmar, porque ninguna RN ni excepción de CU-24 lo dice.

Nota: la cancelación por parte del adoptante ya está en la API (`POST /api/adopter/visits/:id/cancel`); su botón irá en la pantalla "Mis visitas" de T-24, que aún no existe. Las acciones de la protectora (confirmar, rechazar y cancelar) están en el calendario de turnos.

> **Respuesta del responsable (25/11/2026):** Sí. El cupo se comprueba también al **confirmar**. Si el adoptante ya lo tiene lleno, la protectora recibe un error y la visita sigue pendiente. Tarea **T-48**.

**25/11/2026 · T-24 (no bloquea).** CU-21 y CU-22 incluyen también las **adopciones** (solicitudes, aprobadas pendientes de entrega), que todavía no existen: T-24 cubre solo las visitas, y las adopciones se añadirán a estas mismas pantallas en T-30–T-32. Además, CU-22 dice que la bandeja da "acceso al perfil de cada adoptante", pero ningún caso de uso ni RN dice qué datos del adoptante puede ver la protectora (¿nombre, provincia, datos del hogar de RN-27, historial de visitas con ella?). De momento la bandeja muestra solo el nombre. ¿Qué datos debe ver, y en qué tarea va?

> **Respuesta del responsable (25/11/2026):** La protectora ve el nombre, la provincia, los datos del hogar (RN-27) y el **historial de visitas y ausencias** de ese adoptante con **esa misma** protectora. Nunca ve el historial con otras protectoras. Solo ve estos datos de los adoptantes que le han enviado alguna solicitud (RN-29). Tarea **T-50**.

**25/11/2026 · T-25 (no bloquea).** RN-105 y RN-106 cuentan las 48 h "desde la visita", y CU-26 dice que no se puede marcar una ausencia si la visita "todavía no ha tenido lugar". Se ha tomado como referencia el **fin del turno**: la ausencia se puede registrar desde que termina el turno y hasta 48 h después, y a las 48 h del fin el sistema la marca como realizada. ¿Es correcto, o debe contarse desde el **inicio** del turno?

> **Respuesta del responsable (25/11/2026):** Es correcto: las 48 h se cuentan desde el **fin** del turno. No se cambia nada.

**25/11/2026 · T-29 (no bloquea).** RN-198 pide que el aviso fijo del chat diga a las dos partes "que el adoptante está bloqueado", pero RN-149 da al adoptante un texto neutro ("ha restringido tu acceso"). De momento el chat le dice al adoptante "Esta protectora te ha bloqueado hasta el …" y a la protectora "Has bloqueado a este adoptante hasta el …". ¿Se mantiene, o el adoptante debe ver también aquí el texto neutro de RN-149?

> **Respuesta del responsable (25/11/2026):** En el chat, el adoptante ve el **texto neutro** de RN-149, por ejemplo "La protectora X ha restringido tu acceso hasta el …". La protectora sigue viendo "Has bloqueado a este adoptante hasta el …". RN-198 está actualizada. Tarea **T-51**.

**26/11/2026 · T-51 (bloquea T-51).** T-51 choca con dos tests de T-29 que **ya están bloqueados** (`tests/integration/chat.test.ts`):
- `"RN-136, RN-198, CU-33: with an active block nobody can write, both can read, and both see a fixed notice with the end date"` (línea 181) comprueba, **también para el adoptante**, que el aviso cumple `/bloquead.* hasta el …/`;
- `"RN-198: a permanent block has a notice with no end date; once lifted, they can write again"` (línea 192) comprueba con la sesión **del adoptante** que el aviso cumple `/bloquead/`.

El texto neutro ("La protectora X ha restringido tu acceso hasta el …") no contiene "bloquead", así que esos dos tests fallarían. Meter la palabra en el texto del adoptante le quitaría la neutralidad que pide RN-149. Opciones:
- **(a)** Autorizar el cambio de esos dos tests bloqueados (con `relock`/`unlock --approved`): que comprueben "bloquead" solo con la sesión de la protectora, y para el adoptante el texto neutro (eso lo cubrirían tests nuevos de T-51).
- **(b)** Dejar el chat como está (el adoptante ve "Esta protectora te ha bloqueado hasta el …") y descartar T-51.

No he tocado nada. T-51 queda `BLOQUEADA`.

> **Respuesta del responsable (26/11/2026):** Opción **(a)**. Se autoriza modificar esos dos tests bloqueados de `tests/integration/chat.test.ts`: que comprueben "bloquead" solo con la sesión de la protectora y, para el adoptante, el texto neutro. El resto del archivo no se toca. El archivo ya está desbloqueado (`unlock --approved`) y se volverá a bloquear cuando el revisor apruebe T-51. T-51 pasa a `PENDIENTE`.

**26/11/2026 · T-36 (no bloquea).** CU-06 se contradice sobre el **CIF** (y el nombre) de la protectora. El objetivo enumera los datos públicos que puede modificar (descripción, logo, dirección, teléfono, email de contacto, web y horario), sin el nombre ni el CIF. Pero una excepción dice "el CIF nuevo ya está registrado por otra protectora", como si se pudiera cambiar. Además, dejar cambiar el CIF de una protectora ya validada se saltaría la comprobación del administrador (RN-16). Se ha implementado lo que dice el objetivo: la protectora edita descripción, logo, dirección (con provincia y localidad), teléfono, email de contacto, web y horario; el **nombre y el CIF se muestran pero no se editan**. ¿Es correcto? Si deben poder cambiarse, ¿la protectora vuelve a `PENDING` para que el administrador revise el CIF nuevo? Se haría en una tarea aparte con tests nuevos.

> **Respuesta del responsable (26/11/2026):** Correcto, **ni el nombre ni el CIF se editan**. El CIF es lo que el administrador comprueba al validar (RN-16), y el nombre va ligado a él: si se pudiera cambiar sin revisión, una protectora validada podría hacerse pasar por otra. Se quita de CU-06 la excepción del "CIF nuevo". No hay que cambiar el código.

**26/11/2026 · T-37 (bloquea T-37).** Para eliminar la cuenta (CU-07, RN-11–13, RN-210) faltan cuatro decisiones:
- **(a) Motivo de baja de las mascotas** al eliminar una protectora (RN-12: "sus mascotas pasan a `BAJA`"). `Pet.unlist_reason` es obligatorio en `UNLISTED`, pero su `CHECK` no tiene un valor para esto. Opciones: usar `OTHER`, o añadir `ACCOUNT_DELETED` al `CHECK` de `db/schema.sql` (y al modelo de datos). Recomiendo añadir `ACCOUNT_DELETED`.
- **(b) Qué mascotas pasan a baja.** ¿Todas, o solo las `AVAILABLE` y `RESERVED`? Propuesta: las `AVAILABLE` y `RESERVED` (una `RESERVED` vuelve a baja y su adopción aprobada se anula con `ACCOUNT_DELETED`); las `ADOPTED` se quedan como están, porque son historial.
- **(c) Alcance de RN-210 en el registro de auditoría.** Propuesta: en las entradas cuyo `entity_type`/`entity_id` es el perfil eliminado (`Adopter` o `Shelter`), por ejemplo `PROFILE_UPDATED`, se vacían los valores de `details` (se conservan las claves que cambiaron, no los valores), y se borra `ip_address` de las entradas de esa cuenta. `actor_user_id` se mantiene, porque apunta a la cuenta ya anonimizada.
- **(d) Confirmación (excepción de CU-07).** ¿Basta con una confirmación en la pantalla y un `confirm: true` en la petición, o hay que pedir la contraseña actual? Propuesta: pedir la contraseña actual, porque es una acción irreversible.

Datos que se anonimizarían según la propuesta: email → `deleted-<id>@deleted.invalid` (sigue siendo único), contraseña inutilizable, nombre "Usuario eliminado", teléfono, localidad y datos del hogar vacíos; en la protectora, también CIF (un valor único ficticio), dirección, descripción, logo, web, horario y email de contacto. Se cierran sus sesiones. T-37 queda `BLOQUEADA`.

> **Respuesta del responsable (26/11/2026):** De acuerdo con las cuatro propuestas: **(a)** se añade `ACCOUNT_DELETED` al `CHECK` de `unlist_reason` (y al modelo de datos); **(b)** pasan a baja solo las `AVAILABLE` y `RESERVED` (la adopción aprobada de una `RESERVED` se anula con `ACCOUNT_DELETED`) y las `ADOPTED` se quedan como están; **(c)** en la auditoría se vacían los valores de `details` de las entradas del perfil eliminado (se conservan las claves) y se borra `ip_address` de las entradas de esa cuenta, manteniendo `actor_user_id`; **(d)** se pide la contraseña actual para confirmar. La anonimización de datos, como se propone. T-37 pasa a `PENDIENTE`.

**26/11/2026 · T-37 (no bloquea).** Al eliminar su cuenta un **adoptante**, sus visitas y adopciones abiertas se anulan (`ACCOUNT_DELETED`), pero RN-12 y CU-07 solo piden avisar a los adoptantes cuando se elimina una **protectora**, así que la protectora **no recibe aviso** de las visitas o solicitudes anuladas de ese adoptante (las ve anuladas en su calendario y en su bandeja). Si tenía una adopción **aprobada**, la mascota vuelve a `AVAILABLE` y se avisa a los no seleccionados, como al cancelarla (RN-130). Además, se anonimiza también la **fecha de nacimiento** (queda `1900-01-01`), porque es un dato personal. ¿Es correcto, o la protectora debe recibir un aviso? Se haría en una tarea aparte con tests nuevos.

> **Respuesta del responsable (26/11/2026):** La protectora **sí debe recibir un aviso**, porque puede tener procesos pendientes con ese adoptante. RN-12 y CU-07 están actualizadas. Tarea **T-53**. Lo demás (fecha de nacimiento anonimizada y adopción aprobada liberada como en RN-130) es correcto.

**26/11/2026 · T-43 (no bloquea).** CU-49 no concreta algunos detalles. Se ha implementado así:
- **Sesiones al cambiar la contraseña:** no se cierra ninguna. Al restablecerla sí se cierran todas (T-44), pero para el cambio con la sesión iniciada no hay decisión. ¿Se cierran las demás sesiones y se mantiene la actual?
- **Cambiar el email no pide la contraseña actual**, porque CU-49 solo la pide para la contraseña. El cambio se confirma con el enlace al email nuevo y se avisa al anterior. ¿Hay que pedirla también?
- **Validez del enlace al email nuevo:** 24 h, la misma que la verificación de email (RN-177). Cada petición nueva anula el enlace anterior sin usar, pero **no hay espera de 5 minutos** entre peticiones (RN-180 solo habla de la verificación). Si el email nuevo ya está registrado, se responde igual y no se envía nada. Si se registra antes de abrir el enlace, el enlace deja de valer.
- **Auditoría (RN-208):** `PASSWORD_CHANGED` y `EMAIL_CHANGED`, sin guardar las direcciones, para que no queden datos personales en el registro al eliminar la cuenta (RN-210).

**26/11/2026 · T-42 (bloquea T-42).** T-42 es la única tarea `PENDIENTE`, pero no se puede empezar:
- depende de "todas las anteriores", y T-46 (el seed visual con fotos, que T-42 amplía con el historial) está `BLOQUEADA` porque `db/seed-photos/` no existe en `develop`;
- la propia T-42 pide fotos de ejemplo guardadas en el repositorio, que son las mismas de T-46.

Hacer ahora solo el historial obligaría a rehacerlo cuando T-46 añada las protectoras y mascotas de la demo. T-42 queda `BLOQUEADA`; cuando se suban las fotos a `db/seed-photos/`, T-46 y T-42 pueden pasar a `PENDIENTE` (primero T-46). No queda ninguna otra tarea disponible: el resto está `APROBADA`, `EN_REVISION` (T-38, T-40, T-43) o `BLOQUEADA` (T-46, T-47, T-51).

> **Respuesta del responsable (27/11/2026):** Las fotos, los logos y `CREDITOS.md` ya están en `db/seed-photos/`, en `master`. La estructura y los nombres están en T-46. **T-46 y T-42 pasan a `PENDIENTE`**: primero T-46 y, cuando esté en revisión, T-42 sobre ese seed.

---

## 5. Tareas

**Criterio común.** Cada tarea incluye **la API y su pantalla**, salvo que se indique lo contrario. Además:
- Su definición de "hecho" es: cada regla RN-xx citada y cada excepción del caso de uso tienen su test, y todo está en verde.
- Las pantallas del adoptante siguen los mockups de `docs/ux-ui/app-adoptante` y `docs/ux-ui/acceso`.
- Las de la protectora y el administrador no tienen mockup: siguen el sistema de diseño (`docs/ux-ui/design-system.md`) con la misma estructura de barra lateral.

### Fase 0 · Base del proyecto

| ID | Tarea | Referencias | Depende de | Estado |
|---|---|---|---|---|
| T-01 | **Esqueleto.** `package.json` (ESM), los tres `tsconfig`, ESLint estricto, Vitest y supertest, scripts npm (`dev`, `build`, `start`, `test`, `lint`, `typecheck`, `db:reset`, `pretest` → `test-lock.ts check`), `.env.example` y un `.env` local **sin contraseña** (`pg` la toma de `pgpass.conf`), `config.ts` que valida las variables de entorno y los parámetros de la sección 16 con Zod, y la app de Express con `GET /api/health`. Sin pantalla. | Especificaciones §3–§5 y §10 | — | APROBADA |
| T-02 | **Base de datos.** Pool de `pg`, función para ejecutar en una transacción, y utilidades de test: recrear `lagun_test` con `db/schema.sql` y fábricas de datos para los tests. Script `db:reset` (schema + seed). Sin pantalla. | RN-171; especificaciones §5 | T-01 | APROBADA |
| T-03 | **Piezas transversales.** Middleware de errores (los errores de la base de datos no llegan en crudo al cliente), `audit()` para el registro de auditoría, servicio para **crear** notificaciones con plantillas, y envío de emails simulado que escribe los enlaces en la consola. Sin pantalla. | RN-140–144, RN-208–210 | T-02 | APROBADA |

### Fase 1 · Cuenta y acceso

| ID | Tarea | Referencias | Depende de | Estado |
|---|---|---|---|---|
| T-04 | Registro de adoptante (solo API; las pantallas van en T-09). | CU-01; RN-06–08, 25, 175, 182, 186 | T-03 | APROBADA |
| T-05 | Registro de protectora (solo API). | CU-02; RN-14, 17, 182, 186 | T-04 | APROBADA |
| T-06 | Verificar el email y reenviar el enlace (solo API). | CU-03; RN-07, 177, 180 | T-04 | APROBADA |
| T-07 | Iniciar y cerrar sesión: sesiones en base de datos, cookie, middleware de sesión y de rol, y límite de intentos (solo API). | CU-04; RN-10, 176, 179 | T-06 | APROBADA |
| T-08 | Recuperar la contraseña (solo API). | CU-05; RN-178, 181, 183 | T-07 | APROBADA |
| T-09 | **Frontend base y pantallas de acceso:** `index.html`, router con History API, layout con barra lateral, tokens CSS del sistema de diseño y cliente de la API. Pantallas de inicio de sesión, tipo de cuenta, registros, verificación y recuperación. | Mockups `docs/ux-ui/acceso`; especificaciones §5 | T-08 | APROBADA |
| T-10 | **`db/seed.sql` mínimo:** administrador, una protectora validada, un adoptante y 4 mascotas sin fotos. Incluye un script que genera los hashes Argon2id de las contraseñas de demo, documentadas en el propio seed. | Especificaciones §5 | T-07 | APROBADA |
| T-44 | Al restablecer la contraseña se cierran **todas las sesiones abiertas** de esa cuenta (solo API). Tests nuevos; no se modifican los de T-08. | CU-05; decisión del responsable del 25/11/2026 (sección 4) | T-08 | APROBADA |

### Fase 2 · Mascotas, galería y ficha

| ID | Tarea | Referencias | Depende de | Estado |
|---|---|---|---|---|
| T-11 | Validar, rechazar y revocar protectoras (administrador). Imprescindible para que las mascotas sean visibles. | CU-39; RN-14–19, 23 | T-07 | APROBADA |
| T-45 | El administrador puede **validar también una protectora `REJECTED`** (rechazada o revocada). Al hacerlo, sus mascotas vuelven a ser visibles (RN-23). Tests nuevos para `REJECTED` → `VALIDATED`. El responsable autoriza un único cambio en T-11: quitar `rejected` del bucle de `"CU-39: rejects validating a shelter that is not pending"` (`tests/integration/admin-shelters.test.ts`). Ningún otro test de T-11 se toca. | CU-39; RN-19, 23; decisión del responsable del 25/11/2026 (sección 4) | T-11 | APROBADA |
| T-12 | Alta, edición y listado de las mascotas de una protectora, **sin fotos**. | CU-14, CU-15, CU-16; RN-22, 39–49, 53 | T-11 | APROBADA |
| T-13 | Fotos de las mascotas con multer: subir, borrar y ordenar, como máximo 6. | CU-15, CU-16; RN-50–52 | T-12 | APROBADA |
| T-14 | Galería con filtros, también para el usuario no registrado. | CU-09; RN-23, 24, 58, 77, 187, 189, 205 | T-12 | APROBADA |
| T-15 | Ficha de la mascota (solo con sesión). | CU-11; RN-188 | T-14 | APROBADA |
| T-46 | **Seed visual para la demo** (adelanta una parte de T-42): 3–4 protectoras validadas y unas 15 mascotas publicadas con fotos, sin historial (visitas, chat ni solicitudes). Las fotos están en `db/seed-photos/`, junto con `CREDITOS.md`, que no se copia. El seed copia las fotos a `uploads/` y crea sus filas. Al terminar `npm run db:reset`, todo debe quedar listo. Se amplía `db/seed.sql` y se conservan las cuentas de demo actuales; T-42 añadirá después el historial. Si hay logos en `db/seed-photos/logos/`, se asignan a las protectoras (`logo_path`). **Estructura de `db/seed-photos/`** (indicaciones del responsable del 27/11/2026): **(1) Protectoras:** una por cada logo de `logos/`, con estos nombres exactos: `can-solo.png` → "Can Solo", `nakama.png` → "Nakama" y `parque-amigazo.png` → "Parque Amigazo". Cada una tiene su cuenta de demo, validada y con contraseña conocida, igual que las actuales. "Protectora Txiki" y sus 4 mascotas sin foto se conservan tal cual, sin logo. **(2) Mascotas:** una por cada carpeta de `mascotas/`, con el nombre `especie-nombre` (`perro` o `gato`). El nombre visible es el de la carpeta con la inicial en mayúscula y, si en español lleva tilde, con ella: `perro-pistacho` → "Pistacho", `perro-titan` → "Titán". Las fotos `1.jpg`, `2.jpg`… se cargan en ese orden, y la `1` es la principal (RN-51). Ahora hay 8: Diana, Paco y Paprika (gatos) y Pistacho, Rocky, Shiro, Titán y Torpedo (perros). La raza, el tamaño, la edad y el sexo se eligen **mirando las fotos**, con razas del catálogo, y la descripción es breve y en español. Se reparten de forma equilibrada entre las tres protectoras nuevas. **No hace falta llegar a 15 mascotas**: se crean las que haya. **(3)** El responsable añadirá más fotos y logos; se incorporarán en una tarea aparte. | Especificaciones §9 | T-13, T-15 | APROBADA |
| T-16 | Buscar protectoras y ver su perfil. | CU-13; RN-24, 69, 149 | T-14 | APROBADA |

### Fase 3 · Descubrir y favoritos

| ID | Tarea | Referencias | Depende de | Estado |
|---|---|---|---|---|
| T-17 | Cuestionario de preferencias: ofrecerlo tras el registro y editarlo desde el perfil. | CU-08; RN-30–38, 205 | T-07 | APROBADA |
| T-18 | Modo descubrir: deslizar, descarte de 15 días, deshacer el último descarte y mensaje si no hay cuestionario. | CU-10; RN-70–75, 190, 191 | T-17, T-14 | APROBADA |
| T-19 | Favoritos: lista, quitar y recuperar descartadas. | CU-12; RN-73, 74, 76 | T-18 | APROBADA |

### Fase 4 · Turnos y visitas

| ID | Tarea | Referencias | Depende de | Estado |
|---|---|---|---|---|
| T-20 | Turnos de visita: calendario, crear, modificar y eliminar. | CU-18, CU-19, CU-20; RN-78–85, 111, 112 | T-11 | APROBADA |
| T-21 | Turnos recurrentes. | CU-50; RN-192 | T-20 | APROBADA |
| T-22 | Solicitar una visita desde la ficha (franjas disponibles para esa mascota). Al hacerlo se crea la conversación. | CU-23; RN-80–93, 134, 193, 194 | T-20, T-15 | APROBADA |
| T-23 | Confirmar, rechazar y cancelar visitas. | CU-24, CU-25; RN-94–101 | T-22 | APROBADA |
| T-24 | Consultar mis visitas (adoptante) y la bandeja de solicitudes (protectora). | CU-21, CU-22 | T-23 | APROBADA |
| T-25 | Tareas programadas de visitas (caducar sin respuesta, marcar como realizadas) y registrar ausencias. | CU-26, CU-45, CU-46; RN-95, 102–107 | T-23 | APROBADA |
| T-26 | Reprogramar una visita y recordatorio de visita. | CU-51, CU-53; RN-195–197 | T-25 | APROBADA |
| T-27 | Dar de baja y reactivar una mascota (anula sus visitas y avisa a los adoptantes). | CU-17; RN-60–67 | T-23 | APROBADA |
| T-48 | Comprobar el **cupo** (RN-90) también al **confirmar** una visita. Si el adoptante ya lo tiene lleno con esa protectora, se responde con un error y la visita sigue pendiente. Solo API, más el mensaje de error en el calendario. Tests nuevos; no se modifican los de T-23. | CU-24; RN-90, 93; decisión del responsable del 25/11/2026 (sección 4) | T-23 | APROBADA |
| T-49 | **Visita sustituta** (CU-23, RN-111). Solo cuando la visita anulada tenía motivo `SLOT_CANCELLED` y estaba confirmada. Es para la misma mascota y solo una vez (`replaces_visit_id`). No necesita las 48 h de antelación y queda confirmada directamente. Se aplican el resto de reglas: plazas, bloqueo, ausencia y cupo. Tests nuevos; no se modifican los de T-22. | CU-23; RN-87, 90, 111; decisión del responsable del 25/11/2026 (sección 4) | T-22, T-20 | APROBADA |
| T-50 | **Perfil del adoptante en la bandeja** de la protectora (CU-22). La protectora ve el nombre, la provincia, los datos del hogar (RN-27) y el historial de visitas y ausencias de ese adoptante **con ella**. Solo ve los adoptantes que le han enviado alguna solicitud (RN-29). Tests nuevos, incluido que no se ve el historial con otras protectoras; no se modifican los de T-24. | CU-22; RN-27, 29; decisión del responsable del 25/11/2026 (sección 4) | T-24, T-25 | APROBADA |

### Fase 5 · Notificaciones y chat

| ID | Tarea | Referencias | Depende de | Estado |
|---|---|---|---|---|
| T-28 | Pantalla de notificaciones, marcar como leídas y contador con *polling*. El acceso es una **campana arriba a la derecha** con un punto o contador de no leídas, como en las maquetas de `docs/ux-ui/app-adoptante`, para el adoptante y la protectora. | CU-34; RN-140–144 | T-23 | APROBADA |
| T-29 | Chat con texto y fotos (multer, reutilizando lo de T-13), avisos de bloqueo y de cuenta eliminada, y *polling* de mensajes nuevos. | CU-33; RN-13, 133–139, 198 | T-22 | APROBADA |
| T-51 | **Aviso de bloqueo neutro para el adoptante** en el chat. El adoptante ve el texto neutro de RN-149, por ejemplo "La protectora X ha restringido tu acceso hasta el …". La protectora sigue viendo "Has bloqueado a este adoptante hasta el …". Tests nuevos. **Excepción autorizada por el responsable el 26/11/2026 (sección 4):** en `tests/integration/chat.test.ts` se modifican solo los tests `"RN-136, RN-198, CU-33: with an active block nobody can write, both can read, and both see a fixed notice with the end date"` y `"RN-198: a permanent block has a notice with no end date; once lifted, they can write again"`, para que comprueben "bloquead" solo con la sesión de la protectora. El resto de tests de T-29 no se tocan. | RN-149, 198; decisiones del responsable del 25/11/2026 y del 26/11/2026 (sección 4) | T-29 | APROBADA |

### Prioridad para la demo (decisión del responsable del 26/11/2026)

Estas tareas van **antes que el resto de las pendientes** (T-33 en adelante). Proceden de la Fase 8 (T-36) y de la Fase 9 (T-47); T-52 es nueva. El orden es: terminar las funcionalidades clave (T-32 y T-36, ya hechas, y T-52), luego **el responsable revisa la app** y, con su visto bueno, se hace el pulido visual (T-47). Mientras tanto, el desarrollador sigue con las demás tareas pendientes en el orden de la lista.

| ID | Tarea | Referencias | Depende de | Estado |
|---|---|---|---|---|
| T-36 | Editar el perfil (datos personales y del hogar, o datos públicos de la protectora, **logo incluido**, subido con multer como las fotos de T-13). Se entra desde una **tarjeta arriba de la barra lateral**, "Hola, {nombre} · Ver mi perfil" (el nombre de la protectora en su caso), como en las maquetas de `docs/ux-ui/app-adoptante`. | CU-06; RN-25, 27 | T-07 | APROBADA |
| T-52 | **"Solicitar adopción" solo cuando se puede** (detectado por el responsable al revisar la app, 26/11/2026). Hoy la ficha de la mascota ofrece "Solicitar visita" y "Solicitar adopción" a la vez, y el adoptante solo descubre que no puede adoptar al enviar el formulario. **(1)** La API indica al adoptante si puede solicitar la adopción de esa mascota y, si no, el motivo. Se calcula en el servicio con **la misma comprobación** que valida `POST /api/adoptions`, sin duplicar reglas: visita `REALIZADA` a esa mascota (RN-113) dentro de su validez (RN-116), sin ausencia ni bloqueo con esa protectora (RN-118) y sin otra solicitud abierta para ella (RN-119). Los datos del hogar (RN-117) **no** cuentan, porque se completan en el propio formulario. **(2)** En la ficha, si no puede, el botón aparece **deshabilitado** con el motivo debajo, por ejemplo: "Para solicitar la adopción, primero tienes que visitar a {nombre}", "Tu visita a {nombre} fue hace más de un mes: pide otra visita para poder adoptarla" o "Ya has solicitado adoptar a {nombre}" (con enlace a la solicitud). El texto de bloqueo es neutro (RN-149). **(3)** Si se entra a `/mascotas/:id/adoptar` sin poder, se muestra el mismo aviso en lugar del formulario. Tests nuevos; no se modifican los de T-15 ni T-30. | CU-11, CU-27; RN-113, 116, 118, 119, 149 | T-30 | APROBADA |
| T-47 | **Repaso visual según las maquetas** (indicaciones del responsable del 25/11/2026). Para estas pantallas, las maquetas de `docs/ux-ui/app-adoptante` **dejan de ser solo orientativas**: se siguen fielmente, salvo lo que diga esta tarea. Solo front, sin cambios en reglas ni API. Incluye: **(1) Explorar como una sola sección** con **tabs** Mascotas / Protectoras debajo del título, la activa subrayada en naranja; nada de botones. **(2) Interruptor flotante fijo** abajo en el centro, "Descubrir \| Buscador", para pasar del modo descubrir a la galería sin salir de Explorar. Es un rasgo distintivo de la app. **(3) Modo descubrir como la maqueta `01-explorar-modo-descubrir`:** foto grande, información superpuesta con la protectora encima del nombre y botón "Ver ficha"; botones ✕ y ♥ a los lados con su texto; pista "Arrastra la tarjeta"; al soltar, la tarjeta sale hacia el lado elegido. **(4) Filtros de la galería** compactos, en una sola línea y con menos espacio entre chips, como la maqueta `02-explorar-buscador`, salvo que la sección 3 diga otra cosa. **(5) Iconos SVG propios** junto a cada entrada de la barra lateral, para el adoptante y la protectora: brújula para Explorar, corazón para Favoritos, calendario para Visitas, etc. Con los colores del sistema de diseño y sin emojis. **(6) Logo de la protectora** en pequeño junto a su nombre en la ficha de la mascota, o sus iniciales en un círculo si no tiene logo. **Bloqueada hasta que el responsable revise la app** (sección 3); él la pasará a `PENDIENTE`, quizá con indicaciones nuevas. | Maquetas `docs/ux-ui/app-adoptante`; `docs/ux-ui/design-system.md` | T-32, T-36 | BLOQUEADA |

### Fase 6 · Adopción

| ID | Tarea | Referencias | Depende de | Estado |
|---|---|---|---|---|
| T-30 | Solicitar una adopción: datos del hogar del perfil ya rellenados, obligatorios y editables allí mismo, más el cuestionario opcional de RN-207. Incluye el valor nuevo `RENT_TO_OWN` de `housing_tenure` (RN-27), también en la edición del perfil si ya existe. | CU-27; RN-113–120, 207 | T-25 | APROBADA |
| T-31 | Comparar candidatos y aprobar o rechazar una adopción. | CU-28, CU-29; RN-121–125 | T-30 | APROBADA |
| T-32 | Cancelar una adopción, registrar la entrega y registrar una devolución. | CU-30, CU-31, CU-32; RN-126–131 | T-31 | APROBADA |
| T-33 | Recordatorios de adopciones y entregas pendientes. | CU-47, CU-48; RN-122, 127, 128 | T-32 | APROBADA |

### Fase 7 · Bloqueos y notas internas

| ID | Tarea | Referencias | Depende de | Estado |
|---|---|---|---|---|
| T-34 | Bloquear y desbloquear adoptantes (primero temporal, luego definitivo) y levantar automáticamente los bloqueos temporales. | CU-35, CU-56; RN-145–152, 198, 201–203 | T-29, T-32 | APROBADA |
| T-35 | Notas internas sobre adoptantes. | CU-52; RN-204 | T-24 | APROBADA |

### Fase 8 · Perfil, avisos y administración

| ID | Tarea | Referencias | Depende de | Estado |
|---|---|---|---|---|
| T-37 | Eliminar la cuenta con anonimización. | CU-07; RN-11–13, 210 | T-34 | APROBADA |
| T-38 | Avisos de nuevas mascotas compatibles y de cambios en los favoritos. | CU-54, CU-55; RN-199, 200 | T-19, T-28 | APROBADA |
| T-39 | Incidencias: abrir, gestionar y corregir una asistencia. | CU-36, CU-37, CU-38; RN-108, 165–170 | T-25 | APROBADA |
| T-40 | Suspender y reactivar cuentas, retirar mascotas y gestionar catálogos. | CU-40, CU-41, CU-42; RN-154–159, 163 | T-11 | APROBADA |
| T-41 | Supervisar la actividad (incluido el registro de auditoría) y estadísticas. | CU-43, CU-44; RN-160, 161 | T-39 | APROBADA |
| T-53 | **Aviso a la protectora cuando un adoptante elimina su cuenta** (decisión del responsable del 26/11/2026, sección 4). Al eliminar su cuenta un adoptante, cada protectora con la que tenía visitas o adopciones abiertas, que se anulan con `ACCOUNT_DELETED`, recibe una notificación por cada una, en la misma transacción. El texto habla de "Usuario eliminado", sin datos personales del adoptante (RN-210). Tests nuevos; no se modifican los de T-37. | CU-07; RN-12, 140, 210 | T-37, T-28 | APROBADA |
| T-54 | **Ajustes de la revisión del 26/11/2026** (decisión del responsable). **(1) T-39:** al abrir una incidencia, la protectora solo puede indicar un adoptante que le haya enviado alguna solicitud (`selectAdopterForShelter`, como en los bloqueos). Si no, la respuesta es **la misma** que si el adoptante no existe, para que no se puedan averiguar ids probando por la API (RN-29). **(2) T-52:** `getAdoptionEligibility` es una lectura y no bloquea la fila de la mascota: se lee sin `FOR UPDATE` y sin abrir una transacción, y se mantiene **la misma** comprobación que `POST /api/adopter/adoptions`. Esa petición sigue bloqueando la fila. **(3) T-37:** al eliminar una protectora con logo, su archivo se borra de `uploads/` **después del commit**, como en `setShelterLogo`. Tests nuevos; no se modifican los de T-37, T-39 ni T-52. | RN-29, 166; CU-07, CU-11, CU-36 | T-37, T-39, T-52 | APROBADA |

### Fase 9 · Demo

| ID | Tarea | Referencias | Depende de | Estado |
|---|---|---|---|---|
| T-42 | **`db/seed.sql` completo para la demo:** protectoras y mascotas ficticias, usuarios con contraseña conocida, historial (visitas, chat, favoritos) y fechas relativas al día de ejecución. Las fotos de ejemplo se guardan en el repositorio y el seed las copia a `uploads/`. | Especificaciones §9 | T-10 y todas las anteriores | APROBADA |
| T-55 | **Seed robusto para la demo** (revisión del 26/11/2026, `docs/revisiones/2026-11-26-3.md`; decisión del responsable del 27/11/2026). **(1) Codificación:** `npm run db:reset` funciona aunque la consola de Windows use WIN1252. Para ello, se pasa `PGCLIENTENCODING=UTF8` en el `env` de `execFileSync` (`scripts/db-reset.ts`) y se pone `SET client_encoding = 'UTF8';` al principio de `db/schema.sql` y `db/seed.sql`. **(2) Visita pendiente:** la visita `PENDING` de Ane a Txuri **no caduca** antes de la demo aunque el reset se haga la víspera. Se crea con un `created_at` que deje al menos 20 h de margen tras el reset, sin pasarse del plazo de RN-94 y RN-95, y respetando las 48 h de antelación (RN-87). La cabecera de `seed.sql` explica cuánto dura. **(3) Notificaciones y auditoría:** el seed crea algunas filas de `"Notification"` coherentes con el historial, unas leídas y otras no, para que la campana tenga contenido. Por ejemplo: a Ane, "visita confirmada" (Diana); a Can Solo, "nueva solicitud de adopción" (Iker → Pistacho) y "nueva solicitud de visita"; a Iker, "visita cancelada". Crea también unas cuantas filas de `"Audit_log"` coherentes (validación de las protectoras, publicación de mascotas, cambios de estado de visitas), para que la actividad del administrador (T-41) no salga vacía. Se usan los mismos `type`, claves y formatos que generan los servicios. **(4) Cruces por protectora:** las mascotas se buscan en el seed por nombre **y** por la protectora (su CIF), no solo por nombre. **(5)** Si es razonable, un test **nuevo** comprueba lo que se pueda verificar leyendo el seed como texto, por ejemplo la línea de `client_encoding`. El de T-46 está bloqueado y no se toca. El seed se comprueba cargándolo en una base temporal, como en T-42. | Especificaciones §9; RN-87, 94, 95, 140, 208 | T-42 | PENDIENTE |

### Para el final, si da tiempo

| ID | Tarea | Referencias | Depende de | Estado |
|---|---|---|---|---|
| T-43 | Cambiar el email o la contraseña con la sesión iniciada. | CU-49 | T-36 | APROBADA |

---

## 6. Puesta en marcha

| Archivo | Para qué |
|---|---|
| `scripts/agents/run-desarrollador.ps1` | Una ejecución del desarrollador. Comprueba que no haya cambios sin commit del responsable, se sitúa en `develop`, lanza el agente, verifica el candado de tests y hace `push` de `develop`. |
| `scripts/agents/run-revisor.ps1` | La revisión diaria. Espera a que termine el desarrollador si está trabajando, revisa los commits nuevos de `develop`, guarda el informe en `docs/revisiones/` y hace commit y `push`. |
| `scripts/agents/register-tasks.ps1` | Crea (o elimina con `-Remove`) las dos tareas en el Programador de tareas de Windows. Con `-IntervalHours N`, el desarrollador se ejecuta cada N horas. |
| `scripts/agents/status.ps1` | Estado de un vistazo: si hay un agente trabajando y desde cuándo, las tareas programadas, el trabajo en curso, los commits pendientes de pasar a `master`, el resumen del plan, la última revisión y la última ejecución. Solo lee, no cambia nada. |

Cómo trabajan los agentes:
- **En una copia aparte.** Usan un *worktree* de Git en una carpeta hermana del proyecto (`lagun-app-adopciones-agentes`) con la rama `develop`. Nunca tocan la carpeta de trabajo del responsable. Para ver su trabajo: `git log develop`, o la rama `develop` en GitHub.
- **Nunca a la vez.** Las dos ejecuciones comparten un cerrojo (`.git/agents.lock`).
- **Con registro.** Lo que pasa en cada ejecución queda en `logs/agents/`, fuera de Git.
- **Con permisos limitados.** Se lanzan con una lista cerrada de herramientas y comandos prohibidos (`push`, cambiar de rama, reescribir el historial…). El revisor, además, no puede escribir archivos.
- **Con el candado de tests activo.** Los hooks funcionan igual: sin nadie que apruebe, cualquier cambio en un test bloqueado se deniega.

**Pasos para activarlo:**
1. Hacer commit en `master` de este plan, los agentes y los scripts, y `push`. La rama `develop` se crea a partir de `master` en la primera ejecución.
2. Registrar las tareas: `powershell -ExecutionPolicy Bypass -File scripts\agents\register-tasks.ps1`.
3. Opcional: lanzar una ejecución de prueba a mano: `powershell -ExecutionPolicy Bypass -File scripts\agents\run-desarrollador.ps1`.
4. Para pararlo todo: `register-tasks.ps1 -Remove`.

Requisitos: el PC encendido, sin suspenderse y con tu sesión de Windows iniciada en esas horas, y PostgreSQL arrancado.

### Pausar los agentes para trabajar tú

No hace falta pausarlos para editar en tu carpeta, porque trabajan en otra copia. Sí conviene pausarlos si vas a **ejecutar los tests**, porque compartís la base de datos `lagun_test`, o para no gastar tu límite de uso a la vez.

| Acción | Comando (bash) |
|---|---|
| Pausar (las próximas ejecuciones se saltan) | `touch .git/agents.pause` |
| Reanudar | `rm .git/agents.pause` |
| Ver si hay una ejecución en marcha | `powershell -Command "Get-ScheduledTask -TaskName 'Lagun*' \| Select-Object TaskName, State"` |
| Detener la ejecución en marcha | `powershell -Command "Stop-ScheduledTask -TaskName 'Lagun - agente desarrollador'"` |

Notas:
- La pausa no interrumpe una ejecución que ya ha empezado: o esperas a que termine, o la detienes.
- Si la detienes, el trabajo a medias se guarda en el stash `wip-desarrollador` al empezar la siguiente ejecución, y el agente lo retoma.
- Mientras estén pausados no se pierde nada: la siguiente revisión cubre todos los commits desde la anterior.
