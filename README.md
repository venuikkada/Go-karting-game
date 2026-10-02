# 🏁 Turbo Kart: Velocity

A fast, good-looking 3D go-kart racer inspired by Asphalt. It runs in the browser on phones, tablets and desktops, and you can install it as an app. There are no downloads or build step, and it needs no art files: everything is drawn in code with [three.js](https://threejs.org/).

## Features

**Racing**
- Arcade handling tuned to feel quick and responsive. Drifts keep your momentum.
- **Drift → Turbo:** hold a drift to charge a blue **TURBO**, then an orange **SUPER TURBO**, and let go to fire it.
- **Nitro (N2O):** fills up from drifting, driving at top speed and boost pads. Fire it for about 230 km/h with flames, speed lines and a wider field of view.
- **Boost pads**, a **perfect start** (press gas just before GO), wall-riding that helps you recover instead of stalling, and karts that bump into each other.
- **5 AI rivals** that follow a racing line, brake for corners, use nitro on straights and steer around other karts. Rubber-banding keeps every race close.
- Lap timing, best lap, live standings, minimap, a wrong-way warning, a results screen, and a slow camera orbit after you cross the line.

**Environment**
- A 2.1 km coastal circuit: asphalt with a rubbered-in racing line, red and white curbs, sponsor barriers with guard rails, and tyre walls on the sharp corners.
- Grandstands with crowds, a start/finish gantry with working start lights, a lake, more than 600 trees, snow-capped mountains, clouds and waving flags.
- **Day / Sunset / Night.** At night you get headlights, glowing floodlights, pools of light on the track and a starry sky.
- Visual effects: bloom, ACES tone mapping, shiny clear-coat paint with sky reflections, soft shadows, drift smoke, coloured drift sparks, skid marks, wall sparks, nitro flames, camera shake and speed lines.
- All sound is generated in code: an engine with simulated gear changes, tyre squeal, nitro whoosh, impacts and countdown beeps.

## 📱 Mobile

- **Touch controls:** an analog steering pad (drag your thumb), plus big **N2O**, **DRIFT** and **BRAKE** buttons with haptic feedback.
- **Tilt steering** (like Asphalt), with a re-center option in the pause menu.
- **Auto-accelerate** is on by default. Switch to **Manual** to get a GAS button.
- It goes full-screen and locks to landscape when you start a race. If the phone is upright, it asks you to rotate (or tap **Play anyway** to play in portrait).
- **Installable (PWA):** add it to the home screen and it opens full-screen and works **offline**.
- Graphics presets (Low / Med / High) plus **automatic resolution scaling**, so cheaper phones stay smooth.
- The race pauses itself when you switch apps or take a call.

## Controls

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Accelerate | W / ↑ | RT | Auto (or GAS) |
| Brake / Reverse | S / ↓ | LT | BRAKE |
| Steer | A D / ← → | Left stick | Steering pad or tilt |
| Drift | Space | A / RB | DRIFT (hold) |
| Nitro | Shift / N | X / B | N2O (tap) |
| Camera | C | Y | 🎥 |
| Reset to track | R | Back | — |
| Pause | P / Esc | Start | ❚❚ |

**Tips:** start a drift going into a corner and hold it until the bar turns orange, then let go for a Super Turbo. Save nitro for straights. Press gas when the last light comes on for a perfect start.

## Run it

The game uses ES modules, so open it through a local web server (opening the file directly won't work):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

To try it on your phone, connect it to the same Wi-Fi network and open `http://<your-computer-ip>:8000`. Installing the app and using tilt steering require **HTTPS**, so use the hosted version for those.

### Host it free (GitHub Pages)
Go to repo **Settings → Pages → Deploy from branch** and pick your branch and `/ (root)`. You'll get a public HTTPS link that you can install as an app.

### Publish to the App Store / Google Play
The game is a static web app, so you can wrap it with [Capacitor](https://capacitorjs.com/):
```bash
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init "Turbo Kart" com.yourname.turbokart --web-dir .
npx cap add android && npx cap add ios
npx cap open android   # build & sign in Android Studio
```
For Google Play only, a [Trusted Web Activity (Bubblewrap)](https://github.com/GoogleChromeLabs/bubblewrap) can package the hosted PWA directly.

## Project structure

```
index.html            UI shell: menus, HUD, touch controls
css/style.css         Responsive HUD/menu styles, safe-area aware
js/main.js            Renderer, themes, game loop, camera, effects, UI
js/track.js           Spline circuit, collision queries, road/curb/wall meshes
js/scenery.js         Sky, terrain, trees, stands, gantry, lamps, flags
js/kart.js            Kart model + arcade physics (drift, nitro, walls)
js/ai.js              Rival drivers
js/input.js           Keyboard, gamepad, touch and tilt input
js/hud.js             Speedometer, minimap, standings, messages
js/audio.js           Web Audio sound synthesis
js/effects.js         Particles, skid marks, speed lines
sw.js, manifest.webmanifest, icons/   PWA (installable, offline)
vendor/               three.js r169 + post-processing (MIT)
```

---

## 💰 How to sell and market Turbo Kart

### 1. Make money from it
- **Free to play with ads (the fastest way to earn):** submit it to web game portals that share ad revenue, such as **CrazyGames, Poki and GameDistribution**. Racing games do well there. Add their SDK for a rewarded ad that gives a **nitro refill** or doubles the race reward.
- **App stores:** use Capacitor (see above). Make it free with **rewarded video** and an **in-app purchase to remove ads** ($2.99). Rewarded ads earn more than banners and don't annoy players.
- **In-app purchases:** kart paint jobs, helmets, nitro flame colours, new tracks (city, desert, snow), and a **Season Pass** with weekly cups.
- **Premium option:** a $4.99 "Turbo Kart Deluxe" on **itch.io / Steam** with extra tracks, time trial with ghost replays, and online leaderboards.
- **Sponsorship:** the barrier panels are already sponsor slots. Sell them to local karting tracks, energy-drink brands or esports teams.

### 2. Position it
- **One-line pitch:** *"Asphalt-style kart racing that runs instantly in your browser. No download, 60 seconds to your first drift."*
- **Who it's for:** casual mobile racers aged 13–35, fans of Mario Kart and Asphalt, and office or school players on desktop.
- **What sets it apart:** you play instantly from a link, it's tiny (under 1 MB of game code), it works offline once installed, and the drifts feel great.

### 3. Get players
- **Short videos sell racing games:** post 10–20 second vertical clips on TikTok, Reels and YouTube Shorts. Good subjects: a Super Turbo drift, a last-corner overtake, a night race with bloom. Open with the action in the first second and put the link in your bio.
- **Challenge loop:** post *"Beat my 2:41 lap — link in bio"*. Comments and duets work as free promotion.
- **Communities:** r/WebGames, r/IndieGaming, r/threejs, r/gamedev (#screenshotsaturday), Discord game servers, Product Hunt and Hacker News ("Show HN: an Asphalt-style kart racer in 1 MB of JavaScript").
- **Store page:** an icon showing the kart mid-drift, the first screenshot showing nitro flames and speed lines, a 15-second trailer, and keywords like *kart racing, drift, nitro, offline racing game, car racing*.
- **Retention:** daily challenges, weekly time-trial leaderboards, and achievements like "First Win" and "Drift King". Players who come back are the ones who watch ads and buy things.
- **Partnerships:** offer local karting venues a co-branded version with their track for their lobby screens and social media. They pay, and their customers become your players.

### 4. Measure and improve
Track installs, Day-1 and Day-7 retention, races per session, ad views per player, and how many players buy something. Change one thing at a time (difficulty, reward size, ad frequency) and keep what improves retention.
