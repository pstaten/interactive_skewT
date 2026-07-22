(function attachSkewTData(globalScope) {
  "use strict";

  const physics = globalScope.SkewTPhysics || (typeof require === "function" ? require("./physics.js") : null);

  const PRESETS = Object.freeze({
    "summer-unstable": {
      name: "Summer: unstable",
      description: "Warm, humid boundary layer beneath a conditionally unstable troposphere.",
      points: [
        { p: 1000, t: 30, td: 22 }, { p: 950, t: 27, td: 20 },
        { p: 900, t: 23, td: 18 }, { p: 850, t: 19, td: 15 },
        { p: 775, t: 12, td: 8 }, { p: 700, t: 5, td: -1 },
        { p: 600, t: -3, td: -12 }, { p: 500, t: -13, td: -25 },
        { p: 400, t: -25, td: -36 }, { p: 300, t: -40, td: -48 },
        { p: 200, t: -55, td: -64 }, { p: 150, t: -64, td: -72 },
        { p: 100, t: -72, td: -80 }, { p: 70, t: -68, td: -88 },
        { p: 50, t: -62, td: -92 }, { p: 30, t: -53, td: -96 },
        { p: 20, t: -48, td: -99 }, { p: 10, t: -42, td: -104 },
      ],
    },
    "winter-inversion": {
      name: "Winter: surface inversion",
      description: "Cold surface air capped by a shallow inversion and a stable lower troposphere.",
      points: [
        { p: 1020, t: -8, td: -10 }, { p: 980, t: -5, td: -8 },
        { p: 940, t: 0, td: -5 }, { p: 900, t: 2, td: -5 },
        { p: 850, t: 0, td: -7 }, { p: 775, t: -4, td: -11 },
        { p: 700, t: -9, td: -15 }, { p: 600, t: -17, td: -25 },
        { p: 500, t: -28, td: -37 }, { p: 400, t: -39, td: -48 },
        { p: 300, t: -51, td: -59 }, { p: 200, t: -61, td: -69 },
        { p: 100, t: -73, td: -82 }, { p: 70, t: -69, td: -90 },
        { p: 50, t: -64, td: -94 }, { p: 30, t: -56, td: -98 },
        { p: 20, t: -51, td: -101 }, { p: 10, t: -45, td: -106 },
      ],
    },
    "tropical-moist": {
      name: "Tropical: deep moisture",
      description: "A hot, nearly saturated boundary layer with moisture extending through the midlevels.",
      points: [
        { p: 1005, t: 29, td: 26 }, { p: 950, t: 26, td: 23 },
        { p: 900, t: 23, td: 21 }, { p: 850, t: 20, td: 18 },
        { p: 775, t: 15, td: 13 }, { p: 700, t: 10, td: 7 },
        { p: 600, t: 3, td: -1 }, { p: 500, t: -6, td: -11 },
        { p: 400, t: -17, td: -23 }, { p: 300, t: -33, td: -41 },
        { p: 200, t: -53, td: -62 }, { p: 150, t: -64, td: -73 },
        { p: 100, t: -76, td: -84 }, { p: 70, t: -73, td: -91 },
        { p: 50, t: -69, td: -95 }, { p: 30, t: -62, td: -100 },
        { p: 20, t: -57, td: -103 }, { p: 10, t: -50, td: -108 },
      ],
    },
    "high-plains-dry": {
      name: "High Plains: dry boundary layer",
      description: "A deep, hot mixed layer beginning at an elevated surface pressure.",
      points: [
        { p: 900, t: 33, td: 4 }, { p: 850, t: 28, td: 1 },
        { p: 800, t: 23, td: -3 }, { p: 700, t: 13, td: -13 },
        { p: 600, t: 3, td: -23 }, { p: 500, t: -9, td: -32 },
        { p: 400, t: -22, td: -42 }, { p: 300, t: -38, td: -52 },
        { p: 200, t: -54, td: -65 }, { p: 150, t: -63, td: -73 },
        { p: 100, t: -70, td: -81 }, { p: 70, t: -67, td: -89 },
        { p: 50, t: -63, td: -94 }, { p: 30, t: -58, td: -99 },
        { p: 20, t: -54, td: -102 }, { p: 10, t: -47, td: -107 },
      ],
    },
  });

  function cleanHeader(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function splitCsvLine(line) {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"') {
        if (quoted && line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (character === "," && !quoted) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += character;
      }
    }
    cells.push(cell.trim());
    return cells;
  }

  function indexForHeader(headers, candidates) {
    for (const candidate of candidates) {
      const exact = headers.indexOf(candidate);
      if (exact >= 0) return exact;
    }
    for (let index = 0; index < headers.length; index += 1) {
      if (candidates.some((candidate) => headers[index].includes(candidate))) return index;
    }
    return -1;
  }

  function convertPressure(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 2000 ? numeric / 100 : numeric;
  }

  function convertTemperature(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || Math.abs(numeric) > 1e20) return null;
    return numeric > 150 ? numeric - 273.15 : numeric;
  }

  function dewpointFromRelativeHumidity(tempC, relativeHumidity) {
    const rh = Number(relativeHumidity);
    if (!Number.isFinite(rh) || rh <= 0) return null;
    const vaporPressure = physics.saturationVaporPressure(tempC) * Math.min(rh, 100) / 100;
    const logRatio = Math.log(vaporPressure / 6.112);
    return (243.5 * logRatio) / (17.67 - logRatio);
  }

  function pointsFromRows(rows, headerCells) {
    const headers = headerCells.map(cleanHeader);
    const pIndex = indexForHeader(headers, ["pressurehpa", "pressuremb", "pressure", "pres", "noncoordinatepressure"]);
    const tIndex = indexForHeader(headers, ["temperaturec", "airtemperature", "temperature", "temp"]);
    const tdIndex = indexForHeader(headers, ["dewpointtemperaturec", "dewpointtemperature", "dewpoint", "dwpt", "td"]);
    const rhIndex = indexForHeader(headers, ["relativehumidity", "relh", "rh"]);
    if (pIndex < 0 || tIndex < 0) throw new Error("Could not find pressure and temperature columns in this file.");

    return rows.map((row) => {
      const p = convertPressure(row[pIndex]);
      const t = convertTemperature(row[tIndex]);
      let td = tdIndex >= 0 ? convertTemperature(row[tdIndex]) : null;
      if (!Number.isFinite(td) && rhIndex >= 0 && Number.isFinite(t)) td = dewpointFromRelativeHumidity(t, row[rhIndex]);
      return { p, t, td };
    });
  }

  function parseHtmlList(text) {
    const preMatch = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (!preMatch) throw new Error("The HTML file does not contain a Wyoming sounding table.");
    const lines = preMatch[1].replace(/&nbsp;/g, " ").split(/\r?\n/);
    const points = [];
    for (const line of lines) {
      const values = line.trim().split(/\s+/).map(Number);
      if (values.length >= 4 && Number.isFinite(values[0]) && values[0] > 0 && values[0] < 1200 &&
          Number.isFinite(values[2])) {
        points.push({ p: values[0], t: values[2], td: Number.isFinite(values[3]) ? values[3] : null });
      }
    }
    return points;
  }

  function parseDelimitedText(text) {
    const cleaned = text.replace(/^\uFEFF/, "").trim();
    if (!cleaned) throw new Error("The uploaded file is empty.");
    if (/<(?:html|pre)[\s>]/i.test(cleaned)) return parseHtmlList(cleaned);

    const lines = cleaned.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
    if (lines.length < 2) throw new Error("The uploaded sounding does not contain enough rows.");
    const commaSeparated = lines.slice(0, 4).some((line) => line.includes(","));
    const split = commaSeparated ? splitCsvLine : (line) => line.trim().split(/\s+/);
    const firstCells = split(lines[0]);
    const hasHeader = firstCells.some((cell) => /[A-Za-z]/.test(cell));

    if (hasHeader) {
      const rows = lines.slice(1).map(split);
      return pointsFromRows(rows, firstCells);
    }

    const rows = lines.map(split).map((row) => row.map(Number));
    return rows.map((row) => {
      if (row.length >= 4 && row[1] > 80) return { p: convertPressure(row[0]), t: convertTemperature(row[2]), td: convertTemperature(row[3]) };
      return { p: convertPressure(row[0]), t: convertTemperature(row[1]), td: convertTemperature(row[2]) };
    });
  }

  function findObjectArray(object, candidates) {
    const entries = Object.entries(object || {});
    for (const candidate of candidates) {
      const match = entries.find(([key, value]) => cleanHeader(key) === candidate && Array.isArray(value));
      if (match) return match[1];
    }
    return null;
  }

  function extractEcCodesValues(value, collections) {
    if (Array.isArray(value)) {
      value.forEach((entry) => extractEcCodesValues(entry, collections));
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.key === "string" && Object.prototype.hasOwnProperty.call(value, "value")) {
      const normalizedKey = cleanHeader(value.key.replace(/^#\d+#/, ""));
      const rawValues = Array.isArray(value.value) ? value.value : [value.value];
      if (!collections[normalizedKey]) collections[normalizedKey] = [];
      collections[normalizedKey].push(...rawValues);
    }
    Object.values(value).forEach((entry) => extractEcCodesValues(entry, collections));
  }

  function pointsFromJson(parsed) {
    if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === "object" && !Array.isArray(parsed[0])) {
      const headers = Object.keys(parsed[0]);
      return pointsFromRows(parsed.map((row) => headers.map((key) => row[key])), headers);
    }

    const pressure = findObjectArray(parsed, ["pressure", "pressurehpa", "noncoordinatepressure", "airpressure"]);
    const temperature = findObjectArray(parsed, ["temperature", "temperaturec", "airtemperature"]);
    const dewpoint = findObjectArray(parsed, ["dewpoint", "dewpointtemperature", "dewpointtemperaturec"]);
    if (pressure && temperature) {
      const count = Math.min(pressure.length, temperature.length);
      return Array.from({ length: count }, (_, index) => ({
        p: convertPressure(pressure[index]),
        t: convertTemperature(temperature[index]),
        td: dewpoint ? convertTemperature(dewpoint[index]) : null,
      }));
    }

    const collections = {};
    extractEcCodesValues(parsed, collections);
    const pValues = collections.pressure || collections.noncoordinatepressure || collections.airpressure;
    const tValues = collections.airtemperature || collections.temperature;
    const tdValues = collections.dewpointtemperature || collections.dewpoint;
    if (!pValues || !tValues) throw new Error("Could not find pressure and air-temperature values in this JSON file.");
    const count = Math.min(pValues.length, tValues.length);
    return Array.from({ length: count }, (_, index) => ({
      p: convertPressure(pValues[index]),
      t: convertTemperature(tValues[index]),
      td: tdValues ? convertTemperature(tdValues[index]) : null,
    }));
  }

  function finalizePoints(points) {
    const normalized = physics.normalizeSoundingPoints(points)
      .filter((point) => point.p >= 5 && point.p <= 1100);
    if (normalized.length < 2) throw new Error("No usable sounding levels were found between 5 and 1100 hPa.");
    return normalized;
  }

  function parseSoundingText(text, filename = "") {
    const looksJson = /\.json$/i.test(filename) || /^[\s\n]*[\[{]/.test(text);
    const points = looksJson ? pointsFromJson(JSON.parse(text)) : parseDelimitedText(text);
    return finalizePoints(points);
  }

  async function parseSoundingFile(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const signature = String.fromCharCode(...bytes.slice(0, 4));
    if (signature === "BUFR") {
      throw new Error("This is binary BUFR. Convert it with ecCodes (bufr_dump -j file.bufr > file.json), then upload the JSON. Browser-only GitHub Pages cannot bundle the full changing WMO table system safely.");
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return parseSoundingText(text, file.name);
  }

  const api = {
    PRESETS,
    parseDelimitedText,
    pointsFromJson,
    parseSoundingText,
    parseSoundingFile,
  };

  globalScope.SkewTData = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
