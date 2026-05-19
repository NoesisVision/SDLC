import { createTheme, type MantineColorsTuple } from "@mantine/core";

const noesisBlue: MantineColorsTuple = [
  "#e8f0ff",
  "#c6d9f7",
  "#9ebfef",
  "#74a4e8",
  "#4f8de2",
  "#1d4ed8",
  "#1843be",
  "#1338a4",
  "#0e2d8b",
  "#091f6e",
];

const noesisGreen: MantineColorsTuple = [
  "#e6fcee",
  "#c1f7d5",
  "#93f0b5",
  "#65e995",
  "#4ade80",
  "#2dd468",
  "#22b854",
  "#179c41",
  "#0c802e",
  "#05641c",
];

const noesisIndigo: MantineColorsTuple = [
  "#edeaff",
  "#d4cff8",
  "#b3abf2",
  "#9184ec",
  "#7262e7",
  "#4f46e5",
  "#4238cc",
  "#362bb3",
  "#291e9a",
  "#1c1280",
];

export const theme = createTheme({
  fontFamily: "Raleway, sans-serif",
  primaryColor: "noesisBlue",
  colors: {
    noesisBlue,
    noesisGreen,
    noesisIndigo,
    dark: [
      "#C1C2C5",
      "#A6A7AB",
      "#909296",
      "#5c5f66",
      "#373A40",
      "#2C2E33",
      "#111827",
      "#030712",
      "#020510",
      "#01030a",
    ],
  },
});
