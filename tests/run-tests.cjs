"use strict";

const assert = require("node:assert/strict");
const P = require("../physics.js");
const D = require("../data.js");

function close(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} ± ${tolerance}, received ${actual}`);
}

const anchors = [
  { p: 1000, t: 20, td: 10 },
  { p: 850, t: 8, td: 2 },
  { p: 700, t: -4, td: -12 },
  { p: 500, t: -22, td: -35 },
  { p: 300, t: -45, td: -55 },
  { p: 100, t: -72, td: -80 },
];

const environment = P.buildEnvironment(anchors);
assert.equal(environment.surfacePressure, 1000);
assert.equal(environment.topPressure, 100);
assert.ok(environment.topHeight > 14000);
assert.ok(environment.levels.every((level, index, levels) => index === 0 ||
  (level.p < levels[index - 1].p && level.z > levels[index - 1].z)));

const at850 = P.environmentAtPressure(environment, 850);
close(at850.t, 8, 0.03, "log-pressure interpolation preserves anchor temperature");
close(P.pressureAtHeight(environment, at850.z), 850, 0.03, "pressure-height inversion");

const extendedEnvironment = P.buildEnvironment([
  { p: 1000, t: 20, td: 10 },
  { p: 100, t: -72, td: -80 },
  { p: 10, t: -44, td: -106 },
]);
assert.equal(extendedEnvironment.topPressure, 10);
assert.ok(extendedEnvironment.topHeight > environment.topHeight);
close(P.pressureAtHeight(extendedEnvironment, extendedEnvironment.topHeight), 10, 0.03,
  "environment preserves supplied data above the plotted domain");

const dryParcel = P.createParcel(900, 18, null, environment);
const dryTheta = dryParcel.tempK * (1000 / dryParcel.p) ** P.CONSTANTS.kappa;
P.evolveParcelToPressure(dryParcel, 700);
const liftedTheta = dryParcel.tempK * (1000 / dryParcel.p) ** P.CONSTANTS.kappa;
close(liftedTheta, dryTheta, 1e-8, "dry potential temperature conservation");
assert.equal(P.parcelDewpoint(dryParcel), null);
assert.equal(dryParcel.perfectlyDry, true);

const moistParcel = P.createParcel(900, 18, 18, environment);
const dryComparison = P.dryTemperatureAtPressure(moistParcel.tempK, 900, 700);
P.evolveParcelToPressure(moistParcel, 700);
assert.equal(moistParcel.saturated, true);
assert.ok(moistParcel.tempK > dryComparison, "saturated ascent should cool less than dry ascent");
close(P.parcelDewpoint(moistParcel), moistParcel.tempK - 273.15, 1e-10, "saturated T equals Td");

P.evolveParcelToPressure(moistParcel, 750);
assert.equal(moistParcel.saturated, false, "saturated sinking parcel becomes unsaturated");
assert.ok(P.parcelDewpoint(moistParcel) < moistParcel.tempK - 273.15);

const forcedParcel = P.createParcel(900, 20, 10, environment);
const initialHeight = forcedParcel.z;
forcedParcel.velocity = 12;
P.forceParcelUp(forcedParcel, environment, 100);
close(forcedParcel.z, initialHeight + 100, 0.01, "forced lift distance");
assert.equal(forcedParcel.velocity, 0);

const downwardParcel = P.createParcel(700, 0, 0, environment);
const downwardStartHeight = downwardParcel.z;
downwardParcel.velocity = -12;
P.forceParcelDown(downwardParcel, environment, 100);
close(downwardParcel.z, downwardStartHeight - 100, 0.01, "forced descent distance");
assert.equal(downwardParcel.velocity, 0);
assert.equal(downwardParcel.saturated, false, "forced descent makes a saturated parcel unsaturated");
P.forceParcelDown(downwardParcel, environment, 1e6);
assert.equal(downwardParcel.z, 0, "forced descent cannot pass below the surface");
close(downwardParcel.p, environment.surfacePressure, 1e-10, "surface pressure after forced descent");

const movingParcel = P.createParcel(850, 20, 10, environment);
movingParcel.velocity = 15;
const undampedBuoyancy = P.calculateBuoyancy(movingParcel, environment);
P.stepParcelDynamics(movingParcel, environment, 0.1);
close(movingParcel.acceleration, undampedBuoyancy, 1e-12,
  "default parcel acceleration has no velocity-damping term");

const wyomingCsv = `time,longitude,latitude,pressure_hPa,geopotential height_m,temperature_C,dew point temperature_C,ice point temperature_C,relative humidity_%,humidity wrt ice_%,mixing ratio_g/kg,wind direction_degree,wind speed_m/s
2026-07-22 11:16:53,-114.1092,53.5475,928.1,768,14.2,13.9,13.9,98,98,10.84,146,0.4
2026-07-22 11:43:00,-114.0000,53.5000,500.0,5600,-16.2,-22.5,-22.5,58,63,1.20,250,12.0
2026-07-22 12:18:00,-113.8000,53.4500,100.0,16400,-72.1,-79.5,-78.9,8,14,0.02,270,22.0
2026-07-22 13:18:44,-113.2944,53.4138,5.5,36112,-27.4,-73.1,-68.4,1,1,0.37,111,16.6`;
const csvPoints = D.parseSoundingText(wyomingCsv, "test.csv");
assert.equal(csvPoints.length, 4);
assert.deepEqual(csvPoints.map((point) => point.p), [928.1, 500, 100, 5.5]);
assert.deepEqual(csvPoints[0], { p: 928.1, t: 14.2, td: 13.9 });
assert.equal(P.buildEnvironment(csvPoints).topPressure, 5.5);

const jsonPoints = D.parseSoundingText(JSON.stringify({
  pressure: [100000, 90000, 80000],
  airTemperature: [293.15, 285.15, 277.15],
  dewpointTemperature: [285.15, 278.15, 270.15],
}), "test.json");
close(jsonPoints[0].p, 1000, 1e-10, "Pa-to-hPa conversion");
close(jsonPoints[0].t, 20, 1e-10, "K-to-C conversion");

console.log("All Skew-T physics and parser tests passed.");
