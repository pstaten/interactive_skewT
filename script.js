"use strict";

const P = window.SkewTPhysics;
const D = window.SkewTData;

const elements = {
  canvas: document.getElementById("skewCanvas"),
  presetSelect: document.getElementById("presetSelect"),
  loadPreset: document.getElementById("loadPresetButton"),
  soundingFile: document.getElementById("soundingFile"),
  dataStatus: document.getElementById("dataStatus"),
  sourceReadout: document.getElementById("sourceReadout"),
  surfaceReadout: document.getElementById("surfaceReadout"),
  topReadout: document.getElementById("topReadout"),
  levelReadout: document.getElementById("levelReadout"),
  pressureInput: document.getElementById("parcelPressureInput"),
  tempInput: document.getElementById("parcelTempInput"),
  dewpointInput: document.getElementById("parcelDewpointInput"),
  applyParcel: document.getElementById("applyParcelButton"),
  parcelTempButton: document.getElementById("parcelTempButton"),
  parcelDewpointButton: document.getElementById("parcelDewpointButton"),
  clearTemp: document.getElementById("clearTempButton"),
  clearDewpoint: document.getElementById("clearDewpointButton"),
  run: document.getElementById("runButton"),
  pause: document.getElementById("pauseButton"),
  fastForward: document.getElementById("fastForwardButton"),
  forceUp: document.getElementById("forceUpButton"),
  forceDown: document.getElementById("forceDownButton"),
  reset: document.getElementById("resetButton"),
  gridToggles: document.querySelectorAll("[data-grid-layer]"),
  cursorReadout: document.getElementById("cursorReadout"),
  simulationStatus: document.getElementById("simulationStatus"),
  parcelPressureReadout: document.getElementById("parcelPressureReadout"),
  parcelHeightReadout: document.getElementById("parcelHeightReadout"),
  parcelTempReadout: document.getElementById("parcelTempReadout"),
  parcelDewpointReadout: document.getElementById("parcelDewpointReadout"),
  parcelVelocityReadout: document.getElementById("parcelVelocityReadout"),
  parcelBuoyancyReadout: document.getElementById("parcelBuoyancyReadout"),
  parcelPhaseReadout: document.getElementById("parcelPhaseReadout"),
};

const plotSettings = Object.freeze({
  bottomPressure: 1050,
  topPressure: 100,
  skew: 30,
  xMin: -58,
  xMax: 82,
});

const simulationSettings = Object.freeze({
  normalTimeScale: 50,
  fastForwardMultiplier: 10,
  forcedMotionSpeed: 1100,
});

const state = {
  environment: null,
  sourceName: "",
  placementMode: null,
  hover: null,
  setup: { p: null, t: null, td: null },
  parcel: null,
  simulationMode: "idle",
  simulationError: null,
  fastForward: false,
  forcingDirection: null,
  gridVisibility: {
    isotherms: true,
    isobars: true,
    dryAdiabats: true,
    saturatedAdiabats: true,
    mixingRatio: true,
  },
  trail: [],
  trailClock: 0,
  simulationClock: 0,
  backgroundCurves: null,
  lastMap: null,
};

