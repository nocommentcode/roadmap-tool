#!/usr/bin/env node
// Thin wrapper — the implementation lives in server/skills.mjs, next to its only
// caller, so the binary can never be shipped without it.
import { installSkills, WHY } from '../server/skills.mjs';

console.log(WHY);
installSkills();
