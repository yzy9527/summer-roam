export function bindCameraPointer(
  canvas,
  { isPlaying, getInspection, rotateOrbit, onSelect, onDrag },
) {
  let drag = null;
  // A fixed canvas cursor needs no scene picking or animation-frame polling.
  canvas.style.cursor = 'pointer';
  function cancel() {
    const previous = drag;
    drag = null;
    onDrag(null);
    if (previous && canvas.hasPointerCapture(previous.pointerId))
      canvas.releasePointerCapture(previous.pointerId);
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!isPlaying() || drag || (e.button !== 2 && e.button !== 0)) return;
    drag = {
      pointerId: e.pointerId,
      button: e.button,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    onDrag(drag);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!isPlaying()) return cancel();
    if (typeof e.buttons === 'number' && !(e.buttons & (drag.button === 2 ? 2 : 1)))
      return cancel();
    const crossed = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >= 6;
    drag.moved ||= crossed;
    if (drag.button !== 2 || !drag.moved) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y,
      inspection = getInspection();
    if (inspection?.active) {
      inspection.rotate(dx, dy);
    } else rotateOrbit(dx, dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pointerId || e.button !== drag.button) return;
    const select =
      isPlaying() &&
      drag.button === 0 &&
      !drag.moved &&
      Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6;
    cancel();
    if (select) onSelect(e);
  });
  for (const type of ['pointercancel', 'lostpointercapture'])
    canvas.addEventListener(type, (e) => {
      if (drag?.pointerId === e.pointerId) cancel();
    });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  return { cancel };
}
