const TAU = Math.PI * 2;
const innerSpeed = 2.5;

function randomSequence(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function createEffect(canvas) {
  const ctx = canvas.getContext("2d");
  const random = randomSequence(42);
  const stars = Array.from({ length: 104 }, () => ({
    x: random(),
    y: random(),
    phase: random() * TAU,
    size: .45 + random() * 1.25,
  }));
  const motes = Array.from({ length: 102 }, () => ({
    angle: random() * TAU,
    speed: .45 + random() * 1.45,
    distance: random(),
    tilt: .45 + random() * .55,
    phase: random() * TAU,
    size: .55 + random() * 1.32,
  }));
  const currents = Array.from({ length: 348 }, (_, index) => ({
    phase: random() * TAU,
    tilt: random() * Math.PI,
    axis: random() * TAU,
    velocity: (.51 + random() * 1.13) * (index % 3 === 0 ? -1 : 1),
    winding: (1.55 + random() * 2.7) * (index % 2 === 0 ? 1 : -1),
    offset: (random() - .5) * 1.65,
    span: .25 + random() * 1.21,
    radius: .53 + random() * .57,
    glint: random(),
  }));
  const turbulence = Array.from({ length: 1980 }, () => ({
    angle: random() * TAU,
    latitude: Math.asin(random() * 2 - 1),
    inclination: .57 + random() * .83,
    axis: (random() - .5) * 2.8,
    radius: .09 + .96 * random() ** .68,
    speed: 2.3 + random() * 3.5,
    length: .07 + random() * .13,
    brightness: .16 + random() * .56,
  })).map((strand, index) => ({
    ...strand,
    speed: strand.speed * (index % 3 === 0 ? -1 : 1),
    tiltSin: Math.sin(strand.inclination),
    tiltCos: Math.cos(strand.inclination),
    axisSin: Math.sin(strand.axis),
    axisCos: Math.cos(strand.axis),
  }));
  const wakes = Array.from({ length: 22 }, () => ({
    phase: random() * TAU,
    radius: 1.12 + random() * 1.57,
    tilt: .35 + random() * .58,
    speed: .42 + random() * .78,
    span: .75 + random() * 1.15,
  }));
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let width = 1;
  let height = 1;
  let dpr = 0;

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const scale = Math.min(2, window.devicePixelRatio || 1);
    if (width === bounds.width && height === bounds.height && dpr === scale) return;
    width = bounds.width;
    height = bounds.height;
    dpr = scale;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function circle(x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function gradient(x, y, r, stops) {
    const paint = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (const [offset, color] of stops) paint.addColorStop(offset, color);
    return paint;
  }

  function backdrop(time) {
    ctx.save();
    for (const star of stars) {
      ctx.globalAlpha = .16 + .24 * (1 + Math.sin(time * .6 + star.phase)) / 2;
      circle(star.x * width, star.y * height, star.size, "#66b7ff");
    }
    const x = width * .5;
    const y = height * .49;
    const ring = Math.min(width, height) * .34;
    ctx.translate(x, y);
    ctx.strokeStyle = "#5692c6";
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = [.22, .13, .16][i];
      ctx.setLineDash(i === 1 ? [2, 5] : []);
      ctx.beginPath();
      ctx.arc(0, 0, ring * (.83 + .18 * i), 0, TAU);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = .38;
    for (let i = 0; i < 72; i++) {
      const angle = i / 72 * TAU;
      const inner = ring * (i % 6 === 0 ? 1.05 : 1.075);
      const outer = ring * 1.10;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCurrent(flow, r, time, power) {
    const leanSin = Math.sin(flow.tilt);
    const leanCos = Math.cos(flow.tilt);
    const axisSin = Math.sin(flow.axis);
    const axisCos = Math.cos(flow.axis);
    const angle = flow.phase + time * flow.velocity;
    let previousX = 0;
    let previousY = 0;
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      const longitude = angle + t * flow.winding;
      const latitude = flow.offset + (t - .5) * flow.span + .15 * Math.sin(t * 8 + time * 1.6 + flow.phase);
      const arcRadius = Math.cos(latitude) * flow.radius;
      const x = Math.cos(longitude) * arcRadius;
      const y = Math.sin(latitude) * flow.radius;
      const z = Math.sin(longitude) * arcRadius;
      const tiltY = y * leanCos - z * leanSin;
      const depth = y * leanSin + z * leanCos;
      const scale = r * (1 + depth * .08);
      const nextX = (x * axisCos - tiltY * axisSin) * scale;
      const nextY = (x * axisSin + tiltY * axisCos) * scale;
      if (i > 0 && (i - 1) % 4 === 0) {
        const midpoint = (i + 1) / 32;
        const fade = Math.sin(midpoint * Math.PI) ** 1.35;
        const front = .22 + .78 * ((depth + 1.1) / 2.2) ** 1.7;
        const flicker = .74 + .26 * Math.sin(midpoint * 15 + angle * 2);
        ctx.globalAlpha = power * fade * front * flicker * (.105 + .16 * flow.glint);
        ctx.strokeStyle = depth > .30 && flow.glint > .53 ? "#c8f5ff" : flow.glint > .48 ? "#459fff" : "#2976ff";
        ctx.lineWidth = (.42 + 1.1 * flow.glint) * Math.max(.5, r / 114) * (.44 + fade * .56);
        ctx.beginPath();
        ctx.moveTo(previousX, previousY);
      }
      if (i > 0) ctx.lineTo(nextX, nextY);
      if (i > 0 && i % 4 === 0) ctx.stroke();
      previousX = nextX;
      previousY = nextY;
    }
  }

  function drawWake(wake, radius, energy, time) {
    const phase = wake.phase + time * wake.speed;
    const axis = Math.sin(wake.phase * 2) * .64;
    for (let segment = 0; segment < 4; segment++) {
      const progress = (segment + .5) / 4;
      ctx.globalAlpha = energy ** 1.5 * Math.sin(progress * Math.PI) * (wake.radius > 2 ? .12 : .26);
      ctx.strokeStyle = wake.radius > 2 ? "#93b8c8" : "#c9eafa";
      ctx.lineWidth = Math.max(.45, radius * (.004 + .004 * Math.sin(progress * Math.PI)));
      ctx.beginPath();
      for (let i = 0; i <= 8; i++) {
        const t = (segment + i / 8) / 4;
        const angle = phase + t * wake.span;
        const distance = radius * (wake.radius - t * .54);
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance * wake.tilt + Math.sin(angle * 2 + wake.phase) * radius * .19;
        const nextX = x * Math.cos(axis) - y * Math.sin(axis);
        const nextY = x * Math.sin(axis) + y * Math.cos(axis);
        if (i === 0) ctx.moveTo(nextX, nextY);
        else ctx.lineTo(nextX, nextY);
      }
      ctx.stroke();
    }
  }

  function drawTurbulence(radius, time, power, front) {
    const soft = new Path2D();
    const bright = new Path2D();
    for (const strand of turbulence) {
      const phase = strand.angle + time * strand.speed;
      const shell = strand.radius * radius;
      const orbit = Math.cos(strand.latitude) * shell;
      const height = Math.sin(strand.latitude) * shell;
      const depth = Math.sin(phase) * orbit * strand.tiltSin - height * strand.tiltCos;
      if ((depth >= 0) !== front) continue;

      const path = strand.brightness + .24 * Math.abs(depth / radius) > .53 ? bright : soft;
      for (let step = 0; step <= 4; step++) {
        const angle = phase + strand.length * step / 4;
        const x = Math.cos(angle) * orbit;
        const y = height * strand.tiltSin + Math.sin(angle) * orbit * strand.tiltCos;
        const nextX = x * strand.axisCos - y * strand.axisSin;
        const nextY = x * strand.axisSin + y * strand.axisCos;
        if (step === 0) path.moveTo(nextX, nextY);
        else path.lineTo(nextX, nextY);
      }
    }

    ctx.lineWidth = Math.max(.43, radius * (front ? .0052 : .0035));
    ctx.strokeStyle = front ? "#2cc7fc" : "#467cdb";
    ctx.globalAlpha = power * (front ? .31 : .16);
    ctx.stroke(soft);
    ctx.strokeStyle = front ? "#e2ffff" : "#67beff";
    ctx.globalAlpha = power * (front ? .43 : .22);
    ctx.stroke(bright);
  }

  function orb(x, y, r, energy, time, rotation) {
    const power = Math.min(1, .40 + energy * .65);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.lineCap = "round";
    for (const wake of wakes) drawWake(wake, r, energy, time);

    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = power;
    const glowRadius = r * 1.75;
    circle(0, 0, glowRadius, gradient(0, 0, glowRadius, [
      [0, "#13bfff5e"], [.48, "#008fff36"], [.69, "#168aff0e"], [1, "#1a5bff00"],
    ]));

    ctx.globalCompositeOperation = "source-over";
    circle(0, 0, r * 1.17, gradient(0, 0, r * 1.17, [
      [0, "#d9ffff"], [.13, "#a9faff"], [.31, "#41c8fff5"], [.56, "#086ecde8"],
      [.76, "#123f9acb"], [.92, "#127dd444"], [1, "#1452ff00"],
    ]));

    ctx.globalCompositeOperation = "lighter";
    const innerTime = time * innerSpeed;
    for (const flow of currents) drawCurrent(flow, r, innerTime * 2.05, power);

    drawTurbulence(r, innerTime, power, false);

    const hotX = Math.sin(time * 3.15) * r * .10;
    const hotY = Math.cos(time * 3.37) * r * .09;
    ctx.globalAlpha = power * (.27 + energy * .28);
    circle(hotX, hotY, r * .37, gradient(hotX, hotY, r * .37, [
      [0, "#ffffff"], [.27, "#ebffffd7"], [.59, "#56e0ff63"], [1, "#51bcff00"],
    ]));

    drawTurbulence(r, innerTime, power, true);

    const count = Math.ceil(motes.length * (.29 + energy * .71));
    for (let i = 0; i < count; i++) {
      const mote = motes[i];
      const progress = (mote.distance + time * mote.speed * .23) % 1;
      const angle = mote.angle + time * mote.speed + progress * 1.3;
      const distance = r * (.78 + progress * 1.12);
      const sx = Math.cos(angle) * distance;
      const sy = Math.sin(angle) * distance * mote.tilt;
      const flicker = .53 + .47 * Math.sin(time * 4 + mote.phase) ** 2;
      ctx.globalAlpha = Math.sin(progress * Math.PI) * flicker * power * .62;
      const size = mote.size * Math.max(.6, r / 125);
      circle(sx, sy, size, i % 3 === 0 ? "#c2f0ff" : "#4da9ff");
      if (i % 4 === 0) {
        ctx.lineWidth = size * .86;
        ctx.strokeStyle = "#488dff";
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.sin(angle) * size * 7, sy - Math.cos(angle) * size * 7);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  function placementRadius(energy) {
    return Math.min(width, height) * .20 * energy ** .82;
  }

  function clipBeyondHand(directionX, directionY, boundary) {
    const reach = Math.hypot(width, height) + Math.abs(boundary);
    const nearX = directionX * boundary;
    const nearY = directionY * boundary;
    const sideX = -directionY * reach;
    const sideY = directionX * reach;
    const farX = nearX + directionX * reach;
    const farY = nearY + directionY * reach;
    ctx.beginPath();
    ctx.moveTo(nearX + sideX, nearY + sideY);
    ctx.lineTo(nearX - sideX, nearY - sideY);
    ctx.lineTo(farX - sideX, farY - sideY);
    ctx.lineTo(farX + sideX, farY + sideY);
    ctx.closePath();
    ctx.clip();
  }

  return {
    placementRadius,
    draw({ x, y, energy, camera, timestamp, rotation = 0, scale = 1, lift = 0, sideways = 0, hand }) {
      const time = timestamp * .001 * (reduceMotion.matches ? .20 : 1);
      ctx.clearRect(0, 0, width, height);
      if (!camera) backdrop(time);
      if (energy <= .006) return;
      const radius = placementRadius(energy) * 2.5 * scale;
      const growth = Math.sqrt(energy);
      // Use the same smoothed size for the orb and its rise above the palm.
      const rise = camera ? radius * (.17 + .90 * growth + .32 * lift * (1 - growth)) : 0;
      const centerX = x * width;
      if (!camera || !hand) {
        orb(centerX, y * height - rise, radius, energy, time, rotation);
        return;
      }

      const turn = Math.min(1, Math.max(0, (Math.abs(sideways) - .26) / .52));
      const sideWeight = turn * turn * (3 - 2 * turn);
      const angle = sideWeight * Math.PI / 2;
      const directionX = Math.sign(sideways) * Math.sin(angle);
      const directionY = -Math.cos(angle);
      const centerY = y * height - rise * (1 - sideWeight);
      const palmMargin = hand.palmSize * (.18 - .10 * sideWeight);
      const distanceAlongPalm = point => directionX * point.x * width + directionY * point.y * height;
      const boundary = Math.max(...hand.guideOutline.map(distanceAlongPalm)) + palmMargin;
      // The raw outline only masks the effect. It does not pull the ball around.
      const clipBoundary = Math.max(...hand.outline.map(distanceAlongPalm)) + palmMargin;
      const separation = radius * (1.18 - .13 * sideWeight);
      const centerProjection = directionX * centerX + directionY * centerY;
      const shift = Math.max(0, boundary + separation - centerProjection);

      ctx.save();
      clipBeyondHand(directionX, directionY, clipBoundary);
      orb(centerX + directionX * shift, centerY + directionY * shift, radius, energy, time, rotation);
      ctx.restore();
    },
  };
}
