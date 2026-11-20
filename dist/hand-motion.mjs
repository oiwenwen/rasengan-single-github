const mix = (start, end, fraction) => start + (end - start) * fraction;
const blendFor = (frequency, seconds) => 1 - Math.exp(-2 * Math.PI * frequency * seconds);

export function createHandMotion() {
  let previous;

  function update(pose, timestamp, width, height) {
    const offsets = pose.outline.map(point => ({ x: point.x - pose.x, y: point.y - pose.y }));
    if (!previous || timestamp - previous.timestamp > 150 || width !== previous.width || height !== previous.height) {
      previous = { rawX: pose.x, rawY: pose.y, x: pose.x, y: pose.y, vx: 0, vy: 0, offsets, timestamp, width, height };
      return;
    }

    const seconds = Math.max(.008, (timestamp - previous.timestamp) / 1000);
    const rawVx = (pose.x - previous.rawX) / seconds;
    const rawVy = (pose.y - previous.rawY) / seconds;
    const reversing = rawVx * previous.vx + rawVy * previous.vy <= 0;
    const velocityBlend = blendFor(reversing ? 12 : 5, seconds);
    // Require consistent motion before extrapolating; alternating noise must not be projected.
    const gain = reversing ? .24 : 1;
    const vx = mix(previous.vx, rawVx * gain, velocityBlend);
    const vy = mix(previous.vy, rawVy * gain, velocityBlend);
    const speed = Math.hypot(vx * width, vy * height) / Math.min(width, height);
    const positionBlend = blendFor(2.9 + Math.min(13, speed * 8), seconds);
    const shapeBlend = blendFor(4.4, seconds);

    previous = {
      rawX: pose.x,
      rawY: pose.y,
      x: mix(previous.x, pose.x, positionBlend),
      y: mix(previous.y, pose.y, positionBlend),
      vx,
      vy,
      offsets: offsets.map((point, index) => ({
        x: mix(previous.offsets[index].x, point.x, shapeBlend),
        y: mix(previous.offsets[index].y, point.y, shapeBlend),
      })),
      timestamp,
      width,
      height,
    };
  }

  function sample(timestamp) {
    const { x, y, vx, vy, offsets, width, height } = previous;
    const travelSpeed = Math.hypot(vx * width, vy * height);
    const moving = Math.max(0, 1 - 30 / Math.max(1, travelSpeed));
    const lead = Math.min(.046, Math.max(0, timestamp - previous.timestamp + 14) / 1000) * moving;
    const horizon = Math.min(lead, 22 / Math.max(1, travelSpeed));
    const centerX = x + vx * horizon;
    const centerY = y + vy * horizon;
    return {
      x: centerX,
      y: centerY,
      outline: offsets.map(point => ({ x: point.x + centerX, y: point.y + centerY })),
    };
  }

  return {
    update,
    sample,
    reset() { previous = undefined; },
  };
}
