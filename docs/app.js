import { createEffect } from "./effect.js";
import { createHandMotion } from "./hand-motion.mjs";
import { chargeProgress, chargeStartedAt, measureHand } from "./hand.mjs";
import { recoveryView, restoreRecoveryLandmarks, usableLandmarks } from "./hand-view.mjs";

const element = (id) => document.getElementById(id);
const stage = element("stage");
const video = element("camera");
const previewMode = element("preview-mode");
const cameraMode = element("camera-mode");
const cameraAction = element("camera-action");
const slider = element("preview-energy");
const meter = element("meter");
const status = element("status");
const stageMessage = element("stage-message");
const gesture = element("gesture");
const energyValue = element("energy-value");
const effect = createEffect(element("effect"));
const handMotion = createHandMotion();
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const trackingGrace = 310;
const recoveryCanvas = document.createElement("canvas");
recoveryCanvas.width = recoveryCanvas.height = 448;
const recoveryContext = recoveryCanvas.getContext("2d", { alpha: false });

const preview = { x: .5, y: .49, energy: Number(slider.value) / 100, rotation: 0, scale: 1, lift: 0, sideways: 0, sideOffset: 0, upOffset: 0 };
const drawn = { ...preview };
let mode = "preview";
let request = 0;
let stream;
let modelPromise;
let model;
let createLandmarker;
let recoveryModel;
let recoveryModelPromise;
let recoveryAttempt = 0;
let lastRecovery = -Infinity;
let lastPoints;
let lastHandedness;
let tracked;
let lastSeen = -Infinity;
let lastVideoFrame = -1;
let lastDetection = -Infinity;
let lastTick = performance.now();
let lastPercentage = Number(slider.value);
let lastGesture = "";
let dragPointer;
let startedAt;

function setStatus(message, isError = false) {
  status.lastElementChild.textContent = message;
  status.dataset.error = String(isError);
}

function setMessage(message) {
  stageMessage.hidden = !message;
  stageMessage.textContent = message;
}

function setGesture(label) {
  if (label === lastGesture) return;
  lastGesture = label;
  gesture.hidden = !label;
  gesture.textContent = label;
}

function setMode(next) {
  mode = next;
  const isPreview = next === "preview";
  const isLive = next === "camera";
  stage.classList.toggle("live", isLive);
  previewMode.setAttribute("aria-pressed", String(isPreview));
  cameraMode.setAttribute("aria-pressed", String(!isPreview));
  cameraMode.disabled = next === "loading";
  cameraAction.disabled = next === "loading";
  cameraAction.dataset.active = String(isLive);
  element("camera-action-label").textContent = isLive ? "关闭摄像头" : next === "loading" ? "正在启动…" : "开启摄像头";
  element("camera-help").textContent = isLive ? "保持手掌张开约 2.6 秒即可蓄满，掌心朝上可托起球体。" : "开启摄像头，把一只手完整地伸进画面。";
  element("stage-mode").lastChild.nodeValue = isLive ? "摄像头实时画面" : "效果预览";
  element("stage-hint").textContent = isLive ? "一只手 · 张掌凝聚，端掌托起" : "拖动能量球，试试跟随效果";
  element("energy-hint").textContent = isLive ? "显示持续张掌的蓄力进度" : "拖动滑条，预览不同蓄力阶段";
  slider.hidden = !isPreview;
  meter.setAttribute("role", isPreview ? "presentation" : "meter");
  if (isPreview) {
    meter.removeAttribute("aria-labelledby");
    meter.removeAttribute("aria-valuenow");
  } else {
    meter.setAttribute("aria-labelledby", "energy-label");
    meter.setAttribute("aria-valuenow", String(lastPercentage));
  }
  setGesture("");
}

function releaseCamera() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
  video.srcObject = null;
  tracked = undefined;
  handMotion.reset();
  startedAt = undefined;
  lastSeen = -Infinity;
  lastVideoFrame = -1;
  lastRecovery = -Infinity;
  recoveryAttempt = 0;
  lastPoints = undefined;
  lastHandedness = undefined;
}

