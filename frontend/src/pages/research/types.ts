/**
 * Shared prop types for the research page sections. The theme colors are
 * derived once in ResearchPage (from useTheme) and passed down so every
 * section renders with identical values.
 */

export interface ResearchTheme {
  isDark: boolean;
  gold: string;
  textMuted: string;
  textSecondary: string;
  surface: string;
  border: string;
  greenColor: string;
  redColor: string;
}
