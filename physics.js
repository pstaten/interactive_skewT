(function attachSkewTPhysics(globalScope) {
  "use strict";

  const CONSTANTS = Object.freeze({
    Rd: 287.05,
    Rv: 461.5,
    Cp: 1004.0,
    g: 9.80665,
    Lv: 2.5e6,
    epsilon: 0.622,
    kappa: 287.05 / 1004.0,
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function saturationVaporPressure(tempC) {
    const denominator = tempC + 243.5;
    if (Math.abs(denominator) < 1e-8) return 0;
    return 6.112 * Math.exp((17.67 * tempC) / denominator);
  }

  function mixingRatioFromVaporPressure(vaporPressureHpa, pressureHpa) {
    const e = clamp(vaporPressureHpa, 0, pressureHpa * 0.99);
    return CONSTANTS.epsilon * e / Math.max(pressureHpa - e, 1e-9);
  }

  function mixingRatioFromDewpoint(dewpointC, pressureHpa) {
    if (dewpointC === null || dewpointC === undefined || !Number.isFinite(dewpointC)) return 0;
    return mixingRatioFromVaporPressure(saturationVaporPressure(dewpointC), pressureHpa);
  }

  function saturationMixingRatio(tempK, pressureHpa) {
    return mixingRatioFromDewpoint(tempK - 273.15, pressureHpa);
  }

  function dewpointFromMixingRatio(mixingRatio, pressureHpa) {
    if (!Number.isFinite(mixingRatio) || mixingRatio <= 1e-12) return null;
    const e = mixingRatio * pressureHpa / (CONSTANTS.epsilon + mixingRatio);
    if (!(e > 0)) return null;
    const logarithm = Math.log(e / 6.112);
    return (243.5 * logarithm) / (17.67 - logarithm);
  }

  function virtualTemperature(tempK, mixingRatio) {
    const w = Math.max(0, Number.isFinite(mixingRatio) ? mixingRatio : 0);
    return tempK * (1 + w / CONSTANTS.epsilon) / (1 + w);
  }

  function dryTemperatureAtPressure(tempK, oldPressureHpa, newPressureHpa) {
    return tempK * Math.pow(newPressureHpa / oldPressureHpa, CONSTANTS.kappa);
  }

  function moistLogTemperatureSlope(tempK, pressureHpa) {
    const ws = saturationMixingRatio(tempK, pressureHpa);
    const numerator = 1 + (CONSTANTS.Lv * ws) / (CONSTANTS.Rd * tempK);
    const denominator = 1 + ws * (CONSTANTS.Lv ** 2) /
      (CONSTANTS.Rv * tempK ** 2 * CONSTANTS.Cp);
    return CONSTANTS.kappa * numerator / denominator;
  }

  function integrateMoistTemperature(tempK, oldPressureHpa, newPressureHpa) {
    if (Math.abs(newPressureHpa - oldPressureHpa) < 1e-9) return tempK;
    const totalLogPressureChange = Math.log(newPressureHpa / oldPressureHpa);
    const steps = Math.max(1, Math.ceil(Math.abs(totalLogPressureChange) / 0.002));
    const stepLogPressure = totalLogPressureChange / steps;
    let temperature = tempK;
    let pressure = oldPressureHpa;

    for (let index = 0; index < steps; index += 1) {
      const midpointPressure = pressure * Math.exp(stepLogPressure / 2);
      const firstSlope = moistLogTemperatureSlope(temperature, pressure);
      const midpointTemperature = temperature * Math.exp(firstSlope * stepLogPressure / 2);
      const midpointSlope = moistLogTemperatureSlope(midpointTemperature, midpointPressure);
      temperature *= Math.exp(midpointSlope * stepLogPressure);
      pressure *= Math.exp(stepLogPressure);
    }
    return temperature;
  }

  function interpolateLogPressure(lower, upper, pressureHpa, key) {
    if (Math.abs(lower.p - upper.p) < 1e-9) return lower[key];
    const fraction = (Math.log(pressureHpa) - Math.log(lower.p)) /
      (Math.log(upper.p) - Math.log(lower.p));
    const first = lower[key];
    const second = upper[key];
    if (!Number.isFinite(first) && !Number.isFinite(second)) return null;
    if (!Number.isFinite(first)) return second;
    if (!Number.isFinite(second)) return first;
    return first + fraction * (second - first);
  }

  function valueAtPressure(points, pressureHpa, key) {
    if (pressureHpa >= points[0].p) return points[0][key];
    if (pressureHpa <= points[points.length - 1].p) return points[points.length - 1][key];
    let low = 0;
    let high = points.length - 1;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (points[middle].p >= pressureHpa) low = middle;
      else high = middle;
    }
    return interpolateLogPressure(points[low], points[high], pressureHpa, key);
  }

  function normalizeSoundingPoints(rawPoints) {
    const valid = rawPoints
      .map((point) => ({
        p: Number(point.p),
        t: Number(point.t),
        td: point.td === null || point.td === undefined || point.td === "" ? null : Number(point.td),
      }))
      .filter((point) => Number.isFinite(point.p) && point.p > 0 &&
        Number.isFinite(point.t) && point.t > -150 && point.t < 80)
      .map((point) => ({
        p: point.p,
        t: point.t,
        td: Number.isFinite(point.td) ? Math.min(point.td, point.t) : null,
      }))
      .sort((a, b) => b.p - a.p);

    const unique = [];
    for (const point of valid) {
      const previous = unique[unique.length - 1];
      if (previous && Math.abs(previous.p - point.p) < 0.02) {
        previous.t = (previous.t + point.t) / 2;
        if (Number.isFinite(previous.td) && Number.isFinite(point.td)) previous.td = (previous.td + point.td) / 2;
        else if (Number.isFinite(point.td)) previous.td = point.td;
      } else {
        unique.push({ ...point });
      }
    }
    if (unique.length < 2) throw new Error("A sounding needs at least two valid pressure-temperature levels.");
    return unique;
  }

  function buildEnvironment(rawPoints, options = {}) {
    const anchors = normalizeSoundingPoints(rawPoints);
    const surfacePressure = anchors[0].p;
    const topPressure = anchors[anchors.length - 1].p;
    const logRange = Math.log(surfacePressure / topPressure);
    const count = Math.max(2, Math.ceil(logRange / (options.logPressureStep || 0.004)) + 1);
    const levels = [];

    for (let index = 0; index < count; index += 1) {
      const fraction = index / (count - 1);
      const p = surfacePressure * Math.exp(-logRange * fraction);
      const t = valueAtPressure(anchors, p, "t");
      const td = valueAtPressure(anchors, p, "td");
      const vaporMixingRatio = Number.isFinite(td) ? mixingRatioFromDewpoint(td, p) : 0;
      levels.push({ p, t, td, z: 0, tv: virtualTemperature(t + 273.15, vaporMixingRatio) });
    }

    for (let index = 1; index < levels.length; index += 1) {
      const below = levels[index - 1];
      const current = levels[index];
      const layerMeanVirtualTemperature = (below.tv + current.tv) / 2;
      current.z = below.z + CONSTANTS.Rd * layerMeanVirtualTemperature / CONSTANTS.g *
        Math.log(below.p / current.p);
    }

    return {
      anchors,
      levels,
      surfacePressure,
      topPressure,
      topHeight: levels[levels.length - 1].z,
    };
  }

  function environmentAtPressure(environment, pressureHpa) {
    const p = clamp(pressureHpa, environment.topPressure, environment.surfacePressure);
    const levels = environment.levels;
    if (p >= levels[0].p) return { ...levels[0] };
    if (p <= levels[levels.length - 1].p) return { ...levels[levels.length - 1] };
    let low = 0;
    let high = levels.length - 1;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (levels[middle].p >= p) low = middle;
      else high = middle;
    }
    return {
      p,
      t: interpolateLogPressure(levels[low], levels[high], p, "t"),
      td: interpolateLogPressure(levels[low], levels[high], p, "td"),
      z: interpolateLogPressure(levels[low], levels[high], p, "z"),
      tv: interpolateLogPressure(levels[low], levels[high], p, "tv"),
    };
  }

  function pressureAtHeight(environment, heightM) {
    const z = clamp(heightM, 0, environment.topHeight);
    const levels = environment.levels;
    if (z <= 0) return environment.surfacePressure;
    if (z >= environment.topHeight) return environment.topPressure;
    let low = 0;
    let high = levels.length - 1;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (levels[middle].z <= z) low = middle;
      else high = middle;
    }
    const fraction = (z - levels[low].z) / (levels[high].z - levels[low].z);
    return Math.exp(Math.log(levels[low].p) + fraction *
      (Math.log(levels[high].p) - Math.log(levels[low].p)));
  }

  function createParcel(pressureHpa, temperatureC, dewpointC, environment) {
    const p = clamp(pressureHpa, environment.topPressure, environment.surfacePressure);
    const t = Number(temperatureC);
    if (!Number.isFinite(t)) throw new Error("Parcel temperature must be a number.");
    const hasDewpoint = dewpointC !== null && dewpointC !== undefined && dewpointC !== "" && Number.isFinite(Number(dewpointC));
    const td = hasDewpoint ? Math.min(Number(dewpointC), t) : null;
    const qv = hasDewpoint ? mixingRatioFromDewpoint(td, p) : 0;
    const saturated = hasDewpoint && td >= t - 0.02;
    return {
      p,
      z: environmentAtPressure(environment, p).z,
      tempK: t + 273.15,
      qv,
      perfectlyDry: !hasDewpoint,
      saturated,
      velocity: 0,
      buoyancy: 0,
      acceleration: 0,
    };
  }

  function findLclPressure(parcel, targetPressureHpa) {
    let lower = targetPressureHpa;
    let upper = parcel.p;
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const middle = Math.sqrt(lower * upper);
      const middleTemp = dryTemperatureAtPressure(parcel.tempK, parcel.p, middle);
      const difference = saturationMixingRatio(middleTemp, middle) - parcel.qv;
      if (difference > 0) upper = middle;
      else lower = middle;
    }
    return Math.sqrt(lower * upper);
  }

  function evolveParcelToPressure(parcel, newPressureHpa) {
    const targetPressure = Math.max(1, newPressureHpa);
    if (Math.abs(targetPressure - parcel.p) < 1e-9) return parcel;
    const rising = targetPressure < parcel.p;

    if (!rising) {
      parcel.tempK = dryTemperatureAtPressure(parcel.tempK, parcel.p, targetPressure);
      parcel.p = targetPressure;
      parcel.saturated = false;
      return parcel;
    }

    if (parcel.saturated && !parcel.perfectlyDry) {
      parcel.tempK = integrateMoistTemperature(parcel.tempK, parcel.p, targetPressure);
      parcel.p = targetPressure;
      parcel.qv = saturationMixingRatio(parcel.tempK, parcel.p);
      return parcel;
    }

    const dryTargetTemperature = dryTemperatureAtPressure(parcel.tempK, parcel.p, targetPressure);
    const targetSaturationMixingRatio = saturationMixingRatio(dryTargetTemperature, targetPressure);
    if (parcel.perfectlyDry || parcel.qv <= targetSaturationMixingRatio * (1 + 1e-7)) {
      parcel.tempK = dryTargetTemperature;
      parcel.p = targetPressure;
      parcel.saturated = false;
      return parcel;
    }

    const lclPressure = findLclPressure(parcel, targetPressure);
    const lclTemperature = dryTemperatureAtPressure(parcel.tempK, parcel.p, lclPressure);
    parcel.tempK = integrateMoistTemperature(lclTemperature, lclPressure, targetPressure);
    parcel.p = targetPressure;
    parcel.qv = saturationMixingRatio(parcel.tempK, parcel.p);
    parcel.saturated = true;
    return parcel;
  }

  function parcelDewpoint(parcel) {
    if (!parcel || parcel.perfectlyDry) return null;
    if (parcel.saturated) return parcel.tempK - 273.15;
    return dewpointFromMixingRatio(parcel.qv, parcel.p);
  }

  function calculateBuoyancy(parcel, environment) {
    const environmental = environmentAtPressure(environment, parcel.p);
    const parcelMixingRatio = parcel.saturated ? saturationMixingRatio(parcel.tempK, parcel.p) : parcel.qv;
    const parcelVirtualTemperature = virtualTemperature(parcel.tempK, parcelMixingRatio);
    return CONSTANTS.g * (parcelVirtualTemperature - environmental.tv) / environmental.tv;
  }

  function stepParcelDynamics(parcel, environment, deltaTime, options = {}) {
    const dt = clamp(deltaTime, 0, 0.25);
    const damping = options.velocityDamping ?? 0;
    parcel.buoyancy = calculateBuoyancy(parcel, environment);
    parcel.acceleration = parcel.buoyancy - damping * parcel.velocity;
    const oldVelocity = parcel.velocity;
    parcel.velocity += parcel.acceleration * dt;
    const targetHeight = parcel.z + (oldVelocity + parcel.velocity) * 0.5 * dt;
    const boundedHeight = clamp(targetHeight, 0, environment.topHeight);
    const newPressure = pressureAtHeight(environment, boundedHeight);
    evolveParcelToPressure(parcel, newPressure);
    parcel.z = boundedHeight;

    if ((parcel.z <= 0 && parcel.velocity < 0) ||
        (parcel.z >= environment.topHeight && parcel.velocity > 0)) {
      parcel.velocity = 0;
      parcel.acceleration = 0;
    }
    parcel.buoyancy = calculateBuoyancy(parcel, environment);
    return parcel;
  }

  function forceParcelUp(parcel, environment, distanceM) {
    const targetHeight = clamp(parcel.z + Math.max(0, distanceM), 0, environment.topHeight);
    const newPressure = pressureAtHeight(environment, targetHeight);
    evolveParcelToPressure(parcel, newPressure);
    parcel.z = targetHeight;
    parcel.velocity = 0;
    parcel.acceleration = 0;
    parcel.buoyancy = calculateBuoyancy(parcel, environment);
    return parcel;
  }

  function forceParcelDown(parcel, environment, distanceM) {
    const targetHeight = clamp(parcel.z - Math.max(0, distanceM), 0, environment.topHeight);
    const newPressure = pressureAtHeight(environment, targetHeight);
    evolveParcelToPressure(parcel, newPressure);
    parcel.z = targetHeight;
    parcel.velocity = 0;
    parcel.acceleration = 0;
    parcel.buoyancy = calculateBuoyancy(parcel, environment);
    return parcel;
  }

  const api = {
    CONSTANTS,
    clamp,
    saturationVaporPressure,
    mixingRatioFromDewpoint,
    saturationMixingRatio,
    dewpointFromMixingRatio,
    virtualTemperature,
    dryTemperatureAtPressure,
    integrateMoistTemperature,
    normalizeSoundingPoints,
    buildEnvironment,
    environmentAtPressure,
    pressureAtHeight,
    createParcel,
    evolveParcelToPressure,
    parcelDewpoint,
    calculateBuoyancy,
    stepParcelDynamics,
    forceParcelUp,
    forceParcelDown,
  };

  globalScope.SkewTPhysics = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
