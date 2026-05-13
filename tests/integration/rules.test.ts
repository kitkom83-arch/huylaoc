import { describe, expect, it } from "vitest";
import { deriveOutcomes, matchStraightBet, validateStraightSelectionLength } from "@lottery/rules";

describe("P0 straight rules", () => {
  it("derives tail1-tail6 outcomes", () => {
    expect(deriveOutcomes("255480")).toEqual({
      tail1: "0",
      tail2: "80",
      tail3: "480",
      tail4: "5480",
      tail5: "55480",
      tail6: "255480"
    });
  });

  it("validates result_6d format", () => {
    expect(() => deriveOutcomes("25548")).toThrow();
    expect(() => deriveOutcomes("25548A")).toThrow();
  });

  it("validates straight selection length", () => {
    expect(validateStraightSelectionLength("TWO_STRAIGHT", "80")).toBe(true);
    expect(validateStraightSelectionLength("TWO_STRAIGHT", "8")).toBe(false);
    expect(validateStraightSelectionLength("SIX_STRAIGHT", "255480")).toBe(true);
  });

  it("matches straight win and loss", () => {
    expect(matchStraightBet("THREE_STRAIGHT", "480", "255480")).toBe(true);
    expect(matchStraightBet("THREE_STRAIGHT", "481", "255480")).toBe(false);
  });
});
