# Publicar Claude x WoW en CurseForge

Proyecto: **Claude Terminal** · ID `1817243`

El addon se publica solo con subir una etiqueta (`git tag v0.3.0 && git push --tags`):
GitHub Actions pasa los tests, empaqueta `addon/ClaudeXWoW` y lo sube a GitHub
Releases y a CurseForge. Para lo de CurseForge hay que configurarlo una vez:

## 1. Crear el proyecto (una vez)

1. Entra en https://authors.curseforge.com con tu cuenta y crea un proyecto
   nuevo de **World of Warcraft → Addons**.
   - Nombre: `Claude x WoW`
   - Categorías: *Development Tools*, *Miscellaneous*
   - Licencia: MIT
   - Descripción: la de abajo.
2. Copia el **Project ID** (aparece en la página del proyecto, en "About Project").
3. Añádelo al `.toc` del addon (`addon/ClaudeXWoW/ClaudeXWoW.toc`):
   ```
   ## X-Curse-Project-ID: 123456
   ```

## 2. Token de la API (una vez)

1. En https://legacy.curseforge.com/account/api-tokens genera un token.
2. En GitHub: *Settings → Secrets and variables → Actions → New repository secret*
   con el nombre `CF_API_KEY` y el token como valor.

## 3. Publicar una versión

```
git checkout main
git merge develop
git tag -a v0.3.0 -m "v0.3.0"
git push && git push --tags
```

## Notas

- El addon solo no hace nada: hace falta el puente (`npm install -g github:VelaElDios/claude-x-wow`).
  Los "canales" (`ClaudeXWoW_S###`) los crea el puente en tu PC, no van en el paquete.
- Si CurseForge no reconoce la versión del juego del `.toc` (`16001`, WoW Forever),
  elige la versión a mano al subir o revisa los avisos del paso "Empaquetar" en Actions.

---

## Descripción para la página de CurseForge

**Claude x WoW** pone tu **Claude Code** dentro del juego: una terminal con el
estilo de Claude Code donde le mandas tareas para tu proyecto y ves en directo
lo que hace (qué archivos lee, qué edita, qué comandos ejecuta) mientras sigues
jugando.

- Terminal propia con `/claude`, historial, colores y respuestas en directo.
- Permisos desde el juego: botones Sí / Esta sesión / Siempre / No.
- Cambia de proyecto, modelo o modo sin salir del juego (`/proyecto`, `/modelo`, `/modo`).
- Botón en el minimapa, atajo de teclado y aviso cuando Claude termina.
- Sigue o continúa tus sesiones de Claude Code de la terminal (`/sesiones`).
- Claude Code se ejecuta en **tu PC**, en la carpeta que elijas. El addon solo
  usa APIs documentadas: no lee memoria del juego ni pulsa teclas por ti.

**Requisitos:** Windows, Claude Code instalado y con sesión iniciada, Node.js 18+
y el puente: `npm install -g github:VelaElDios/claude-x-wow`, después
`claude-x-wow setup --project <tu carpeta>` y `claude-x-wow start` (antes de abrir el WoW).

*Proyecto no oficial. No está afiliado ni respaldado por Anthropic ni por Blizzard Entertainment.*

---

## CurseForge page (English summary)

**Claude x WoW** puts your **Claude Code** inside the game: a Claude Code–style terminal where you send tasks for your project and watch live what it does (files read, edits, commands) while you keep playing. Permission buttons in game, follow/continue your terminal sessions, switch project/model/mode, minimap button and notifications. Claude Code runs on **your PC** in the folder you choose; the addon only uses documented APIs.

**Requires** Windows, Claude Code, Node.js 18+ and the bridge: `npm install -g github:VelaElDios/claude-x-wow`. In-game UI is in Spanish.

*Unofficial project, not affiliated with Anthropic or Blizzard Entertainment.*
