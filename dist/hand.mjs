const fingers = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const subtract = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z];
const length = (v) => Math.hypot(...v);
const alignment = (a, b) => clamp(
  (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.max(1e-8, length(a) * length(b)),
  -1,
  1,
);

export function measureHand(points, worldPoints, videoWidth, videoHeight, stageWidth, stageHeight, handedness) {
  const hand = worldPoints ?? points.map(({ x, y, z }) => ({ x, y: y * videoHeight / videoWidth, z }));
  const palmDirection = subtract(hand[9], hand[0]);
  const extensions = [];
  for (const [base, first, second, tip] of fingers) {
    const proximal = subtract(hand[first], hand[base]);
    const middle = subtract(hand[second], hand[first]);
    const distal = subtract(hand[tip], hand[second]);
    const limbLength = length(proximal) + length(middle) + length(distal);
    const reach = length(subtract(hand[tip], hand[base])) / Math.max(1e-8, limbLength);
    const joint = .5 + .36 * alignment(proximal, middle) + .14 * alignment(middle, distal);
    const direction = (1 + alignment(palmDirection, proximal)) / 2;
    extensions.push(.49 * reach + .34 * joint + .17 * direction);
  }
  // The middle two scores reduce the influence of a foreshortened or hidden finger.
  extensions.sort((a, b) => a - b);
  const extension = extensions.reduce((sum, score) => sum + score, 0) * .15
    + (extensions[1] + extensions[2]) * .20;
  const opening = clamp((extension - .54) / .405, 0, 1);

  const knuckleX = fingers.reduce((sum, [index]) => sum + points[index].x, 0) / fingers.length;
  const knuckleY = fingers.reduce((sum, [index]) => sum + points[index].y, 0) / fingers.length;
  const palmX = .36 * points[0].x + .64 * knuckleX;
  const palmY = .36 * points[0].y + .64 * knuckleY;
  const scale = Math.max(stageWidth / videoWidth, stageHeight / videoHeight);
  const paintedWidth = videoWidth * scale;
  const paintedHeight = videoHeight * scale;
  const x = .5 + (.5 - palmX) * paintedWidth / stageWidth;
  const y = .5 + (palmY - .5) * paintedHeight / stageHeight;
  const across = subtract(hand[17], hand[5]);
  const normal = [
    palmDirection[1] * across[2] - palmDirection[2] * across[1],
    palmDirection[2] * across[0] - palmDirection[0] * across[2],
    palmDirection[0] * across[1] - palmDirection[1] * across[0],
  ];
  const palmFacing = handedness === "Left" ? -1 : 1;
  const normalLength = Math.max(1e-8, length(normal));
  const upward = -palmFacing * normal[1] / normalLength;
  const sideways = -palmFacing * normal[0] / normalLength;
  const towardCamera = -palmFacing * normal[2] / normalLength;
  const acrossX = (points[5].x - points[17].x) * paintedWidth;
  const acrossY = (points[17].y - points[5].y) * paintedHeight;
  const alongX = (points[0].x - points[9].x) * paintedWidth;
  const alongY = (points[9].y - points[0].y) * paintedHeight;
  const palmSpan = Math.hypot(acrossX, acrossY);
  const palmLength = Math.hypot(alongX, alongY);
  const palmSize = Math.max(palmSpan, palmLength);
  const rotation = palmSpan >= palmLength * .32
    ? Math.atan2(acrossY, acrossX)
    : Math.atan2(alongY, alongX) + Math.PI / 2;
  const palmDepth = points[0].z * .35 + points[9].z * .65;
  const curledTowardCamera = fingers.reduce((sum, [, , , tip]) => (
    sum + Math.max(0, palmDepth - points[tip].z)
  ), 0) * paintedWidth / (fingers.length * Math.max(1, palmSize));
  const cradle = clamp((curledTowardCamera - .10) / .56, 0, 1) * Math.max(0, towardCamera) * opening;
  const tilt = clamp((upward - .08) / .71, 0, 1);
  const lift = Math.max(tilt * tilt * (3 - 2 * tilt), cradle * .85);
  const outline = points.map(point => ({
    x: .5 + (.5 - point.x) * paintedWidth / stageWidth,
    y: .5 + (point.y - .5) * paintedHeight / stageHeight,
  }));
  return { x, y, opening, lift, sideways, upward, palmSize, rotation, outline };
}

export function chargeStartedAt(opening, timestamp, startedAt) {
  // A lower release threshold prevents jitter during a steady open palm.
  const threshold = startedAt === undefined ? .68 : .54;
  if (opening < threshold) return undefined;
  return startedAt ?? timestamp;
}

export function chargeProgress(timestamp, startedAt) {
  return startedAt === undefined ? 0 : clamp((timestamp - startedAt) / 2600, 0, 1);
}
