# Pet in Windows

Mascotas pixel-art que se pasean por encima de tu barra de tareas de Windows, una por cada
sesión de **Claude Code**, para que veas de un vistazo cómo van tus agentes mientras haces otra
cosa (o juegas).

| Estado del agente | Qué hace la mascota |
| --- | --- |
| Trabajando (ejecutando una herramienta) | Se pone el casco de minero y pica piedra (chispas, gotas de sudor) |
| Pensando | Pasea despacio con una nube de pensamiento `...` |
| Terminado, esperando tu respuesta | Celebra con confeti y «¡Listo!», vuelve a su sitio y se duerme (`Zzz`) |
| Necesita tu permiso | Salta con una `!` roja y un bocadillo «¡Te necesito!» |
| Subagente en marcha | Una mascota pequeña que sigue a su madre |

Pasa el ratón por encima de una mascota para ver el proyecto, la rama, qué está haciendo y la
última tarea o respuesta. Clic: fija el bocadillo. Clic derecho: abre los ajustes.
La bombilla de las antenas (o la linterna del casco) también indica el estado por color. Fuera de las mascotas la ventana
deja pasar los clics, así que no estorba.

## Temáticas

| Tema | Detalle | Trabajando | Indicador de estado |
| --- | --- | --- | --- |
| Bichito | El original, con antenas | Casco de minero + pico y roca | Bombillas de las antenas |
| Gatete | Orejas, bigotes, cola y `:3` | Casco de minero + pico y roca | Cascabel del collar |
| Slime | Gelatina que rebota en vez de andar | Casco de minero + pico y roca | Núcleo brillante |
| Fantasmita | Flota con el borde ondulado | Varita mágica con chispas | Fuego fatuo |
| Caballero | Yelmo con nasal | Espada contra un muñeco de entrenamiento | Penacho |
| Mago | Sombrero puntiagudo con estrella | Varita mágica con chispas | Pompón del sombrero |

También hay **Mezcla**: un tema distinto por conversación.

### Añadir una temática

Las temáticas son código, no imágenes: `src/art.ts` → `THEMES` más su adorno de cabeza en `drawPet`
(y, si quieres, una herramienta en `drawTool` y un objetivo en `drawTarget`). Con `npm run dev` y
`/settings.html` las ves al momento en la vista previa. Los PR con temas nuevos son bienvenidos.

> **Solo arte original.** No se aceptan personajes, logos ni diseños reconocibles de juegos, series
> o marcas (aunque estén «pixelados» o renombrados). Los temas inspirados en géneros (fantasía,
> ciencia ficción, terror cuqui…) son perfectos.

## Cómo funciona

- **Sin configuración.** Las conversaciones abiertas salen del registro de procesos de Claude Code,
  `~/.claude/sessions/<pid>.json`: cada proceso `claude` vivo tiene su id de sesión, nombre y estado
  `busy`/`idle`. Los detalles (herramienta en curso, tarea, última respuesta) salen de los transcripts,
  `~/.claude/projects/<proyecto>/<sesión>.jsonl`, y los subagentes de `<sesión>/subagents/`.
  Si usas `CLAUDE_CONFIG_DIR`, se respeta.
- **Qué mascotas se ven.** Por defecto, solo las conversaciones que están trabajando, más las que terminan
  mientras la app las vigila (durante 15 min, configurable). La app de escritorio mantiene vivos procesos
  `idle` de muchas conversaciones antiguas, y esas no aparecen salvo que actives «Mostrar todas las
  conversaciones abiertas».
- Abrir una conversación en la app de escritorio levanta un proceso que sale `busy` un momento. Solo cuenta
  como actividad si la transcripción se escribe después de que arranque ese proceso.
- **«Necesita tu permiso»** = el proceso está `idle` pero la última llamada a una herramienta no tiene
  resultado.
- Con versiones antiguas de Claude Code sin registro, se usan los transcripts modificados recientemente.

## Ajustes

Desde la bandeja (**Ajustes…**) o con clic derecho sobre una mascota. Hay vista previa en vivo y se
guarda solo, en `%APPDATA%/dev.petinwindows.app/settings.json`:

- **Mascota:** temática (o mezcla), color único por sesión (eliges qué colores entran en la rotación) o un color fijo con
  selector libre, tamaño, velocidad y casco de minero.
- **Bocadillo:** estilos Pixel, Cómic, Terminal y Cristal, tamaño de texto, color de acento y si se
  muestra la tarea o la última respuesta.
- **Comportamiento:** zona de paseo, cuánto tiempo siguen visibles las terminadas, máximo de mascotas,
  subagentes y celebración.

## Stack

- [Tauri v2](https://tauri.app) (Rust + WebView2): ventana transparente, siempre encima,
  clic-a-través e icono en la bandeja.
- `src-tauri/src/sessions.rs`: lector de sesiones → estados.
- `src/art.ts`: pixel art **procedural**. El cuerpo se rasteriza (squircle, contorno, rampa de 3 tonos
  con desplazamiento de matiz, barriga y brillo), así que cualquier color funciona y el squash & stretch
  es solo cambiar el tamaño. Cara, patas, antenas, casco y pico se colocan píxel a píxel.
- `src/main.ts`: mascotas, partículas y bocadillos. `src/settings-ui.ts`: ventana de ajustes.

## Desarrollo

Requisitos: Node 20+, Rust (stable) y WebView2 (ya viene con Windows 11).

```bash
npm install
npm run tauri dev        # app real sobre la barra de tareas
npm run dev              # solo el frontend en el navegador, en modo demo
npm run tauri build      # instalador NSIS en src-tauri/target/release/bundle
```

Utilidades:

- `src-tauri/target/debug/pet-in-windows.exe --dump`: imprime en JSON los agentes que vería la app.
- `PET_DEBUG=1 npm run tauri dev`: registra la posición del cursor.
- Bandeja del sistema → **Modo demo**: mascotas falsas que van rotando entre todos los estados.

## Ideas / hoja de ruta

- Hooks de Claude Code (`Notification`, `Stop`, `PreToolUse`…) a un endpoint local para tener el
  estado de permiso exacto.
- Clic en una mascota → enfocar la terminal o la ventana de esa sesión.
- Más especies y skins, y ajustes (zona de paseo, máximo de mascotas, escala).
- Ocultarse con juegos a pantalla completa.
- Soporte multi-monitor y barra de tareas en vertical.

## Licencia

MIT
