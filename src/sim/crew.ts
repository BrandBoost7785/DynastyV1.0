/**
 * Crew — employees, skills, loyalty, morale, payroll and betrayal (spec §20).
 *
 * People are the mechanism that turns a one-person hustle into an organisation:
 * they staff properties, run businesses, operate production lines, drive
 * shipments, fight beside you, and — because they are simulated rather than
 * scripted — they can be poached, injured, unpaid into resentment, or driven to
 * betray you. Loyalty and morale are the levers; payroll is the cost.
 *
 * Candidates are generated deterministically from the seed and the refresh day,
 * so a save always shows the same hiring pool.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { EMPLOYEE_ROLES, FIRST_NAMES, LAST_NAMES, ROLE_BY_ID, SKILL_BY_ID } from '../engine/registry/people';
import { getWorldRegistry } from '../engine/registry/world';
import { salaryReduction, loyaltyBonus, spanOfControlBonus } from './modifiers';
import { bumpCounter, counter, grantXp, playerModifiers, setCounter } from './progression';
import { addHeat, changeReputation } from './reputation';
import { recordObjective } from './missions';
import {
  computeNetWorth,
  debitCash,
  formatMoney,
  newId,
  pushDiagnostic,
  pushNotification,
  round2,
} from './state';
import type { EmployeeAssignment, EmployeeInstance, EmployeeRole, GameState, HiringCandidate, ID } from './types';
import { orderedEntries } from './ordering';

const B = getBalance();
const worldReg = getWorldRegistry();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ------------------------------------------------------------------ */
/* Candidate generation                                                */
/* ------------------------------------------------------------------ */

const OBJECTIVES = [
  'wants to buy a home for their family',
  'is paying off a sibling\u2019s debt',
  'wants to open their own operation one day',
  'is saving for medical treatment',
  'wants a reference from a serious operator',
  'is running from a previous employer',
  'wants to learn the trade properly',
  'is supporting relatives abroad',
  'wants a quiet job with no questions',
  'is ambitious and impatient',
];

export function generateCandidate(state: GameState, rng: Rng, roleId?: ID): HiringCandidate {
  const role = roleId ? ROLE_BY_ID[roleId] : rng.pick(EMPLOYEE_ROLES);
  const safeRole = role ?? EMPLOYEE_ROLES[0]!;
  const level = clamp(rng.int(1, 3) + Math.floor(state.player.progression.level / 9) + (rng.chance(0.12) ? rng.int(2, 6) : 0), 1, B.crew.maxLevel);
  const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
  const baseSalary = B.crew.salaryBaseByRole[safeRole.id] ?? 70;
  const skillQuality = clamp(0.4 + level * 0.055 + rng.float(-0.15, 0.2), 0.15, 0.99);
  const stats = {
    skill: Math.round(clamp(skillQuality * 100 * rng.float(0.85, 1.12), 8, 99)),
    loyalty: Math.round(clamp(B.crew.loyaltyBase + rng.gaussian(0, 14), 5, 96)),
    morale: Math.round(clamp(B.crew.moraleBase + rng.gaussian(0, 12), 10, 98)),
    health: Math.round(rng.float(78, 100)),
    initiative: Math.round(clamp(30 + skillQuality * 60 + rng.gaussian(0, 10), 5, 99)),
    toughness: Math.round(clamp(safeRole.category === 'security' ? 55 + skillQuality * 40 : 25 + skillQuality * 45 + rng.gaussian(0, 10), 5, 99)),
    discretion: Math.round(clamp(safeRole.category === 'diplomacy' || safeRole.id === 'hacker' ? 50 + skillQuality * 45 : 25 + skillQuality * 50 + rng.gaussian(0, 12), 5, 99)),
  };
  const salaryAskPerDay = round2(baseSalary * (1 + level * 0.075) * rng.float(0.88, 1.28) * (1 + state.world.inflationRate * 0.5));
  const skills: Record<ID, number> = { [safeRole.primarySkill]: clamp(Math.round(level * rng.float(0.8, 1.2)), 1, 30) };
  for (const secondary of safeRole.secondarySkills) {
    skills[secondary] = clamp(Math.round(level * rng.float(0.35, 0.8)), 1, 30);
  }
  return {
    id: newId(rng, 'cand'),
    name,
    role: safeRole.id as EmployeeRole,
    level,
    stats,
    salaryAskPerDay,
    hiringFee: round2(salaryAskPerDay * 30 * B.crew.hiringFeeFraction),
    skills,
    personalObjective: rng.pick(OBJECTIVES) ?? 'wants steady work',
    locationId: rng.chance(0.75) ? state.player.locationId : rng.pick(worldReg.locations)!.id,
    loyaltyExpectation: round2(clamp(stats.loyalty / 100 + rng.float(-0.1, 0.15), 0.05, 1)),
  };
}

export function refreshHiringPool(state: GameState, rng: Rng): number {
  const size = B.crew.hiringPoolSize;
  const pool: HiringCandidate[] = [];
  for (let i = 0; i < size; i += 1) {
    // A weighted mix: mostly local, occasionally a specialist from elsewhere.
    const specialist = rng.chance(0.18);
    const role = specialist
      ? rng.pick(EMPLOYEE_ROLES.filter((r) => r.category === 'technical' || r.category === 'finance' || r.category === 'diplomacy'))?.id
      : undefined;
    const candidate = generateCandidate(state, rng, role);
    pool.push(candidate);
  }
  state.player.hiringPool = pool;
  state.player.hiringPoolRefreshDay = state.world.day;
  return pool.length;
}

