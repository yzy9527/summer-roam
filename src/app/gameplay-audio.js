export function connectGameplayAudio({ field, audio, getState, setImpact }) {
  field.animals.interactions.connectAudio(audio, {
    getCar: getState,
    onBite: field.animals.biteReaction,
    onImpact: (hit) => {
      const relative = hit.heading - getState().heading;
      setImpact({
        time: 0,
        side: Math.sin(relative),
        along: Math.cos(relative),
        flip: hit.flip,
        impacts: hit.impacts,
      });
    },
  });
  field.corral?.connectAudio(audio.corralSound);
  field.calfHeist?.connectAudio(audio.calfLiftSound);
  field.calfHeist?.connectGateSignalAudio(audio.gateSignalSound);
  field.calfHeist?.connectLookoutAudio(audio.lookoutSound);
  field.calfRescue?.connectAudio(audio.corralSound);
  field.paddyPloughing?.connectAudio(audio.paddyPloughSound);
  field.leopardMilk?.connectAudio(audio.milkSound);
}
