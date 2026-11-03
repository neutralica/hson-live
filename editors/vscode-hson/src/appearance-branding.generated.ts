// Generated from appearance.ts; edit the catalog and run themes:generate.
export const HSON_BRANDING = {
  "colors": {
    "blue": "#84a9d6",
    "yellow": "#bda065",
    "pink": "#dd97cc",
    "green": "#80a894"
  },
  "libraryOpacity": 1,
  "authoringOpacity": 0.7,
  "colorLibraryMarker": true,
  "identityMarkers": [
    {
      "publicName": "hson",
      "letter": "h",
      "colorId": "hson.libraryMarker.h",
      "colorSetting": "blue",
      "strength": "strong"
    },
    {
      "publicName": "hson",
      "letter": "s",
      "colorId": "hson.libraryMarker.s",
      "colorSetting": "yellow",
      "strength": "strong"
    },
    {
      "publicName": "hson",
      "letter": "o",
      "colorId": "hson.libraryMarker.o",
      "colorSetting": "pink",
      "strength": "strong"
    },
    {
      "publicName": "hson",
      "letter": "n",
      "colorId": "hson.libraryMarker.n",
      "colorSetting": "green",
      "strength": "strong"
    },
    {
      "publicName": "Hson",
      "letter": "H",
      "colorId": "hson.authoringMarker.h",
      "colorSetting": "blue",
      "strength": "soft"
    },
    {
      "publicName": "Hson",
      "letter": "s",
      "colorId": "hson.authoringMarker.s",
      "colorSetting": "yellow",
      "strength": "soft"
    },
    {
      "publicName": "Hson",
      "letter": "o",
      "colorId": "hson.authoringMarker.o",
      "colorSetting": "pink",
      "strength": "soft"
    },
    {
      "publicName": "Hson",
      "letter": "n",
      "colorId": "hson.authoringMarker.n",
      "colorSetting": "green",
      "strength": "soft"
    }
  ],
  "librarySeparator": {
    "colorId": "hson.libraryMarker.separator",
    "colorSetting": "librarySeparatorColor",
    "color": "#7247d4"
  }
} as const;
export type AppearanceColorKey = keyof typeof HSON_BRANDING.colors;
export const hsonIdentityMarkers = HSON_BRANDING.identityMarkers;
export const HSON_LIBRARY_SEPARATOR_COLOR_ID = HSON_BRANDING.librarySeparator.colorId;
