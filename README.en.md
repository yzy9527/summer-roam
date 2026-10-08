# <img src="src/favicon.svg" alt="Summer Roam icon" width="40" height="40"> Summer Roam

[简体中文](README.md) | [English](README.en.md)

[Live Demo](https://game.biubiubiu.win)

A desktop 3D driving and countryside exploration game built with Three.js. Drive an orange car along country roads, canals, forests and houses, watch animals roam, and take part in camp activities, calf escapes and rescues, and rice-field ploughing.

## Screenshots

**Countryside animals**

![Cows, a wolf and a zombie in the countryside](docs/images/countryside-animals.png)

**Campsite enclosure**

![A calf, a wooden enclosure and a campfire at the campsite](docs/images/campsite-enclosure.png)

**Rice-field ploughing**

![A calf and ploughing workers in the rice field](docs/images/rice-field-ploughing.png)

## Run locally

Requires Node.js ≥22.13.0. Dependency versions are pinned in `package-lock.json`.

```sh
npm ci
npm start
```

Open `http://localhost:5173/`. If the port is occupied, run `npm start -- --port 5174`.

## Controls

| Action | Input |
| --- | --- |
| Drive forward / reverse | W / S or Up / Down arrow keys |
| Steer | A / D or Left / Right arrow keys |
| Drift / brake | Shift + steering / Space |
| Select an object and open its action menu | Left click or E |
| Perform an action | The number key shown in the action menu |
| Rotate / zoom the camera | Right-click drag / mouse wheel |
| Restore the rear camera view / reset the car | C / R |
| Pause / toggle headlights / switch low and high beams | Esc / L / H |

Start a ploughing task from the action menu of the worker beside the rice field. House music and animal sounds respond to distance, mute and pause settings.

## Develop and build

```sh
npm run test:unit   # Quick regression checks
npm test           # Full tests, including actual models and gameplay integration
npm run verify     # Formatting, lint, full tests, build and release validation
npm run build
npm run preview
```

To deploy, upload all files inside `dist/` and preserve their relative paths.

Further documentation is currently in Chinese:

- [Development guide](docs/development.md): directory layout, asset creation entry points and validation.
- [Deployment guide](docs/deployment.md): builds, asset versions and release budgets.
- [Asset sources and licenses](assets-source/ASSETS.md): provenance records for models, textures and audio.

## License

The project's own source code and asset creation scripts are licensed under the [MIT License](LICENSE). Third-party code, models, textures, audio and reference materials retain their respective licenses; the project's MIT License does not replace their permissions.

The asset inventory includes noncommercial licenses, the Sketchfab Standard license and materials whose permissions have not been confirmed. Confirm the applicable permissions for each asset before publicly distributing the complete game or its assets. Existing model and audio attribution files are retained in `src/assets/`.
