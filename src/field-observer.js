import { snapshotData } from './app/snapshot-data.js';
import * as THREE from 'three';
import { drivingHeight } from './world-queries.js';
import { VEHICLE_CONFIG } from './vehicle-config.js';

// Read-only diagnostics remain available in normal play for existing automation.
export function createFieldObserver({ readGame, getRenderer, getWheels, getField, getImpact }) {
  const frameTimes = [];
  let measureAfter = Infinity;
  function start() {
    measureAfter = performance.now() + 2000;
    frameTimes.length = 0;
  }
  function recordFrame(time, rawFrameMs, dt) {
    if (dt > 0 && time > measureAfter) {
      frameTimes.push(rawFrameMs);
      if (frameTimes.length > 240) frameTimes.shift();
    }
  }
  function snapshot() {
    const renderer = getRenderer(),
      wheels = getWheels(),
      field = getField();
    return snapshotData({
      ...readGame(),
      renderCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      threeRevision: THREE.REVISION,
      viewport: { width: innerWidth, height: innerHeight, pixelRatio: renderer.getPixelRatio() },
      performance: {
        samples: frameTimes.length,
        meanFrameMs: frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length,
        p95FrameMs: [...frameTimes].sort((a, b) => a - b)[Math.floor(frameTimes.length * 0.95)],
      },
      wheelGroundGaps: wheels.map((w) => {
        const p = w.steerGroup.getWorldPosition(new THREE.Vector3());
        return (
          p.y - VEHICLE_CONFIG.wheelRadius - (drivingHeight(p.x, p.z) + VEHICLE_CONFIG.groundOffset)
        );
      }),
      wheelMeshGroundGaps: wheels.map((w) => {
        const p = w.steerGroup.getWorldPosition(new THREE.Vector3()),
          bounds = new THREE.Box3().setFromObject(w.rollGroup, true);
        return bounds.min.y - (drivingHeight(p.x, p.z) + VEHICLE_CONFIG.groundOffset);
      }),
      vehicle: VEHICLE_CONFIG,
      wheelPivots: wheels.map((w) => ({
        front: w.front,
        position: w.steerGroup.position.toArray(),
        steer: w.steerGroup.rotation.y,
        roll: w.rollGroup.rotation.x,
      })),
      loading: { ...field.loading },
      animals: field.animals?.snapshot(),
      goldfish: field.goldfish?.snapshot(),
      zombies: field.zombies?.snapshot(),
      woodenCart: field.woodenCart?.snapshot(),
      corral: field.corral?.snapshot(),
      calfHeist: field.calfHeist?.snapshot(),
      calfRescue: field.calfRescue?.snapshot(),
      lookout: field.lookout?.snapshot(),
      paddyPloughing: field.paddyPloughing?.snapshot(),
      campsite: field.campsite?.snapshot(),
      family: field.animals?.family.snapshot(),
      encounters: field.animals?.encounters.snapshot(),
      mountain: field.animals?.mountain?.snapshot(),
      leopardTree: field.animals?.tree?.snapshot(),
      charge: field.animals?.charge.snapshot(),
      bullImpact: getImpact(),
      grass: field.summerGrass.snapshot(),
      assetWarnings: field.warnings,
    });
  }
  return { start, recordFrame, snapshot };
}
