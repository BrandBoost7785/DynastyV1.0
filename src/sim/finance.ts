/**
 * Finance — banks, credit, debt, laundering and taxation (spec §13).
 *
 * Money never appears or disappears here: every movement goes through the
 * primitives in `state.ts`, which is the only module allowed to touch balances.
 * What this module adds is the *cost of capital and the cost of crime*:
 *
 *   • deposit interest, wire fees, account freezes and daily limits
 *   • a credit score that gates bank lending and reprices it
 *   • six loan kinds (bank, loan shark, mortgage, margin, business, faction)
 *     with simple/compound/amortised accrual, collateral, late fees, seizure
 *   • money laundering through owned fronts, with throughput limits, fees and
 *     detection risk that feeds the enforcement systems
 *   • periodic taxation reconstructed from the transaction ledger, with audits
 *     and evasion penalties
 *   • offshore structures that lower tax and raise risk
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { COMPANY_BY_ID } from '../engine/registry/actors';
import { getWorldRegistry } from '../engine/registry/world';
import { startCombat } from './combat';
import { interestReduction, launderingDetectionReduction, launderingFeeReduction, taxReduction } from './modifiers';
import { bumpCounter, counter, grantXp, playerModifiers, setCounter } from './progression';
import { addHeat, changeReputation, closeInvestigation, startInvestigation } from './reputation';
import {
  cleanBalance,
  computeNetWorth,
  creditCash,
  debitCash,
  debtTotal,
  dirtyBalance,
  formatMoney,
  inventoryValue,
  isUsable,
  newId,
  pushDiagnostic,
  pushNotification,
  round2,
  totalBalance,
  transferCash,
} from './state';
import { pushNews } from './world';
import type { BankAccount, CollateralRef, GameState, ID, Loan, LoanKind, TransactionRecord } from './types';

const B = getBalance();
const worldReg = getWorldRegistry();
const registry = getCommodityRegistry();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export const TAX_PERIOD_DAYS = 30;

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export interface AccountView {
  id: ID;
  institution: string;
  kind: BankAccount['kind'];
  locationName: string;
  balance: number;
  clean: number;
  dirty: number;
  currency: string;
  apy: number;
  dailyInterest: number;
  openedDay: number;
  frozen: boolean;
  frozenUntilDay: number | null;
  freezeReason: string | null;
  dailyLimit: number | null;
  usable: boolean;
  isSettlementAccount: boolean;
  offshore: boolean;
  taxRateApplied: number;
}

export function accountViews(state: GameState): AccountView[] {
  const mods = playerModifiers(state);
  const taxCut = taxReduction(mods);
  return state.player.accounts.map((a) => ({
    id: a.id,
    institution: a.institution,
    kind: a.kind,
    locationName: worldReg.location(a.locationId)?.name ?? a.locationId,
    balance: round2(a.balance),
    clean: round2(a.balance - a.dirtyBalance),
    dirty: round2(a.dirtyBalance),
    currency: a.currency,
    apy: a.apy,
    dailyInterest: round2((Math.max(0, a.balance - a.dirtyBalance) * a.apy) / 365),
    openedDay: a.openedDay,
    frozen: a.frozen,
    frozenUntilDay: a.frozenUntilDay,
    freezeReason: a.freezeReason,
    dailyLimit: a.dailyLimit,
    usable: isUsable(a, state.world.day),
    isSettlementAccount: state.player.brokerageAccountId === a.id,
    offshore: a.kind === 'offshore' || a.kind === 'shell',
    taxRateApplied: round2(Math.max(0, B.finance.tax.incomeTaxRate * (a.kind === 'offshore' || a.kind === 'shell' ? 1 - 0.65 - taxCut : 1 - taxCut))),
  }));
}

export interface OpenAccountOptions {
  kind?: BankAccount['kind'];
  institution?: string;
  locationId?: ID;
  initialDeposit?: number;
  /** Offshore/shell accounts need a jurisdiction with bank secrecy. */
  offshore?: boolean;
}

const OFFSHORE_JURISDICTIONS = ['free_port_zero', 'isthmus', 'polaris', 'aldrich_union'];

export function openAccount(state: GameState, rng: Rng, opts: OpenAccountOptions = {}): { ok: boolean; reason?: string; account?: BankAccount } {
  const kind: BankAccount['kind'] = opts.offshore ? 'offshore' : opts.kind ?? 'checking';
  const locationId = opts.locationId ?? state.player.locationId;
  const location = worldReg.location(locationId);
  if (!location) return { ok: false, reason: 'Unknown location.' };

  if (kind === 'offshore' || kind === 'shell') {
    const secrecy = OFFSHORE_JURISDICTIONS.includes(location.countryId) || location.financialServices.offshore;
    if (!secrecy) {
      return {
        ok: false,
        reason: `${location.countryName} does not offer the secrecy structure you need.`,
      };
    }
    if (state.player.progression.level < 6 && kind === 'shell') {
      return { ok: false, reason: 'Shell companies require level 6 and a reputation to match.' };
    }
  }
  if (state.player.accounts.length >= 12) {
    return { ok: false, reason: 'You cannot realistically maintain more than twelve accounts.' };
  }

  const setupFee = kind === 'offshore' ? 2500 : kind === 'shell' ? 6500 : kind === 'savings' ? 0 : 25;
  if (setupFee > 0) {
    const fee = debitCash(state, setupFee, { kind: 'fee', description: `Account opening fee (${kind})`, allowDirty: false });
    if (!fee.ok) return { ok: false, reason: fee.reason ?? `Opening this account costs ${formatMoney(setupFee)}.` };
  }

  const apy =
    kind === 'savings'
      ? B.finance.savingsApyAnnual
      : kind === 'offshore'
        ? round2(B.finance.savingsApyAnnual * 1.35)
        : kind === 'shell'
          ? round2(B.finance.savingsApyAnnual * 1.6)
          : round2(B.finance.savingsApyAnnual * 0.15);

  const account: BankAccount = {
    id: newId(rng, 'acc'),
    institution: opts.institution ?? defaultInstitution(kind, location.countryId),
    kind,
    locationId,
    balance: 0,
    dirtyBalance: 0,
    currency: currencyFor(location.countryId),
    apy,
    openedDay: state.world.day,
    frozen: false,
    frozenUntilDay: null,
    freezeReason: null,
    dailyLimit: kind === 'checking' ? 250_000 : null,
    lastInterestDay: state.world.day,
  };
  state.player.accounts.push(account);

  const deposit = opts.initialDeposit ?? 0;
  if (deposit > 0) {
    const source = state.player.accounts.find((a) => a.id !== account.id && isUsable(a, state.world.day) && a.balance - a.dirtyBalance >= deposit);
    if (source) {
      transferCash(state, source.id, account.id, deposit, { description: 'Opening deposit', fee: B.finance.wireFeeFlat });
    }
  }

  pushNotification(state, {
    kind: 'success',
    title: `Account opened: ${account.institution}`,
    body: `${kind} account in ${location.name}, ${(apy * 100).toFixed(2)}% APY${account.dailyLimit ? `, daily limit ${formatMoney(account.dailyLimit)}` : ''}.`,
    link: '/game/bank',
    metrics: [
      { label: 'APY', value: `${(apy * 100).toFixed(2)}%` },
      ...(setupFee > 0 ? [{ label: 'Setup fee', value: formatMoney(setupFee) }] : []),
    ],
  });
  bumpCounter(state, 'accounts_opened');
  return { ok: true, account };
}

function defaultInstitution(kind: BankAccount['kind'], countryId: string): string {
  const names: Record<string, string> = {
    valtreya: 'Meridian Trust',
    cascadia_fed: 'Cascadia Federal',
    aldrich_union: 'Aldrich Privatbank',
    kessel_confed: 'Kessel Kantonalbank',
    marenza: 'Banca Marenza',
    emirate_of_zahr: 'Zahr National Bank',
    jinwan: 'Jinwan Commercial Bank',
    free_port_zero: 'Zero Harbour Private Bank',
    isthmus: 'Isthmus Merchant Bank',
    polaris: 'Polaris Savings & Trust',
    jade: 'Jade State Bank',
  };
  const base = names[countryId] ?? 'Continental Bank';
  switch (kind) {
    case 'savings':
      return `${base} Savings`;
    case 'offshore':
      return `${base} Offshore (Private Client)`;
    case 'shell':
      return `${base} Nominee Shell`;
    case 'crypto_backed':
      return `${base} Digital Assets`;
    default:
      return base;
  }
}

function currencyFor(countryId: string): string {
  const currencies: Record<string, string> = {
    valtreya: 'VAL',
    cascadia_fed: 'CSD',
    aldrich_union: 'ALD',
    kessel_confed: 'KSF',
    marenza: 'MRZ',
    emirate_of_zahr: 'ZAR',
    jinwan: 'JWN',
    free_port_zero: 'ZPZ',
    isthmus: 'IST',
    polaris: 'PLR',
    jade: 'JDC',
  };
  return currencies[countryId] ?? 'CR';
}