export function maybeRefreshHiringPool(state: GameState, rng: Rng): boolean {
  if (state.player.hiringPool.length === 0 || state.world.day - state.player.hiringPoolRefreshDay >= B.crew.poolRefreshDays) {
    refreshHiringPool(state, rng);
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Hiring and firing                                                   */
/* ------------------------------------------------------------------ */

export interface CrewActionResult {
  ok: boolean;
  reason?: string;
  employee?: EmployeeInstance;
  cost?: number;
}

export function hire(state: GameState, rng: Rng, candidateId: ID): CrewActionResult {
  const candidate = state.player.hiringPool.find((c) => c.id === candidateId);
  if (!candidate) return { ok: false, reason: 'That candidate is no longer available.' };
  const span = spanOfControl(state);
  if (state.player.crew.length >= span.capacity) {
    return {
      ok: false,
      reason: `You can only manage ${span.capacity} people directly. Hire a manager or raise your leadership skill to extend your span of control.`,
    };
  }
  if (candidate.locationId !== state.player.locationId) {
    return { ok: false, reason: `${candidate.name} is in ${worldReg.location(candidate.locationId)?.name ?? candidate.locationId}. Travel there or wait for the pool to refresh.` };
  }

  const mods = playerModifiers(state);
  const fee = round2(candidate.hiringFee * (1 - salaryReduction(mods) * 0.5));
  const salary = round2(candidate.salaryAskPerDay * (1 - salaryReduction(mods)));
  const move = debitCash(state, fee, {
    kind: 'hire',
    description: `Hired ${candidate.name} (${candidate.role}) — placement fee`,
    allowDirty: false,
    counterparty: candidate.name,
    meta: { role: candidate.role, level: candidate.level, salary },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? `The placement fee is ${formatMoney(fee)}.` };

  const employee: EmployeeInstance = {
    id: newId(rng, 'emp'),
    name: candidate.name,
    role: candidate.role,
    hiredDay: state.world.day,
    level: candidate.level,
    xp: 0,
    stats: { ...candidate.stats },
    salaryPerDay: salary,
    lastPaidDay: state.world.day,
    daysUnpaid: 0,
    assignment: null,
    skills: { ...candidate.skills },
    injured: false,
    injuredUntilDay: null,
    trainingUntilDay: null,
    betrayalRisk: round2(clamp((100 - candidate.stats.loyalty) / 320, 0, 0.5)),
    relationships: {},
    personalObjective: candidate.personalObjective,
    locationId: state.player.locationId,
    equipmentIds: [],
    status: 'active',
    contractEndDay: null,
  };
  state.player.crew.push(employee);
  state.player.hiringPool = state.player.hiringPool.filter((c) => c.id !== candidateId);

  bumpCounter(state, 'hires');
  setCounter(state, 'hiring_fees', round2(counter(state, 'hiring_fees') + fee));
  changeReputation(state, 'crew', 1.4, `Hired ${employee.name}`);
  grantXp(state, 24 + employee.level * 3, `Hired ${employee.name} as ${employee.role}`);
  recordObjective(state, 'hire_role', { roleId: employee.role, qty: 1 });

  pushNotification(state, {
    kind: 'success',
    title: `${employee.name} joined`,
    body: `${employee.role} (level ${employee.level}), ${formatMoney(salary)}/day. Skill ${employee.stats.skill}, loyalty ${employee.stats.loyalty}, morale ${employee.stats.morale}. ${employee.personalObjective[0]!.toUpperCase()}${employee.personalObjective.slice(1)}.`,
    link: '/game/crew',
    metrics: [
      { label: 'Placement fee', value: formatMoney(fee) },
      { label: 'Salary/day', value: formatMoney(salary) },
      { label: 'Skill', value: String(employee.stats.skill) },
    ],
  });
  return { ok: true, employee, cost: fee };
}

export function fire(state: GameState, employeeId: ID, severanceDays = 7): CrewActionResult {
  const employee = state.player.crew.find((e) => e.id === employeeId);
  if (!employee) return { ok: false, reason: 'No such employee.' };
  const severance = round2(employee.salaryPerDay * Math.max(0, severanceDays));
  if (severance > 0) {
    const move = debitCash(state, severance, {
      kind: 'wages',
      description: `Severance for ${employee.name} (${severanceDays} days)`,
      allowDirty: false,
      counterparty: employee.name,
    });
    if (!move.ok) return { ok: false, reason: move.reason ?? `Severance of ${formatMoney(severance)} is required.` };
  }

  const hostile = severanceDays < 7 || employee.stats.loyalty < 40;
  employee.status = 'departed';
  employee.assignment = null;
  state.player.crew = state.player.crew.filter((e) => e.id !== employeeId);
  detachFromTargets(state, employeeId);

  changeReputation(state, 'crew', hostile ? -5.5 : -1.5, hostile ? `Dismissed ${employee.name} without proper severance` : `Dismissed ${employee.name}`);
  if (hostile) {
    addHeat(state, 3.5, `A disgruntled former employee talked to people`);
    employee.stats.loyalty = 0;
    // They may take something with them.
    if (state.player.crew.length === 0 || hostile) {
      const stolen = round2(Math.min(computeNetWorth(state).cash * 0.02, employee.salaryPerDay * 12));
      if (stolen > 50) {
        debitCash(state, stolen, { kind: 'theft', description: `${employee.name} left with ${formatMoney(stolen)}`, allowDirty: true });
        pushNotification(state, {
          kind: 'danger',
          title: `${employee.name} left badly`,
          body: `They took ${formatMoney(stolen)} and your reputation as an employer suffered. Word travels in this labour market.`,
          link: '/game/crew',
        });
      }
    }
  }
  bumpCounter(state, 'firings');
  pushNotification(state, {
    kind: 'info',
    title: `${employee.name} let go`,
    body: `Severance ${formatMoney(severance)}. ${hostile ? 'The departure was not amicable.' : 'They left on good terms.'}`,
    link: '/game/crew',
  });
  return { ok: true, cost: severance };
}

function detachFromTargets(state: GameState, employeeId: ID): void {
  for (const business of state.player.businesses) {
    business.staffIds = business.staffIds.filter((id) => id !== employeeId);
    if (business.managerId === employeeId) business.managerId = null;
  }
  for (const line of state.player.productionLines) {
    line.workerIds = line.workerIds.filter((id) => id !== employeeId);
    if (line.managerId === employeeId) line.managerId = null;
  }
  for (const rule of state.player.automation) {
    if (rule.managerId === employeeId) rule.managerId = null;
  }
}

/* ------------------------------------------------------------------ */
/* Assignment, training, promotion                                     */
/* ------------------------------------------------------------------ */

export function assignEmployee(
  state: GameState,
  employeeId: ID,
  kind: EmployeeAssignment['kind'],
  targetId: ID,
  tier = 1,
  reportsTo: ID | null = null,
): { ok: boolean; reason?: string } {
  const employee = state.player.crew.find((e) => e.id === employeeId);
  if (!employee) return { ok: false, reason: 'No such employee.' };
  if (employee.injured || employee.status !== 'active') return { ok: false, reason: `${employee.name} is ${employee.status}${employee.injured ? ' and injured' : ''}.` };
  if (employee.trainingUntilDay !== null && employee.trainingUntilDay > state.world.day) {
    return { ok: false, reason: `${employee.name} is in training until day ${employee.trainingUntilDay}.` };
  }

  const target = validateAssignmentTarget(state, kind, targetId);
  if (!target.ok) return { ok: false, reason: target.reason };

  const role = ROLE_BY_ID[employee.role];
  const capability = role?.automationCapability ?? 'none';
  const mismatch = capabilityMismatch(kind, capability);
  if (mismatch) return { ok: false, reason: `${employee.name} (${employee.role}) cannot ${kind.replace('_', ' ')}: ${mismatch}` };

  detachFromTargets(state, employeeId);
  employee.assignment = { kind, targetId, tier, reportsTo };
  employee.locationId = locationOfTarget(state, kind, targetId) ?? employee.locationId;
  if (kind === 'business') {
    const business = state.player.businesses.find((b) => b.id === targetId);
    if (business) {
      business.staffIds.push(employeeId);
      if (capability === 'auto_business' && !business.managerId) business.managerId = employeeId;
    }
  }
  if (kind === 'production') {
    const line = state.player.productionLines.find((l) => l.id === targetId);
    if (line && !line.workerIds.includes(employeeId)) {
      const recipeWorkers = line.workerIds.length;
      line.workerIds.push(employeeId);
      void recipeWorkers;
    }
  }
  const property = state.player.properties.find((p) => p.id === targetId);
  if (property) property.staffed = true;

  pushDiagnostic(state, {
    system: 'crew',
    level: 'info',
    message: `Assigned ${employee.name} (${employee.role}) to ${kind}:${targetId} tier ${tier}`,
    data: { employeeId, kind, tier },
  });
  return { ok: true };
}

function capabilityMismatch(kind: EmployeeAssignment['kind'], capability: string): string | null {
  const map: Partial<Record<EmployeeAssignment['kind'], string[]>> = {
    business: ['auto_business', 'combat', 'none'],
    production: ['auto_production', 'none'],
    logistics: ['auto_logistics', 'none'],
    warehouse: ['auto_logistics', 'none'],
    trading: ['auto_trade', 'none'],
    finance: ['auto_finance', 'none'],
    security: ['combat', 'none'],
    intel: ['none'],
    manager_of_managers: ['auto_business', 'auto_trade', 'auto_finance', 'none'],
  };
  const allowed = map[kind];
  if (!allowed) return null;
  return allowed.includes(capability) ? null : `their capability is "${capability}"`;
}

function validateAssignmentTarget(state: GameState, kind: EmployeeAssignment['kind'], targetId: ID): { ok: boolean; reason?: string } {
  switch (kind) {
    case 'business':
      return state.player.businesses.some((b) => b.id === targetId) ? { ok: true } : { ok: false, reason: 'You do not own that business.' };
    case 'production':
      return state.player.productionLines.some((l) => l.id === targetId) ? { ok: true } : { ok: false, reason: 'You do not own that production line.' };
    case 'warehouse':
    case 'security':
    case 'logistics':
    case 'manager_of_managers':
      return state.player.properties.some((p) => p.id === targetId) ? { ok: true } : { ok: false, reason: 'You do not own that property.' };
    case 'trading':
    case 'finance':
    case 'intel':
      return { ok: true };
    default:
      return { ok: false, reason: 'Unknown assignment kind.' };
  }
}

function locationOfTarget(state: GameState, kind: EmployeeAssignment['kind'], targetId: ID): ID | null {
  if (kind === 'business') return state.player.businesses.find((b) => b.id === targetId)?.locationId ?? null;
  if (kind === 'production') return state.player.productionLines.find((l) => l.id === targetId)?.propertyId
    ? state.player.properties.find((p) => p.id === state.player.productionLines.find((l) => l.id === targetId)?.propertyId)?.locationId ?? null
    : null;
  return state.player.properties.find((p) => p.id === targetId)?.locationId ?? null;
}

export function unassignEmployee(state: GameState, employeeId: ID): { ok: boolean; reason?: string } {
  const employee = state.player.crew.find((e) => e.id === employeeId);
  if (!employee) return { ok: false, reason: 'No such employee.' };
  employee.assignment = null;
  detachFromTargets(state, employeeId);
  return { ok: true };
}

export function trainEmployee(state: GameState, employeeId: ID): { ok: boolean; reason?: string; cost?: number; untilDay?: number } {
  const employee = state.player.crew.find((e) => e.id === employeeId);
  if (!employee) return { ok: false, reason: 'No such employee.' };
  if (employee.level >= B.crew.maxLevel) return { ok: false, reason: `${employee.name} is already at the maximum level.` };
  if (employee.trainingUntilDay !== null && employee.trainingUntilDay > state.world.day) {
    return { ok: false, reason: `Already training until day ${employee.trainingUntilDay}.` };
  }
  const cost = round2(B.crew.trainingCostPerLevel * (1 + employee.level * 0.35));
  const move = debitCash(state, cost, {
    kind: 'wages',
    description: `Training for ${employee.name} (${employee.role} → level ${employee.level + 1})`,
    allowDirty: false,
    counterparty: 'Training provider',
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? `Training costs ${formatMoney(cost)}.` };
  employee.trainingUntilDay = state.world.day + B.crew.trainingDaysPerLevel;
  employee.status = 'training';
  setCounter(state, 'training_spend', round2(counter(state, 'training_spend') + cost));
  pushNotification(state, {
    kind: 'info',
    title: `${employee.name} in training`,
    body: `Off the floor until day ${employee.trainingUntilDay}, then level ${employee.level + 1}. Cost ${formatMoney(cost)}.`,
    link: '/game/crew',
  });
  return { ok: true, cost, untilDay: employee.trainingUntilDay };
}

export function promoteEmployee(state: GameState, employeeId: ID): { ok: boolean; reason?: string } {
  const employee = state.player.crew.find((e) => e.id === employeeId);
  if (!employee) return { ok: false, reason: 'No such employee.' };
  const span = spanOfControl(state);
  const managers = state.player.crew.filter((e) => e.assignment?.kind === 'manager_of_managers').length;
  if (managers >= span.managers + 1) return { ok: false, reason: 'You already have as many managers as your span of control supports.' };
  if (employee.level < 5) return { ok: false, reason: `${employee.name} needs level 5 to manage others.` };
  employee.assignment = { kind: 'manager_of_managers', targetId: employee.locationId, tier: 2, reportsTo: null };
  employee.salaryPerDay = round2(employee.salaryPerDay * 1.22);
  employee.stats.loyalty = Math.round(clamp(employee.stats.loyalty + B.crew.promotionLoyaltyBonus, 0, 100));
  employee.stats.morale = Math.round(clamp(employee.stats.morale + 8, 0, 100));
  changeReputation(state, 'crew', 2.5, `Promoted ${employee.name}`);
  pushNotification(state, {
    kind: 'success',
    title: `${employee.name} promoted to manager`,
    body: `Salary rises to ${formatMoney(employee.salaryPerDay)}/day; loyalty +${B.crew.promotionLoyaltyBonus}. They can now run a delegation tier on your behalf.`,
    link: '/game/crew',
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Span of control                                                     */
/* ------------------------------------------------------------------ */

export interface SpanOfControl {
  crew: number;
  capacity: number;
  managers: number;
  managerCapacity: number;
  overloaded: boolean;
  moralePenalty: number;
  explanation: string;
}

export function spanOfControl(state: GameState): SpanOfControl {
  const mods = playerModifiers(state);
  const leadership = mods.skill('leadership');
  const businessManagement = mods.skill('business_management');
  const managers = state.player.crew.filter((e) => e.assignment?.kind === 'manager_of_managers').length;
  const base = 4 + Math.floor(leadership / 3) + spanOfControlBonus(mods);
  const perManager = 5 + Math.floor(businessManagement / 4);
  const capacity = base + managers * perManager;
  const crew = state.player.crew.filter((e) => e.status === 'active').length;
  const overloaded = crew > capacity;
  return {
    crew,
    capacity,
    managers,
    managerCapacity: perManager,
    overloaded,
    moralePenalty: overloaded ? round2(clamp((crew - capacity) * 0.9, 0, 14)) : 0,
    explanation: `${base} direct reports from level ${leadership} leadership${managers > 0 ? ` plus ${managers} manager(s) × ${perManager}` : ''} = ${capacity} people.`,
  };
}

/* ------------------------------------------------------------------ */
/* Payroll                                                             */
/* ------------------------------------------------------------------ */

export interface PayrollResult {
  paid: number;
  unpaid: number;
  unpaidEmployees: { id: ID; name: string; salary: number; daysUnpaid: number }[];
  totalSalary: number;
  injuries: number;
  departures: { id: ID; name: string; reason: string }[];
  betrayals: { id: ID; name: string; stolen: number; heat: number }[];
  promotions: { id: ID; name: string; level: number }[];
}

export function payrollForecast(state: GameState): number {
  return round2(state.player.crew.filter((e) => e.status === 'active').reduce((s, e) => s + e.salaryPerDay, 0));
}

/** Daily payroll, morale/loyalty drift, XP, injuries, betrayal and retirement. */
export function crewTick(state: GameState, rng: Rng): PayrollResult {
  const result: PayrollResult = { paid: 0, unpaid: 0, unpaidEmployees: [], totalSalary: payrollForecast(state), injuries: 0, departures: [], betrayals: [], promotions: [] };
  const mods = playerModifiers(state);
  const loyaltyPerk = loyaltyBonus(mods);
  const span = spanOfControl(state);
  const day = state.world.day;

  for (const employee of [...state.player.crew]) {
    if (employee.status === 'departed' || employee.status === 'retired' || employee.status === 'betrayed') continue;

    /* ------------------------------- payroll ------------------------------- */
    const salary = employee.salaryPerDay;
    if (employee.status !== 'training') {
      const payment = debitCash(state, salary, {
        kind: 'wages',
        description: `Wages: ${employee.name} (${employee.role})`,
        allowDirty: false,
        counterparty: employee.name,
        meta: { employeeId: employee.id, level: employee.level },
      });
      if (payment.ok) {
        employee.lastPaidDay = day;
        employee.daysUnpaid = 0;
        result.paid = round2(result.paid + salary);
      } else {
        employee.daysUnpaid += 1;
        result.unpaid = round2(result.unpaid + salary);
        result.unpaidEmployees.push({ id: employee.id, name: employee.name, salary, daysUnpaid: employee.daysUnpaid });
      }
    }

    /* ------------------------- loyalty and morale -------------------------- */
    const paidToday = employee.daysUnpaid === 0;
    const loyaltyDelta =
      (paidToday ? B.crew.loyaltyPerDayPaid : -B.crew.loyaltyPenaltyPerDayUnpaid * Math.min(4, 1 + employee.daysUnpaid * 0.4)) +
      loyaltyPerk * 0.05 +
      (employee.assignment ? 0.02 : -0.06) +
      (employee.injured ? -0.12 : 0);
    employee.stats.loyalty = Math.round(clamp(employee.stats.loyalty + loyaltyDelta, 0, 100));

    const moraleTarget =
      B.crew.moraleBase +
      (paidToday ? 12 : -18 - employee.daysUnpaid * 3) +
      (employee.assignment ? 6 : -8) +
      (employee.injured ? -14 : 0) -
      span.moralePenalty +
      state.player.reputation.dimensions.crew * 0.12;
    employee.stats.morale = Math.round(clamp(employee.stats.morale + (moraleTarget - employee.stats.morale) * 0.18 + rng.gaussian(0, 1.6), 0, 100));

    /* ---------------------------------- XP --------------------------------- */
    if (employee.status === 'active' && employee.assignment) {
      employee.xp = round2(employee.xp + B.crew.xpPerDayWorked * (0.6 + employee.stats.morale / 150));
      const needed = Math.round(B.crew.levelXpBase * Math.pow(B.crew.levelXpGrowth, employee.level - 1));
      if (employee.xp >= needed && employee.level < B.crew.maxLevel) {
        employee.xp -= needed;
        employee.level += 1;
        employee.salaryPerDay = round2(employee.salaryPerDay * 1.06);
        employee.stats.skill = Math.round(clamp(employee.stats.skill + rng.int(2, 5), 1, 99));
        for (const [skillId, level] of orderedEntries(employee.skills)) {
          employee.skills[skillId] = Math.min(30, level + 1);
        }
        result.promotions.push({ id: employee.id, name: employee.name, level: employee.level });
        changeReputation(state, 'crew', 0.8, `${employee.name} reached level ${employee.level}`);
      }
    }

    /* ------------------------------ training ------------------------------- */
    if (employee.trainingUntilDay !== null && day >= employee.trainingUntilDay) {
      employee.trainingUntilDay = null;
      employee.status = 'active';
      employee.level = Math.min(B.crew.maxLevel, employee.level + 1);
      employee.stats.skill = Math.round(clamp(employee.stats.skill + rng.int(4, 9), 1, 99));
      employee.stats.loyalty = Math.round(clamp(employee.stats.loyalty + 4, 0, 100));
      pushNotification(state, {
        kind: 'success',
        title: `${employee.name} finished training`,
        body: `Now level ${employee.level} with skill ${employee.stats.skill}.`,
        link: '/game/crew',
      });
    }

    /* ------------------------------- injury -------------------------------- */
    if (employee.injured && employee.injuredUntilDay !== null && day >= employee.injuredUntilDay) {
      employee.injured = false;
      employee.injuredUntilDay = null;
      employee.stats.health = 100;
      employee.status = 'active';
    }
    if (!employee.injured && employee.assignment?.kind === 'security' && rng.chance(B.crew.injuryChancePerCombat * 0.03)) {
      employee.injured = true;
      employee.injuredUntilDay = day + rng.int(B.crew.injuryRecoveryDays[0], B.crew.injuryRecoveryDays[1]);
      employee.status = 'injured';
      employee.stats.health = rng.int(20, 60);
      result.injuries += 1;
      changeReputation(state, 'crew', -1.2, `${employee.name} was injured on duty`);
      pushNotification(state, {
        kind: 'warning',
        title: `${employee.name} injured`,
        body: `Off duty until day ${employee.injuredUntilDay}. Injured staff stay on payroll and their loyalty drops if they feel used.`,
        link: '/game/crew',
      });
    }

    /* ------------------------------ betrayal ------------------------------- */
    const loyalty = employee.stats.loyalty;
    employee.betrayalRisk = round2(
      clamp(B.crew.betrayalChanceAtZeroLoyalty * Math.pow((100 - loyalty) / 100, B.crew.betrayalChanceAtZeroLoyalty > 0 ? B.crew.betrayalLoyaltyExponent : 1), 0, 0.25),
    );
    if (rng.chance(employee.betrayalRisk * 0.1)) {
      const betrayal = betray(state, rng, employee);
      result.betrayals.push(betrayal);
      result.departures.push({ id: employee.id, name: employee.name, reason: 'betrayed you' });
      continue;
    }

    /* ------------------------------ retirement ----------------------------- */
    if (employee.level >= B.crew.retirementLevel && rng.chance(0.004)) {
      employee.status = 'retired';
      detachFromTargets(state, employee.id);
      state.player.crew = state.player.crew.filter((e) => e.id !== employee.id);
      result.departures.push({ id: employee.id, name: employee.name, reason: 'retired' });
      changeReputation(state, 'crew', employee.stats.loyalty > 65 ? 1.5 : -1.5, `${employee.name} retired`);
      pushNotification(state, {
        kind: 'info',
        title: `${employee.name} retired`,
        body: `After ${day - employee.hiredDay} days and level ${employee.level}, they left the business.`,
        link: '/game/crew',
      });
    }

    /* -------------------------- voluntary departure ------------------------- */
    if (!employee.injured && loyalty < 12 && rng.chance(0.06)) {
      employee.status = 'departed';
      detachFromTargets(state, employee.id);
      state.player.crew = state.player.crew.filter((e) => e.id !== employee.id);
      result.departures.push({ id: employee.id, name: employee.name, reason: 'quit' });
      changeReputation(state, 'crew', -3, `${employee.name} quit`);
      pushNotification(state, {
        kind: 'warning',
        title: `${employee.name} quit`,
        body: `Loyalty fell to ${loyalty}. ${employee.daysUnpaid > 0 ? `They were owed ${employee.daysUnpaid} day(s) of wages.` : 'A rival offered more, or they simply had enough.'}`,
        link: '/game/crew',
      });
    }
  }

  if (result.paid > 0) setCounter(state, 'wages_paid', round2(counter(state, 'wages_paid') + result.paid));
  if (result.unpaid > 0) {
    setCounter(state, 'wages_owed', round2(counter(state, 'wages_owed') + result.unpaid));
    changeReputation(state, 'crew', -1.6, 'Missed payroll');
  }
  if (span.overloaded) {
    pushDiagnostic(state, {
      system: 'crew',
      level: 'warn',
      message: `Span of control exceeded: ${span.crew} people vs ${span.capacity} capacity — morale is falling across the organisation`,
      data: { crew: span.crew, capacity: span.capacity, penalty: span.moralePenalty },
    });
  }
  return result;
}

function betray(state: GameState, rng: Rng, employee: EmployeeInstance): { id: ID; name: string; stolen: number; heat: number } {
  const cash = computeNetWorth(state).cash;
  const stolen = round2(Math.min(cash * rng.float(0.02, 0.11), employee.salaryPerDay * rng.int(10, 60)));
  if (stolen > 0) {
    debitCash(state, stolen, { kind: 'theft', description: `${employee.name} betrayed you and took ${formatMoney(stolen)}`, allowDirty: true, counterparty: employee.name });
  }
  const heat = round2(rng.float(4, 16) * (employee.assignment?.kind === 'finance' || employee.role === 'accountant' ? 1.8 : 1));
  addHeat(state, heat, `${employee.name} talked to enforcement`);
  changeReputation(state, 'crew', -8, `${employee.name} betrayed you`);
  changeReputation(state, 'business', -4, 'A betrayal became known');

  // They can damage what they knew about.
  if (employee.assignment?.kind === 'business') {
    const business = state.player.businesses.find((b) => b.id === employee.assignment!.targetId);
    if (business) {
      business.clientele = round2(clamp(business.clientele - rng.float(0.1, 0.3), 0.05, 1));
      business.reputationLocal = round2(business.reputationLocal - rng.float(4, 14));
    }
  }
  if (employee.assignment?.kind === 'warehouse' || employee.assignment?.kind === 'security') {
    const property = state.player.properties.find((p) => p.id === employee.assignment!.targetId);
    if (property) {
      property.security = round2(clamp(property.security - rng.float(0.08, 0.25), 0, 0.98));
    }
  }

  employee.status = 'betrayed';
  employee.stats.loyalty = 0;
  detachFromTargets(state, employee.id);
  state.player.crew = state.player.crew.filter((e) => e.id !== employee.id);
  bumpCounter(state, 'betrayals');
  pushNotification(state, {
    kind: 'danger',
    title: `${employee.name} betrayed you`,
    body: `They took ${formatMoney(stolen)} and gave enforcement enough to raise your heat by ${heat}. Loyalty was ${employee.stats.loyalty} before this; unpaid wages, injuries and overwork are what get you here.`,
    link: '/game/crew',
    metrics: [
      { label: 'Stolen', value: formatMoney(stolen) },
      { label: 'Heat', value: `+${heat}` },
      { label: 'Role', value: employee.role },
    ],
  });
  return { id: employee.id, name: employee.name, stolen, heat };
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface CandidateView {
  id: ID;
  name: string;
  role: EmployeeRole;
  roleName: string;
  category: string;
  level: number;
  stats: EmployeeInstance['stats'];
  salaryAskPerDay: number;
  hiringFee: number;
  skills: { skillId: ID; name: string; level: number }[];
  personalObjective: string;
  locationName: string;
  here: boolean;
  loyaltyExpectation: number;
  automationCapability: string;
  valueScore: number;
}

export function candidateViews(state: GameState): CandidateView[] {
  return state.player.hiringPool.map((c) => {
    const role = ROLE_BY_ID[c.role];
    const skills = orderedEntries(c.skills).map(([skillId, level]) => ({ skillId, name: SKILL_BY_ID[skillId]?.name ?? skillId, level }));
    const valueScore = round2(
      (c.stats.skill * 0.4 + c.stats.loyalty * 0.25 + c.stats.morale * 0.15 + c.level * 2) / Math.max(1, c.salaryAskPerDay) * 10,
    );
    return {
      id: c.id,
      name: c.name,
      role: c.role,
      roleName: role?.name ?? c.role,
      category: role?.category ?? 'operations',
      level: c.level,
      stats: c.stats,
      salaryAskPerDay: c.salaryAskPerDay,
      hiringFee: c.hiringFee,
      skills,
      personalObjective: c.personalObjective,
      locationName: worldReg.location(c.locationId)?.name ?? c.locationId,
      here: c.locationId === state.player.locationId,
      loyaltyExpectation: c.loyaltyExpectation,
      automationCapability: role?.automationCapability ?? 'none',
      valueScore,
    };
  });
}

export interface EmployeeView {
  id: ID;
  name: string;
  role: EmployeeRole;
  roleName: string;
  level: number;
  xp: number;
  xpToNext: number;
  status: EmployeeInstance['status'];
  hiredDay: number;
  daysEmployed: number;
  salaryPerDay: number;
  salaryShareOfRevenue: number;
  stats: EmployeeInstance['stats'];
  skills: { skillId: ID; name: string; level: number }[];
  injured: boolean;
  injuredUntilDay: number | null;
  trainingUntilDay: number | null;
  daysUnpaid: number;
  betrayalRisk: number;
  assignment: { kind: string; targetName: string; tier: number } | null;
  locationName: string;
  personalObjective: string;
  canPromote: boolean;
  trainingCost: number;
  combatReady: boolean;
  capability: string;
}

export function employeeViews(state: GameState): EmployeeView[] {
  const revenue = Math.max(1, state.player.businesses.reduce((s, b) => s + b.revenue30d, 0) / 30);
  return state.player.crew.map((e) => {
    const role = ROLE_BY_ID[e.role];
    const xpToNext = Math.round(B.crew.levelXpBase * Math.pow(B.crew.levelXpGrowth, e.level - 1));
    return {
      id: e.id,
      name: e.name,
      role: e.role,
      roleName: role?.name ?? e.role,
      level: e.level,
      xp: round2(e.xp),
      xpToNext,
      status: e.status,
      hiredDay: e.hiredDay,
      daysEmployed: state.world.day - e.hiredDay,
      salaryPerDay: e.salaryPerDay,
      salaryShareOfRevenue: round2(e.salaryPerDay / revenue),
      stats: e.stats,
      skills: orderedEntries(e.skills).map(([skillId, level]) => ({ skillId, name: SKILL_BY_ID[skillId]?.name ?? skillId, level })),
      injured: e.injured,
      injuredUntilDay: e.injuredUntilDay,
      trainingUntilDay: e.trainingUntilDay,
      daysUnpaid: e.daysUnpaid,
      betrayalRisk: e.betrayalRisk,
      assignment: e.assignment
        ? {
            kind: e.assignment.kind,
            targetName: assignmentTargetName(state, e.assignment),
            tier: e.assignment.tier,
          }
        : null,
      locationName: worldReg.location(e.locationId)?.name ?? e.locationId,
      personalObjective: e.personalObjective,
      canPromote: e.level >= 5 && e.assignment?.kind !== 'manager_of_managers',
      trainingCost: round2(B.crew.trainingCostPerLevel * (1 + e.level * 0.35)),
      combatReady: !e.injured && e.status === 'active' && ['security', 'mercenary', 'fixer', 'driver'].includes(e.role),
      capability: role?.automationCapability ?? 'none',
    };
  });
}

function assignmentTargetName(state: GameState, assignment: EmployeeAssignment): string {
  switch (assignment.kind) {
    case 'business':
      return state.player.businesses.find((b) => b.id === assignment.targetId)?.name ?? assignment.targetId;
    case 'production':
      return state.player.productionLines.find((l) => l.id === assignment.targetId)?.name ?? assignment.targetId;
    case 'warehouse':
    case 'security':
    case 'logistics':
    case 'manager_of_managers':
      return state.player.properties.find((p) => p.id === assignment.targetId)?.name ?? worldReg.location(assignment.targetId)?.name ?? assignment.targetId;
    default:
      return assignment.kind;
  }
}

export interface CrewSummary {
  headcount: number;
  active: number;
  injured: number;
  training: number;
  unassigned: number;
  payrollPerDay: number;
  payrollShareOfRevenue: number;
  averageLoyalty: number;
  averageMorale: number;
  averageSkill: number;
  averageLevel: number;
  span: SpanOfControl;
  unpaidWages: number;
  highestRisk: { id: ID; name: string; loyalty: number; betrayalRisk: number }[];
  byRole: { role: string; count: number; payroll: number }[];
  byAssignment: { kind: string; count: number }[];
}

export function crewSummary(state: GameState): CrewSummary {
  const crew = state.player.crew;
  const active = crew.filter((e) => e.status === 'active');
  const revenue = Math.max(1, state.player.businesses.reduce((s, b) => s + b.revenue30d, 0) / 30);
  const payroll = payrollForecast(state);
  const byRole = new Map<string, { count: number; payroll: number }>();
  for (const e of crew) {
    const entry = byRole.get(e.role) ?? { count: 0, payroll: 0 };
    entry.count += 1;
    entry.payroll = round2(entry.payroll + e.salaryPerDay);
    byRole.set(e.role, entry);
  }
  const byAssignment = new Map<string, number>();
  for (const e of crew) {
    const key = e.assignment?.kind ?? 'unassigned';
    byAssignment.set(key, (byAssignment.get(key) ?? 0) + 1);
  }
  return {
    headcount: crew.length,
    active: active.length,
    injured: crew.filter((e) => e.injured).length,
    training: crew.filter((e) => e.trainingUntilDay !== null).length,
    unassigned: crew.filter((e) => !e.assignment).length,
    payrollPerDay: payroll,
    payrollShareOfRevenue: round2(payroll / revenue),
    averageLoyalty: crew.length > 0 ? Math.round(crew.reduce((s, e) => s + e.stats.loyalty, 0) / crew.length) : 0,
    averageMorale: crew.length > 0 ? Math.round(crew.reduce((s, e) => s + e.stats.morale, 0) / crew.length) : 0,
    averageSkill: crew.length > 0 ? Math.round(crew.reduce((s, e) => s + e.stats.skill, 0) / crew.length) : 0,
    averageLevel: crew.length > 0 ? round2(crew.reduce((s, e) => s + e.level, 0) / crew.length) : 0,
    span: spanOfControl(state),
    unpaidWages: round2(crew.reduce((s, e) => s + e.daysUnpaid * e.salaryPerDay, 0)),
    highestRisk: [...crew]
      .sort((a, b) => b.betrayalRisk - a.betrayalRisk)
      .slice(0, 5)
      .map((e) => ({ id: e.id, name: e.name, loyalty: e.stats.loyalty, betrayalRisk: e.betrayalRisk })),
    byRole: [...byRole.entries()].map(([role, v]) => ({ role, ...v })).sort((a, b) => b.count - a.count),
    byAssignment: [...byAssignment.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
  };
}

/** Skill coverage across the organisation — used by automation and production. */
export function crewSkillLevel(state: GameState, skillId: ID, assignmentKind?: EmployeeAssignment['kind']): number {
  const relevant = state.player.crew.filter(
    (e) => e.status === 'active' && !e.injured && (assignmentKind ? e.assignment?.kind === assignmentKind : true),
  );
  let best = 0;
  for (const e of relevant) {
    const level = e.skills[skillId] ?? 0;
    const scaled = level * (0.6 + e.stats.morale / 250);
    if (scaled > best) best = scaled;
  }
  return round2(best);
}

export function payOutstandingWages(state: GameState): { ok: boolean; reason?: string; paid?: number } {
  const owed = state.player.crew.reduce((s, e) => s + e.daysUnpaid * e.salaryPerDay, 0);
  if (owed <= 0) return { ok: false, reason: 'No wages are outstanding.' };
  const move = debitCash(state, round2(owed), { kind: 'wages', description: 'Back pay for missed wages', allowDirty: false });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Insufficient funds.' };
  for (const e of state.player.crew) {
    if (e.daysUnpaid <= 0) continue;
    e.daysUnpaid = 0;
    e.lastPaidDay = state.world.day;
    e.stats.loyalty = Math.round(clamp(e.stats.loyalty + 9, 0, 100));
    e.stats.morale = Math.round(clamp(e.stats.morale + 12, 0, 100));
  }
  setCounter(state, 'wages_owed', 0);
  changeReputation(state, 'crew', 4, 'Paid outstanding wages');
  pushNotification(state, {
    kind: 'success',
    title: 'Back pay settled',
    body: `${formatMoney(round2(owed))} paid out. Loyalty and morale recovered across the organisation.`,
    link: '/game/crew',
  });
  return { ok: true, paid: round2(owed) };
}
