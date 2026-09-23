// SGS MinFinder palette — loosely borrowed from the British Columbia logo
// (deep navy + warm gold) without copying the official mark.

const navy = "#16365C";
const navyDeep = "#0E2444";
const gold = "#FCBA19";
const goldDim = "#C98F0C";

const colors = {
  light: {
    text: "#0E1A2B",
    tint: navy,

    background: "#F4F1EA",
    foreground: "#0E1A2B",

    card: "#FFFFFF",
    cardForeground: "#0E1A2B",

    primary: navy,
    primaryForeground: "#FFFFFF",

    secondary: "#E6DFCE",
    secondaryForeground: navy,

    muted: "#E6DFCE",
    mutedForeground: "#5F6B7A",

    accent: gold,
    accentForeground: navyDeep,

    destructive: "#B3261E",
    destructiveForeground: "#FFFFFF",

    border: "#D7CFBE",
    input: "#D7CFBE",

    // Status tones: strong text on a weak fill.
    success: "#1B6B3A",
    successSubtle: "#E3F1E7",
    warning: "#6B4700",
    warningSubtle: "#FFF1CC",
    danger: "#8C1D17",
    dangerSubtle: "#FBE4E2",

    // Controls floating on the map stay light in both schemes: the basemap is light.
    mapChrome: "#FFFFFF",
    mapChromeForeground: "#0E1A2B",
    mapChromeMuted: "#5F6B7A",
    scrim: "rgba(0,0,0,0.55)",

    // App-specific
    navy,
    navyDeep,
    gold,
    goldDim,
  },

  dark: {
    text: "#F4F1EA",
    tint: gold,

    background: navyDeep,
    foreground: "#F4F1EA",

    card: "#142A4A",
    cardForeground: "#F4F1EA",

    primary: gold,
    primaryForeground: navyDeep,

    secondary: "#1B3661",
    secondaryForeground: "#F4F1EA",

    muted: "#1B3661",
    mutedForeground: "#9BA9BD",

    accent: gold,
    accentForeground: navyDeep,

    destructive: "#E66A60",
    destructiveForeground: "#0E1A2B",

    border: "#1F3E70",
    input: "#1F3E70",

    success: "#8FD9A8",
    successSubtle: "#12321F",
    warning: "#F2C45A",
    warningSubtle: "#3A2C08",
    danger: "#F08A80",
    dangerSubtle: "#3D1714",

    mapChrome: "#FFFFFF",
    mapChromeForeground: "#0E1A2B",
    mapChromeMuted: "#5F6B7A",
    scrim: "rgba(0,0,0,0.55)",

    navy,
    navyDeep,
    gold,
    goldDim,
  },
};

export default colors;