export function closeAccount(state: GameState, accountId: ID): { ok: boolean; reason?: string } {
  const account = state.player.accounts.find((a) => a.id === accountId);
  if (!account) return { ok: false, reason: 'Account not found.' };
  if (state.player.accounts.length <= 1) return { ok: false, reason: 'You must keep at least one account open.' };
  if (account.balance !== 0) return { ok: false, reason: 'Move the balance out before closing the account.' };
  if (state.player.loans.some((l) => l.status === 'active' && l.collateral.some((c) => c.refId === accountId))) {
    return { ok: false, reason: 'That account is pledged as collateral on a loan.' };
  }
  if (state.player.brokerageAccountId === accountId) {
    return { ok: false, reason: 'That account settles your share trades. Link another brokerage account first.' };
  }
  state.player.accounts = state.player.accounts.filter((a) => a.id !== accountId);
  pushNotification(state, { kind: 'info', title: `Account closed: ${account.institution}`, body: 'The relationship is finished and the record archived.', link: '/game/bank' });
  return { ok: true };
}

/** Daily deposit interest, freeze expiry and account maintenance. */
export function accountsTick(state: GameState, rng: Rng): { interestEarned: number; unfrozen: ID[]; frozen: ID[] } {
  let interestEarned = 0;
  const unfrozen: ID[] = [];
  const frozen: ID[] = [];
  const day = state.world.day;

  for (const account of state.player.accounts) {
    // Unfreeze.
    if (account.frozenUntilDay !== null && day >= account.frozenUntilDay) {
      account.frozen = false;
      account.frozenUntilDay = null;
      account.freezeReason = null;
      unfrozen.push(account.id);
      pushNotification(state, {
        kind: 'success',
        title: `Account unfrozen: ${account.institution}`,
        body: 'The hold was lifted. Funds are available again.',
        link: '/game/bank',
      });
    }
    if (account.frozen) continue;

    // Interest is paid on clean balances only: banks do not pay interest on
    // money they would have to report.
    const base = Math.max(0, account.balance - account.dirtyBalance);
    if (base <= 0 || account.apy <= 0) continue;
    const sinceLast = Math.max(0, day - account.lastInterestDay);
    if (sinceLast <= 0) continue;
    const daily = account.apy / 365;
    const interest = round2(base * (Math.pow(1 + daily, sinceLast) - 1));
    if (interest <= 0) continue;
    creditCash(state, interest, {
      kind: 'interest',
      description: `Deposit interest at ${account.institution} (${(account.apy * 100).toFixed(2)}% APY)`,
      dirty: false,
      accountId: account.id,
    });
    account.lastInterestDay = day;
    interestEarned = round2(interestEarned + interest);
    setCounter(state, 'interest_earned', round2(counter(state, 'interest_earned') + interest));
  }

  // Authorities can freeze an account while an investigation runs.
  if (state.player.reputation.investigation > 72 && rng.chance(0.05)) {
    const target = state.player.accounts.filter((a) => !a.frozen && a.balance > 0).sort((a, b) => b.balance - a.balance)[0];
    if (target) {
      target.frozen = true;
      target.frozenUntilDay = day + rng.int(6, 26);
      target.freezeReason = 'Frozen by court order during an active investigation';
      frozen.push(target.id);
      pushNotification(state, {
        kind: 'danger',
        title: `Account frozen: ${target.institution}`,
        body: `${formatMoney(target.balance)} is inaccessible until day ${target.frozenUntilDay}. Investigators froze it as part of the open file on you.`,
        link: '/game/bank',
        metrics: [{ label: 'Frozen balance', value: formatMoney(target.balance) }],
      });
    }
  }
  void rng;
  return { interestEarned, unfrozen, frozen };
}

/* ------------------------------------------------------------------ */
/* Credit score                                                        */
/* ------------------------------------------------------------------ */

export function adjustCreditScore(state: GameState, delta: number, reason: string): number {
  const before = state.player.creditScore;
  const next = Math.round(clamp(before + delta, B.finance.creditScore.min, B.finance.creditScore.max));
  state.player.creditScore = next;
  state.player.creditHistory.push({ day: state.world.day, score: next, reason });
  if (state.player.creditHistory.length > 200) state.player.creditHistory.splice(0, state.player.creditHistory.length - 200);
  if (Math.abs(next - before) >= 12) {
    pushNotification(state, {
      kind: next > before ? 'success' : 'warning',
      title: `Credit score ${next > before ? 'improved' : 'dropped'} to ${next}`,
      body: `${reason} (${next > before ? '+' : ''}${next - before}).`,
      link: '/game/bank',
    });
  }
  return next;
}

export function creditScoreView(state: GameState): {
  score: number;
  band: string;
  maxBankLoan: number;
  bankApr: number;
  utilisation: number;
  factors: { label: string; impact: number }[];
  history: { day: number; score: number; reason: string }[];
} {
  const score = state.player.creditScore;
  const band = score >= 780 ? 'Excellent' : score >= 720 ? 'Good' : score >= 660 ? 'Fair' : score >= 580 ? 'Poor' : 'Distressed';
  const maxLoan = maxBankLoanFor(score);
  const factors: { label: string; impact: number }[] = [];
  const active = state.player.loans.filter((l) => l.status === 'active');
  const utilisation = maxLoan > 0 ? clamp(active.reduce((s, l) => s + l.balance, 0) / maxLoan, 0, 2) : 0;
  factors.push({ label: 'Base score', impact: B.finance.creditScore.start });
  factors.push({ label: `Utilisation ${(utilisation * 100).toFixed(0)}%`, impact: -Math.round(utilisation * B.finance.creditScore.utilisationPenaltyPerFraction) });
  if (active.some((l) => l.daysDelinquent > 0)) factors.push({ label: 'Delinquent payments', impact: -Math.round(active.reduce((s, l) => s + l.daysDelinquent * B.finance.bankLoan.creditScoreHitPerMissedDay, 0)) });
  if (active.some((l) => l.status === 'active' && l.kind === 'loan_shark')) factors.push({ label: 'Informal lender on record', impact: -18 });
  factors.push({ label: 'Drift toward mean', impact: Math.round((B.finance.creditScore.mean - score) * B.finance.creditScore.dailyDriftTowardMean * 30) });
  return {
    score,
    band,
    maxBankLoan: maxLoan,
    bankApr: round2(bankAprFor(state, score)),
    utilisation: round2(utilisation),
    factors,
    history: state.player.creditHistory.slice(-40).reverse(),
  };
}

export function maxBankLoanFor(score: number): number {
  let max = 0;
  for (const tier of B.finance.bankLoan.maxAmountByCreditScore) {
    if (score >= tier.minScore) max = tier.max;
  }
  return max;
}

function bankAprFor(state: GameState, score: number): number {
  const mods = playerModifiers(state);
  const spread = B.finance.bankLoan.aprSpreadOverBase * (1 + clamp((700 - score) / 400, -0.5, 1.6));
  return round2(Math.max(0.02, (state.world.interestRate + spread) * (1 - interestReduction(mods)) * state.config.difficultyModifiers.interestRateMultiplier));
}

/** Daily credit-score drift and delinquency scoring. */
export function creditTick(state: GameState): void {
  const mean = B.finance.creditScore.mean;
  const drift = (mean - state.player.creditScore) * B.finance.creditScore.dailyDriftTowardMean;
  if (Math.abs(drift) >= 0.5) {
    state.player.creditScore = Math.round(clamp(state.player.creditScore + drift, B.finance.creditScore.min, B.finance.creditScore.max));
  }
}

/* ------------------------------------------------------------------ */
/* Loans                                                               */
/* ------------------------------------------------------------------ */

export interface LoanOffer {
  kind: LoanKind;
  lenderName: string;
  amount: number;
  apr: number;
  termDays: number;
  originationFee: number;
  paymentPerDay: number;
  totalRepayment: number;
  totalInterest: number;
  method: Loan['method'];
  compoundingPeriodDays: number;
  collateralRequired: number;
  collateralHaircut: number;
  approvalChance: number;
  available: boolean;
  reason?: string;
  maxAmount: number;
  termOptions: number[];
  pressurePerDayOverdue: number;
}

export function collateralCapacity(state: GameState): { total: number; lines: { kind: CollateralRef['kind']; refId: ID; label: string; value: number; lendable: number }[] } {
  const lines: { kind: CollateralRef['kind']; refId: ID; label: string; value: number; lendable: number }[] = [];
  const haircut = B.finance.bankLoan.collateralHaircut;
  for (const property of state.player.properties) {
    lines.push({ kind: 'property', refId: property.id, label: property.name, value: round2(property.valuation), lendable: round2(property.valuation * haircut) });
  }
  for (const vehicle of state.player.vehicles) {
    const value = round2(vehicle.purchasePrice * (0.55 + vehicle.condition * 0.45));
    lines.push({ kind: 'vehicle', refId: vehicle.id, label: vehicle.name, value, lendable: round2(value * haircut) });
  }
  for (const holding of state.player.stockHoldings) {
    const price = state.world.companies[holding.companyId]?.price ?? holding.avgCost;
    const value = round2(holding.shares * price);
    if (value <= 0) continue;
    lines.push({
      kind: 'stock',
      refId: holding.companyId,
      label: `${COMPANY_BY_ID[holding.companyId]?.ticker ?? holding.companyId} (${holding.shares} sh)`,
      value,
      lendable: round2(value * haircut * 0.85),
    });
  }
  for (const holding of state.player.cryptoHoldings) {
    const price = state.world.cryptoAssets[holding.assetId]?.price ?? holding.avgCost;
    const value = round2(holding.amount * price);
    if (value <= 0) continue;
    lines.push({
      kind: 'crypto',
      refId: holding.assetId,
      value,
      label: `${holding.assetId} (${holding.amount.toFixed(4)})`,
      lendable: round2(value * haircut * 0.6),
    });
  }
  const inv = inventoryValue(state);
  if (inv > 0) {
    lines.push({ kind: 'inventory', refId: 'inventory', label: 'Warehoused goods', value: round2(inv), lendable: round2(inv * haircut * 0.5) });
  }
  return { total: round2(lines.reduce((s, l) => s + l.lendable, 0)), lines };
}

