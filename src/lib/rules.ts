import rulesDatabase from "@/data/rules.json";
import type { RulesDatabase, SignalRule } from "./signal-types";

export const editableRulesDatabase = rulesDatabase as RulesDatabase;

export function getEditableRules(): SignalRule[] {
  return editableRulesDatabase.rules;
}
