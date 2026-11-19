# Claude x WoW

Habla con tu **Claude Code** local desde **World of Warcraft**. Le mandas una tarea con `/claude`, sigues jugando y lees la respuesta en el juego.

> Proyecto **no oficial**. No está afiliado ni respaldado por Anthropic ni por Blizzard Entertainment.
> "Claude" es marca de Anthropic y "World of Warcraft" de Blizzard.

## Cómo funciona

Los addons de WoW no tienen red ni pueden ejecutar programas, así que el proyecto tiene dos piezas:

| Pieza | Qué hace |
|---|---|
| **Addon `ClaudeXWoW`** (Lua) | Terminal estilo Claude Code dentro del juego (`/claude`) |
| **Puente `claude-x-wow`** (Node) | Corre en tu PC, recoge tus mensajes, lanza Claude Code en tu proyecto y devuelve lo que va haciendo al juego |

### Canal en directo (v0.2)

- **Juego → PC:** al enviar, el addon dibuja una tira de cuadraditos de colores (256×48 px) en la esquina superior izquierda durante un instante. El puente la captura de la pantalla y la decodifica (con calibración de color y checksum).
- **PC → juego:** el puente escribe cada lote de eventos en un *addon ranura* (`ClaudeXWoW_S001`, `S002`…, addons LoadOnDemand que el WoW lee del disco al cargarlos). Para avisar de que hay algo nuevo usa un contador de 10 bits hecho con archivos vacíos en `ClaudeXWoW/sig/`, que borra o recrea (código Gray: un solo archivo cambia por paso). `PlaySoundFile` devuelve si el archivo existe, y el cliente lo comprueba en caliente siempre que existiera al arrancar el juego. Por eso conviene **abrir el puente antes que el WoW**: cuando el juego se cierra, el puente deja las señales listas para el siguiente arranque.
- **Respaldo:** si el directo no está disponible, todo funciona igual con `/reload` (SavedVariables + `Inbox.lua`).

Claude Code se ejecuta en modo no interactivo (`claude -p --output-format stream-json --resume`), así que ves en directo cada herramienta que usa (leer, editar, ejecutar...) y la conversación es la misma que puedes seguir luego en tu terminal con `claude --resume <id>` (`claude-x-wow status` te da el comando).

## Requisitos

- [Claude Code](https://docs.claude.com/en/docs/claude-code) instalado y con sesión iniciada (`claude` en la terminal).
- Node.js 18 o superior.
- WoW Forever (Interface 16001). Otras versiones pueden funcionar cambiando el `.toc`.
- Para el canal en directo: **Windows**, WoW en modo **ventana (pantalla completa)** y el puente abierto **antes** de abrir el WoW. Sin eso funciona en modo `/reload`.

## Instalación

```bash
npm install -g github:VelaElDios/claude-x-wow
claude-x-wow setup --project "C:\ruta\a\tu\proyecto"
claude-x-wow start
```

`setup` detecta el WoW e instala el addon. Si no lo encuentra: `--wow "C:\Program Files (x86)\World of Warcraft\_forever_"`.

Reinicia el WoW si estaba abierto y escribe `/claude ayuda`.

## Uso en el juego

`/claude` abre la terminal. Escribe la tarea y pulsa Enter: verás a Claude pensando, las herramientas que usa y su respuesta, mientras sigues jugando.

| En la terminal | Qué hace |
|---|---|
| `<tarea>` + Enter | Manda una tarea |
| ↑ / ↓ | Historial de lo que has escrito |
| `/nuevo` | Empieza una conversación nueva |
| `/stop` | Para la tarea actual |
| `/clear` | Limpia la pantalla |
| `/recargar` | Recarga la interfaz (reinicia el canal) |
| `/sesiones` | Lista tus sesiones de Claude Code de la terminal en este proyecto |
| `/ver N` | Sigue en directo la sesión N (solo lectura): ves lo que haces en Warp/la terminal |
| `/usar N` | Las próximas tareas del juego continúan la sesión N |
| `/dejar` | Deja de seguir la sesión |
| `s` / `siempre` / `n` | Responde a una petición de permiso (o haz clic en los botones) |

Desde el chat también funcionan `/claude <tarea>`, `/claude nuevo`, `/claude stop`, `/claude sesiones` y `/claude estado`.

### Permisos desde el juego

Cuando Claude quiere hacer algo que no está permitido de antemano (por ejemplo, ejecutar `npm test`), la terminal del juego te lo pregunta con botones **[ Sí ]**, **[ Siempre ]** y **[ No ]** (o escribiendo `s`, `siempre` o `n`). "Siempre" vale para esa herramienta (en Bash, para ese comando: `npm`, `git`...) hasta que cierres el puente. Por debajo usa `--permission-prompt-tool` de Claude Code con un pequeño servidor MCP propio (`bridge/permission-mcp.js`).

En la lista de addons verás muchos "Claude x WoW - canal ###": son las ranuras del canal en directo, déjalos activados.

## Seguridad y permisos

- Claude Code trabaja **solo en la carpeta de proyecto** que configures, en tu PC. Nada pasa por servidores de terceros más allá de lo que ya hace Claude Code.
- Por defecto usa `permissionMode: "acceptEdits"`: puede leer y editar archivos del proyecto, y **todo lo demás (comandos de terminal, web...) te lo pregunta en el juego**. Si no quieres que pregunte, pon `"askPermissions": false` y se denegará. Puedes permitir cosas de antemano en `~/.claude-x-wow/config.json`:

```json
{
  "permissionMode": "acceptEdits",
  "allowedTools": ["Bash(npm test:*)", "Bash(git status:*)"]
}
```

- No uses `bypassPermissions` ni lo apuntes a carpetas con credenciales o `.env`.
- El addon solo usa APIs documentadas: no lee memoria del juego ni genera pulsaciones.

## Hoja de ruta

- [x] MVP con `/reload`
- [x] Terminal estilo Claude Code con respuestas en directo (v0.2)
- [x] Ver y continuar desde el juego tus sesiones de la terminal (v0.3)
- [x] Aprobar permisos desde el juego (v0.3)
- [ ] Publicación en CurseForge

## Desarrollo

```bash
npm test
```

## Licencia

MIT
