/**
 * Every user-facing string, in one place (concept §9).
 *
 * Not an i18n layer — the game ships English-only and a second language is
 * explicitly out of scope for this phase. This is the preparation the concept
 * schedules here because "preparing costs almost nothing, retrofitting is
 * expensive": once a translation exists, it needs one module to swap and not a
 * search across every component.
 *
 * Two rules keep it useful rather than ceremonial:
 *
 * 1. Anything with a value in it is a function, not a template built at the
 *    call site. Word order moves between languages, and a sentence assembled
 *    from fragments cannot be reordered by a translator.
 * 2. Keys name what the string *is*, not what it currently says, so changing
 *    the wording never means renaming a key.
 */

const percent = (fraction: number, digits = 1): string =>
  `${(fraction * 100).toFixed(digits)} %`;

export const strings = {
  app: {
    title: 'GO/NOGO',
    vehicle: 'GN-1 VANGUARD',
  },

  consoles: {
    launch: 'LAUNCH',
    flight: 'FLIGHT',
    comms: 'COMMS',
    engineering: 'ENGINEERING',
    eventLog: 'EVENT LOG',
    planner: 'PLANNER',
    postMortem: 'POST-MORTEM',
  },

  controls: {
    pause: 'PAUSE',
    resume: 'RESUME',
    save: 'SAVE',
    keys: 'KEYS',
    soundOn: 'SOUND ON',
    soundOff: 'SOUND OFF',
    restart: 'RESTART',
    close: 'CLOSE',
    reset: 'RESET',
    anomalyCount: (count: number): string => `${count} ANOMALY`,
    resumedFromSave: 'Resumed from the last auto-save.',
    resultReady: (measure: string): string => `RESULT READY — ${measure}. Pause to read it?`,
  },

  keyBindings: {
    heading: 'KEY BINDINGS',
    pressAKey: 'press a key…',
    unbound: 'unbound',
    note:
      '1–5 stay on the consoles: the tab bar prints those numbers, and a player who rebound one ' +
      'would have no way back to it. Q W E R T belong to the focused panel unless you take them.',
  },

  launch: {
    checklist: 'PRELAUNCH CHECKLIST',
    telemetry: 'TELEMETRY',
    orbitMap: 'ORBIT MAP',
    velocity: 'VELOCITY',
    acceleration: 'ACCELERATION',
    stage: 'STAGE',
    orbit: 'ORBIT',
    propellant: 'PROPELLANT',
    burn: 'BURN',
    coast: 'COAST',
    riskBudget: 'RISK BUDGET',
    suborbital: 'SUBORBITAL',
    armAndLaunch: 'ARM AND LAUNCH',
    allStationsGo: 'ALL STATIONS MUST REPORT GO',
    terminalCount: 'TERMINAL COUNT RUNNING',
    flightInProgress: 'FLIGHT IN PROGRESS',
    riskSpread: (points: number): string =>
      `An estimate, not a number: the spread is what you have not paid to find out. Currently ±${points.toFixed(1)} points wide.`,
  },

  engineering: {
    noAnomaly: 'NO ACTIVE ANOMALY',
    noAnomalyBody:
      'All systems reporting nominal. The diagnosis panel arms itself when something does not.',
    escalationIn: 'ESCALATION IN',
    channels: 'CHANNELS',
    reported: 'REPORTED',
    candidates: 'CANDIDATES',
    diagnose: 'DIAGNOSE',
    actWithoutCertainty: 'ACT WITHOUT CERTAINTY',
    commandTimeline: 'COMMAND TIMELINE',
    nothingQueued: 'Nothing queued.',
    escalation: 'ESCALATION',
    waitingForReading: 'Waiting for a reading…',
  },

  comms: {
    link: 'LINK',
    noContact: 'NO CONTACT',
    noContactBody: 'Nothing above the horizon. Data stays aboard.',
    channels: 'CHANNELS',
    channelsFree: (free: number, capacity: number): string => `${free} free of ${capacity}`,
    groundStations: 'GROUND STATIONS',
    belowHorizon: 'below horizon',
    downlink: 'DOWNLINK',
    noScience: 'No science aboard. This contract pays in money alone.',
    delivered: '% delivered',
    onTheGround: 'ON THE GROUND',
    stillAboard: 'STILL ABOARD',
    downlinkNote:
      'Science counts when it lands, not when it is recorded. Every channel the diagnosis panel ' +
      'takes is a channel not carrying it home.',
  },

  planner: {
    lossOfMission: 'LOSS OF MISSION',
    unknownPoints: (points: number): string => `±${points.toFixed(1)} points unknown`,
    cost: 'COST',
    redundancyMass: 'REDUNDANCY MASS',
    qualityAssurance: 'QUALITY ASSURANCE',
    units: 'UNITS',
    contributes: 'CONTRIBUTES',
    locked: 'locked',
    discard: 'DISCARD',
    build: 'BUILD AND ROLL OUT',
    nothingChanged: 'Nothing changed yet. Applying now would fly the identical vehicle.',
    slotsChanged: (count: number): string =>
      `${count} slot${count === 1 ? '' : 's'} changed. Those get new hardware; every other part stays the one it was.`,

    board: (week: number): string => `WEEK ${week} · BOARD`,
    capital: 'CAPITAL',
    terms: (contract: {
      fee: number;
      penalty: number;
      requiredQaLevel: string;
      maxAcceptedRisk: number;
      researchData: number;
    }): string => {
      const parts = [
        `${contract.fee}k`,
        `penalty ${contract.penalty}k`,
        `needs ${contract.requiredQaLevel}`,
      ];
      if (contract.maxAcceptedRisk < 1) {
        parts.push(`max ${percent(contract.maxAcceptedRisk, 0)} LOM`);
      }
      if (contract.researchData > 0) parts.push(`${contract.researchData} data`);
      return parts.join(' · ');
    },

    research: 'RESEARCH',
    dataUnits: (amount: number): string => `${amount} data`,
    branchComplete: 'Branch complete.',
    forkWarning: (level: number): string =>
      `Level ${level}: one choice, once. It cannot be taken back.`,
    branchLevel: (level: number): string => `level ${level}`,

    engineers: 'ENGINEERS',
    dismiss: 'dismiss',
    payroll: (hired: number, max: number, perWeek: number, debt: number): string =>
      debt > 0
        ? `${hired}/${max} · ${perWeek}k per week (incl. ${debt}k debt)`
        : `${hired}/${max} · ${perWeek}k per week`,
    payrollSandbox: (hired: number, max: number): string =>
      `${hired}/${max} · no fixed costs in the sandbox`,
    engineersNote:
      'An engineer makes their own team faster to ask, and their guesses sharper. A second one in ' +
      'the same specialty costs the same and adds nothing.',

    sandboxLocked: (unlockedBy: string): string => `Locked. ${unlockedBy}`,

    investorInControl: 'INVESTOR IN CONTROL — debt cleared, standing lost in every market.',
    dictated: (count: number): string =>
      `${count} contract${count === 1 ? '' : 's'} still dictated.`,
    frozen: (branches: string): string => `Research frozen on ${branches}.`,
    campaignOver:
      'CAMPAIGN OVER — the investor has written the company off. A second bankruptcy ends it.',
    inTheRed: (secondWeek: boolean): string =>
      `ACCOUNT IN THE RED — ${secondWeek ? 'second week' : 'first week'}. Two in a row and the investor steps in.`,
  },

  postMortem: {
    vehicleLost: 'VEHICLE LOST',
    missionComplete: 'MISSION COMPLETE',
    stillRunning: 'The flight is still running.',
    riskBudget: 'RISK BUDGET AS FLOWN',
    lossOfMission: 'loss of mission',
    riskNote:
      'What the vehicle was priced at before it flew, worst line first. The spread is what was ' +
      'never paid to find out.',
    inNumbers: 'THE FLIGHT IN NUMBERS',
    anomalies: 'ANOMALIES',
    diagnosesBought: 'DIAGNOSES BOUGHT',
    wrongMeasures: 'WRONG MEASURES',
    neverTouched: 'NEVER TOUCHED',
    nothingMaterialised: 'Nothing materialised. The budget was paid for a flight that stayed quiet.',
    nobodyLooked: 'Nobody looked at it.',
    window: (used: number, total: number): string =>
      `${used.toFixed(1)} s of a ${total.toFixed(0)} s window`,
    verdicts: {
      resolved: 'RESOLVED',
      escalated: 'ESCALATED',
      open: 'NEVER CLOSED',
    },
    confirmed: (cause: string): string => `confirmed ${cause}`,
    ruledOut: (causes: string): string => `ruled out ${causes}`,
    toldNothing: 'told you nothing new',
    fixedIt: 'fixed it',
    wrongAndCaused: (chain: string): string => `wrong — and it set off ${chain}`,
    wrongNoEffect: 'wrong — no effect',
    retrySame: 'SAME SEED, SAME CONFIGURATION',
    retrySameNote: 'The identical run. Diagnose it properly this time.',
    retryNew: 'NEW CONFIGURATION',
    retryNewNote: 'The planner reopens. Only the parts you change are rebuilt.',
  },

  eventLog: {
    heading: 'EVENT LOG',
    awaiting: 'Awaiting checklist…',
  },
} as const;

export type Strings = typeof strings;
