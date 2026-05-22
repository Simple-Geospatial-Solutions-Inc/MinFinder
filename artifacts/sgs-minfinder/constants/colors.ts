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

    navy,
    navyDeep,
    gold,
    goldDim,
  },

  radius: 14,
};

export default colors;
