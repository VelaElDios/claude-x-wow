# Claude x WoW

Habla con tu **Claude Code** local desde **World of Warcraft**. Le mandas una tarea con `/claude`, sigues jugando y lees la respuesta en el juego.

> Proyecto **no oficial**. No está afiliado ni respaldado por Anthropic ni por Blizzard Entertainment.
> "Claude" es marca de Anthropic y "World of Warcraft" de Blizzard.

## Cómo funciona

Los addons de WoW no tienen red ni pueden ejecutar programas, así que el proyecto tiene dos piezas:

| Pieza | Qué hace |
|---|---|
| **Addon `ClaudeXWoW`** (Lua) | Ventana de chat y comando `/claude` dentro del juego |
| **Puente `claude-x-wow`** (Node) | Corre en tu PC, recoge tus mensajes, lanza Claude Code en tu proyecto y devuelve la respuesta al juego |

Versión 0.1 (MVP): el canal usa `/reload`.

- **Juego → PC:** el mensaje se guarda en las SavedVariables del addon y se recarga la interfaz para que WoW lo escriba en disco.
- **PC → juego:** el puente reescribe `Inbox.lua` del addon y el juego lo lee en el siguiente `/reload` (`/claude ver`).

Claude Code se ejecuta en modo no interactivo (`claude -p --resume`), así que la conversación es la misma que puedes seguir luego en tu terminal con `claude --resume <id>` (`claude-x-wow status` te da el comando).

## Requisitos

- [Claude Code](https://docs.claude.com/en/docs/claude-code) instalado y con sesión iniciada (`claude` en la terminal).
- Node.js 18 o superior.
- WoW Forever (Interface 16001). Otras versiones pueden funcionar cambiando el `.toc`.

## Instalación

```bash
npm install -g github:<tu-usuario>/claude-x-wow
claude-x-wow setup --project "C:\ruta\a\tu\proyecto"
claude-x-wow start
```

`setup` detecta el WoW e instala el addon. Si no lo encuentra: `--wow "C:\Program Files (x86)\World of Warcraft\_forever_"`.

Reinicia el WoW si estaba abierto y escribe `/claude ayuda`.

## Comandos en el juego

| Comando | Qué hace |
|---|---|
| `/claude <tarea>` | Manda una tarea (recarga la interfaz) |
| `/claude` | Abre o cierra la ventana |
| `/claude ver` | Recarga para ver respuestas nuevas |
| `/claude nuevo` | Empieza una conversación nueva |
| `/claude estado` | Estado del puente |

## Seguridad y permisos

- Claude Code trabaja **solo en la carpeta de proyecto** que configures, en tu PC. Nada pasa por servidores de terceros más allá de lo que ya hace Claude Code.
- Por defecto usa `permissionMode: "acceptEdits"`: puede leer y editar archivos del proyecto, pero **los comandos de terminal se bloquean** salvo que los permitas en `~/.claude-x-wow/config.json`:

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
- [ ] Respuestas en tiempo real sin `/reload`
- [ ] Ver en modo lectura las sesiones abiertas en tu terminal
- [ ] Aprobar permisos desde el juego
- [ ] Publicación en CurseForge

## Desarrollo

```bash
npm test
```

## Licencia

MIT
