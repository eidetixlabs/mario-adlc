# Mario Dash

Fullscreen Mario-style platformer with synthesized chiptune audio.

## Play

```bash
python3 -m http.server 5179 --directory .
```

Open [http://127.0.0.1:5179](http://127.0.0.1:5179), or open `index.html` directly.

## Controls

| Key | Action |
|-----|--------|
| `←` `→` / `A` `D` | Move |
| `↑` / `W` / `Space` | Jump |
| `Shift` | Run |
| `P` | Pause |
| `M` or 🔊 button | Mute / unmute |

Mute preference is saved in `localStorage`.

## Features

- Fullscreen hi-DPI canvas
- Short, jumpable gaps with mid-air platforms
- Pixel Mario, goombas, pipes, hills, and brick ground
- SDLC hazards: crawling neon **code bugs** and hidden, glitching **edge-case** traps
- Hidden proximity-triggered **landmines** and running **burrowers**
- Classic **spikes**, **Goombas**, pits, and **piranha plants** that lunge from pipes
- Powerups from `?`/`★` blocks plus ordinary-looking hidden power-up bricks: **Super** mushroom (shrug off one hit) and **Star** (temporary invincibility)
- Three modes: Classic (blind), Context Graph (player-centered threat type/distance/urgency), Autonomous Agent (autopilot)
- Web Audio SFX + looping chiptune (no external files)
