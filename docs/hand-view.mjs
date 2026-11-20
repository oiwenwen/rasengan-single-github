const quarterTurn = Math.PI / 2;
const searchAngles = [0, quarterTurn, -quarterTurn, Math.PI];

export function recoveryView(width, height, previousPoints, attempt) {
  const offset = searchAngles[attempt % searchAngles.length];
  const frameSize = Math.hypot(width, height);
  const fullFrame = { x: width / 2, y: height / 2, size: frameSize, angle: offset };
  if (!previousPoints || attempt % 3 === 2) return fullFrame;

  const wrist = previousPoints[0];
  const middle = previousPoints[9];
  const x = (wrist.x * .35 + middle.x * .65) * width;
  const y = (wrist.y * .35 + middle.y * .65) * height;
  const reach = Math.max(...previousPoints.map(point => Math.hypot(point.x * width - x, point.y * height - y)));
  const heading = Math.atan2((middle.y - wrist.y) * height, (middle.x - wrist.x) * width);
  return { x, y, size: Math.min(frameSize, Math.max(256, reach * 3.7)), angle: -quarterTurn - heading + offset };
}

export function restoreRecoveryLandmarks(result, view, width, height) {
  const points = result.landmarks?.[0];
  if (!points) return result;
  const { x, y, size, angle } = view;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const world = result.worldLandmarks?.[0];
  return {
    ...result,
    landmarks: [points.map(point => {
      const dx = (point.x - .5) * size;
      const dy = (point.y - .5) * size;
      return { x: (x + dx * cos + dy * sin) / width, y: (y - dx * sin + dy * cos) / height, z: point.z * size / width };
    })],
    worldLandmarks: world ? [world.map(point => ({
      x: point.x * cos + point.y * sin,
      y: -point.x * sin + point.y * cos,
      z: point.z,
    }))] : undefined,
  };
}

export function usableLandmarks(points) {
  return points?.length === 21 && points.every(point =>
    Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
  );
}
