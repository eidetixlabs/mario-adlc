## Design System Context
Reuse existing tokens, theme variables, and components. Do not hardcode colors or spacing.
Match the repository's naming and file-structure conventions.
### styles.css
```
:root {
  --sky: #5c94fc;
  --gold: #f8d030;
  --cream: #fff8e7;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}

body {
  font-family: "Press Start 2P", monospace;
  color: var(--cream);
}

#app {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #000;
}

.hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  display: grid;
  grid-template-columns: 1fr auto 1fr 1fr auto;
  gap: 12px;
  align-items: end;
  padding: 14px 22px 0;
  pointer-events: none;
  text-shadow:
    3px 3px 0 #000,
    -1px 0 #000,
    0 -1px #000,
    1px 0 #000;
}

.mute-btn {
  pointer-events: auto;
  align-self: start;
  margin-top: 2px;
  width: 42px;
  height: 42px;
  border: 3px solid #111;
  border-radius: 6px;
  background: linear-gradient(180deg, #
```
