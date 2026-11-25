# Casos de uso — Plataforma de adopción de mascotas (MVP)

> Casos de uso identificados durante el diseño de la base de datos. Las reglas que hay detrás de cada excepción están en [reglas-de-negocio.md](reglas-de-negocio.md).
> Igual que las reglas, los identificadores no se renumeran: un caso de uso nuevo recibe el siguiente número libre aunque se coloque dentro de su sección.
>
> **Última actualización:** 24/11/2026

## Actores

| Actor | Descripción |
|---|---|
| **Usuario no registrado** | Persona sin cuenta o sin sesión iniciada. Solo puede ver la galería de mascotas y registrarse. |
| **Adoptante** | Persona registrada que busca una mascota para adoptar. |
| **Protectora** | Asociación registrada que publica mascotas y gestiona el proceso. Una única cuenta para todo su personal. |
| **Administrador** | Usuario que vela por el buen funcionamiento y el equilibrio de la plataforma. |
| **Sistema** | Procesos automáticos (tareas programadas y acciones encadenadas). |

## Índice

1. [Cuenta y acceso](#1-cuenta-y-acceso)
2. [Preferencias](#2-preferencias)
3. [Búsqueda y favoritos](#3-búsqueda-y-favoritos)
4. [Gestión de mascotas](#4-gestión-de-mascotas)
5. [Turnos de visita](#5-turnos-de-visita)
6. [Seguimiento de solicitudes](#6-seguimiento-de-solicitudes)
7. [Visitas](#7-visitas)
8. [Adopción](#8-adopción)
9. [Chat y notificaciones](#9-chat-y-notificaciones)
10. [Bloqueos](#10-bloqueos)
11. [Incidencias](#11-incidencias)
12. [Administración](#12-administración)
13. [Procesos automáticos](#13-procesos-automáticos)

---

## 1. Cuenta y acceso

**CU-01 · Registrarse como adoptante**

**Actor:** Usuario no registrado

**Objetivo:** Crear una cuenta de adoptante con sus datos personales (nombre, apellidos, email, contraseña, teléfono, fecha de nacimiento, provincia y localidad).

**Excepciones:**
- El email ya está registrado en la plataforma: se responde igual que con un email nuevo (para no revelar qué emails tienen cuenta) y se avisa por email al dueño de la cuenta.
- La persona es menor de edad.
- No acepta los términos de uso y la política de privacidad.
- Faltan datos obligatorios o tienen un formato incorrecto.

---

**CU-02 · Registrarse como protectora**

**Actor:** Usuario no registrado

**Objetivo:** Crear una cuenta de protectora con sus datos (nombre, CIF, dirección, provincia, teléfono…). La cuenta queda pendiente de validación por el administrador.

**Excepciones:**
- El email ya está registrado en la plataforma: se responde igual que con un email nuevo (para no revelar qué emails tienen cuenta) y se avisa por email al dueño de la cuenta.
- El CIF ya está registrado por otra protectora.
- No acepta los términos de uso y la política de privacidad.
- Faltan datos obligatorios o tienen un formato incorrecto.

---

**CU-03 · Verificar el email**

**Actor:** Adoptante, Protectora

**Objetivo:** Activar la cuenta pulsando el enlace recibido tras el registro. Si el enlace no llega o caduca, el usuario puede pedir que se le reenvíe.

**Excepciones:**
- El enlace no es válido o ha caducado.
- El email ya estaba verificado.

---

**CU-04 · Iniciar sesión**

**Actor:** Adoptante, Protectora, Administrador

**Objetivo:** Acceder a la plataforma con email y contraseña.

**Excepciones:**
- El email o la contraseña son incorrectos.
- El email no está verificado.
- La cuenta tiene una suspensión activa.
- La cuenta ha sido eliminada.

---

**CU-05 · Recuperar la contraseña**

**Actor:** Adoptante, Protectora, Administrador

**Objetivo:** Establecer una contraseña nueva mediante un enlace enviado al email de la cuenta, cuando el usuario la ha olvidado. Al hacerlo, se cierran todas las sesiones abiertas de la cuenta (RN-211).

**Excepciones:**
- El email no corresponde a ninguna cuenta (o la cuenta está suspendida). Una cuenta sin verificar sí recibe el enlace, y al usarlo queda verificada (RN-183).
- El enlace no es válido o ha caducado.

---

**CU-06 · Editar el perfil**

**Actor:** Adoptante, Protectora

**Objetivo:**
- **Adoptante:** modificar sus datos personales y completar o actualizar los datos del hogar (tipo de vivienda, jardín o terraza, propiedad o alquiler, convivientes, niños, otras mascotas, experiencia previa, horas que pasaría solo el animal).
- **Protectora:** modificar sus datos públicos (descripción, logo, dirección, teléfono, email de contacto, web, horario).

**Excepciones:**
- Los datos tienen un formato incorrecto.
- Adoptante: la nueva fecha de nacimiento corresponde a un menor de edad.
- Protectora: el CIF nuevo ya está registrado por otra protectora.

---

**CU-07 · Eliminar la cuenta**

**Actor:** Adoptante, Protectora

**Objetivo:** Eliminar su cuenta. Los datos personales se anonimizan y el historial se conserva. Si es un adoptante, sus visitas y adopciones abiertas se anulan. Si es una protectora, sus mascotas pasan a baja y sus visitas y adopciones abiertas se anulan, con aviso a los adoptantes. En ambos casos, sus conversaciones de chat se conservan con el autor como "Usuario eliminado", y la otra parte puede leerlas pero ya no escribir.

**Excepciones:**
- El usuario no confirma la eliminación.

---

**CU-49 · Cambiar el email o la contraseña** *(prioridad baja: al final del desarrollo, si da tiempo)*

**Actor:** Adoptante, Protectora

**Objetivo:** Con la sesión iniciada, cambiar la contraseña (indicando la actual) o el email de acceso. El email nuevo debe verificarse con un enlace antes de sustituir al anterior, y se avisa del cambio al email anterior.

**Excepciones:**
- La contraseña actual no es correcta.
- La contraseña nueva no cumple la longitud exigida.
- El email nuevo ya está registrado (se responde igual que si estuviera libre).
- El enlace de verificación del email nuevo no es válido o ha caducado.

---

## 2. Preferencias

**CU-08 · Rellenar o editar las preferencias**

**Actor:** Adoptante

**Objetivo:** Indicar qué busca en una mascota: especie, raza, tamaño, edad, sexo, nivel de actividad, convivencia con niños y con otras especies. Se ofrece tras el primer registro y se puede editar en cualquier momento desde el perfil. Todas las preguntas admiten varias respuestas y "me da igual", salvo la edad, que se indica con una edad mínima y una máxima (ambas opcionales). Al editar, se borran sus descartes para que esas mascotas puedan volver a aparecer; sus favoritos se conservan.

**Excepciones:**
- Ninguna: el cuestionario es opcional y todas sus preguntas también.

---

## 3. Búsqueda y favoritos

**CU-09 · Buscar mascotas en la galería**

**Actor:** Adoptante, Usuario no registrado

**Objetivo:** Ver las tarjetas de las mascotas disponibles y filtrarlas por especie, raza, tamaño, edad (mínima y máxima), sexo y provincia. La galería no aplica las preferencias del adoptante: para eso está el modo descubrir.
- **Adoptante:** puede abrir la ficha de cada mascota y añadirla a favoritos.
- **Usuario no registrado:** solo ve las tarjetas. Al pulsar una, se le invita a registrarse.

**Excepciones:**
- No hay mascotas disponibles que cumplan los filtros.
- No se muestran las mascotas de protectoras que han bloqueado al adoptante, ni las de protectoras no validadas o suspendidas.

---

**CU-10 · Descubrir mascotas compatibles**

**Actor:** Adoptante

**Objetivo:** Ver, una a una, mascotas compatibles con sus preferencias en el modo descubrir. Desliza a la derecha para añadirla a favoritos o a la izquierda para descartarla durante 15 días, y pasa a la siguiente. Puede deshacer su último descarte. Si no ha rellenado el cuestionario, ve todas las mascotas disponibles y un mensaje que le invita a rellenarlo.

**Excepciones:**
- No quedan mascotas compatibles sin valorar (o con el descarte aún vigente).
- Deshacer: no hay un descarte inmediatamente anterior que deshacer.
- No se muestran las mascotas no disponibles, las de protectoras que han bloqueado al adoptante ni las de protectoras no validadas o suspendidas.

---

**CU-11 · Consultar la ficha de una mascota**

**Actor:** Adoptante

**Objetivo:** Ver toda la información de una mascota: fotos, descripción, características (con la edad en meses o años), convivencia, salud y protectora.

**Excepciones:**
- El usuario no ha iniciado sesión: se le invita a registrarse o a iniciar sesión (no hay enlaces públicos a las fichas).
- La mascota no está disponible.
- La protectora ha bloqueado al adoptante.
- La protectora no está validada o está suspendida.

---

**CU-12 · Gestionar los favoritos**

**Actor:** Adoptante

**Objetivo:** Consultar su lista de favoritos, añadir mascotas desde la galería o la ficha, quitar mascotas de la lista y recuperar mascotas descartadas.

**Excepciones:**
- La mascota ya no es visible para el adoptante (no disponible, bloqueo o protectora no validada o suspendida).

---

**CU-13 · Buscar protectoras**

**Actor:** Adoptante

**Objetivo:** Encontrar protectoras, por ejemplo por provincia, y ver su perfil y sus mascotas.

**Excepciones:**
- No hay protectoras que cumplan los filtros.
- No se muestran las protectoras no validadas o suspendidas.
- Si la protectora ha bloqueado al adoptante, el perfil muestra el aviso de acceso restringido y no muestra sus mascotas.

---

## 4. Gestión de mascotas

**CU-14 · Consultar mis mascotas**

**Actor:** Protectora

**Objetivo:** Ver el listado de sus mascotas con su estado (disponible, reservada, adoptada o de baja) y acceder a cada ficha.

**Excepciones:**
- La protectora no tiene mascotas dadas de alta.

---

**CU-15 · Dar de alta una mascota**

**Actor:** Protectora

**Objetivo:** Publicar la ficha de una mascota con sus datos (incluida la fecha de nacimiento aproximada), características, convivencia, salud y fotos. Queda en estado disponible.

**Excepciones:**
- Faltan datos obligatorios o tienen un formato incorrecto.
- Se intentan subir más de 6 fotos.
- La protectora no está validada: la ficha se crea, pero no es visible para los adoptantes hasta la validación.

---

**CU-16 · Editar la ficha de una mascota**

**Actor:** Protectora

**Objetivo:** Modificar los datos de una mascota y gestionar sus fotos (añadir, eliminar y ordenar; la primera es la principal).

**Excepciones:**
- Los datos tienen un formato incorrecto.
- La mascota quedaría con más de 6 fotos.

---

**CU-17 · Dar de baja o reactivar una mascota**

**Actor:** Protectora

**Objetivo:**
- **Dar de baja:** ocultar una mascota de los adoptantes indicando el motivo (fallecimiento, traslado, tratamiento, acogida, error u otro). Sus visitas abiertas y adopciones pendientes se anulan y se avisa a los adoptantes con un mensaje según el motivo.
- **Reactivar:** volver a ponerla disponible. Se avisa a los adoptantes cuyas visitas o adopciones se anularon por esa baja.

**Excepciones:**
- Baja: la mascota no está disponible (por ejemplo, está reservada: primero hay que cancelar la adopción aprobada).
- Baja: no se indica el motivo.
- Reactivar: la mascota no está de baja.
- Reactivar: la mascota fue retirada por el administrador.

---

## 5. Turnos de visita

**CU-18 · Consultar el calendario de turnos**

**Actor:** Protectora

**Objetivo:** Ver sus turnos de visita con las plazas ocupadas y libres, y las visitas de cada turno.

**Excepciones:**
- La protectora no tiene turnos creados.

---

**CU-19 · Crear un turno de visita**

**Actor:** Protectora

**Objetivo:** Publicar en su calendario un turno con fecha, hora de inicio, hora de fin y número de plazas.

**Excepciones:**
- La fecha ya ha pasado.
- La hora de fin es anterior a la de inicio.
- La capacidad es menor que 1.

---

**CU-20 · Modificar o eliminar un turno de visita**

**Actor:** Protectora

**Objetivo:** Cambiar la fecha, el horario o la capacidad de un turno, o eliminarlo. Si cambian la fecha o el horario, o si se elimina, sus visitas se anulan y se invita a los adoptantes a elegir otro turno.

**Excepciones:**
- La nueva capacidad es menor que las plazas ya ocupadas.
- Los datos nuevos no son válidos (fecha pasada, hora de fin anterior a la de inicio).
- Eliminar: el turno ya ha pasado (se conserva como historial de las visitas).

---

**CU-50 · Crear turnos de visita recurrentes**

**Actor:** Protectora

**Objetivo:** Generar de una vez varios turnos indicando los días de la semana, la hora de inicio y de fin, la capacidad y el rango de fechas (por ejemplo, "martes y jueves de 10:00 a 12:00, 3 plazas, del 1 al 31 de diciembre"). Se crea un turno independiente por cada fecha, que después se modifica o elimina por separado (CU-20).

**Excepciones:**
- La fecha de inicio del rango ya ha pasado o el rango supera los 3 meses.
- No se ha elegido ningún día de la semana.
- La hora de fin es anterior a la de inicio o la capacidad es menor que 1.
- Alguna fecha choca con un turno existente en la misma franja: ese turno no se genera y se informa a la protectora.

---

## 6. Seguimiento de solicitudes

**CU-21 · Consultar mis visitas y adopciones**

**Actor:** Adoptante

**Objetivo:** Ver sus visitas y adopciones con su estado, cuántas visitas le quedan del cupo en cada protectora y cuándo recupera la siguiente plaza.

**Excepciones:**
- El adoptante no tiene visitas ni adopciones.

---

**CU-22 · Consultar la bandeja de solicitudes**

**Actor:** Protectora

**Objetivo:** Ver las solicitudes de visita y de adopción que esperan respuesta, las visitas confirmadas próximas y las adopciones aprobadas pendientes de entrega, con acceso al perfil de cada adoptante.

**Excepciones:**
- No hay solicitudes pendientes.

---

**CU-52 · Gestionar notas internas sobre un adoptante**

**Actor:** Protectora

**Objetivo:** Desde el perfil de un adoptante que le ha enviado alguna solicitud, escribir, consultar, editar o borrar notas privadas (por ejemplo, impresiones de la visita) que le ayuden a decidir. El adoptante nunca las ve.

**Excepciones:**
- El adoptante no ha enviado ninguna solicitud a esa protectora.
- La nota está vacía.

---

## 7. Visitas

**CU-23 · Solicitar una visita**

**Actor:** Adoptante

**Objetivo:** Desde la ficha de la mascota, elegir uno de los días y franjas disponibles para esa mascota y reservar plaza para verla en la protectora. La solicitud queda pendiente de confirmación por la protectora. Si es la primera solicitud del adoptante a esa protectora, se abre el chat entre ambos. Si la visita sustituye a otra anulada porque la protectora modificó o eliminó el turno, no necesita 48 horas de antelación y queda confirmada directamente.

**Excepciones:**
- La mascota no está disponible.
- El turno no tiene plazas libres.
- La mascota ya tiene una visita activa en ese turno.
- El turno empieza dentro de menos de 48 horas (salvo si sustituye a una visita anulada por cambio de turno).
- El adoptante ya tiene 3 visitas confirmadas o realizadas en esa protectora en los últimos 3 meses.
- El adoptante tiene una visita no asistida en esa protectora.
- La protectora ha bloqueado al adoptante.

---

**CU-24 · Confirmar o rechazar una visita**

**Actor:** Protectora

**Objetivo:** Responder a una solicitud de visita pendiente. Si la rechaza, puede indicar el motivo. El adoptante recibe una notificación.

**Excepciones:**
- Han pasado más de 24 horas desde la solicitud (la visita ha caducado).
- El adoptante ya ha cancelado la solicitud.

---

**CU-25 · Cancelar una visita**

**Actor:** Adoptante, Protectora

**Objetivo:** Cancelar una visita. Se registra quién la cancela, se notifica a la otra parte y la visita no cuenta para el cupo del adoptante.
- **Adoptante:** puede cancelar una visita pendiente o confirmada con al menos 24 horas de antelación.
- **Protectora:** puede cancelar una visita confirmada en cualquier momento, incluso con menos de 24 horas, por un imprevisto.

**Excepciones:**
- Adoptante: faltan menos de 24 horas para la visita.
- Protectora: la visita no está confirmada.
- La visita ya está cerrada (realizada, no asistida, cancelada, rechazada, caducada o anulada).

---

**CU-51 · Reprogramar una visita**

**Actor:** Adoptante

**Objetivo:** Cambiar una visita pendiente o confirmada a otro turno de la misma protectora, para la misma mascota. En una sola operación, la visita original se cancela y se crea una solicitud nueva, que queda pendiente de confirmación. La protectora recibe una notificación.

**Excepciones:**
- Faltan menos de 24 horas para la visita original.
- La visita original ya está cerrada.
- El nuevo turno no cumple las condiciones de una solicitud (menos de 48 horas de antelación, sin plazas, la mascota ya tiene visita en ese turno, cupo agotado…). En ese caso la visita original se mantiene tal cual.

---

**CU-26 · Registrar una ausencia**

**Actor:** Protectora

**Objetivo:** Marcar que el adoptante no acudió a una visita confirmada. El adoptante pierde el derecho a visitar y adoptar en esa protectora: sus visitas y adopciones abiertas en ella se anulan y, si tenía una adopción aprobada, se cancela.

**Excepciones:**
- La visita todavía no ha tenido lugar.
- La visita no está confirmada.
- Han pasado más de 48 horas y el sistema ya la marcó como realizada.

---

## 8. Adopción

**CU-27 · Solicitar una adopción**

**Actor:** Adoptante

**Objetivo:** Pedir la adopción de una mascota que ha visitado, revisando sus datos del hogar y respondiendo un breve cuestionario de adopción opcional (RN-207). La solicitud queda pendiente y puede competir con las de otros adoptantes. El contrato y las posibles tasas se gestionan fuera de la app.

**Excepciones:**
- No tiene una visita realizada a esa mascota.
- La visita se realizó hace más de 1 mes.
- No ha completado los datos del hogar.
- Tiene una visita no asistida en esa protectora.
- La protectora le ha bloqueado.
- Ya tiene una solicitud abierta para esa mascota.
- La mascota no está disponible.

---

**CU-28 · Comparar los candidatos de una mascota**

**Actor:** Protectora

**Objetivo:** Ver todas las solicitudes de adopción pendientes de una mascota, con los datos personales y del hogar de cada candidato, para elegir el mejor hogar.

**Excepciones:**
- La mascota no tiene solicitudes de adopción pendientes.

---

**CU-29 · Aprobar o rechazar una adopción**

**Actor:** Protectora

**Objetivo:**
- **Aprobar:** elegir al adoptante con el que se irá la mascota. La mascota pasa a reservada, el resto de candidatos pasan a no seleccionados, las visitas abiertas de la mascota se anulan y se notifica a todos los afectados.
- **Rechazar:** descartar una solicitud indicando el motivo. El adoptante recibe una notificación.

**Excepciones:**
- La solicitud no está pendiente.
- Aprobar: la mascota ya tiene otra adopción aprobada o completada.

---

**CU-30 · Cancelar una adopción**

**Actor:** Adoptante, Protectora

**Objetivo:**
- **Adoptante:** retirar su solicitud mientras está pendiente, o echarse atrás de una adopción aprobada.
- **Protectora:** echarse atrás de una adopción aprobada.

Se registra quién cancela y el motivo. Si la adopción estaba aprobada, la mascota vuelve a estar disponible y se avisa a los candidatos no seleccionados.

**Excepciones:**
- La adopción ya está cerrada (si ya está completada, corresponde una devolución).
- Protectora: la adopción solo está pendiente (corresponde rechazarla).

---

**CU-31 · Registrar la entrega de la mascota**

**Actor:** Protectora

**Objetivo:** Indicar con un clic que la mascota se ha ido con su adoptante. La adopción pasa a completada y la mascota a adoptada.

**Excepciones:**
- La adopción no está aprobada.

---

**CU-32 · Registrar una devolución**

**Actor:** Protectora

**Objetivo:** Registrar que un adoptante ha devuelto la mascota, con la fecha y el motivo. La mascota vuelve a estar disponible.

**Excepciones:**
- La adopción no está completada.

---

## 9. Chat y notificaciones

**CU-33 · Usar el chat**

**Actor:** Adoptante, Protectora

**Objetivo:** Consultar sus conversaciones, leer los mensajes y enviar texto o fotos a la otra parte (está pendiente decidir si también vídeos). La conversación se abre con la primera solicitud de visita del adoptante a esa protectora (esté o no confirmada) y queda abierta para siempre.

**Excepciones:**
- El adoptante no ha solicitado ninguna visita a esa protectora (la conversación no existe).
- La protectora intenta iniciar una conversación.
- Hay un bloqueo activo: la conversación se puede leer, pero ninguna de las partes puede escribir, y se muestra un aviso de que el adoptante está bloqueado.
- La otra parte ha eliminado su cuenta: la conversación se puede leer, pero no escribir.

---

**CU-34 · Consultar las notificaciones**

**Actor:** Adoptante, Protectora, Administrador

**Objetivo:** Ver sus avisos (visitas, adopciones, recordatorios, bloqueos, incidencias…) y abrir la visita o adopción relacionada. Las notificaciones quedan marcadas como leídas.

**Excepciones:**
- No tiene notificaciones.

---

## 10. Bloqueos

**CU-35 · Bloquear o desbloquear a un adoptante**

**Actor:** Protectora

**Objetivo:**
- **Bloquear:** impedir que un adoptante vea sus mascotas, le envíe solicitudes o le escriba, indicando un motivo interno. El primer bloqueo a ese adoptante dura 15 días; cualquier bloqueo posterior es definitivo. Las visitas y adopciones pendientes del adoptante se anulan, una adopción aprobada se cancela, y el adoptante recibe una notificación. Mientras dure el bloqueo, ve un aviso en el perfil de la protectora, y el chat queda en solo lectura con un aviso para ambas partes.
- **Desbloquear:** levantar el bloqueo antes de tiempo (temporal o definitivo). El bloqueo queda en el historial.

**Excepciones:**
- Bloquear: el adoptante ya está bloqueado.
- Bloquear: el adoptante no ha enviado ninguna solicitud a esa protectora.
- Bloquear: no se indica el motivo.
- Desbloquear: no existe un bloqueo activo para ese adoptante.

---

## 11. Incidencias

**CU-36 · Abrir una incidencia**

**Actor:** Adoptante, Protectora

**Objetivo:** Comunicar un problema al administrador sobre la otra parte, con un motivo y una explicación. Opcionalmente, puede ligarse a una visita o adopción concreta (por ejemplo, para reclamar una ausencia mal registrada).

**Excepciones:**
- Falta la explicación.
- La visita o adopción indicada no pertenece a las partes implicadas.

---

**CU-37 · Gestionar una incidencia**

**Actor:** Administrador

**Objetivo:** Revisar una incidencia, cambiar su estado (en revisión, resuelta o descartada) y registrar la resolución. Quien la abrió recibe una notificación; la otra parte solo si la resolución le afecta.

**Excepciones:**
- La incidencia ya está resuelta o descartada.

---

**CU-38 · Corregir una asistencia**

**Actor:** Administrador

**Objetivo:** Cambiar una visita marcada como no asistida a realizada tras revisar una incidencia. Queda registrado que la corrección la hizo el administrador.

**Excepciones:**
- La visita no está marcada como no asistida.

---

## 12. Administración

**CU-39 · Gestionar la validación de las protectoras**

**Actor:** Administrador

**Objetivo:**
- **Validar o rechazar** una protectora recién registrada, tras comprobar su CIF. Una vez validada, sus mascotas pasan a ser visibles.
- **Revocar** la validación de una protectora que ya no cumple los requisitos. Sus mascotas dejan de ser visibles; sus visitas y adopciones en curso se mantienen.
- **Volver a validar** una protectora rechazada o con la validación revocada, cuando ya cumple los requisitos. Sus mascotas vuelven a ser visibles (RN-212).

**Excepciones:**
- Validar: la protectora ya está validada.
- Rechazar: la protectora no está pendiente de validación.
- Revocar: la protectora no está validada.
- Se rechaza o se revoca sin indicar el motivo.

---

**CU-40 · Suspender o reactivar una cuenta**

**Actor:** Administrador

**Objetivo:**
- **Suspender** a un adoptante o a una protectora indicando el motivo. El usuario no puede iniciar sesión. Si es un adoptante, sus visitas y adopciones abiertas se anulan y una adopción aprobada se cancela. Si es una protectora, sus mascotas dejan de ser visibles y lo que tiene en curso se mantiene.
- **Reactivar** una cuenta suspendida. La suspensión queda en el historial.

**Excepciones:**
- Suspender: el usuario ya tiene una suspensión activa.
- Suspender: no se indica el motivo.
- Reactivar: el usuario no tiene una suspensión activa.

---

**CU-41 · Retirar una mascota por contenido inapropiado**

**Actor:** Administrador

**Objetivo:** Dar de baja la ficha de una mascota con fotos o textos inadecuados. La protectora no puede reactivarla.

**Excepciones:**
- La mascota no está disponible.

---

**CU-42 · Gestionar los catálogos**

**Actor:** Administrador

**Objetivo:** Añadir o editar especies y razas.

**Excepciones:**
- Ya existe una especie o raza con ese nombre.
- La raza no se asocia a ninguna especie.

---

**CU-43 · Supervisar la actividad**

**Actor:** Administrador

**Objetivo:** Consultar cualquier visita, adopción o bloqueo con su historial, y el registro de auditoría (quién hizo cada acción y qué cambió), por ejemplo para resolver una disputa o detectar adoptantes problemáticos y protectoras que bloquean de forma abusiva.

**Excepciones:**
- Ninguna.

---

**CU-44 · Consultar estadísticas**

**Actor:** Administrador

**Objetivo:** Ver indicadores globales de la plataforma: adopciones, tiempos medios de gestión, devoluciones, bloqueos, incidencias…

**Excepciones:**
- Ninguna.

---

## 13. Procesos automáticos

**CU-45 · Caducar las visitas sin respuesta**

**Actor:** Sistema

**Objetivo:** Marcar como caducadas las solicitudes de visita que la protectora no ha respondido en 24 horas, liberar su plaza y avisar al adoptante.

**Excepciones:**
- La protectora responde antes de que se cumpla el plazo.

---

**CU-46 · Marcar las visitas como realizadas**

**Actor:** Sistema

**Objetivo:** Marcar como realizadas las visitas confirmadas cuando han pasado 48 horas desde la visita sin que la protectora haya registrado una ausencia.

**Excepciones:**
- La protectora registra una ausencia antes de que se cumpla el plazo.
- La visita se cancela o se anula antes de tener lugar.

---

**CU-47 · Recordar las adopciones pendientes**

**Actor:** Sistema

**Objetivo:** Enviar a la protectora un recordatorio cada 3 días mientras tenga solicitudes de adopción sin responder.

**Excepciones:**
- Ya se envió un recordatorio para esa solicitud en los últimos 3 días.

---

**CU-48 · Recordar las entregas pendientes**

**Actor:** Sistema

**Objetivo:** Enviar a la protectora un recordatorio diario mientras tenga adopciones aprobadas sin entrega registrada y, si pasan 5 días, avisar al administrador.

**Excepciones:**
- La protectora registra la entrega o la adopción se cancela.

---

**CU-53 · Recordar las visitas próximas**

**Actor:** Sistema

**Objetivo:** Enviar al adoptante un recordatorio de cada visita confirmada 48 horas antes (o al confirmarse, si ya faltan menos), con la fecha, la hora, la dirección de la protectora y hasta cuándo puede cancelar.

**Excepciones:**
- La visita se cancela, se anula o se reprograma antes del envío.

---

**CU-54 · Avisar de nuevas mascotas compatibles**

**Actor:** Sistema

**Objetivo:** Cuando una mascota pasa a estar disponible y visible, avisar a los adoptantes que han rellenado el cuestionario y con los que es compatible.

**Excepciones:**
- El adoptante no ha rellenado el cuestionario.
- La protectora ha bloqueado al adoptante.
- La mascota ya está en sus favoritos (recibe el aviso del CU-55).

---

**CU-55 · Avisar de los cambios en los favoritos**

**Actor:** Sistema

**Objetivo:** Avisar al adoptante cuando una mascota de sus favoritos pasa a reservada, adoptada o de baja, o vuelve a estar disponible.

**Excepciones:**
- El cambio se debe a una adopción del propio adoptante (ya recibe los avisos de su adopción).

---

**CU-56 · Levantar los bloqueos temporales**

**Actor:** Sistema

**Objetivo:** Cuando se cumplen los 15 días de un bloqueo temporal, levantarlo, registrar la fecha de desbloqueo y avisar al adoptante. Se vuelve a poder escribir en el chat. Las visitas y adopciones anuladas por el bloqueo no se recuperan.

**Excepciones:**
- La protectora ya levantó el bloqueo antes de tiempo.
- El bloqueo es definitivo.

---

## Fuera del MVP

No se incluyen casos de uso de donativos, apadrinamiento, voluntariado, comunicados generales, configuración de parámetros desde un panel, gestión de varios administradores, reporte de mensajes del chat, enlaces públicos a las fichas, borrado automático de cuentas sin verificar ni descarga de los datos personales.

**Para el final, si da tiempo:** cambiar el email o la contraseña (CU-49), que una protectora rechazada corrija sus datos y vuelva a pedir la validación, y que el adoptante reporte fichas de mascotas y protectoras al administrador.
