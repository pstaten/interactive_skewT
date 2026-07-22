# Interactive Skew-T Parcel Lab

A dependency-free static HTML/CSS/JavaScript learning tool for plotting environmental soundings and following a buoyant air parcel on a Skew-T log-p diagram. The folder can be served locally or published directly with GitHub Pages.

## Run locally

From this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

No build step or package installation is required. Run the numerical/parser checks with:

```bash
node tests/run-tests.cjs
```

## What is implemented

- Four preset temperature/dewpoint profiles.
- A 1050–100 hPa plotting domain whose 1000 hPa temperature span is −58 to 82 °C.
- Uploads of the University of Wyoming archive's `TEXT:CSV` sounding files, including the standard time, location, pressure, height, temperature, dewpoint, humidity, and wind columns.
- Log-pressure interpolation of environmental temperature and dewpoint.
- Geopotential height recomputed upward from a zero-height surface by layerwise integration of the hypsometric equation using layer-mean virtual temperature.
- Mouse, touch, and numeric/keyboard parcel placement. Placing the second thermodynamic variable locks it to the first marker's pressure.
- Temperature and dewpoint markers may be cleared and replaced independently. Dewpoint is constrained not to exceed temperature, so supersaturation is not represented.
- Free motion with acceleration from virtual-temperature buoyancy and no velocity damping.
- Free-motion animation advances at 50 simulated seconds per real second.
- Unsaturated temperature follows a dry adiabat; unsaturated dewpoint follows a constant mixing-ratio line.
- Saturated rising parcels follow a pseudoadiabatic moist adiabat with `T = Td`. A saturated parcel that starts sinking immediately becomes unsaturated and follows a dry adiabat.
- Parcel temperature and dewpoint trajectories retain their complete history for the full animation.
- Parcels cannot move below the environmental surface. They may continue above the plotted 100 hPa boundary while sounding data remain available; reaching the highest supplied level stops the animation with an error instead of extrapolating the environment.
- Run, pause/resume, reset, and press-and-hold forced ascent or descent at 1,100 m s⁻¹. Forced motion always leaves vertical velocity at zero, and forced descent cannot pass below the surface.

## Sounding files

Download a sounding from the University of Wyoming archive in `TEXT:CSV` format and select it with the upload control. The importer recognizes the archive's `pressure_hPa`, `temperature_C`, and `dew point temperature_C` columns and ignores the time, location, reported height, humidity, and wind columns. Data above the plotted 100 hPa boundary are retained for off-plot parcel motion. Geopotential height is recalculated from the surface as required by the parcel model. A representative archive-format file is included at `sample-data/wyoming-text-csv-example.csv`.

The importer also retains compatibility with simple column CSV/text, profile JSON, and JSON produced by `bufr_dump -j`. Pressures in Pa and temperatures in K are converted automatically. If dewpoint is absent but relative humidity is present, dewpoint is calculated. See `sample-data/example-sounding.csv` for the simplest compatible format.

### Binary BUFR

BUFR is table-driven: a binary message depends on WMO master/local tables that change over time and may include center-specific descriptors. This static GitHub Pages version detects a real binary BUFR file and gives a precise conversion instruction rather than silently misreading it. Convert once with ECMWF ecCodes and upload the JSON:

```bash
bufr_dump -j sounding.bufr > sounding.json
```

The app accepts ordinary profile JSON as well:

```json
{
  "pressure": [100000, 90000, 80000],
  "airTemperature": [293.15, 285.15, 277.15],
  "dewpointTemperature": [285.15, 278.15, 270.15]
}
```

## Publish with GitHub Pages

1. Make this folder the root of a GitHub repository (or copy its contents to the repository root).
2. Push the files to the default branch.
3. In **Settings → Pages**, choose **Deploy from a branch**, then select the default branch and `/ (root)`.
4. Open the Pages URL after the deployment finishes.

All runtime code and styles are local. Sounding files are read in the student's browser and are not uploaded to a server.

## Model notes

- Moist thermodynamics use a numerical form of the pseudoadiabatic saturated lapse relation with fixed `Rd`, `Rv`, `Cp`, and `Lv`.
- “Perfectly dry” is represented by zero water-vapor mixing ratio. Its dewpoint is displayed as perfectly dry rather than assigning a finite absolute-zero dewpoint; mathematically, dewpoint approaches negative infinity as vapor pressure approaches zero.
- Buoyancy is `g(Tv,parcel − Tv,environment) / Tv,environment`. The diagram is an instructional parcel model, not an operational convection forecast.
