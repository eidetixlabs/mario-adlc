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
- Pixel Mario, named comic-style code bugs, pipes, hills, and brick ground
- SDLC hazards: famous **code bugs** and hidden, glitching **edge-case** traps
- Spaced-out proximity-triggered **landmines**, including a stacked **Tech Debt** trap, plus one redesigned **Edge Case**
- Classic **spikes**, pits, and production-incident plants; one exclusive random pipe releases a bug instead of growing a plant
- Powerups from `?`/`★` blocks plus ordinary-looking hidden power-up bricks: audible **Super** mushroom growth (and one-hit shield) and **Star** invincibility
- Three modes: Classic (blind), Context Graph (player-centered threat type/distance/urgency), Autonomous Agent (autopilot)
- Web Audio SFX + looping chiptune (no external files)