function showPreview(message = "", isError = false) {
  request++;
  releaseCamera();
  setMode("preview");
  setMessage("");
  setStatus(message || "画面仅在当前设备处理", isError);
  if (isError) status.scrollIntoView({ block: "nearest" });
}

function getModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const { FilesetResolver, HandLandmarker } = await import("./vision/vision_bundle.mjs");
      const resolver = await FilesetResolver.forVisionTasks(new URL("./vision/wasm", import.meta.url).href);
      createLandmarker = (runningMode, minHandDetectionConfidence, minHandPresenceConfidence) =>
        HandLandmarker.createFromOptions(resolver, {
          baseOptions: { modelAssetPath: new URL("./vision/hand_landmarker.task", import.meta.url).href },
          runningMode,
          numHands: 1,
          minHandDetectionConfidence,
          minHandPresenceConfidence,
          minTrackingConfidence: .50,
        });
      return createLandmarker("VIDEO", .55, .50);
    })().catch((error) => {
      modelPromise = undefined;
      throw error;
    });
  }
  return modelPromise;
}

function cameraErrorMessage(error) {
  switch (error.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "摄像头权限未开启。请在浏览器的站点设置中允许摄像头，再重试。";
    case "NotFoundError":
    case "OverconstrainedError":
      return "没有找到可用的摄像头。你仍可以使用效果预览。";
    case "NotReadableError":
    case "AbortError":
      return "摄像头暂时无法启动。关闭可能正在使用它的应用后再试。";
    default:
      return "手部追踪加载失败。可以重新点击开启摄像头，或先使用效果预览。";
  }
}

async function enableCamera() {
  if (mode !== "preview") return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showPreview("当前页面无法访问摄像头，请在支持摄像头的浏览器中通过 HTTPS 打开。", true);
    return;
  }
  const currentRequest = ++request;
  setMode("loading");
  setMessage("等待摄像头权限…");
  setStatus("请在浏览器提示中允许访问摄像头");
  try {
    const input = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "user" }, width: { ideal: 960 }, height: { ideal: 720 } },
    });
    if (currentRequest !== request) {
      input.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = input;
    video.srcObject = input;
    input.getVideoTracks()[0].addEventListener("ended", () => {
      if (currentRequest === request) showPreview("摄像头已断开，可以重新开启。", true);
    }, { once: true });
    setMessage("正在加载手部追踪…");
    setStatus("正在加载手部识别模型");
    const [, handLandmarker] = await Promise.all([video.play(), getModel()]);
    if (currentRequest !== request) return;
    model = handLandmarker;
    drawn.energy = 0;
    setMode("camera");
    setMessage("把一只手伸进画面");
    setStatus("摄像头已开启 · 画面仅在本地处理");
  } catch (error) {
    if (currentRequest !== request) return;
    console.warn("Camera startup failed", error);
    showPreview(cameraErrorMessage(error), true);
  }
}

function acceptLandmarks(result, timestamp) {
  const points = result.landmarks?.[0];
  if (!usableLandmarks(points)) return false;

  const age = timestamp - lastSeen;
  const continuous = tracked && age < trackingGrace;
  const reportedSide = result.handedness?.[0]?.[0]?.categoryName;
  const side = continuous ? lastHandedness ?? reportedSide : reportedSide;
  const world = result.worldLandmarks?.[0];
  const candidate = measureHand(
    points, usableLandmarks(world) ? world : undefined,
    video.videoWidth, video.videoHeight, stage.clientWidth, stage.clientHeight, side,
  );
  if (!Number.isFinite(candidate.palmSize) || candidate.palmSize < 7) return false;
  const outsideFrame = points[0].x < -.22 || points[0].x > 1.22 || points[0].y < -.22 || points[0].y > 1.22;
  if (outsideFrame) return false;

  if (continuous) {
    const distance = Math.hypot(
      (candidate.x - tracked.x) * stage.clientWidth, (candidate.y - tracked.y) * stage.clientHeight,
    );
    const limit = Math.max(stage.clientWidth, stage.clientHeight) * .24 + tracked.palmSize * .8;
    if (age < 150 && distance > limit) return false;
    const blend = 1 - Math.exp(-age / 63);
    candidate.opening = tracked.opening + (candidate.opening - tracked.opening) * blend;
  }

  handMotion.update(candidate, timestamp, stage.clientWidth, stage.clientHeight);
  tracked = candidate;
  lastPoints = points;
  lastHandedness = side;
  lastSeen = timestamp;
  recoveryAttempt = 0;
  return true;
}

