# Connected Calculator (AuraKit)

A working copy of the iOS Calculator, linked over Bluetooth between two iPhones with [AuraKit](https://github.com/splitter77/aura_framework).

| Where | Role | What you see |
| --- | --- | --- |
| **App Clip** (AuraClip, opened from the Aura tag) | guest / spectator | A normal calculator, with no sign of any connection. |
| **Aura Browser** | host / performer | The same calculator, mirrored live. The calculator button at the top right opens the connection panel. |

## Features

- Calculator: operator precedence, iOS-style `%` (`50+10%` = 55), `±`, decimal point, ⌫ delete, `AC`, repeated `=`, numbers in the phone's language format (`1,234.5` / `1 234,5`), history (clock button), AC turns into C as soon as you type.
- Large numbers: exact decimal arithmetic (no rounding errors, `0.1+0.2` = `0.3`), typing never stops (safety cap at 100 digits). Like on iOS, the number stays on one line: it shrinks until about 12 digits fit, then the start slides off the left edge with a fade (swipe to scroll back).
- No vibrations.
- Mirroring: the whole state is shared (`link.shared('calc')`), so both screens stay identical; a spectator who connects late gets the performer's state.
- Performer panel (Aura Browser only):
  - link status;
  - **force the result**: the next `=` shows the chosen number instead of the real result, then the force disarms itself;
  - log of the spectator's keys;
  - reset both calculators;
  - language switch (Français / English).

## Languages

Menus, history, the performer panel and messages are available in English and French (AuraKit's `lib/aurakit-i18n.js`). Each iPhone follows its own phone language: an English-speaking spectator sees the App Clip in English even if the performer uses French. Numbers follow the language too, like on a real iPhone: `1,234.5` and a « . » key in English, `1 234,5` and a « , » key in French. The shared state only holds raw numbers, so each iPhone shows the same calculation in its own format (history and performer log included). The performer can pick a language in the panel, or add `?lang=en` / `?lang=fr` to the URL.

## Bluetooth LE link, no pairing

The link uses Aura's Bluetooth LE (`AuraKit.link()`, on top of `Aura.peer`). There is no iOS pairing and no code to type: the App Clip opened from your Aura tag finds **your** Aura Browser by itself, even with other Aura users nearby, and reconnects if the link drops. Room codes are disabled (no field, no `?room=`, no saved code).

`AuraKit.ble` can't be used for this: it only connects to accessories (central role), and an Aura page can't advertise like an accessory does. Two iPhones therefore can't talk over raw BLE, which is why the app uses `Aura.peer`.

## Files

```
index.html        Single page (App Clip and Aura Browser)
style.css         iOS look
calc-engine.js    Calculation engine (pure functions, JSON state)
app.js            UI + AuraKit link
lib/              aurakit.js, aurakit-mock.js and aurakit-i18n.js copied from aura_framework (commit e4563a9)
test/             Engine tests: node test/engine.test.js
```

## Deploying

1. Host the folder over **HTTPS**.
2. Add the domain to your **Aura bookmarks** and set the page as the destination of your App Clip link / Aura tag.
3. Open the page in Aura Browser (performer), then have the spectator scan the tag: the App Clip opens and the two iPhones connect by themselves.

Both screens must stay on: locking an iPhone drops the link (it then comes back by itself).

## Testing on a computer

```bash
python3 -m http.server 8771
```

Two tabs of the same browser:

- `http://localhost:8771/?mock=join`: App Clip (spectator)
- `http://localhost:8771/?mock=host`: Aura Browser (performer)

The computer keyboard works too (digits, `+ - * / %`, Enter, Backspace, Escape).
