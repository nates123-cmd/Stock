/**
 * Confidence flags — spec §11. Tasks where Claude *infers* (not extracts)
 * return a confidence per field; the UI surfaces low confidence as italic +
 * muted "I guessed" styling (spec §6 review screen, §5 best-guess capture).
 */
export type Confidence = 'extracted' | 'parsed' | 'guessed';

export type Confidenced<T> = {
  value: T;
  confidence: Confidence;
  /** optional source provenance, e.g. "from page" / "all parsed" */
  note?: string;
};