export function loanOffer(state: GameState, kind: LoanKind, amount: number, termDays: number): LoanOffer {
  const score = state.player.creditScore;
  const collateral = collateralCapacity(state);
  const criminalRep = state.player.reputation.dimensions.criminal;
  const mods = playerModifiers(state);
  const interestCut = interestReduction(mods);

  let apr = bankAprFor(state, score);
  let fee: number = B.finance.bankLoan.originationFee;
  let method: Loan['method'] = 'compound';
  let compoundingPeriodDays = 30;
  let maxAmount = maxBankLoanFor(score);
  let terms = B.finance.bankLoan.termDaysOptions;
  let approvalChance = clamp(0.35 + (score - 560) / 300, 0.05, 0.97);
  let lenderName = defaultInstitution('checking', worldReg.requireLocation(state.player.locationId).countryId);
  let pressure = 0;
  let collateralRequired = 0;
  let available = true;
  let reason: string | undefined;

  switch (kind) {
    case 'loan_shark': {
      apr = round2((state.world.interestRate + B.finance.loanShark.aprSpreadOverBase) * (1 - interestCut * 0.4));
      fee = B.finance.loanShark.originationFee;
      method = 'compound';
      compoundingPeriodDays = 7;
      maxAmount = Math.round(B.finance.loanShark.maxAmountByReputation * clamp(0.15 + criminalRep / 100, 0.1, 1.4));
      terms = B.finance.loanShark.termDaysOptions;
      approvalChance = clamp(0.35 + criminalRep / 90, 0.2, 0.98);
      lenderName = 'Undisclosed private lender';
      pressure = B.finance.loanShark.pressurePerDayOverdue;
      if (criminalRep < 4) {
        available = false;
        reason = 'Loan sharks do not deal with strangers. You need criminal reputation.';
      }
      break;
    }
    case 'mortgage': {
      apr = round2(bankAprFor(state, score) * 0.86);
      fee = round2(B.finance.bankLoan.originationFee * 1.6);
      method = 'amortized';
      compoundingPeriodDays = 30;
      terms = [1095, 1825, 3650];
      maxAmount = Math.round(collateral.lines.filter((l) => l.kind === 'property').reduce((s, l) => s + l.value, 0) * 0.72);
      approvalChance = clamp(0.4 + (score - 560) / 260, 0.05, 0.96);
      lenderName = `${lenderName} Mortgage`;
      collateralRequired = 1;
      if (maxAmount <= 0) {
        available = false;
        reason = 'A mortgage needs a property to secure it.';
      }
      break;
    }
    case 'margin': {
      apr = round2(bankAprFor(state, score) * 1.18);
      fee = round2(B.finance.bankLoan.originationFee * 0.5);
      method = 'compound';
      compoundingPeriodDays = 30;
      terms = [30, 90, 180];
      const portfolio = state.player.stockHoldings.reduce((s, h) => s + h.shares * (state.world.companies[h.companyId]?.price ?? h.avgCost), 0);
      maxAmount = Math.round(portfolio * 0.5);
      approvalChance = state.player.brokerageAccountId ? clamp(0.5 + (score - 560) / 300, 0.1, 0.97) : 0;
      lenderName = 'Brokerage margin desk';
      if (!state.player.brokerageAccountId) {
        available = false;
        reason = 'Open a brokerage account first.';
      } else if (maxAmount <= 0) {
        available = false;
        reason = 'No portfolio to borrow against.';
      }
      break;
    }
    case 'business': {
      apr = round2(bankAprFor(state, score) * 1.08);
      fee = B.finance.bankLoan.originationFee;
      method = 'amortized';
      compoundingPeriodDays = 30;
      terms = [180, 365, 730];
      const monthlyProfit = state.player.businesses.reduce((s, b) => s + b.profit30d, 0);
      maxAmount = Math.round(Math.max(0, monthlyProfit) * 9);
      approvalChance = clamp(0.3 + monthlyProfit / 60_000 + (score - 560) / 500, 0.05, 0.95);
      lenderName = `${lenderName} Commercial`;
      if (state.player.businesses.length === 0) {
        available = false;
        reason = 'Commercial lending needs an operating business with recorded profit.';
      } else if (maxAmount <= 0) {
        available = false;
        reason = 'Your businesses are not yet profitable enough to service debt.';
      }
      break;
    }
    case 'faction': {
      const faction = Object.values(state.world.factions)
        .filter((f) => f.playerStanding > B.factions.recruitmentRequirementStanding)
        .sort((a, b) => b.playerStanding - a.playerStanding)[0];
      apr = round2(state.world.interestRate + 0.06);
      fee = 0.02;
      method = 'simple';
      compoundingPeriodDays = 30;
      terms = [30, 90, 180];
      maxAmount = faction ? Math.round(faction.resources * 0.02 + faction.playerStanding * 900) : 0;
      approvalChance = faction ? clamp(0.4 + faction.playerStanding / 120, 0.1, 0.95) : 0;
      lenderName = faction ? `Faction: ${faction.factionId}` : 'No faction will lend to you';
      pressure = 0.04;
      if (!faction) {
        available = false;
        reason = `You need at least ${B.factions.recruitmentRequirementStanding} standing with a faction.`;
      }
      break;
    }
    case 'bank':
    default: {
      if (score < 480) {
        available = false;
        reason = `The bank declined pre-approval at a credit score of ${score}.`;
      }
      const securedExtra = collateral.total;
      maxAmount = Math.round(maxBankLoanFor(score) + securedExtra * 0.5);
      collateralRequired = amount > maxBankLoanFor(score) ? round2(amount - maxBankLoanFor(score)) : 0;
      break;
    }
  }

  const principal = round2(Math.max(0, Math.min(amount, maxAmount)));
  const term = terms.includes(termDays) ? termDays : terms[terms.length - 1]!;
  const originationFee = round2(principal * fee);
  const dailyRate = apr / 365;
  let totalInterest: number;
  let paymentPerDay: number;
  if (method === 'simple') {
    totalInterest = round2(principal * dailyRate * term);
    paymentPerDay = round2((principal + totalInterest) / term);
  } else if (method === 'amortized') {
    paymentPerDay = dailyRate > 0 ? round2((principal * dailyRate) / (1 - Math.pow(1 + dailyRate, -term))) : round2(principal / term);
    totalInterest = round2(paymentPerDay * term - principal);
  } else {
    const periods = Math.max(1, Math.ceil(term / compoundingPeriodDays));
    const perPeriod = apr * (compoundingPeriodDays / 365);
    totalInterest = round2(principal * (Math.pow(1 + perPeriod, periods) - 1));
    paymentPerDay = round2((principal + totalInterest) / term);
  }

  return {
    kind,
    lenderName,
    amount: principal,
    apr,
    termDays: term,
    originationFee,
    paymentPerDay,
    totalRepayment: round2(principal + totalInterest + originationFee),
    totalInterest,
    method,
    compoundingPeriodDays,
    collateralRequired,
    collateralHaircut: B.finance.bankLoan.collateralHaircut,
    approvalChance: round2(approvalChance),
    available,
    ...(available ? {} : { reason }),
    maxAmount,
    termOptions: terms,
    pressurePerDayOverdue: pressure,
  };
}

export interface TakeLoanResult {
  ok: boolean;
  reason?: string;
  loan?: Loan;
  received?: number;
  offer?: LoanOffer;
}

