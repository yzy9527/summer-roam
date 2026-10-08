import * as THREE from 'three';

const ease = (t) => THREE.MathUtils.smoothstep(t, 0, 1);

// Art-directed flexible lash: a delayed travelling bend, with a fixed arc-length
// budget. Resampling a smooth loop avoids compressed segments buckling into zigzags.
export function createPaddyWhip(length = 2.45, segments = 24) {
  const points = Array.from({ length: segments + 1 }, () => new THREE.Vector3());
  const samples = Array.from({ length: 97 }, () => new THREE.Vector3());
  const offsets = samples.map(() => new THREE.Vector3());
  const distances = new Float64Array(samples.length);
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const tip = new THREE.Vector3();
  let phase = 0,
    energy = 0;
  return {
    curve,
    tip,
    update(dt, root, rump, heading, time, ground) {
      if (!(dt > 0)) return;
      const side = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
      const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
      const rest = root.clone().addScaledVector(side, -0.38).addScaledVector(forward, 0.14);
      rest.y = ground + 0.035;
      phase = time ?? phase + dt;
      energy = THREE.MathUtils.damp(
        energy,
        time === null ? 0 : ease(phase / 0.3) * (1 - ease((phase - 0.7) / 0.5)),
        14,
        dt,
      );
      const throwTip =
        time === null ? 0 : ease((phase - 0.38) / 0.22) * (1 - ease((phase - 0.7) / 0.48));
      tip.copy(rest).lerp(rump, throwTip);
      // Unreachable cows produce a miss, never a stretched cord or invented contact.
      if (tip.distanceTo(root) > length * 0.995)
        tip
          .sub(root)
          .setLength(length * 0.995)
          .add(root);
      for (let i = 0; i < samples.length; i++) {
        const u = i / (samples.length - 1);
        const wave = Math.sin(u * Math.PI * 2 - (phase - u * 0.17) * 13) * energy;
        offsets[i].copy(side).multiplyScalar(-1 + wave * 0.32);
        offsets[i].y = energy * 0.5 + wave * 0.18 - 0.16;
        offsets[i].multiplyScalar(Math.sin(Math.PI * u));
      }
      function measure(bow) {
        distances[0] = 0;
        for (let i = 0; i < samples.length; i++) {
          samples[i]
            .copy(root)
            .lerp(tip, i / (samples.length - 1))
            .addScaledVector(offsets[i], bow);
          samples[i].y = Math.max(ground + 0.02, samples[i].y);
          if (i) distances[i] = distances[i - 1] + samples[i].distanceTo(samples[i - 1]);
        }
        return distances[samples.length - 1];
      }
      let low = 0,
        high = length;
      for (let pass = 0; pass < 14; pass++) {
        const middle = (low + high) / 2;
        if (measure(middle) > length) high = middle;
        else low = middle;
      }
      const total = measure((low + high) / 2);
      let sample = 1;
      for (let i = 0; i <= segments; i++) {
        const distance = (total * i) / segments;
        while (sample < samples.length - 1 && distances[sample] < distance) sample++;
        const span = distances[sample] - distances[sample - 1];
        points[i]
          .copy(samples[sample - 1])
          .lerp(samples[sample], span > 0 ? (distance - distances[sample - 1]) / span : 0);
      }
    },
    snapshot: () => ({ length, points: points.map((p) => p.toArray()) }),
  };
}