function recoverHand(timestamp) {
  if (!recoveryContext) return;
  if (!recoveryModelPromise) {
    // The separate image model leaves the video model's temporal tracker intact.
    recoveryModelPromise = createLandmarker("IMAGE", .48, .48).then(model => {
      recoveryModel = model;
    }).catch(error => console.warn("Alternate-view hand detection unavailable", error));
  }
  if (!recoveryModel || timestamp - lastRecovery < 75) return;
  lastRecovery = timestamp;

  const { videoWidth: width, videoHeight: height } = video;
  const view = recoveryView(width, height, timestamp - lastSeen < 680 ? lastPoints : undefined, recoveryAttempt++);
  const size = recoveryCanvas.width;
  recoveryContext.setTransform(1, 0, 0, 1, 0, 0);
  recoveryContext.fillStyle = "#202020";
  recoveryContext.fillRect(0, 0, size, size);
  recoveryContext.translate(size / 2, size / 2);
  recoveryContext.scale(size / view.size, size / view.size);
  recoveryContext.rotate(view.angle);
  recoveryContext.drawImage(video, -view.x, -view.y);

  try {
    const result = recoveryModel.detect(recoveryCanvas);
    acceptLandmarks(restoreRecoveryLandmarks(result, view, width, height), timestamp);
  } catch (error) {
    recoveryModel.close();
    recoveryModel = undefined;
    console.warn("Alternate-view hand detection stopped", error);
  }
}

function detect(timestamp) {
  if (timestamp - lastDetection < 32 || video.readyState < 2 || video.currentTime === lastVideoFrame) return;
  lastVideoFrame = video.currentTime;
  lastDetection = timestamp;
  if (!acceptLandmarks(model.detectForVideo(video, timestamp), timestamp)) recoverHand(timestamp);
}

function updateEnergy(energy) {
  const value = Math.round(energy * 100);
  if (value === lastPercentage) return;
  lastPercentage = value;
  meter.style.setProperty("--energy", value + "%");
  energyValue.firstChild.nodeValue = String(value);
  if (mode !== "preview") meter.setAttribute("aria-valuenow", String(value));
}