export function takeLoan(
  state: GameState,
  rng: Rng,
  kind: LoanKind,
  amount: number,
  termDays: number,
  collateralRefs: { kind: CollateralRef['kind']; refId: ID }[] = [],
): TakeLoanResult {
  const offer = loanOffer(state, kind, amount, termDays);
  if (!offer.available) return { ok: false, reason: offer.reason ?? 'That loan is not available to you.', offer };
  if (amount <= 0) return { ok: false, reason: 'Loan amount must be positive.', offer };
  if (amount > offer.maxAmount) {
    return { ok: false, reason: `${offer.lenderName} will lend at most ${formatMoney(offer.maxAmount)} on these terms.`, offer };
  }
  if (!rng.chance(offer.approvalChance)) {
    adjustCreditScore(state, -3, `Application declined by ${offer.lenderName}`);
    pushNotification(state, {
      kind: 'warning',
      title: 'Loan application declined',
      body: `${offer.lenderName} declined ${formatMoney(amount)} over ${termDays} days. Approval chance was ${(offer.approvalChance * 100).toFixed(0)}% — collateral, a better score or a smaller ask would help.`,
      link: '/game/bank',
    });
    return { ok: false, reason: 'Application declined.', offer };
  }

  // Collateral.
  const collateral: CollateralRef[] = [];
  if (offer.collateralRequired > 0 || kind === 'mortgage' || kind === 'margin') {
    const capacity = collateralCapacity(state);
    const requested = collateralRefs.length > 0 ? collateralRefs : capacity.lines.map((l) => ({ kind: l.kind, refId: l.refId }));
    let needed = kind === 'mortgage' ? amount : kind === 'margin' ? amount : offer.collateralRequired;
    for (const ref of requested) {
      if (needed <= 0) break;
      const line = capacity.lines.find((l) => l.kind === ref.kind && l.refId === ref.refId);
      if (!line) continue;
      if (state.player.loans.some((l) => l.status === 'active' && l.collateral.some((c) => c.kind === ref.kind && c.refId === ref.refId))) continue;
      collateral.push({ kind: line.kind, refId: line.refId, valuedAt: line.value });
      needed = round2(needed - line.lendable);
    }
    if (needed > 0 && offer.collateralRequired > 0) {
      return {
        ok: false,
        reason: `This loan needs ${formatMoney(offer.collateralRequired)} of collateral; you can pledge ${formatMoney(collateral.reduce((s, c) => s + c.valuedAt * B.finance.bankLoan.collateralHaircut, 0))}.`,
        offer,
      };
    }
  }

  const loan: Loan = {
    id: newId(rng, 'loan'),
    kind,
    lenderName: offer.lenderName,
    principal: offer.amount,
    balance: offer.amount,
    apr: offer.apr,
    penaltyApr: round2(offer.apr + (kind === 'loan_shark' ? 0.65 : B.finance.bankLoan.lateRatePenaltyAnnual)),
    openedDay: state.world.day,
    dueDay: state.world.day + offer.termDays,
    termDays: offer.termDays,
    paymentPerDay: offer.paymentPerDay,
    lastPaymentDay: state.world.day,
    daysDelinquent: 0,
    method: offer.method,
    compoundingPeriodDays: offer.compoundingPeriodDays,
    collateral,
    pressure: 0,
    status: 'active',
    totalRepaid: 0,
    totalInterestPaid: 0,
    creditLineLimit: kind === 'margin' ? round2(offer.maxAmount) : null,
  };
  state.player.loans.push(loan);

  const net = round2(offer.amount - offer.originationFee);
  const credited = creditCash(state, net, {
    kind: 'loan_take',
    description: `${kind} loan from ${offer.lenderName}: ${formatMoney(offer.amount)} over ${offer.termDays} days at ${(offer.apr * 100).toFixed(2)}% APR`,
    dirty: kind === 'loan_shark',
    counterparty: offer.lenderName,
    meta: { apr: offer.apr, termDays: offer.termDays, fee: offer.originationFee, collateral: collateral.length },
  });
  if (!credited.ok) {
    state.player.loans = state.player.loans.filter((l) => l.id !== loan.id);
    return { ok: false, reason: credited.reason ?? 'Could not credit the loan proceeds.', offer };
  }

  adjustCreditScore(state, kind === 'loan_shark' ? -6 : 4, `Opened a ${kind} loan with ${offer.lenderName}`);
  bumpCounter(state, 'loans_taken');
  setCounter(state, 'principal_borrowed', round2(counter(state, 'principal_borrowed') + offer.amount));
  grantXp(state, Math.round(8 + Math.log10(Math.max(1000, offer.amount)) * 6), `Arranged ${formatMoney(offer.amount)} of ${kind} financing`);

  pushNotification(state, {
    kind: kind === 'loan_shark' ? 'warning' : 'success',
    title: `${formatMoney(net)} received — ${kind} loan`,
    body: `${offer.lenderName}: ${(offer.apr * 100).toFixed(2)}% APR, ${offer.method} accrual, ${formatMoney(offer.paymentPerDay)}/day, due day ${loan.dueDay}. Origination fee ${formatMoney(offer.originationFee)}${
      collateral.length > 0 ? `. Pledged: ${collateral.map((c) => c.kind).join(', ')}.` : '.'
    }${kind === 'loan_shark' ? ' Miss payments and the pressure becomes physical.' : ''}`,
    link: '/game/bank',
    metrics: [
      { label: 'Principal', value: formatMoney(offer.amount) },
      { label: 'Total repayment', value: formatMoney(offer.totalRepayment) },
      { label: 'Interest', value: formatMoney(offer.totalInterest) },
      { label: 'Per day', value: formatMoney(offer.paymentPerDay) },
    ],
  });

  return { ok: true, loan, received: net, offer };
}

