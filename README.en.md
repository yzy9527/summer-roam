# <img src="src/favicon.svg" alt="Summer Roam icon" width="40" height="40"> Summer Roam

[简体中文](README.md) | [English](README.en.md)

Take your orange car for a leisurely drive through the summer countryside.

A 3D driving and exploration game built with Three.js. Follow country roads past canals, forests and houses, say hello to the animals, and discover what happens between the herd and the zombie camp.

**[Play online](https://game.biubiubiu.win)** · Best played in a desktop browser with a keyboard and mouse

![An orange car on a country road, with fields, forests and mountains ahead](docs/images/countryside-drive.jpg)

## Meet the animals

Park your car, then left-click an animal or point at it and press **E** to open its action menu. The herd, wolf and baola can be patted or touched, make a call, graze or sniff the ground, turn around, and rest at night.

| Animal | What to try |
| --- | --- |
| Mother cow | Responds to niulai's calls, approaches and touches noses for comfort; may chase the wolf after it bites niulai |
| Bull | Repeated pats make it angry: the second is a warning, and pats from the third onward can trigger a charge at your parked car; also protects the herd and charges nearby giant zombies |
| niulai (the calf) | Pats from the fourth onward can trigger a search for its mother; may be captured when separated from the herd, or escape home when the enclosure gate is opened |
| Wolf | Touching it may send it up the mountain or make it chase and bite niulai, drawing the mother cow into pursuit; choose to climb or descend through the action menu |
| baola (the leopard) | Choose to climb up or down the tree, and watch it rest on the branches; once niulai is enclosed, you can send it to deliver a bucket of milk |
| Shiro | Watch the dog walk, run, wag its tail, sit and stretch around the Nohara house |
| Goldfish | Swim slowly, flick their tails and turn in the canal; easier to spot from above |

## Stories at the camp

- **Capture and escape**: Select the capture cart and send it out to capture niulai. Watch the giant zombie lift niulai onto the cart and bring it back to camp. Opening the enclosure gate may lead to an escape, an alarm, a recapture attempt and a rescue by the bull. You can also select the giant zombie to carry or recapture niulai manually.
- **Milk delivery**: Once niulai is inside and the gate is closed, select baola and choose the action to deliver milk (**7**). It picks up the bucket, jumps over the fence so niulai can drink, then brings the empty bucket back.
- **Rice-field ploughing**: Once niulai is inside and the gate is closed, select the **worker beside the rice field** to start ploughing. The flagbearer leads niulai while the worker carries the plough, and the team heads into the field. You can end the task early; niulai returns to the enclosure afterward.

Animals and zombies follow their own routines, and some events happen at random. When an action is unavailable, its menu explains why; try again after the current task finishes.

## Controls

| Action | Input |
| --- | --- |
| Drive forward / reverse, steer | W / S, A / D, or arrow keys |
| Drift / brake | Shift + steering / Space |
| Select an object and open its action menu | Left-click, or point at the object and press E |
| Perform an action / close the menu | Click an action or press its number key / E or Esc |
| Rotate / zoom the camera | Right-click drag / mouse wheel |
| Restore the rear camera view / reset the car | C / R |
| Pause / resume | Esc while the action menu is closed |
| Toggle headlights / switch low and high beams | L / H (turn the lights on first) |

Clicking an animal only selects it. Enable sound effects and stay nearby to experience the interactions fully; some event chains depend on calls playing to completion. If your car blocks a gate, route or landing spot, a task may wait until you move it.

<details>
<summary>More screenshots</summary>

**Countryside animals**

![Cows, a wolf and a zombie in the countryside](docs/images/countryside-animals.png)

**Milk delivery**

![baola watches niulai drink inside the enclosure, with the milk bucket between them](docs/images/leopard-milk-delivery.jpg)

**Rice-field ploughing**

![The flagbearer leads niulai while the worker guides the wooden plough through the rice field](docs/images/rice-field-ploughing-close.jpg)

</details>

## Run locally

Requires Node.js ≥22.13.0.

```sh
npm ci
npm start
```

Open `http://localhost:5173/`. If the port is occupied, run `npm start -- --port 5174`.

## Development

```sh
npm run test:unit   # Quick regression checks
npm run verify     # Formatting, lint, full tests, build and release validation
npm run build
npm run preview
```

Further documentation (in Chinese):

- [Development guide](docs/development.md)
- [Deployment guide](docs/deployment.md)
- [Asset sources and licenses](assets-source/ASSETS.md)

## License

The project's own source code and asset creation scripts are licensed under the [MIT License](LICENSE). Third-party code, models, textures, audio and reference materials retain their respective licenses; the project's MIT License does not replace their permissions.

The asset inventory includes noncommercial licenses, the Sketchfab Standard license and materials whose permissions have not been confirmed. Confirm the applicable permissions for each asset before publicly distributing the complete game or its assets. Existing model and audio attribution files are retained in `src/assets/`.