function tick(timestamp) {
  const delta = clamp(timestamp - lastTick, 1, 80);
  lastTick = timestamp;
  let target = preview;
  let hand;
  let followingHand = false;
  if (mode === "camera") {
    try {
      detect(timestamp);
    } catch (error) {
      console.warn("Hand tracking stopped", error);
      showPreview("手部追踪已中断，可以尝试重新开启摄像头。", true);
    }
    if (mode === "camera") {
      const present = tracked && timestamp - lastSeen < trackingGrace;
      const motion = tracked ? handMotion.sample(timestamp) : undefined;
      if (tracked) hand = { ...tracked, guideOutline: motion.outline };
      startedAt = chargeStartedAt(present && !document.hidden ? tracked.opening : 0, timestamp, startedAt);
      const energy = chargeProgress(timestamp, startedAt);
      if (present) {
        followingHand = true;
        const scale = clamp(tracked.palmSize / (Math.min(stage.clientWidth, stage.clientHeight) * .33), .45, 1);
        const radius = effect.placementRadius(energy) * scale;
        const sideOffset = tracked.sideways * Math.min(radius * .42 + tracked.palmSize * .08, tracked.palmSize * .30);
        const upOffset = tracked.lift * tracked.palmSize * .16;
        target = {
          ...tracked,
          x: motion.x,
          y: motion.y,
          sideOffset: sideOffset / stage.clientWidth,
          upOffset: upOffset / stage.clientHeight,
          scale,
          sideways: tracked.sideways * (1 - Math.min(1, Math.abs(tracked.upward) * 1.35)),
          energy,
        };
      } else {
        target = { ...drawn, energy: 0 };
      }
      if (!present) setGesture("");
      else if (startedAt === undefined) setGesture(tracked.opening < .055 ? "握拳" : "继续张开");
      else setGesture(energy === 1 ? "蓄力完成" : "正在凝聚");
      const message = present ? "" : "把一只手伸进画面";
      if (stageMessage.textContent !== message) setMessage(message);
    }
  }
  const distance = Math.hypot(
    (target.x - drawn.x) * stage.clientWidth, (target.y - drawn.y) * stage.clientHeight,
  );
  const positionDelay = mode === "camera" ? 67 - 36 * Math.min(1, distance / 90) : 74;
  const positionBlend = 1 - Math.exp(-delta / positionDelay);
  const energyBlend = 1 - Math.exp(-delta / (target.energy < drawn.energy ? 59 : 82));
  drawn.sideways += (target.sideways - drawn.sideways) * positionBlend;
  drawn.lift += (target.lift - drawn.lift) * positionBlend;
  drawn.scale += (target.scale - drawn.scale) * positionBlend;
  drawn.sideOffset += (target.sideOffset - drawn.sideOffset) * positionBlend;
  drawn.upOffset += (target.upOffset - drawn.upOffset) * positionBlend;
  if (followingHand) {
    drawn.x = target.x;
    drawn.y = target.y;
  } else {
    drawn.x += (target.x - drawn.x) * positionBlend;
    drawn.y += (target.y - drawn.y) * positionBlend;
  }
  // The knuckle axis has the same orientation after a half turn.
  const angle = 2 * (target.rotation - drawn.rotation);
  drawn.rotation += Math.atan2(Math.sin(angle), Math.cos(angle)) * .5 * positionBlend;
  drawn.energy += (target.energy - drawn.energy) * energyBlend;
  if (target.energy === 0 && drawn.energy < .008) drawn.energy = 0;
  effect.draw({
    ...drawn, x: drawn.x + drawn.sideOffset, y: drawn.y - drawn.upOffset,
    camera: mode === "camera", timestamp, hand,
  });
  updateEnergy(drawn.energy);
  requestAnimationFrame(tick);
}

function movePreview(event) {
  const bounds = stage.getBoundingClientRect();
  preview.x = clamp((event.clientX - bounds.left) / bounds.width, .08, .92);
  preview.y = clamp((event.clientY - bounds.top) / bounds.height, .10, .90);
}

slider.addEventListener("input", () => {
  preview.energy = Number(slider.value) / 100;
});
previewMode.addEventListener("click", () => {
  if (mode !== "preview") showPreview();
});
cameraMode.addEventListener("click", () => void enableCamera());
cameraAction.addEventListener("click", () => {
  if (mode === "camera") showPreview();
  else void enableCamera();
});
stage.addEventListener("pointerdown", (event) => {
  if (mode !== "preview" || event.button !== 0 || dragPointer !== undefined) return;
  dragPointer = event.pointerId;
  stage.setPointerCapture(dragPointer);
  movePreview(event);
});
stage.addEventListener("pointermove", (event) => {
  if (mode === "preview" && event.pointerId === dragPointer) movePreview(event);
});
stage.addEventListener("lostpointercapture", (event) => {
  if (event.pointerId === dragPointer) dragPointer = undefined;
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) startedAt = undefined;
});
window.addEventListener("pagehide", () => {
  if (mode !== "preview") showPreview();
});

energyValue.setAttribute("aria-live", "off");
requestAnimationFrame(tick);