function cssColor(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function formatSigned(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 0.5 * 10 ** -digits) return (0).toFixed(digits);
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function currentTimeScale() {
  return simulationSettings.normalTimeScale *
    (state.fastForward ? simulationSettings.fastForwardMultiplier : 1);
}

function setDataStatus(message, kind = "") {
  elements.dataStatus.textContent = message;
  elements.dataStatus.className = `status-message${kind ? ` is-${kind}` : ""}`;
}

function generateBackgroundCurves() {
  const pressureSamples = Array.from({ length: 110 }, (_, index) =>
    plotSettings.bottomPressure * Math.exp(
      Math.log(plotSettings.topPressure / plotSettings.bottomPressure) * index / 109
    ));

  const dry = [];
  for (let theta = 240; theta <= 450; theta += 10) {
    dry.push(pressureSamples.map((p) => ({ p, t: theta * (p / 1000) ** P.CONSTANTS.kappa - 273.15 })));
  }

  const moist = [];
  for (let startTempC = -20; startTempC <= 40; startTempC += 5) {
    const curve = [{ p: 1000, t: startTempC }];
    let previousPressure = 1000;
    let previousTemperature = startTempC + 273.15;
    for (const p of pressureSamples.filter((value) => value < 1000)) {
      previousTemperature = P.integrateMoistTemperature(previousTemperature, previousPressure, p);
      curve.push({ p, t: previousTemperature - 273.15 });
      previousPressure = p;
    }
    moist.push(curve);
  }

  const mixing = [0.4, 1, 2, 4, 6, 8, 12, 16, 20].map((gramsPerKg) => ({
    label: gramsPerKg,
    points: pressureSamples
      .filter((p) => p <= 1000)
      .map((p) => ({ p, t: P.dewpointFromMixingRatio(gramsPerKg / 1000, p) }))
      .filter((point) => Number.isFinite(point.t)),
  }));
  state.backgroundCurves = { pressureSamples, dry, moist, mixing };
}

function resetParcel() {
  state.placementMode = null;
  state.hover = null;
  state.setup = { p: null, t: null, td: null };
  state.parcel = null;
  state.simulationMode = "idle";
  state.simulationError = null;
  state.forcingDirection = null;
  state.trail = [];
  state.trailClock = 0;
  state.simulationClock = 0;
  updateUI();
}

function loadEnvironment(points, sourceName, message = "") {
  state.environment = P.buildEnvironment(points);
  state.sourceName = sourceName;
  resetParcel();
  elements.sourceReadout.textContent = sourceName;
  elements.sourceReadout.title = sourceName;
  elements.surfaceReadout.textContent = `${state.environment.surfacePressure.toFixed(0)} hPa`;
  const topDigits = state.environment.topPressure < 10 ? 1 : 0;
  elements.topReadout.textContent = `${state.environment.topPressure.toFixed(topDigits)} hPa`;
  elements.levelReadout.textContent = `${state.environment.anchors.length} given / ${state.environment.levels.length} interpolated`;
  elements.pressureInput.max = Math.floor(state.environment.surfacePressure);
  elements.pressureInput.min = Math.ceil(Math.max(plotSettings.topPressure, state.environment.topPressure));
  elements.pressureInput.value = Math.round(P.clamp(900, state.environment.topPressure, state.environment.surfacePressure));
  setDataStatus(message || "Profile loaded. Heights were recomputed upward from a 0 m surface.");
}

function loadPreset(key) {
  const preset = D.PRESETS[key] || D.PRESETS["summer-unstable"];
  loadEnvironment(preset.points, preset.name, `${preset.description} Heights were recomputed with the hypsometric equation.`);
}

function syncSetupFromParcel() {
  if (!state.parcel) return;
  state.setup.p = state.parcel.p;
  state.setup.t = state.parcel.tempK - 273.15;
  state.setup.td = P.parcelDewpoint(state.parcel);
}

function createParcelFromSetup() {
  if (!Number.isFinite(state.setup.p) || !Number.isFinite(state.setup.t)) {
    state.parcel = null;
    return;
  }
  if (Number.isFinite(state.setup.td)) state.setup.td = Math.min(state.setup.td, state.setup.t);
  state.parcel = P.createParcel(state.setup.p, state.setup.t, state.setup.td, state.environment);
  state.parcel.buoyancy = P.calculateBuoyancy(state.parcel, state.environment);
  state.simulationMode = "idle";
  state.simulationError = null;
  state.forcingDirection = null;
  state.trail = [];
  recordTrailPoint(true);
}

function setPlacementMode(mode) {
  if (state.simulationMode === "running") return;
  state.placementMode = state.placementMode === mode ? null : mode;
  state.hover = null;
  updateUI();
}

function clearTemperature() {
  if (state.simulationMode === "running") return;
  syncSetupFromParcel();
  state.setup.t = null;
  state.parcel = null;
  state.trail = [];
  state.simulationMode = "idle";
  state.simulationError = null;
  state.forcingDirection = null;
  state.placementMode = null;
  updateUI();
}

function clearDewpoint() {
  if (state.simulationMode === "running") return;
  syncSetupFromParcel();
  state.setup.td = null;
  if (Number.isFinite(state.setup.t)) createParcelFromSetup();
  state.placementMode = null;
  updateUI();
}

function applyPreciseParcel() {
  const p = Number(elements.pressureInput.value);
  const t = Number(elements.tempInput.value);
  const dewpointText = elements.dewpointInput.value.trim();
  const td = dewpointText === "" ? null : Number(dewpointText);
  if (!Number.isFinite(p) || !Number.isFinite(t) || (td !== null && !Number.isFinite(td))) {
    setDataStatus("Enter numeric pressure and temperature values; dewpoint may be blank.", "error");
    return;
  }
  state.setup.p = P.clamp(p, Math.max(plotSettings.topPressure, state.environment.topPressure), state.environment.surfacePressure);
  state.setup.t = t;
  state.setup.td = td === null ? null : Math.min(td, t);
  createParcelFromSetup();
  state.placementMode = null;
  setDataStatus(td !== null && td > t ? "Parcel applied at saturation; dewpoint was limited to temperature." : "Parcel applied from numeric entry.");
  updateUI();
}

function updateControlState() {
  const hasTemp = Number.isFinite(state.setup.t) || Boolean(state.parcel);
  const hasDewpoint = Number.isFinite(state.setup.td) || (state.parcel && !state.parcel.perfectlyDry);
  const running = state.simulationMode === "running";
  const paused = state.simulationMode === "paused";
  const terminalError = state.simulationMode === "error";

  elements.parcelTempButton.setAttribute("aria-pressed", String(state.placementMode === "temp"));
  elements.parcelDewpointButton.setAttribute("aria-pressed", String(state.placementMode === "dewpoint"));
  elements.parcelTempButton.disabled = running;
  elements.parcelDewpointButton.disabled = running;
  elements.clearTemp.disabled = !hasTemp || running;
  elements.clearDewpoint.disabled = !hasDewpoint || running;
  elements.run.disabled = !state.parcel || running || terminalError;
  elements.pause.disabled = !state.parcel || state.simulationMode === "idle" || terminalError;
  elements.pause.textContent = paused ? "Resume" : "Pause";
  elements.fastForward.setAttribute("aria-pressed", String(state.fastForward));
  elements.forceUp.disabled = !state.parcel || running || terminalError;
  elements.forceDown.disabled = !state.parcel || running || terminalError;
  elements.forceUp.classList.toggle("is-held", state.forcingDirection === "up");
  elements.forceDown.classList.toggle("is-held", state.forcingDirection === "down");
  elements.forceUp.setAttribute("aria-pressed", String(state.forcingDirection === "up"));
  elements.forceDown.setAttribute("aria-pressed", String(state.forcingDirection === "down"));
}

function updateReadouts() {
  const hasSimulationError = Boolean(state.simulationError);
  elements.simulationStatus.classList.toggle("is-error", hasSimulationError);
  elements.simulationStatus.setAttribute("aria-live", hasSimulationError ? "assertive" : "polite");
  if (state.parcel) {
    const parcel = state.parcel;
    const dewpoint = P.parcelDewpoint(parcel);
    elements.parcelPressureReadout.textContent = `${parcel.p.toFixed(1)} hPa`;
    elements.parcelHeightReadout.textContent = `${Math.round(parcel.z).toLocaleString()} m`;
    elements.parcelTempReadout.textContent = `${(parcel.tempK - 273.15).toFixed(1)} °C`;
    elements.parcelDewpointReadout.textContent = dewpoint === null ? "perfectly dry" : `${dewpoint.toFixed(1)} °C`;
    elements.parcelVelocityReadout.textContent = `${formatSigned(parcel.velocity, 1)} m s⁻¹`;
    elements.parcelBuoyancyReadout.textContent = `${formatSigned(parcel.buoyancy, 3)} m s⁻²`;
    elements.parcelPhaseReadout.textContent = parcel.saturated ? "saturated" : (parcel.perfectlyDry ? "dry / unsaturated" : "unsaturated");

    const abovePlot = parcel.p < plotSettings.topPressure;
    if (hasSimulationError) {
      elements.simulationStatus.textContent = state.simulationError;
    } else if (state.forcingDirection === "up") {
      elements.simulationStatus.textContent = abovePlot ?
        `Forcing above the plotted ${plotSettings.topPressure} hPa boundary; vertical velocity is held at zero.` :
        "Forcing upward; vertical velocity is held at zero.";
    } else if (state.forcingDirection === "down") {
      elements.simulationStatus.textContent = "Forcing downward; vertical velocity is held at zero.";
    } else if (state.simulationMode === "running") {
      const direction = parcel.velocity > 0.05 ? "rising" : parcel.velocity < -0.05 ? "sinking" : "nearly stationary";
      const speedLabel = state.fastForward ? " at 10× speed" : "";
      elements.simulationStatus.textContent = abovePlot ?
        `Running${speedLabel} above the plotted ${plotSettings.topPressure} hPa boundary: parcel is ${direction}.` :
        `Running${speedLabel}: parcel is ${direction}; acceleration follows virtual-temperature buoyancy.`;
    } else if (state.simulationMode === "paused") {
      elements.simulationStatus.textContent = abovePlot ?
        `Paused above the plotted ${plotSettings.topPressure} hPa boundary.` :
        "Paused. Resume, or hold a force button to move the parcel with zero velocity.";
    } else if (parcel.perfectlyDry) {
      elements.simulationStatus.textContent = "Ready. No dewpoint is set, so the parcel contains zero water vapor.";
    } else {
      elements.simulationStatus.textContent = "Ready. Run for free buoyant motion, or hold a force button while stopped.";
    }
  } else if (Number.isFinite(state.setup.td)) {
    elements.parcelPressureReadout.textContent = `${state.setup.p.toFixed(1)} hPa`;
    elements.parcelHeightReadout.textContent = `${Math.round(P.environmentAtPressure(state.environment, state.setup.p).z).toLocaleString()} m`;
    elements.parcelTempReadout.textContent = "not set";
    elements.parcelDewpointReadout.textContent = `${state.setup.td.toFixed(1)} °C`;
    elements.parcelVelocityReadout.textContent = "—";
    elements.parcelBuoyancyReadout.textContent = "—";
    elements.parcelPhaseReadout.textContent = "awaiting T";
    elements.simulationStatus.textContent = "Dewpoint placed. Set parcel temperature at the same pressure.";
  } else {
    elements.parcelPressureReadout.textContent = "—";
    elements.parcelHeightReadout.textContent = "—";
    elements.parcelTempReadout.textContent = "—";
    elements.parcelDewpointReadout.textContent = "—";
    elements.parcelVelocityReadout.textContent = "—";
    elements.parcelBuoyancyReadout.textContent = "—";
    elements.parcelPhaseReadout.textContent = "—";
    elements.simulationStatus.textContent = "Place a parcel temperature to begin.";
  }
}

function updateCursorReadout() {
  if (state.hover && state.placementMode) {
    const label = state.placementMode === "temp" ? "Parcel T" : "Parcel Td";
    elements.cursorReadout.textContent = `${label}: ${state.hover.t.toFixed(1)} °C at ${state.hover.p.toFixed(1)} hPa`;
  } else if (state.placementMode) {
    elements.cursorReadout.textContent = "Move over the diagram; click to place the marker.";
  } else {
    elements.cursorReadout.textContent = "Choose a parcel control, then point on the diagram.";
  }
}

function updateUI() {
  updateControlState();
  updateReadouts();
  updateCursorReadout();
}

function canvasSize() {
  const canvas = elements.canvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(320, rect.width || 800);
  const height = Math.max(450, rect.height || 600);
  const targetWidth = Math.round(width * dpr);
  const targetHeight = Math.round(height * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  return { width, height, dpr };
}

function plotMap(width, height) {
  const left = width < 520 ? 50 : 58;
  const right = width < 520 ? 17 : 28;
  const top = 18;
  const bottomMargin = width < 520 ? 52 : 48;
  const bottom = height - bottomMargin;
  const plotWidth = width - left - right;
  const plotHeight = bottom - top;
  const logBottom = Math.log(plotSettings.bottomPressure);
  const logTop = Math.log(plotSettings.topPressure);
  return {
    left,
    right: left + plotWidth,
    top,
    bottom,
    width: plotWidth,
    height: plotHeight,
    xCoord(xValue) {
      return left + (xValue - plotSettings.xMin) /
        (plotSettings.xMax - plotSettings.xMin) * plotWidth;
    },
    x(tempC, pressureHpa) {
      return this.xCoord(tempC + plotSettings.skew * Math.log(1000 / pressureHpa));
    },
    pressureFromY(y) {
      const fraction = P.clamp((y - top) / plotHeight, 0, 1);
      return Math.exp(logTop + fraction * (logBottom - logTop));
    },
    y(pressureHpa) {
      return top + (Math.log(pressureHpa) - logTop) /
        (logBottom - logTop) * plotHeight;
    },
    temperatureFromX(x, pressureHpa) {
      const xValue = plotSettings.xMin + (x - left) / plotWidth *
        (plotSettings.xMax - plotSettings.xMin);
      return xValue - plotSettings.skew * Math.log(1000 / pressureHpa);
    },
  };
}

function drawCurve(ctx, map, points, options = {}) {
  ctx.save();
  ctx.strokeStyle = options.color || "#999";
  ctx.lineWidth = options.width || 1;
  ctx.globalAlpha = options.alpha ?? 1;
  ctx.setLineDash(options.dash || []);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  let started = false;
  for (const point of points) {
    if (!Number.isFinite(point.t) || point.p < plotSettings.topPressure || point.p > plotSettings.bottomPressure) {
      started = false;
      continue;
    }
    const x = map.x(point.t, point.p);
    const y = map.y(point.p);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawAxesAndBackground(ctx, map, width, height) {
  const colors = {
    ink: cssColor("--ink", "#17202a"),
    muted: cssColor("--muted", "#5b6873"),
    line: cssColor("--line", "#c7d1d9"),
    soft: cssColor("--panel-soft", "#eef3f6"),
  };
  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(map.left, map.top, map.width, map.height);
  ctx.clip();

  const pressureTicks = [1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100];
  if (state.gridVisibility.isobars) {
    for (const pressure of pressureTicks) {
      const y = map.y(pressure);
      ctx.strokeStyle = pressure === 500 ? "#aab7c0" : "#dce3e8";
      ctx.lineWidth = pressure === 500 ? 1.2 : 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(map.left, y);
      ctx.lineTo(map.right, y);
      ctx.stroke();
    }
  }

  if (state.gridVisibility.isotherms) {
    for (let temperature = -110; temperature <= plotSettings.xMax; temperature += 10) {
      drawCurve(ctx, map, [
        { p: plotSettings.bottomPressure, t: temperature },
        { p: plotSettings.topPressure, t: temperature },
      ], {
        color: temperature === 0 ? "#7199bc" : "#ead7d3",
        width: temperature === 0 ? 1.35 : 0.8,
        alpha: temperature === 0 ? 0.95 : 0.75,
      });
    }
  }

  if (state.gridVisibility.dryAdiabats) {
    for (const curve of state.backgroundCurves.dry) {
      drawCurve(ctx, map, curve, { color: "#d0a05f", width: 0.8, alpha: 0.62 });
    }
  }
  if (state.gridVisibility.saturatedAdiabats) {
    for (const curve of state.backgroundCurves.moist) {
      drawCurve(ctx, map, curve, { color: "#65a784", width: 0.85, alpha: 0.66, dash: [5, 4] });
    }
  }
  if (state.gridVisibility.mixingRatio) {
    for (const curve of state.backgroundCurves.mixing) {
      drawCurve(ctx, map, curve.points, { color: "#6697a8", width: 0.7, alpha: 0.7, dash: [2, 4] });
    }
  }

  if (state.environment && state.environment.surfacePressure < plotSettings.bottomPressure) {
    const surfaceY = map.y(state.environment.surfacePressure);
    ctx.fillStyle = "rgba(108, 123, 134, 0.11)";
    ctx.fillRect(map.left, surfaceY, map.width, map.bottom - surfaceY);
    ctx.strokeStyle = "#778793";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(map.left, surfaceY);
    ctx.lineTo(map.right, surfaceY);
    ctx.stroke();
  }

  ctx.restore();
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(map.left, map.top, map.width, map.height);

  ctx.fillStyle = colors.muted;
  ctx.font = `${width < 520 ? 10 : 11}px system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (const pressure of pressureTicks) {
    ctx.fillText(String(pressure), map.left - 8, map.y(pressure));
  }

  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  const firstTemperatureTick = Math.ceil(plotSettings.xMin / 10) * 10;
  const lastTemperatureTick = Math.floor(plotSettings.xMax / 10) * 10;
  for (let temperature = firstTemperatureTick; temperature <= lastTemperatureTick; temperature += 10) {
    const x = map.x(temperature, 1000);
    if (x >= map.left - 4 && x <= map.right + 4) ctx.fillText(String(temperature), x, map.bottom + 9);
  }

  ctx.fillStyle = colors.ink;
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("temperature (°C)", map.left + map.width / 2, height - 20);
  ctx.save();
  ctx.translate(15, map.top + map.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  ctx.fillText("pressure (hPa)", 0, 0);
  ctx.restore();

  ctx.font = "10px system-ui, sans-serif";
  ctx.fillStyle = colors.muted;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  if (state.gridVisibility.mixingRatio) {
    for (const curve of state.backgroundCurves.mixing) {
      const labelPoint = curve.points.reduce((closest, point) =>
        Math.abs(point.p - 650) < Math.abs(closest.p - 650) ? point : closest, curve.points[0]);
      const x = map.x(labelPoint.t, labelPoint.p);
      const y = map.y(labelPoint.p);
      if (x > map.left + 5 && x < map.right - 5) ctx.fillText(`${curve.label}`, x + 2, y - 2);
    }
  }
}

function drawEnvironment(ctx, map) {
  if (!state.environment) return;
  const visible = state.environment.levels.filter((point) => point.p >= plotSettings.topPressure);
  const tempColor = cssColor("--temperature", "#b43b2f");
  const dewColor = cssColor("--dewpoint", "#19724b");

  ctx.save();
  ctx.beginPath();
  ctx.rect(map.left, map.top, map.width, map.height);
  ctx.clip();
  drawCurve(ctx, map, visible, { color: tempColor, width: 3 });
  drawCurve(ctx, map, visible.filter((point) => Number.isFinite(point.td)).map((point) => ({ p: point.p, t: point.td })), {
    color: dewColor,
    width: 2.6,
  });
  ctx.restore();

  const surface = visible[0];
  if (surface) {
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = tempColor;
    ctx.textAlign = "left";
    ctx.fillText("T", map.x(surface.t, surface.p) + 6, map.y(surface.p) - 4);
    if (Number.isFinite(surface.td)) {
      ctx.fillStyle = dewColor;
      ctx.textAlign = "right";
      ctx.fillText("Td", map.x(surface.td, surface.p) - 6, map.y(surface.p) - 4);
    }
  }
}

function drawTrail(ctx, map) {
  if (state.trail.length < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(map.left, map.top, map.width, map.height);
  ctx.clip();
  drawCurve(ctx, map, state.trail.map((point) => ({ p: point.p, t: point.t })), {
    color: cssColor("--parcel-temp", "#ef7d1a"), width: 2.2, alpha: 0.9,
  });
  const dewTrail = state.trail.filter((point) => Number.isFinite(point.td)).map((point) => ({ p: point.p, t: point.td }));
  if (dewTrail.length > 1) drawCurve(ctx, map, dewTrail, {
    color: cssColor("--parcel-dewpoint", "#7551a6"), width: 1.8, alpha: 0.85, dash: [5, 4],
  });
  ctx.restore();
}

function drawMarker(ctx, map, point, color, shape = "circle", ghost = false) {
  if (!point || !Number.isFinite(point.t) || !Number.isFinite(point.p) ||
      point.p < plotSettings.topPressure || point.p > plotSettings.bottomPressure) return;
  const x = map.x(point.t, point.p);
  const y = map.y(point.p);
  ctx.save();
  ctx.globalAlpha = ghost ? 0.68 : 1;
  ctx.fillStyle = color;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (shape === "diamond") {
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x + 7, y);
    ctx.lineTo(x, y + 7);
    ctx.lineTo(x - 7, y);
    ctx.closePath();
  } else {
    ctx.arc(x, y, 6.5, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawParcel(ctx, map) {
  const tempColor = cssColor("--parcel-temp", "#ef7d1a");
  const dewColor = cssColor("--parcel-dewpoint", "#7551a6");
  if (state.parcel) {
    drawMarker(ctx, map, { p: state.parcel.p, t: state.parcel.tempK - 273.15 }, tempColor, "circle");
    const td = P.parcelDewpoint(state.parcel);
    if (Number.isFinite(td)) drawMarker(ctx, map, { p: state.parcel.p, t: td }, dewColor, "diamond");
  } else if (Number.isFinite(state.setup.td)) {
    drawMarker(ctx, map, { p: state.setup.p, t: state.setup.td }, dewColor, "diamond");
  }

  if (state.hover && state.placementMode) {
    const color = state.placementMode === "temp" ? tempColor : dewColor;
    if ((state.placementMode === "temp" && Number.isFinite(state.setup.td)) ||
        (state.placementMode === "dewpoint" && Number.isFinite(state.setup.t))) {
      const y = map.y(state.hover.p);
      ctx.save();
      ctx.strokeStyle = "#7e8991";
      ctx.lineWidth = 1.3;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(map.left, y);
      ctx.lineTo(map.right, y);
      ctx.stroke();
      ctx.restore();
    }
    drawMarker(ctx, map, state.hover, color, state.placementMode === "temp" ? "circle" : "diamond", true);
  }
}

function drawPlot() {
  if (!state.environment || !state.backgroundCurves) return;
  const { width, height, dpr } = canvasSize();
  const ctx = elements.canvas.getContext("2d");
  const map = plotMap(width, height);
  state.lastMap = map;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawAxesAndBackground(ctx, map, width, height);
  drawEnvironment(ctx, map);
  drawTrail(ctx, map);
  drawParcel(ctx, map);
}

function pointerPosition(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function updateHover(event) {
  if (!state.placementMode || !state.lastMap) return;
  const point = pointerPosition(event);
  const map = state.lastMap;
  if (point.x < map.left || point.x > map.right || point.y < map.top || point.y > map.bottom) {
    state.hover = null;
    updateCursorReadout();
    return;
  }
  let pressure = map.pressureFromY(point.y);
  const fixedPressure = (state.placementMode === "temp" && Number.isFinite(state.setup.td)) ||
    (state.placementMode === "dewpoint" && Number.isFinite(state.setup.t));
  if (fixedPressure) pressure = state.setup.p;
  pressure = P.clamp(pressure, Math.max(plotSettings.topPressure, state.environment.topPressure), state.environment.surfacePressure);
  let temperature = map.temperatureFromX(point.x, pressure);
  if (state.placementMode === "dewpoint" && Number.isFinite(state.setup.t)) temperature = Math.min(temperature, state.setup.t);
  if (state.placementMode === "temp" && Number.isFinite(state.setup.td)) temperature = Math.max(temperature, state.setup.td);
  state.hover = { p: pressure, t: temperature };
  updateCursorReadout();
}

function placeHoverPoint() {
  if (!state.hover || !state.placementMode) return;
  if (state.placementMode === "temp") {
    state.setup.p = state.hover.p;
    state.setup.t = state.hover.t;
    if (Number.isFinite(state.setup.td)) state.setup.td = Math.min(state.setup.td, state.setup.t);
    createParcelFromSetup();
  } else {
    state.setup.p = state.hover.p;
    state.setup.td = state.hover.t;
    if (Number.isFinite(state.setup.t)) {
      state.setup.td = Math.min(state.setup.td, state.setup.t);
      createParcelFromSetup();
    }
  }
  state.placementMode = null;
  state.hover = null;
  updateUI();
}

function recordTrailPoint(force = false) {
  if (!state.parcel) return;
  const last = state.trail[state.trail.length - 1];
  if (!force && last && Math.abs(last.z - state.parcel.z) < 10) return;
  state.trail.push({
    p: state.parcel.p,
    z: state.parcel.z,
    t: state.parcel.tempK - 273.15,
    td: P.parcelDewpoint(state.parcel),
  });
}

function startRun() {
  if (!state.parcel || state.simulationMode === "error") return;
  state.forcingDirection = null;
  state.simulationMode = "running";
  updateUI();
}

function togglePause() {
  if (!state.parcel || state.simulationMode === "idle" || state.simulationMode === "error") return;
  state.simulationMode = state.simulationMode === "running" ? "paused" : "running";
  if (state.simulationMode === "running") state.forcingDirection = null;
  updateUI();
}

function toggleFastForward() {
  state.fastForward = !state.fastForward;
  updateUI();
}

function setForcing(direction, active) {
  const allowed = Boolean(active && state.parcel && state.simulationMode !== "running" && state.simulationMode !== "error");
  if (allowed) state.forcingDirection = direction;
  else if (state.forcingDirection === direction) state.forcingDirection = null;
  if (allowed) {
    state.parcel.velocity = 0;
    state.parcel.acceleration = 0;
  }
  updateControlState();
  updateReadouts();
}

function stopAtTopOfData() {
  if (!state.parcel || state.simulationMode === "error") return;
  const topPressure = state.environment.topPressure;
  const pressureDigits = topPressure < 10 ? 1 : 0;
  state.forcingDirection = null;
  state.simulationMode = "error";
  state.parcel.velocity = 0;
  state.parcel.acceleration = 0;
  state.simulationError = `Animation stopped: the parcel reached the top of the supplied sounding at ${topPressure.toFixed(pressureDigits)} hPa (${Math.round(state.environment.topHeight).toLocaleString()} m above the sounding surface). Environmental data are unavailable above this level.`;
  recordTrailPoint(true);
}

function bindHoldButton(button, start, stop) {
  let keyboardActive = false;
  button.addEventListener("pointerdown", (event) => {
    if (button.disabled || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    if (button.setPointerCapture) button.setPointerCapture(event.pointerId);
    start();
  });
  const stopPointer = (event) => {
    if (event) event.preventDefault();
    if (event && button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
    stop();
  };
  button.addEventListener("pointerup", stopPointer);
  button.addEventListener("pointercancel", stopPointer);
  button.addEventListener("lostpointercapture", stop);
  button.addEventListener("keydown", (event) => {
    if (button.disabled || keyboardActive || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    keyboardActive = true;
    start();
  });
  button.addEventListener("keyup", (event) => {
    if (!keyboardActive || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    keyboardActive = false;
    stop();
  });
  button.addEventListener("blur", () => {
    keyboardActive = false;
    stop();
  });
}

async function handleFileUpload() {
  const file = elements.soundingFile.files?.[0];
  if (!file) return;
  setDataStatus(`Reading ${file.name}…`, "loading");
  try {
    const points = await D.parseSoundingFile(file);
    loadEnvironment(points, file.name, `Loaded ${points.length} valid levels from ${file.name}. Heights were recomputed from the surface.`);
  } catch (error) {
    setDataStatus(error.message || "Could not read this sounding file.", "error");
  }
}

let dynamicsAccumulator = 0;
let lastTimestamp = performance.now();
function animationFrame(timestamp) {
  const elapsed = Math.min(0.08, Math.max(0, (timestamp - lastTimestamp) / 1000));
  lastTimestamp = timestamp;

  if (state.parcel && state.simulationMode === "running") {
    dynamicsAccumulator += elapsed * currentTimeScale();
    while (dynamicsAccumulator >= 0.05) {
      P.stepParcelDynamics(state.parcel, state.environment, 0.05);
      state.simulationClock += 0.05;
      state.trailClock += 0.05;
      if (state.trailClock >= 0.2) {
        recordTrailPoint();
        state.trailClock = 0;
      }
      dynamicsAccumulator -= 0.05;
      if (state.parcel.z >= state.environment.topHeight - 0.01) {
        stopAtTopOfData();
        dynamicsAccumulator = 0;
        break;
      }
    }
    if (state.simulationMode === "running" &&
        state.parcel.z <= 0.01 && state.parcel.buoyancy <= 0 && Math.abs(state.parcel.velocity) < 0.01) {
      state.simulationMode = "paused";
    }
  } else {
    dynamicsAccumulator = 0;
  }

  if (state.parcel && state.forcingDirection) {
    const forcedDistance = simulationSettings.forcedMotionSpeed * elapsed;
    if (state.forcingDirection === "up") P.forceParcelUp(state.parcel, state.environment, forcedDistance);
    else P.forceParcelDown(state.parcel, state.environment, forcedDistance);
    state.trailClock += elapsed;
    if (state.trailClock >= 0.12) {
      recordTrailPoint();
      state.trailClock = 0;
    }
    if (state.parcel.z >= state.environment.topHeight - 0.01) stopAtTopOfData();
    else if (state.parcel.z <= 0.01 && state.forcingDirection === "down") {
      recordTrailPoint(true);
      state.forcingDirection = null;
    }
  }

  updateControlState();
  updateReadouts();
  drawPlot();
  requestAnimationFrame(animationFrame);
}

elements.loadPreset.addEventListener("click", () => loadPreset(elements.presetSelect.value));
elements.presetSelect.addEventListener("change", () => loadPreset(elements.presetSelect.value));
elements.soundingFile.addEventListener("change", handleFileUpload);
elements.applyParcel.addEventListener("click", applyPreciseParcel);
elements.parcelTempButton.addEventListener("click", () => setPlacementMode("temp"));
elements.parcelDewpointButton.addEventListener("click", () => setPlacementMode("dewpoint"));
elements.clearTemp.addEventListener("click", clearTemperature);
elements.clearDewpoint.addEventListener("click", clearDewpoint);
elements.run.addEventListener("click", startRun);
elements.pause.addEventListener("click", togglePause);
elements.fastForward.addEventListener("click", toggleFastForward);
elements.reset.addEventListener("click", resetParcel);
elements.gridToggles.forEach((toggle) => {
  toggle.addEventListener("change", () => {
    state.gridVisibility[toggle.dataset.gridLayer] = toggle.checked;
    drawPlot();
  });
});
elements.canvas.addEventListener("pointermove", updateHover);
elements.canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== undefined && event.button !== 0) return;
  updateHover(event);
  placeHoverPoint();
});
elements.canvas.addEventListener("pointerleave", () => {
  state.hover = null;
  updateCursorReadout();
});
window.addEventListener("resize", drawPlot);
bindHoldButton(elements.forceUp, () => setForcing("up", true), () => setForcing("up", false));
bindHoldButton(elements.forceDown, () => setForcing("down", true), () => setForcing("down", false));

generateBackgroundCurves();
loadPreset("summer-unstable");
requestAnimationFrame(animationFrame);
