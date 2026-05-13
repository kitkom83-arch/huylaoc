import { betTypeDigits, type BetTypeCode, result6dSchema } from "@lottery/domain";

export interface DerivedOutcomes {
  tail1: string;
  tail2: string;
  tail3: string;
  tail4: string;
  tail5: string;
  tail6: string;
}

export interface RulePlugin {
  code: string;
  validateSelection(number: string): boolean;
  match(number: string, outcomes: DerivedOutcomes): boolean;
}

export function deriveOutcomes(result6d: string): DerivedOutcomes {
  result6dSchema.parse(result6d);
  return {
    tail1: result6d.slice(-1),
    tail2: result6d.slice(-2),
    tail3: result6d.slice(-3),
    tail4: result6d.slice(-4),
    tail5: result6d.slice(-5),
    tail6: result6d
  };
}

export function validateStraightSelectionLength(code: BetTypeCode, number: string): boolean {
  return new RegExp(`^\\d{${betTypeDigits[code]}}$`).test(number);
}

export function matchStraightBet(code: BetTypeCode, number: string, result6d: string): boolean {
  if (!validateStraightSelectionLength(code, number)) {
    return false;
  }
  const outcomes = deriveOutcomes(result6d);
  const outcomeKey = `tail${betTypeDigits[code]}` as keyof DerivedOutcomes;
  return number === outcomes[outcomeKey];
}

export const p0StraightPlugins: RulePlugin[] = Object.entries(betTypeDigits).map(([code, digits]) => ({
  code,
  validateSelection: (number: string) => new RegExp(`^\\d{${digits}}$`).test(number),
  match: (number: string, outcomes: DerivedOutcomes) => number === outcomes[`tail${digits}` as keyof DerivedOutcomes]
}));
