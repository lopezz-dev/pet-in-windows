# Pet in Windows

Mascotas pixel-art que se pasean por encima de tu barra de tareas de Windows, una por cada
sesión de **Claude Code**, para que veas de un vistazo cómo van tus agentes mientras haces otra
cosa (o juegas).

| Estado del agente | Qué hace la mascota |
| --- | --- |
| Trabajando (ejecutando una herramienta) | Camina rápido y pica piedra con un pico ⛏ |
| Pensando | Pasea despacio con `...` sobre la cabeza |
| Terminado, esperando tu respuesta | Vuelve a su sitio y se duerme (`Z z z`); al acabar dice «¡Listo!» |
| Necesita tu permiso | Salta con una `!` roja y un bocadillo «¡Te necesito!» |
| Subagente en marcha | Una mascota pequeña que sigue a su madre |

Pasa el ratón por encima de una mascota para ver el proyecto, la rama, qué está haciendo y la
última tarea o respuesta. Haz clic para fijar el bocadillo. Fuera de las mascotas la ventana
deja pasar los clics, así que no estorba.

## Cómo funciona

- **Sin configuración:** lee los transcripts que Claude Code ya escribe en
  `~/.claude/projects/<proyecto>/<sesión>.jsonl` (y los subagentes en `<sesión>/subagents/`).
  Respeta `CLAUDE_CONFIG_DIR` si lo usas.
- Solo lee el final de cada archivo y cachea por fecha y tamaño. La app ocupa unos 40 MB de RAM.
- «Necesita permiso» es por ahora una heurística: una herramienta lleva más de 25 s sin resultado
  y no estás en modo `bypassPermissions`. Un comando largo puede dar un falso positivo.
- Se muestran como máximo 8 mascotas, priorizando las que te necesitan y las que trabajan. Las
  sesiones terminadas desaparecen a los 45 minutos.

## Stack

- [Tauri v2](https://tauri.app) (Rust + WebView2): ventana transparente, siempre encima,
  clic-a-través e icono en la bandeja.
- `src-tauri/src/sessions.rs`: lector de sesiones → estados.
- `src/`: TypeScript + canvas. Los sprites se definen en código (`src/sprites.ts`) como medias
  rejillas que se reflejan.

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
