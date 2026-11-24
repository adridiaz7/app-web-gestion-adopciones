
> Plataforma de adopción de mascotas
> Generado a partir de los tokens definidos; los contrastes están **calculados** con la fórmula de las WCAG 2.2, no estimados.

## Índice

1. [Principios](#1-principios)
2. [Color](#2-color)
3. [Roles de color](#3-roles-de-color-lo-que-usa-el-código)
4. [Colores semánticos](#4-colores-semánticos)
5. [Accesibilidad: contrastes comprobados](#5-accesibilidad-contrastes-comprobados)
6. [Tipografía](#6-tipografía)
7. [Espaciado, radios y sombras](#7-espaciado-radios-y-sombras)
8. [Componentes básicos](#8-componentes-básicos)
9. [Reglas de uso](#9-reglas-de-uso)
10. [Tokens en CSS](#10-tokens-en-css)

---

## 1. Principios

- **Cálido y cercano.** El naranja transmite hogar y confianza; todos los neutros llevan un poco de ese naranja (tono 33°) para que la interfaz se sienta coherente, en lugar de grises fríos.
- **Texto siempre negro sobre color.** Ni el naranja ni el azul de la marca permiten texto blanco legible (ver [sección 5](#5-accesibilidad-contrastes-comprobados)).
- **El color nunca va solo.** Todo estado o mensaje se acompaña de un icono o de un texto, para que funcione también con daltonismo.
- **Dos niveles de color.** Primero se eligen **primitivos** (la escala `primary-300`, `neutral-600`…); después se les da un **rol** (`--color-primary`, `--color-text-muted`…). El código usa los roles: si mañana cambia la paleta, solo cambia la tabla de roles.

## 2. Color

Cada escala va del 50 (más claro) al 900 (más oscuro). El paso **300** de naranja y azul es exactamente el color de la paleta original.

### Neutros (tintados con el tono del naranja, 33°)

| Token | HEX | HSL | Texto negro encima | Contra el fondo | Uso |
|---|---|---|---|---|---|
| `neutral-0` | `#FFFFFF` | `hsl(0 0% 100%)` | 17,33 | 1,04 | Superficies: tarjetas, paneles, campos, modales |
| `neutral-50` | `#FEFAF6` | `hsl(33 82% 98%)` | 16,69 | 1,00 | Fondo de la página |
| `neutral-100` | `#F9F3EB` | `hsl(33 55% 95%)` | 15,72 | 1,06 | Barra lateral, fondos secundarios, hover suave |
| `neutral-200` | `#EDE4D9` | `hsl(33 35% 89%)` | 13,78 | 1,21 | Bordes suaves, separadores, esqueletos de carga |
| `neutral-300` | `#D7CDC1` | `hsl(33 22% 80%)` | 11,05 | 1,51 | Bordes decorativos (no interactivos) |
| `neutral-400` | `#AC9F91` | `hsl(33 14% 62%)` | 6,70 | 2,49 | Elementos deshabilitados, marcadores de posición |
| `neutral-500` | `#81766A` | `hsl(33 10% 46%)` | 3,91 | 4,27 | Bordes de campos y controles (≥ 3:1) |
| `neutral-600` | `#675F56` | `hsl(33 9% 37%)` | 2,76 | 6,04 | Texto secundario |
| `neutral-700` | `#4C463E` | `hsl(33 10% 27%)` | 1,86 | 8,97 | Iconos, texto de apoyo con más peso |
| `neutral-800` | `#312C26` | `hsl(33 12% 17%)` | 1,25 | 13,31 | Fondos oscuros (tooltips, avisos breves) |
| `neutral-900` | `#1D1A16` | `hsl(33 15% 10%)` | 1,00 | 16,69 | Texto principal |

### Principal · naranja

| Token | HEX | HSL | Texto negro encima | Contra el fondo | Uso |
|---|---|---|---|---|---|
| `primary-50` | `#FDF6EC` | `hsl(33 82% 96%)` | 16,15 | 1,03 | Fondo de selección muy suave |
| `primary-100` | `#FBECDA` | `hsl(33 82% 92%)` | 14,95 | 1,12 | Hover y fondo de elemento seleccionado |
| `primary-200` | `#F8DAB5` | `hsl(33 82% 84%)` | 12,95 | 1,29 | Decoración, ilustraciones |
| **`primary-300`** | `#F1B873` | `hsl(33 82% 70%)` | 9,78 | 1,71 | **Color base** · botón principal, navegación activa, selección |
| `primary-400` | `#D8964B` | `hsl(32 64% 57%)` | 6,92 | 2,41 | Borde de los elementos naranjas, hover del botón principal |
| `primary-500` | `#C07A30` | `hsl(31 60% 47%)` | 5,01 | 3,33 | Iconos naranjas sobre fondo claro (≥ 3:1) |
| `primary-600` | `#9B5E22` | `hsl(30 64% 37%)` | 3,32 | 5,03 | Texto naranja sobre fondo claro (≥ 4,5:1) |
| `primary-700` | `#79481B` | `hsl(29 64% 29%)` | 2,27 | 7,34 | Texto naranja con más peso |
| `primary-800` | `#563315` | `hsl(28 60% 21%)` | 1,55 | 10,75 | — |
| `primary-900` | `#372210` | `hsl(27 55% 14%)` | 1,15 | 14,46 | — |

### Acento · azul

| Token | HEX | HSL | Texto negro encima | Contra el fondo | Uso |
|---|---|---|---|---|---|
| `accent-50` | `#F1F7FE` | `hsl(213 82% 97%)` | 16,07 | 1,04 | Fondo muy suave |
| `accent-100` | `#E3EEFC` | `hsl(213 82% 94%)` | 14,78 | 1,13 | Fondo de chips y filtros activos |
| `accent-200` | `#BFD8F8` | `hsl(213 80% 86%)` | 11,88 | 1,40 | Decoración |
| **`accent-300`** | `#73ACF1` | `hsl(213 82% 70%)` | 7,35 | 2,27 | **Color base** · favoritos, estado destacado, contadores |
| `accent-400` | `#4D8BD5` | `hsl(213 62% 57%)` | 4,93 | 3,39 | Borde de los elementos azules, anillo de foco |
| `accent-500` | `#3271BD` | `hsl(213 58% 47%)` | 3,49 | 4,78 | Iconos azules sobre fondo claro (≥ 3:1) |
| `accent-600` | `#255B9D` | `hsl(213 62% 38%)` | 2,53 | 6,60 | Texto azul sobre fondo claro (≥ 4,5:1) |
| `accent-700` | `#1C487D` | `hsl(213 64% 30%)` | 1,88 | 8,90 | — |
| `accent-800` | `#15355B` | `hsl(213 62% 22%)` | 1,40 | 11,95 | — |
| `accent-900` | `#10243C` | `hsl(213 58% 15%)` | 1,11 | 15,09 | — |

> **Cómo leer las columnas.** *Texto negro encima*: contraste del texto principal sobre ese color (≥ 4,5 para texto normal). *Contra el fondo*: cuánto se distingue ese color del fondo de la página (≥ 3 si es un icono o un borde que el usuario tiene que ver).

## 3. Roles de color (lo que usa el código)

| Variable CSS | Primitivo | HEX | Para qué |
|---|---|---|---|
| `--color-bg` | `neutral-50` | `#FEFAF6` | Fondo de la página |
| `--color-surface` | `neutral-0` | `#FFFFFF` | Tarjetas, paneles, campos |
| `--color-surface-alt` | `neutral-100` | `#F9F3EB` | Barra lateral, zonas secundarias |
| `--color-border` | `neutral-200` | `#EDE4D9` | Bordes suaves y separadores |
| `--color-border-strong` | `neutral-500` | `#81766A` | Bordes de campos y controles |
| `--color-text` | `neutral-900` | `#1D1A16` | Texto principal |
| `--color-text-muted` | `neutral-600` | `#675F56` | Texto secundario |
| `--color-primary` | `primary-300` | `#F1B873` | Botón principal, navegación activa |
| `--color-primary-hover` | `primary-200` | `#F8DAB5` | Hover del botón principal (se aclara, el texto sigue negro) |
| `--color-primary-border` | `primary-400` | `#D8964B` | Borde de los elementos naranjas |
| `--color-primary-soft` | `primary-100` | `#FBECDA` | Selección suave |
| `--color-accent` | `accent-300` | `#73ACF1` | Favoritos, estado destacado, contadores |
| `--color-accent-border` | `accent-400` | `#4D8BD5` | Borde de los elementos azules |
| `--color-accent-soft` | `accent-100` | `#E3EEFC` | Chips y filtros activos |
| `--color-focus` | `accent-400` | `#4D8BD5` | Anillo de foco (3 px) |

## 4. Colores semánticos

Comunican el **resultado** de una acción o el **estado** de algo. Son independientes de la marca: el azul de información **no** es el azul de acento, para que un aviso nunca se confunda con un favorito.

Cada color tiene cuatro pasos con un uso fijo:

| Paso | Uso |
|---|---|
| 50 | Fondo del mensaje |
| 200 | Borde del mensaje |
| 600 | Icono y borde fuerte (≥ 3:1) |
| 800 | Título y texto del mensaje (≥ 4,5:1) |

### Error (rojo) · icono `✕`

Algo ha fallado o no se puede hacer: validación de formularios, acciones destructivas, "No asistida", "Rechazada".

| Token | HEX | HSL | Uso |
|---|---|---|---|
| `error-50` | `#FDEDEC` | `hsl(2 85% 96%)` | Fondo del mensaje |
| `error-200` | `#F6C2C1` | `hsl(2 75% 86%)` | Borde del mensaje |
| `error-600` | `#BE2C27` | `hsl(2 66% 45%)` | Icono y borde fuerte (≥ 3:1) |
| `error-800` | `#7E1A16` | `hsl(2 70% 29%)` | Título y texto del mensaje (≥ 4,5:1) |

### Éxito (verde) · icono `✓`

Una acción ha salido bien: solicitud enviada, datos guardados, "Completada", "Realizada".

| Token | HEX | HSL | Uso |
|---|---|---|---|
| `success-50` | `#ECF9F1` | `hsl(145 50% 95%)` | Fondo del mensaje |
| `success-200` | `#B8E0C9` | `hsl(145 40% 80%)` | Borde del mensaje |
| `success-600` | `#1E7643` | `hsl(145 60% 29%)` | Icono y borde fuerte (≥ 3:1) |
| `success-800` | `#11502B` | `hsl(145 65% 19%)` | Título y texto del mensaje (≥ 4,5:1) |

### Advertencia (ámbar) · icono `!`

Requiere atención pero no es un error: plazos que vencen, cupo casi agotado, "Caducada".

| Token | HEX | HSL | Uso |
|---|---|---|---|
| `warning-50` | `#FEF6DC` | `hsl(46 95% 93%)` | Fondo del mensaje |
| `warning-200` | `#F4D87B` | `hsl(46 85% 72%)` | Borde del mensaje |
| `warning-600` | `#9D6607` | `hsl(38 92% 32%)` | Icono y borde fuerte (≥ 3:1) |
| `warning-800` | `#683D08` | `hsl(33 85% 22%)` | Título y texto del mensaje (≥ 4,5:1) |

### Información (azul) · icono `i`

Contexto útil y neutro: reglas del proceso, consejos, estado del chat.

| Token | HEX | HSL | Uso |
|---|---|---|---|
| `info-50` | `#EDF3FD` | `hsl(215 80% 96%)` | Fondo del mensaje |
| `info-200` | `#C0D5F2` | `hsl(215 65% 85%)` | Borde del mensaje |
| `info-600` | `#1F5CB2` | `hsl(215 70% 41%)` | Icono y borde fuerte (≥ 3:1) |
| `info-800` | `#133D76` | `hsl(215 72% 27%)` | Título y texto del mensaje (≥ 4,5:1) |

> ⚠️ **Advertencia y marca se parecen.** El ámbar (tono 46°) está cerca del naranja principal (33°). Por eso los avisos de advertencia **siempre** llevan el icono `!` y un título, y su fondo tira a amarillo, no a naranja.

> ⚠️ **Rojo y naranja con daltonismo.** Las personas con daltonismo rojo-verde (≈ 8 % de los hombres) confunden el rojo con el naranja y el verde con el rojo. Por eso error y éxito se distinguen también por el icono (`✕` / `✓`) y por el texto.

## 5. Accesibilidad: contrastes comprobados

Requisitos de las WCAG 2.2, nivel AA:
- **Texto normal:** contraste mínimo **4,5:1** (criterio 1.4.3).
- **Iconos, bordes de campos y anillo de foco:** mínimo **3:1** (criterio 1.4.11).

### Combinaciones obligatorias del sistema

| Combinación | Contraste | Mínimo | Resultado |
|---|---|---|---|
| Texto principal (neutral-900) sobre fondo (neutral-50) | 16,69:1 | 4,5:1 | ✅ |
| Texto principal sobre superficie (neutral-0) | 17,33:1 | 4,5:1 | ✅ |
| Texto secundario (neutral-600) sobre fondo | 6,04:1 | 4,5:1 | ✅ |
| Texto secundario sobre superficie | 6,27:1 | 4,5:1 | ✅ |
| Texto secundario sobre neutral-100 (barra lateral) | 5,69:1 | 4,5:1 | ✅ |
| Borde de campo (neutral-500) sobre superficie | 4,44:1 | 3:1 | ✅ |
| Borde de campo sobre fondo | 4,27:1 | 3:1 | ✅ |
| Texto negro sobre botón principal (primary-300) | 9,78:1 | 4,5:1 | ✅ |
| Texto negro sobre primary-100 (seleccionado) | 14,95:1 | 4,5:1 | ✅ |
| Texto negro sobre acento (accent-300) | 7,35:1 | 4,5:1 | ✅ |
| Texto naranja (primary-600) sobre fondo | 5,03:1 | 4,5:1 | ✅ |
| Texto azul (accent-600) sobre fondo | 6,60:1 | 4,5:1 | ✅ |
| Anillo de foco (accent-400) sobre fondo | 3,39:1 | 3:1 | ✅ |
| Anillo de foco (accent-400) sobre superficie | 3,52:1 | 3:1 | ✅ |
| Error: texto (error-800) sobre su fondo (error-50) | 9,04:1 | 4,5:1 | ✅ |
| Error: icono (error-600) sobre su fondo (error-50) | 5,17:1 | 3:1 | ✅ |
| Error: icono (error-600) sobre fondo de página | 5,65:1 | 3:1 | ✅ |
| Error: texto (error-800) sobre fondo de página | 9,88:1 | 4,5:1 | ✅ |
| Éxito: texto (success-800) sobre su fondo (success-50) | 8,79:1 | 4,5:1 | ✅ |
| Éxito: icono (success-600) sobre su fondo (success-50) | 5,20:1 | 3:1 | ✅ |
| Éxito: icono (success-600) sobre fondo de página | 5,42:1 | 3:1 | ✅ |
| Éxito: texto (success-800) sobre fondo de página | 9,16:1 | 4,5:1 | ✅ |
| Advertencia: texto (warning-800) sobre su fondo (warning-50) | 8,60:1 | 4,5:1 | ✅ |
| Advertencia: icono (warning-600) sobre su fondo (warning-50) | 4,48:1 | 3:1 | ✅ |
| Advertencia: icono (warning-600) sobre fondo de página | 4,66:1 | 3:1 | ✅ |
| Advertencia: texto (warning-800) sobre fondo de página | 8,95:1 | 4,5:1 | ✅ |
| Información: texto (info-800) sobre su fondo (info-50) | 9,63:1 | 4,5:1 | ✅ |
| Información: icono (info-600) sobre su fondo (info-50) | 5,83:1 | 3:1 | ✅ |
| Información: icono (info-600) sobre fondo de página | 6,26:1 | 3:1 | ✅ |
| Información: texto (info-800) sobre fondo de página | 10,33:1 | 4,5:1 | ✅ |
| Texto blanco sobre botón de peligro (error-600) | 5,87:1 | 4,5:1 | ✅ |

**Resultado: las 31 combinaciones cumplen AA.**

### Datos que explican las decisiones

| Combinación | Contraste | Conclusión |
|---|---|---|
| Texto blanco sobre el naranja base | 1,77:1 | Texto blanco prohibido sobre este color |
| Texto blanco sobre el azul base | 2,36:1 | Texto blanco prohibido sobre este color |
| Naranja base contra el fondo (sin borde) | 1,71:1 | No se distingue solo: necesita borde `-400` |
| Azul base contra el fondo (sin borde) | 2,27:1 | No se distingue solo: necesita borde `-400` |
| Borde primary-400 contra el fondo | 2,41:1 | El borde mejora la separación, pero el texto da el significado |
| Naranja base contra azul base | 1,33:1 | Se distinguen por el tono, no por la luminosidad (buena pareja para daltonismo) |
| Naranja base contra advertencia (warning-600) | 2,73:1 | Muy parecidos: la advertencia necesita icono y texto |

## 6. Tipografía

Fuente: **Inter** (Google Fonts), con `system-ui` como alternativa. Pesos: 400 (normal), 500 (medio) y 600 (seminegrita).

| Estilo | Tamaño | Peso | Interlineado | Espaciado | Uso |
|---|---|---|---|---|---|
| display | 40 px | 600 | 1,1 | -0,03 em | Título principal de una vista |
| h1 | 32 px | 600 | 1,15 | -0,02 em | Nombre de la mascota o protectora |
| h2 | 24 px | 600 | 1,2 | -0,01 em | Títulos de sección |
| h3 | 20 px | 600 | 1,3 | 0 | Títulos de tarjeta o modal |
| body-lg | 16 px | 400 | 1,5 | 0 | Texto destacado, descripciones largas |
| body | 14 px | 400 | 1,45 | 0 | Texto por defecto de la interfaz |
| small | 13 px | 400 | 1,4 | 0 | Metadatos, ayudas |
| caption | 12 px | 500 | 1,4 | 0 | Fechas, contadores, notas |
| overline | 11 px | 600 | 1,3 | 0,16 em | Etiquetas en MAYÚSCULAS sobre secciones |

## 7. Espaciado, radios y sombras

### Espaciado (base de 4 px)

Todo margen o separación es múltiplo de 4. Así el diseño mantiene un ritmo regular sin decidir cada valor a ojo.

| Token | Valor |
|---|---|
| space-1 | 4 px |
| space-2 | 8 px |
| space-3 | 12 px |
| space-4 | 16 px |
| space-5 | 20 px |
| space-6 | 24 px |
| space-8 | 32 px |
| space-10 | 40 px |
| space-12 | 48 px |
| space-14 | 56 px |

### Radios

| Token | Valor | Uso |
|---|---|---|
| radius-sm | 8 px | Miniaturas, etiquetas pequeñas |
| radius-md | 12 px | Campos, avisos, botones de día |
| radius-lg | 14 px | Tarjetas y paneles |
| radius-xl | 20 px | Modales |
| radius-2xl | 24 px | Tarjeta del modo descubrir |
| radius-full | 999 px | Botones, chips, insignias, avatares |

### Sombras

Tintadas con marrón en lugar de negro, para que no ensucien el fondo cálido.

| Token | Valor | Uso |
|---|---|---|
| shadow-sm | `0 1px 2px rgba(80,50,10,.08)` | Elementos en reposo que necesitan separarse un poco |
| shadow-md | `0 10px 24px rgba(80,50,10,.10)` | Hover de tarjetas, selector flotante |
| shadow-lg | `0 20px 44px rgba(80,50,10,.18)` | Menús desplegables y modales |

## 8. Componentes básicos

### Botones

| Variante | Fondo | Borde | Texto | Cuándo |
|---|---|---|---|---|
| Principal | `primary-300` | `primary-400` | `neutral-900` | La acción más importante de la pantalla (una sola) |
| Secundario | `neutral-0` | `neutral-500` | `neutral-900` | Acciones alternativas |
| Peligro | `error-600` | `error-600` | blanco | Acciones destructivas (eliminar cuenta) |
| Deshabilitado | `neutral-100` | `neutral-300` | `neutral-600` | Acción no disponible; explicar el motivo al lado |

Altura 42 px (34 px en la versión pequeña), radio `radius-full`, foco con anillo `accent-400` de 3 px.

### Insignias de estado (visitas y adopciones)

| Estado | Estilo |
|---|---|
| Confirmada, Aprobada, Disponible | Acento: fondo `accent-300`, texto negro |
| Realizada, Completada | Éxito: fondo `success-50`, borde `success-600`, texto `success-800` |
| Pendiente | Neutro: fondo blanco, borde `neutral-500` |
| Caducada | Advertencia: fondo `warning-50`, borde `warning-600`, texto `warning-800` |
| Rechazada, No asistida | Error: fondo `error-50`, borde `error-600`, texto `error-800` |
| Cancelada, Anulada, No seleccionada | Neutro apagado: borde `neutral-300`, texto `neutral-600` |
| Reservada, Adoptada | Principal: fondo `primary-300`, texto negro |

### Mensajes (avisos)

Estructura: icono (`-600`) + título en seminegrita (`-800`) + texto (`neutral-900`), sobre fondo `-50` con borde `-200` y una franja izquierda de 4 px en `-600`.

### Campos de formulario

Fondo `neutral-0`, borde `neutral-500` (≥ 3:1), radio `radius-md`, etiqueta en `caption` `neutral-600`. En error: borde `error-600` y mensaje debajo con icono `✕` en `error-800`.

## 9. Reglas de uso

1. **Texto sobre naranja o azul: siempre negro** (`neutral-900`). El blanco no llega a 2,5:1.
2. **Un solo botón principal naranja por pantalla.** Si todo es naranja, nada destaca.
3. **El azul de acento no comunica estados del sistema.** Para avisos se usa `info`, que es otro azul.
4. **Ningún significado solo por color:** cada estado lleva texto, y cada mensaje, icono.
5. **Los elementos naranjas y azules llevan borde `-400`.** Sin él, apenas se separan del fondo (≈ 1,7:1 y 2,3:1).
6. **Texto secundario nunca más claro que `neutral-600`.** `neutral-400` y `neutral-500` no sirven para texto.
7. **Usar roles, no primitivos, en el código** (`var(--color-primary)`, no `var(--primary-300)`).

## 10. Tokens en CSS

```css
:root {
  /* Primitivos */
  --neutral-0: #FFFFFF;
  --neutral-50: #FEFAF6;
  --neutral-100: #F9F3EB;
  --neutral-200: #EDE4D9;
  --neutral-300: #D7CDC1;
  --neutral-400: #AC9F91;
  --neutral-500: #81766A;
  --neutral-600: #675F56;
  --neutral-700: #4C463E;
  --neutral-800: #312C26;
  --neutral-900: #1D1A16;
  --primary-50: #FDF6EC;
  --primary-100: #FBECDA;
  --primary-200: #F8DAB5;
  --primary-300: #F1B873;
  --primary-400: #D8964B;
  --primary-500: #C07A30;
  --primary-600: #9B5E22;
  --primary-700: #79481B;
  --primary-800: #563315;
  --primary-900: #372210;
  --accent-50: #F1F7FE;
  --accent-100: #E3EEFC;
  --accent-200: #BFD8F8;
  --accent-300: #73ACF1;
  --accent-400: #4D8BD5;
  --accent-500: #3271BD;
  --accent-600: #255B9D;
  --accent-700: #1C487D;
  --accent-800: #15355B;
  --accent-900: #10243C;
  --error-50: #FDEDEC;
  --error-200: #F6C2C1;
  --error-600: #BE2C27;
  --error-800: #7E1A16;
  --success-50: #ECF9F1;
  --success-200: #B8E0C9;
  --success-600: #1E7643;
  --success-800: #11502B;
  --warning-50: #FEF6DC;
  --warning-200: #F4D87B;
  --warning-600: #9D6607;
  --warning-800: #683D08;
  --info-50: #EDF3FD;
  --info-200: #C0D5F2;
  --info-600: #1F5CB2;
  --info-800: #133D76;

  /* Roles */
  --color-bg: var(--neutral-50);
  --color-surface: var(--neutral-0);
  --color-surface-alt: var(--neutral-100);
  --color-border: var(--neutral-200);
  --color-border-strong: var(--neutral-500);
  --color-text: var(--neutral-900);
  --color-text-muted: var(--neutral-600);
  --color-primary: var(--primary-300);
  --color-primary-hover: var(--primary-200);
  --color-primary-border: var(--primary-400);
  --color-primary-soft: var(--primary-100);
  --color-accent: var(--accent-300);
  --color-accent-border: var(--accent-400);
  --color-accent-soft: var(--accent-100);
  --color-focus: var(--accent-400);

  /* Tipografía, espaciado, radios y sombras */
  --font-sans: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-14: 56px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-2xl: 24px;
  --radius-full: 999px;
  --shadow-sm: 0 1px 2px rgba(80,50,10,.08);
  --shadow-md: 0 10px 24px rgba(80,50,10,.10);
  --shadow-lg: 0 20px 44px rgba(80,50,10,.18);
}
```
