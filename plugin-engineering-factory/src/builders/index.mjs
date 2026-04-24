import { buildTabCsvWindowExport } from "./tabCsvWindowExport.mjs";
import { buildSingleProfileFormFill } from "./singleProfileFormFill.mjs";
import { buildGmailSnippet } from "./gmailSnippet.mjs";

export const SUPPORTED_BUILDERS = {
  tab_csv_window_export: buildTabCsvWindowExport,
  single_profile_form_fill: buildSingleProfileFormFill,
  gmail_snippet: buildGmailSnippet
};

export function getBuilder(archetype) {
  return SUPPORTED_BUILDERS[archetype] ?? null;
}

export function supportedFamilies() {
  return Object.keys(SUPPORTED_BUILDERS);
}