export function repayLoan(state: GameState, loanId: ID, amount: number): { ok: boolean; reason?: string; repaid?: number; settled?: boolean } {
  const loan = state.player.loans.find((l) => l.id === loanId);
  if (!loan) return { ok: false, reason: 'Loan not found.' };
  if (loan.status !== 'active') return { ok: false, reason: `That loan is ${loan.status}.` };
  const pay = Math.max(0, Math.min(round2(amount), loan.balance));
  if (pay <= 0) return { ok: false, reason: 'Payment must be positive.' };

  const move = debitCash(state, pay, {
    kind: 'loan_repay',
    description: `Repayment to ${loan.lenderName} (${loan.kind})`,
    allowDirty: loan.kind === 'loan_shark',
    counterparty: loan.lenderName,
    meta: { loanId, interestPaid: round2(interestAccrued(loan, state.world.day)) },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Insufficient funds.' };

  // Payments clear accrued interest first, then principal.
  const interest = round2(Math.min(pay, interestAccrued(loan, state.world.day)));
  const principal = round2(pay - interest);
  loan.balance = round2(Math.max(0, loan.balance - principal));
  loan.totalRepaid = round2(loan.totalRepaid + pay);
  loan.totalInterestPaid = round2(loan.totalInterestPaid + interest);
  loan.lastPaymentDay = state.world.day;
  if (loan.daysDelinquent > 0 && pay >= loan.paymentPerDay) {
    loan.daysDelinquent = Math.max(0, loan.daysDelinquent - 1);
    adjustCreditScore(state, B.finance.creditScore.onTimeRepaymentPerLoan * 0.4, 'Caught up on a late payment');
  }
  loan.pressure = round2(clamp(loan.pressure - 0.25, 0, 1));
  setCounter(state, 'interest_paid', round2(counter(state, 'interest_paid') + interest));
  setCounter(state, 'principal_repaid', round2(counter(state, 'principal_repaid') + principal));

  let settled = false;
  if (loan.balance <= 0.01) {
    loan.balance = 0;
    loan.status = 'repaid';
    settled = true;
    adjustCreditScore(state, B.finance.creditScore.fullRepaymentBonus, `Repaid ${loan.lenderName} in full`);
    bumpCounter(state, 'loans_repaid');
    grantXp(state, Math.round(20 + Math.log10(Math.max(1000, loan.principal)) * 10), 'Settled a debt in full');
    pushNotification(state, {
      kind: 'success',
      title: 'Loan settled',
      body: `${loan.lenderName} is paid in full. Total interest ${formatMoney(loan.totalInterestPaid)} on ${formatMoney(loan.principal)} borrowed. Collateral released.`,
      link: '/game/bank',
      metrics: [
        { label: 'Principal', value: formatMoney(loan.principal) },
        { label: 'Interest paid', value: formatMoney(loan.totalInterestPaid) },
      ],
    });
  }
  return { ok: true, repaid: pay, settled };
}

/** Interest accrued since the last payment, per the loan's method. */
export function interestAccrued(loan: Loan, day: number): number {
  const since = Math.max(0, day - loan.lastPaymentDay);
  if (since === 0) return 0;
  const rate = loan.daysDelinquent > 0 ? loan.penaltyApr : loan.apr;
  const daily = rate / 365;
  switch (loan.method) {
    case 'simple':
      return round2(loan.balance * daily * since);
    case 'amortized':
      return round2(loan.balance * daily * since);
    case 'compound':
    default: {
      const periods = since / Math.max(1, loan.compoundingPeriodDays);
      return round2(loan.balance * (Math.pow(1 + daily * loan.compoundingPeriodDays, periods) - 1));
    }
  }
}

export interface LoanTickResult {
  /** Today's accrual across all active loans (reported, not charged). */
  interestAccrued: number;
  /** Interest folded into principal at the end of a compounding period. */
  capitalised: number;
  scheduledPayments: number;
  lateFees: number;
  delinquent: ID[];
  defaults: ID[];
  seizures: { loanId: ID; kind: string; refId: ID }[];
  violence: { loanId: ID; combat: boolean }[];
  creditScoreChanges: number;
}

/** Daily debt service: accrual, delinquency, pressure, seizure and default. */
export function loanTick(state: GameState, rng: Rng): LoanTickResult {
  const result: LoanTickResult = { interestAccrued: 0, capitalised: 0, scheduledPayments: 0, lateFees: 0, delinquent: [], defaults: [], seizures: [], violence: [], creditScoreChanges: 0 };
  const day = state.world.day;

  for (const loan of state.player.loans) {
    if (loan.status !== 'active') continue;

    // Today's accrual, reported separately from capitalisation so the daily
    // report is a daily figure rather than a cumulative one.
    const rate = loan.daysDelinquent > 0 ? loan.penaltyApr : loan.apr;
    const accruedToday = round2(loan.balance * (rate / 365));
    result.interestAccrued = round2(result.interestAccrued + accruedToday);

    let overdue = false;
    if (loan.method === 'amortized') {
      // Amortising debt is serviced daily: pay what is due, or fall behind.
      const payment = debitCash(state, loan.paymentPerDay, {
        kind: 'loan_repay',
        description: `Scheduled payment to ${loan.lenderName}`,
        allowDirty: loan.kind === 'loan_shark',
        counterparty: loan.lenderName,
        meta: { loanId: loan.id },
      });
      if (payment.ok) {
        result.scheduledPayments = round2(result.scheduledPayments + loan.paymentPerDay);
        const interestPart = round2(Math.min(loan.paymentPerDay, accruedToday));
        const principalPart = round2(loan.paymentPerDay - interestPart);
        loan.balance = round2(Math.max(0, loan.balance - principalPart));
        loan.totalRepaid = round2(loan.totalRepaid + loan.paymentPerDay);
        loan.totalInterestPaid = round2(loan.totalInterestPaid + interestPart);
        loan.lastPaymentDay = day;
        setCounter(state, 'interest_paid', round2(counter(state, 'interest_paid') + interestPart));
        setCounter(state, 'principal_repaid', round2(counter(state, 'principal_repaid') + principalPart));
        if (loan.daysDelinquent > 0) {
          loan.daysDelinquent = Math.max(0, loan.daysDelinquent - 1);
          adjustCreditScore(state, B.finance.creditScore.onTimeRepaymentPerLoan * 0.4, 'Caught up on a scheduled payment');
        } else if (rng.chance(0.02)) {
          adjustCreditScore(state, B.finance.creditScore.onTimeRepaymentPerLoan * 0.25, 'Consistent on-time payments');
        }
        if (loan.balance <= 0.01) {
          loan.balance = 0;
          loan.status = 'repaid';
          adjustCreditScore(state, B.finance.creditScore.fullRepaymentBonus, `Repaid ${loan.lenderName} in full`);
          bumpCounter(state, 'loans_repaid');
          pushNotification(state, {
            kind: 'success',
            title: 'Loan settled',
            body: `${loan.lenderName} is paid in full. Interest paid ${formatMoney(loan.totalInterestPaid)} on ${formatMoney(loan.principal)} borrowed.`,
            link: '/game/bank',
          });
        }
      } else {
        overdue = true;
      }
    } else if (loan.method === 'compound') {
      // Compound debt capitalises at the end of each period: interest joins the
      // principal and no cash moves until the borrower repays.
      if (day - loan.lastPaymentDay >= loan.compoundingPeriodDays) {
        const capitalised = interestAccrued(loan, day);
        loan.balance = round2(loan.balance + capitalised);
        loan.totalInterestPaid = round2(loan.totalInterestPaid + capitalised);
        loan.lastPaymentDay = day;
        result.capitalised = round2(result.capitalised + capitalised);
        setCounter(state, 'interest_paid', round2(counter(state, 'interest_paid') + capitalised));
        pushDiagnostic(state, {
          system: 'finance',
          level: 'info',
          message: `Capitalised ${formatMoney(capitalised)} of interest on ${loan.kind} loan (${loan.lenderName}); balance ${formatMoney(loan.balance)}`,
          data: { loanId: loan.id, capitalised, balance: loan.balance },
        });
      }
      overdue = day > loan.dueDay;
    } else {
      // Simple interest: accrues, payable at maturity.
      overdue = day > loan.dueDay;
    }

    if (!overdue) continue;

    loan.daysDelinquent += 1;
    const hit = B.finance.bankLoan.creditScoreHitPerMissedDay;
    adjustCreditScore(state, -hit, `Missed payment on ${loan.kind} loan (${loan.daysDelinquent} day(s) late)`);
    result.creditScoreChanges -= hit;
    result.delinquent.push(loan.id);

    const lateFee = round2(loan.paymentPerDay * B.finance.bankLoan.lateFeeFraction * loan.daysDelinquent);
    if (lateFee > 0) {
      const fee = debitCash(state, lateFee, { kind: 'fee', description: `Late fee on ${loan.lenderName} loan`, allowDirty: true, counterparty: loan.lenderName });
      if (fee.ok) result.lateFees = round2(result.lateFees + lateFee);
      else loan.balance = round2(loan.balance + lateFee);
    }

    if (loan.kind === 'loan_shark') {
      loan.pressure = round2(clamp(loan.pressure + B.finance.loanShark.pressurePerDayOverdue, 0, 1));
      addHeat(state, loan.pressure * 2.2, 'Loan shark attention');
      if (loan.pressure >= 0.98 && rng.chance(B.finance.loanShark.violenceChanceAtMaxPressure)) {
        const combat = startCombat(state, rng, {
          kind: 'ambush',
          table: 'debt_collection',
          enemyCount: [1, 3],
          stakes: 'medium',
          reason: `${loan.lenderName} sent collectors to recover ${formatMoney(loan.balance)}.`,
          seedLabel: `debt:${loan.id}`,
        });
        result.violence.push({ loanId: loan.id, combat: combat.ok });
      }
    }

    // Seizure of pledged collateral.
    if (loan.daysDelinquent >= B.finance.bankLoan.seizureAfterDaysDelinquent && loan.collateral.length > 0) {
      for (const item of loan.collateral) {
        seizeCollateral(state, item);
        result.seizures.push({ loanId: loan.id, kind: item.kind, refId: item.refId });
      }
      loan.collateral = [];
    }

    // Default.
    if (loan.daysDelinquent >= B.finance.bankLoan.seizureAfterDaysDelinquent + 20) {
      loan.status = 'defaulted';
      result.defaults.push(loan.id);
      adjustCreditScore(state, -B.finance.creditScore.defaultPenalty, `Defaulted on ${loan.lenderName}`);
      changeReputation(state, 'business', -B.finance.loanShark.reputationDamageOnDefault * 0.6, 'Defaulted on a loan');
      if (loan.kind === 'loan_shark') {
        changeReputation(state, 'criminal', -B.finance.loanShark.reputationDamageOnDefault, 'Defaulted on a loan shark');
        addHeat(state, 18, 'A loan shark put a price on your reliability');
      }
      pushNews(state.world, {
        scope: 'local',
        category: 'finance',
        headline: `Default filed against a ${worldReg.requireLocation(state.player.locationId).name} trader`,
        body: `${loan.lenderName} wrote off ${formatMoney(loan.balance)}. Credit markets price that in for everyone nearby.`,
        locationIds: [state.player.locationId],
        tags: ['finance', 'credit'],
        importance: 2,
      });
      pushNotification(state, {
        kind: 'danger',
        title: 'Loan defaulted',
        body: `${loan.lenderName} wrote off ${formatMoney(loan.balance)}. Credit score −${B.finance.creditScore.defaultPenalty}${loan.collateral.length > 0 ? ' and pledged collateral was seized.' : '.'}`,
        link: '/game/bank',
      });
    }
  }
  return result;
}

function seizeCollateral(state: GameState, item: CollateralRef): void {
  switch (item.kind) {
    case 'property': {
      const property = state.player.properties.find((p) => p.id === item.refId);
      if (property) {
        state.player.properties = state.player.properties.filter((p) => p.id !== item.refId);
        pushNotification(state, { kind: 'danger', title: 'Property repossessed', body: `${property.name} was seized by your lender.`, link: '/game/properties' });
      }
      break;
    }
    case 'vehicle': {
      const vehicle = state.player.vehicles.find((v) => v.id === item.refId);
      if (vehicle) {
        state.player.vehicles = state.player.vehicles.filter((v) => v.id !== item.refId);
        pushNotification(state, { kind: 'danger', title: 'Vehicle repossessed', body: `${vehicle.name} was taken by your lender.`, link: '/game/logistics' });
      }
      break;
    }
    case 'stock': {
      const holding = state.player.stockHoldings.find((h) => h.companyId === item.refId);
      if (holding) {
        const value = round2(holding.shares * (state.world.companies[holding.companyId]?.price ?? holding.avgCost));
        state.player.stockHoldings = state.player.stockHoldings.filter((h) => h.companyId !== item.refId);
        pushNotification(state, { kind: 'danger', title: 'Shares liquidated by lender', body: `${holding.shares} shares worth ${formatMoney(value)} were sold to cover the debt.`, link: '/game/stocks' });
      }
      break;
    }
    case 'crypto': {
      const holding = state.player.cryptoHoldings.find((h) => h.assetId === item.refId);
      if (holding) {
        const value = round2(holding.amount * (state.world.cryptoAssets[holding.assetId]?.price ?? holding.avgCost));
        state.player.cryptoHoldings = state.player.cryptoHoldings.filter((h) => h.assetId !== item.refId);
        pushNotification(state, { kind: 'danger', title: 'Crypto collateral liquidated', body: `${holding.amount.toFixed(4)} coins worth ${formatMoney(value)} were seized.`, link: '/game/crypto' });
      }
      break;
    }
    case 'inventory': {
      const value = inventoryValue(state);
      state.player.inventory = [];
      pushNotification(state, { kind: 'danger', title: 'Inventory seized', body: `Warehoused goods worth about ${formatMoney(value)} were taken by your lender.`, link: '/game/inventory' });
      break;
    }
    default:
      break;
  }
}

export interface DebtSummary {
  totalOutstanding: number;
  byKind: { kind: LoanKind; count: number; balance: number; apr: number; paymentPerDay: number; dueDay: number | null; delinquentDays: number }[];
  totalDailyPayments: number;
  totalCollateralValue: number;
  worstDelinquency: number;
  creditScore: number;
  netWorth: number;
  leverage: number;
  bankruptcyDistance: number;
}

export function debtSummary(state: GameState): DebtSummary {
  const active = state.player.loans.filter((l) => l.status === 'active');
  const kinds: LoanKind[] = ['bank', 'loan_shark', 'mortgage', 'margin', 'business', 'faction'];
  const worth = computeNetWorth(state).total;
  const total = round2(active.reduce((s, l) => s + l.balance, 0));
  return {
    totalOutstanding: total,
    byKind: kinds
      .map((kind) => {
        const list = active.filter((l) => l.kind === kind);
        if (list.length === 0) return null;
        return {
          kind,
          count: list.length,
          balance: round2(list.reduce((s, l) => s + l.balance, 0)),
          apr: round2(list.reduce((s, l) => s + l.apr, 0) / list.length),
          paymentPerDay: round2(list.reduce((s, l) => s + l.paymentPerDay, 0)),
          dueDay: Math.min(...list.map((l) => l.dueDay)),
          delinquentDays: Math.max(...list.map((l) => l.daysDelinquent)),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
    totalDailyPayments: round2(active.reduce((s, l) => s + l.paymentPerDay, 0)),
    totalCollateralValue: round2(active.reduce((s, l) => s + l.collateral.reduce((ss, c) => ss + c.valuedAt, 0), 0)),
    worstDelinquency: active.reduce((m, l) => Math.max(m, l.daysDelinquent), 0),
    creditScore: state.player.creditScore,
    netWorth: round2(worth),
    leverage: worth > 0 ? round2(total / worth) : total > 0 ? 99 : 0,
    bankruptcyDistance: round2(worth - B.finance.bankruptcyThreshold),
  };
}

/* ------------------------------------------------------------------ */
/* Laundering                                                          */
/* ------------------------------------------------------------------ */

export interface LaunderingFront {
  businessId: ID;
  name: string;
  locationName: string;
  throughputPerDay: number;
  feeFraction: number;
  detectionChance: number;
  buffer: number;
  launderedTotal: number;
  suspended: boolean;
  usable: boolean;
  reason?: string;
}

export function launderingFronts(state: GameState): LaunderingFront[] {
  const mods = playerModifiers(state);
  const feeCut = launderingFeeReduction(mods);
  const detectionCut = launderingDetectionReduction(mods);
  return state.player.businesses.map((business) => {
    const throughput = round2(B.finance.laundering.throughputPerFrontPerDay * (1 + business.level * 0.35) * (0.6 + business.clientele * 0.7));
    const feeFraction = round2(clamp(B.finance.laundering.feeFraction * (1 - feeCut), 0.04, 0.5));
    const detection = round2(clamp(B.finance.laundering.detectionChance * (1 - detectionCut) * (1.35 - business.clientele * 0.5), 0.002, 0.5));
    return {
      businessId: business.id,
      name: business.name,
      locationName: worldReg.location(business.locationId)?.name ?? business.locationId,
      throughputPerDay: throughput,
      feeFraction,
      detectionChance: detection,
      buffer: round2(business.launderingBuffer),
      launderedTotal: round2(business.launderedTotal),
      suspended: business.suspended,
      usable: !business.suspended,
      ...(business.suspended ? { reason: 'The business is suspended — it cannot process cash.' } : {}),
    };
  });
}

export function launder(
  state: GameState,
  rng: Rng,
  amount: number,
  businessId?: ID,
): { ok: boolean; reason?: string; staged?: number; front?: string; feeEstimate?: number; daysToClear?: number } {
  const dirty = dirtyBalance(state.player);
  if (amount <= 0) return { ok: false, reason: 'Amount must be positive.' };
  if (amount < B.finance.laundering.minCleanableAmount) {
    return { ok: false, reason: `Amounts under ${formatMoney(B.finance.laundering.minCleanableAmount)} are not worth the risk of moving through a front.` };
  }
  if (amount > dirty) return { ok: false, reason: `You only have ${formatMoney(dirty)} of unlaundered cash.` };

  const fronts = launderingFronts(state).filter((f) => f.usable);
  if (fronts.length === 0) {
    return { ok: false, reason: 'You need an operating business to wash cash through. Buy or open a front.' };
  }
  const front = businessId ? fronts.find((f) => f.businessId === businessId) : fronts.sort((a, b) => b.throughputPerDay - a.throughputPerDay)[0];
  if (!front) return { ok: false, reason: 'That business cannot be used for laundering right now.' };

  const staged = round2(Math.min(amount, front.throughputPerDay * 6));
  const move = debitCash(state, staged, {
    kind: 'launder',
    description: `Staged ${formatMoney(staged)} of cash through ${front.name}`,
    allowDirty: true,
    counterparty: front.name,
    meta: { businessId: front.businessId, feeFraction: front.feeFraction },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Could not move that cash.' };

  const business = state.player.businesses.find((b) => b.id === front.businessId)!;
  business.launderingBuffer = round2(business.launderingBuffer + staged);
  const feeEstimate = round2(staged * front.feeFraction);
  const daysToClear = Math.max(1, Math.ceil(staged / front.throughputPerDay));

  // Structuring cash into a business is itself suspicious.
  const trace = clamp(staged / 250_000, 0.05, 1.4) * (1 - launderingDetectionReduction(playerModifiers(state)));
  addHeat(state, trace * 3.2, `Staged ${formatMoney(staged)} through ${front.name}`);
  void rng;

  pushNotification(state, {
    kind: 'info',
    title: `Cash staged: ${formatMoney(staged)}`,
    body: `${front.name} will work it through the till at up to ${formatMoney(front.throughputPerDay)}/day. Expect about ${daysToClear} day(s) and ${formatMoney(feeEstimate)} in fees, with a ${(front.detectionChance * 100).toFixed(1)}% daily detection chance.`,
    link: '/game/bank',
    metrics: [
      { label: 'Staged', value: formatMoney(staged) },
      { label: 'Throughput/day', value: formatMoney(front.throughputPerDay) },
      { label: 'Fee estimate', value: formatMoney(feeEstimate) },
      { label: 'Detection/day', value: `${(front.detectionChance * 100).toFixed(1)}%` },
    ],
  });
  return { ok: true, staged, front: front.name, feeEstimate, daysToClear };
}

export interface LaunderingTickResult {
  cleaned: number;
  fees: number;
  detections: number;
  frontsUsed: number;
}

/** Daily conversion of staged cash into clean money through each front. */
export function launderingTick(state: GameState, rng: Rng): LaunderingTickResult {
  const result: LaunderingTickResult = { cleaned: 0, fees: 0, detections: 0, frontsUsed: 0 };
  const mods = playerModifiers(state);
  const feeCut = launderingFeeReduction(mods);
  const detectionCut = launderingDetectionReduction(mods);

  for (const business of state.player.businesses) {
    if (business.launderingBuffer <= 0 || business.suspended) continue;
    const throughput = B.finance.laundering.throughputPerFrontPerDay * (1 + business.level * 0.35) * (0.6 + business.clientele * 0.7);
    const processed = round2(Math.min(business.launderingBuffer, throughput * rng.float(0.7, 1.15)));
    if (processed <= 0) continue;
    result.frontsUsed += 1;

    const feeFraction = clamp(B.finance.laundering.feeFraction * (1 - feeCut) * rng.float(1 - B.finance.laundering.feeVariance, 1 + B.finance.laundering.feeVariance), 0.04, 0.5);
    const fee = round2(processed * feeFraction);
    const clean = round2(processed - fee);

    business.launderingBuffer = round2(business.launderingBuffer - processed);
    business.launderedTotal = round2(business.launderedTotal + processed);
    business.cashbox = round2(business.cashbox + clean * 0.25);

    creditCash(state, clean, {
      kind: 'launder',
      description: `Cleaned ${formatMoney(clean)} through ${business.name} (fee ${formatMoney(fee)})`,
      dirty: false,
      counterparty: business.name,
      meta: { businessId: business.id, processed, fee },
    });

    result.cleaned = round2(result.cleaned + clean);
    result.fees = round2(result.fees + fee);
    setCounter(state, 'laundered', round2(counter(state, 'laundered') + clean));
    setCounter(state, 'laundering_fees', round2(counter(state, 'laundering_fees') + fee));
    grantXp(state, Math.max(2, Math.round(Math.sqrt(clean) * 0.1)), `Laundered ${formatMoney(clean)} through ${business.name}`);

    // Detection.
    const detection = clamp(
      (B.finance.laundering.detectionChance + processed * B.finance.laundering.detectionScaleByAmount) * (1 - detectionCut) * (1.35 - business.clientele * 0.5),
      0.001,
      0.6,
    );
    if (rng.chance(detection)) {
      result.detections += 1;
      const heat = round2(12 + processed / 40_000);
      addHeat(state, heat, `Suspicious cash flow detected at ${business.name}`);
      changeReputation(state, 'legal', -6, 'Flagged for suspicious cash flow');
      changeReputation(state, 'criminal', 3, 'Moved serious cash through a front');
      startInvestigation(state, `Financial investigators traced structured deposits through ${business.name}.`);
      const seized = round2(clean * 0.6);
      debitCash(state, seized, { kind: 'seizure', description: `Cash seized during a laundering investigation at ${business.name}`, allowDirty: false, counterparty: 'Financial Intelligence Unit' });
      business.suspended = true;
      business.suspendedUntilDay = state.world.day + rng.int(5, 18);
      pushNotification(state, {
        kind: 'danger',
        title: 'Laundering detected',
        body: `Investigators flagged ${business.name}. ${formatMoney(seized)} seized, the business is suspended until day ${business.suspendedUntilDay}, and an investigation is open. Detection chance was ${(detection * 100).toFixed(1)}%.`,
        link: '/game/bank',
        metrics: [
          { label: 'Seized', value: formatMoney(seized) },
          { label: 'Heat', value: `+${heat}` },
        ],
      });
      pushNews(state.world, {
        scope: 'local',
        category: 'crime',
        headline: `Cash laundering probe into ${business.name}`,
        body: `Regulators froze the till and seized ${formatMoney(seized)} after structuring was detected. Investigators are tracing the beneficial owner.`,
        locationIds: [business.locationId],
        tags: ['crime', 'finance', 'laundering'],
        importance: 3,
      });
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Taxation                                                            */
/* ------------------------------------------------------------------ */

export interface TaxLine {
  category: string;
  base: number;
  rate: number;
  amount: number;
  explanation: string;
}

export interface TaxAssessment {
  periodStartDay: number;
  periodEndDay: number;
  lines: TaxLine[];
  taxableIncome: number;
  grossLiability: number;
  reductions: number;
  liability: number;
  paid: number;
  arrears: number;
  effectiveRate: number;
  offshoreShare: number;
  auditRisk: number;
}

const TAXABLE_KINDS: Partial<Record<TransactionRecord['kind'], { category: string; rate: 'income' | 'gains' }>> = {
  sell: { category: 'Trading income', rate: 'income' },
  mission_reward: { category: 'Contract income', rate: 'income' },
  combat_loot: { category: 'Other income', rate: 'income' },
  mining_reward: { category: 'Mining income', rate: 'income' },
  staking_reward: { category: 'Staking income', rate: 'income' },
  stock_sell: { category: 'Capital gains (equities)', rate: 'gains' },
  crypto_sell: { category: 'Capital gains (digital assets)', rate: 'gains' },
};

/**
 * Reconstruct the tax base from the transaction ledger rather than trusting a
 * counter: the ledger is hash-chained, so the assessment is auditable and cannot
 * be inflated or deflated by a client.
 */
export function assessTaxes(state: GameState, periodStartDay: number, periodEndDay: number): TaxAssessment {
  const mods = playerModifiers(state);
  const reduction = taxReduction(mods);
  const offshoreAccounts = state.player.accounts.filter((a) => a.kind === 'offshore' || a.kind === 'shell');
  const offshoreShare = state.player.accounts.length > 0 ? clamp(offshoreAccounts.length / Math.max(1, state.player.accounts.length) * 0.65, 0, 0.65) : 0;

  const byCategory = new Map<string, { base: number; rate: 'income' | 'gains' }>();
  for (const tx of state.player.recentTransactions) {
    if (tx.day < periodStartDay || tx.day > periodEndDay) continue;
    const rule = TAXABLE_KINDS[tx.kind];
    if (!rule) continue;
    // Gains are taxed on profit, not turnover.
    let base = tx.amount;
    if (tx.kind === 'sell') {
      const costBasis = typeof tx.meta.costBasis === 'number' ? tx.meta.costBasis : 0;
      base = tx.amount - costBasis;
    } else if (tx.kind === 'stock_sell' || tx.kind === 'crypto_sell') {
      base = typeof tx.meta.gain === 'number' ? tx.meta.gain : 0;
    }
    if (base <= 0) continue;
    const existing = byCategory.get(rule.category);
    if (existing) existing.base += base;
    else byCategory.set(rule.category, { base, rate: rule.rate });
  }

  const lines: TaxLine[] = [];
  let gross = 0;
  for (const [category, entry] of byCategory) {
    const rate = entry.rate === 'income' ? B.finance.tax.incomeTaxRate : B.finance.tax.capitalGainsRate;
    const amount = round2(entry.base * rate);
    gross = round2(gross + amount);
    lines.push({
      category,
      base: round2(entry.base),
      rate,
      amount,
      explanation:
        entry.rate === 'income'
          ? `${formatMoney(round2(entry.base))} of realised income at ${(rate * 100).toFixed(0)}%.`
          : `${formatMoney(round2(entry.base))} of gains above cost basis at ${(rate * 100).toFixed(0)}%.`,
    });
  }

  // Property holding tax.
  const propertyTax = round2(state.player.properties.reduce((s, p) => s + p.valuation, 0) * 0.0018);
  if (propertyTax > 0) {
    gross = round2(gross + propertyTax);
    lines.push({ category: 'Property tax', base: round2(state.player.properties.reduce((s, p) => s + p.valuation, 0)), rate: 0.0018, amount: propertyTax, explanation: '0.18% of assessed property value per period.' });
  }

  const reductions = round2(gross * (reduction + offshoreShare));
  const liability = round2(Math.max(0, gross - reductions));
  const taxableIncome = round2([...byCategory.values()].reduce((s, e) => s + e.base, 0));
  const arrears = round2(counter(state, 'tax_arrears'));
  const auditRisk = round2(
    clamp(
      (liability > 0 ? B.finance.tax.taxAuditChancePerDayByWealth * computeNetWorth(state).total * TAX_PERIOD_DAYS : 0) +
        (arrears > 0 ? 0.18 : 0) +
        (offshoreShare > 0.3 ? 0.05 : 0),
      0,
      0.6,
    ),
  );

  return {
    periodStartDay,
    periodEndDay,
    lines,
    taxableIncome,
    grossLiability: gross,
    reductions,
    liability,
    paid: round2(counter(state, 'tax_paid')),
    arrears,
    effectiveRate: taxableIncome > 0 ? round2(liability / taxableIncome) : 0,
    offshoreShare: round2(offshoreShare),
    auditRisk,
  };
}

export interface TaxTickResult {
  assessed: boolean;
  assessment: TaxAssessment | null;
  paid: number;
  arrearsAdded: number;
  penalty: number;
  audited: boolean;
  accountFrozen: boolean;
}

export function taxTick(state: GameState, rng: Rng): TaxTickResult {
  const result: TaxTickResult = { assessed: false, assessment: null, paid: 0, arrearsAdded: 0, penalty: 0, audited: false, accountFrozen: false };
  const lastAssessment = counter(state, 'tax_last_assessment_day');
  const day = state.world.day;
  if (day - lastAssessment >= TAX_PERIOD_DAYS) {
    const assessment = assessTaxes(state, lastAssessment, day);
    result.assessed = true;
    result.assessment = assessment;
    setCounter(state, 'tax_last_assessment_day', day);

    if (assessment.liability > 0) {
      const move = debitCash(state, assessment.liability, {
        kind: 'tax',
        description: `Tax assessment for days ${lastAssessment}–${day}`,
        allowDirty: false,
        meta: { taxable: assessment.taxableIncome, reductions: assessment.reductions },
      });
      if (move.ok) {
        result.paid = assessment.liability;
        setCounter(state, 'tax_paid', round2(counter(state, 'tax_paid') + assessment.liability));
        pushNotification(state, {
          kind: 'info',
          title: `Tax paid: ${formatMoney(assessment.liability)}`,
          body: `Assessment for days ${lastAssessment}–${day}: ${formatMoney(assessment.taxableIncome)} taxable, ${formatMoney(assessment.reductions)} of reductions from planning${assessment.offshoreShare > 0 ? ' and offshore structures' : ''}. Effective rate ${(assessment.effectiveRate * 100).toFixed(1)}%.`,
          link: '/game/bank',
          metrics: assessment.lines.slice(0, 6).map((l) => ({ label: l.category, value: formatMoney(l.amount) })),
        });
      } else {
        const arrears = round2(counter(state, 'tax_arrears') + assessment.liability);
        setCounter(state, 'tax_arrears', arrears);
        result.arrearsAdded = assessment.liability;
        adjustCreditScore(state, -14, 'Unpaid tax assessment');
        addHeat(state, 8, 'Unpaid taxes');
        pushNotification(state, {
          kind: 'danger',
          title: `Tax unpaid: ${formatMoney(assessment.liability)}`,
          body: `You could not cover the assessment. Arrears now ${formatMoney(arrears)}. Penalties accrue at ${(B.finance.tax.evasionPenaltyMultiplier * 100 - 100).toFixed(0)}% and audits become likely.`,
          link: '/game/bank',
          metrics: [{ label: 'Arrears', value: formatMoney(arrears) }],
        });
      }
    }

    // Audit.
    if (rng.chance(assessment.auditRisk)) {
      result.audited = true;
      const arrears = counter(state, 'tax_arrears');
      // An audit only costs money when there is something to find. Audits caused
      // purely by holding offshore structures are a freeze and a warning.
      const exposure = assessment.taxableIncome > 0 || arrears > 0;
      const penalty = exposure
        ? round2(Math.max(500, (assessment.taxableIncome * 0.06 + arrears) * B.finance.tax.evasionPenaltyMultiplier))
        : 0;
      const move = debitCash(state, penalty, { kind: 'fine', description: 'Tax audit penalty and back assessment', allowDirty: false, counterparty: 'Revenue Authority' });
      result.penalty = move.ok ? penalty : 0;
      if (move.ok) setCounter(state, 'tax_arrears', Math.max(0, arrears - penalty * 0.5));
      addHeat(state, 14, 'Tax audit');
      changeReputation(state, 'legal', -8, 'Audited by the revenue authority');
      startInvestigation(state, 'A tax audit opened your books to the authorities.');
      // Audits can freeze accounts.
      if (rng.chance(0.4)) {
        const target = state.player.accounts.filter((a) => !a.frozen && a.balance > 0).sort((a, b) => b.balance - a.balance)[0];
        if (target) {
          target.frozen = true;
          target.frozenUntilDay = day + rng.int(8, 30);
          target.freezeReason = 'Frozen pending tax audit';
          result.accountFrozen = true;
        }
      }
      pushNotification(state, {
        kind: 'danger',
        title: 'Tax audit',
        body: exposure
          ? `The revenue authority audited you and found ${formatMoney(assessment.taxableIncome)} of undeclared activity. Penalty ${formatMoney(penalty)}${result.accountFrozen ? ' and your largest account is frozen' : ''}. Audit risk was ${(assessment.auditRisk * 100).toFixed(1)}%.`
          : `The revenue authority audited you and found nothing to assess${result.accountFrozen ? ', but your largest account is frozen while they finish the review' : ''}. Audit risk was ${(assessment.auditRisk * 100).toFixed(1)}%, raised by your offshore structure.`,
        link: '/game/bank',
        metrics: [
          { label: 'Penalty', value: formatMoney(penalty) },
          { label: 'Taxable income', value: formatMoney(assessment.taxableIncome) },
        ],
      });
      pushNews(state.world, {
        scope: 'national',
        category: 'finance',
        headline: 'Revenue authority intensifies audits of traders',
        body: `Assessments are being reopened across the ${worldReg.requireLocation(state.player.locationId).countryName} trading sector. Penalties run at ${(B.finance.tax.evasionPenaltyMultiplier * 100).toFixed(0)}% of the underpayment.`,
        locationIds: [state.player.locationId],
        tags: ['finance', 'tax'],
        importance: 2,
      });
    }
  }

  // Arrears accrue penalties daily.
  const arrears = counter(state, 'tax_arrears');
  if (arrears > 0) {
    const penalty = round2(arrears * 0.0009);
    setCounter(state, 'tax_arrears', round2(arrears + penalty));
    result.penalty = round2(result.penalty + penalty);
  }
  return result;
}

export function payTaxArrears(state: GameState, amount: number): { ok: boolean; reason?: string; paid?: number } {
  const arrears = counter(state, 'tax_arrears');
  if (arrears <= 0) return { ok: false, reason: 'No tax arrears outstanding.' };
  const pay = round2(Math.min(Math.max(0, amount), arrears));
  if (pay <= 0) return { ok: false, reason: 'Payment must be positive.' };
  const move = debitCash(state, pay, { kind: 'tax', description: 'Voluntary payment of tax arrears', allowDirty: false, counterparty: 'Revenue Authority' });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Insufficient funds.' };
  const remaining = round2(arrears - pay);
  setCounter(state, 'tax_arrears', remaining);
  setCounter(state, 'tax_paid', round2(counter(state, 'tax_paid') + pay));
  if (remaining <= 0) {
    adjustCreditScore(state, 18, 'Tax arrears cleared');
    changeReputation(state, 'legal', 5, 'Settled with the revenue authority');
    if (state.player.reputation.heat < 30) closeInvestigation(state, 'Tax arrears cleared; the file was closed.');
  }
  return { ok: true, paid: pay };
}

/* ------------------------------------------------------------------ */
/* Financial summary                                                   */
/* ------------------------------------------------------------------ */

export interface FinanceView {
  cash: number;
  clean: number;
  dirty: number;
  netWorth: number;
  debt: number;
  leverage: number;
  creditScore: number;
  creditBand: string;
  accounts: AccountView[];
  loans: {
    id: ID;
    kind: LoanKind;
    lenderName: string;
    balance: number;
    apr: number;
    effectiveApr: number;
    method: Loan['method'];
    paymentPerDay: number;
    dueDay: number;
    daysDelinquent: number;
    pressure: number;
    collateral: { kind: string; label: string; valuedAt: number }[];
    accruedInterest: number;
    totalRepaid: number;
    totalInterestPaid: number;
    status: Loan['status'];
  }[];
  dailyDebtService: number;
  dailyInterestIncome: number;
  laundering: { buffer: number; launderedTotal: number; fronts: LaunderingFront[] };
  tax: TaxAssessment;
  offers: LoanOffer[];
  collateral: { total: number; lines: { kind: string; label: string; value: number; lendable: number }[] };
  bankruptcyRisk: string;
}

export function financeView(state: GameState): FinanceView {
  const worth = computeNetWorth(state);
  const debt = debtSummary(state);
  const credit = creditScoreView(state);
  const fronts = launderingFronts(state);
  const kinds: LoanKind[] = ['bank', 'loan_shark', 'mortgage', 'margin', 'business', 'faction'];
  const referenceAmount = Math.max(10_000, Math.min(250_000, worth.total * 0.25));
  return {
    cash: round2(totalBalance(state.player)),
    clean: round2(cleanBalance(state.player)),
    dirty: round2(dirtyBalance(state.player)),
    netWorth: round2(worth.total),
    debt: debt.totalOutstanding,
    leverage: debt.leverage,
    creditScore: credit.score,
    creditBand: credit.band,
    accounts: accountViews(state),
    loans: state.player.loans
      .filter((l) => l.status === 'active' || l.status === 'defaulted')
      .map((l) => ({
        id: l.id,
        kind: l.kind,
        lenderName: l.lenderName,
        balance: round2(l.balance),
        apr: l.apr,
        effectiveApr: l.daysDelinquent > 0 ? l.penaltyApr : l.apr,
        method: l.method,
        paymentPerDay: l.paymentPerDay,
        dueDay: l.dueDay,
        daysDelinquent: l.daysDelinquent,
        pressure: l.pressure,
        collateral: l.collateral.map((c) => ({ kind: c.kind, label: collateralLabel(state, c), valuedAt: c.valuedAt })),
        accruedInterest: interestAccrued(l, state.world.day),
        totalRepaid: l.totalRepaid,
        totalInterestPaid: l.totalInterestPaid,
        status: l.status,
      })),
    dailyDebtService: debt.totalDailyPayments,
    dailyInterestIncome: round2(state.player.accounts.reduce((s, a) => s + (Math.max(0, a.balance - a.dirtyBalance) * a.apy) / 365, 0)),
    laundering: {
      buffer: round2(state.player.businesses.reduce((s, b) => s + b.launderingBuffer, 0)),
      launderedTotal: round2(state.player.businesses.reduce((s, b) => s + b.launderedTotal, 0)),
      fronts,
    },
    tax: assessTaxes(state, counter(state, 'tax_last_assessment_day'), state.world.day),
    offers: kinds.map((kind) => loanOffer(state, kind, referenceAmount, 365)),
    collateral: { total: collateralCapacity(state).total, lines: collateralCapacity(state).lines },
    bankruptcyRisk: bankruptcyRiskLabel(state),
  };
}

function collateralLabel(state: GameState, ref: CollateralRef): string {
  switch (ref.kind) {
    case 'property':
      return state.player.properties.find((p) => p.id === ref.refId)?.name ?? ref.refId;
    case 'vehicle':
      return state.player.vehicles.find((v) => v.id === ref.refId)?.name ?? ref.refId;
    case 'stock':
      return COMPANY_BY_ID[ref.refId]?.ticker ?? ref.refId;
    case 'crypto':
      return ref.refId;
    default:
      return 'Warehoused goods';
  }
}

export function bankruptcyRiskLabel(state: GameState): string {
  const worth = computeNetWorth(state).total;
  const debt = debtTotal(state.player);
  const threshold = B.finance.bankruptcyThreshold;
  if (worth <= threshold) return 'Bankrupt — the run is over on the next valuation.';
  if (worth < 0) return 'Critical: liabilities exceed assets.';
  if (debt > worth * 1.5 && debt > 50_000) return 'Severely leveraged: a bad month would be fatal.';
  if (debt > worth * 0.6) return 'Leveraged: debt service is a large share of your net worth.';
  if (debt > 0) return 'Manageable debt.';
  return 'Debt free.';
}

/** Cash available for discretionary spending after reserving debt service. */
export function discretionaryCash(state: GameState): number {
  const service = state.player.loans.filter((l) => l.status === 'active').reduce((s, l) => s + l.paymentPerDay * 7, 0);
  return round2(Math.max(0, cleanBalance(state.player) - service));
}

/** Convenience for other systems: total commodity value held (used as collateral). */
export function inventoryCollateralValue(state: GameState): number {
  return round2(inventoryValue(state));
}

export function describeCommodity(commodityId: ID): string {
  return registry.get(commodityId)?.name ?? commodityId;
}
