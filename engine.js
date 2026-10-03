/* ABB Signal Tower — core engine (signals, scoring, scenarios, impact, decisions, 8-agent pipeline).
   Runs in browser and Node. ALL SEED DATA IS ILLUSTRATIVE (anonymised, not real company/ABB figures). */
(function (root) {
  const SCEN = ["HG", "BASE", "RS", "SD"];
  const SCEN_NAME = { HG: "Hyper Growth", BASE: "Base Growth", RS: "Regional Shift", SD: "Market Slowdown" };
  const PRIOR = { HG: 0.15, BASE: 0.50, RS: 0.20, SD: 0.15 };
  const REGIONS = ["Nordics", "USA", "Germany", "UK", "Middle East", "APAC"];

  /* ---------- Data source portfolio ---------- */
  // [id, name, group, why, reliability, freq, leadMonths, abbRelevance]
  const S = (id, name, group, why, rel, freq, lead, abb) => ({ id, name, group, why, rel, freq, lead, abb });
  const SOURCES = [
    S("fred", "FRED (St. Louis Fed)", "Macro", "Industrial construction spending, capacity utilisation, credit spreads", 95, "Monthly", 3, 65),
    S("oecd", "OECD / IMF / World Bank", "Macro", "Capex cycles, AI-investment and digitalisation indicators", 92, "Quarterly", 6, 50),
    S("eia", "EIA", "Energy", "US commercial load growth, utility capex, generation additions", 93, "Monthly", 9, 80),
    S("entsoe", "ENTSO-E / Energy-Charts", "Energy", "EU load, TSO ten-year network plans, demand outlooks", 92, "Hourly / yearly", 18, 85),
    S("iea", "IEA", "Energy", "Data-centre electricity demand scenarios, policy trackers", 90, "Annual + updates", 24, 70),
    S("tso_queue", "TSO/DSO connection queues", "Grid", "Large-load connection requests: the earliest hard signal of MW demand", 90, "Quarterly", 24, 95),
    S("grid_plans", "Grid investment & substation plans", "Grid", "Substation / transmission projects = where ABB MV & protection ships", 88, "Annual", 30, 92),
    S("dcmap", "DataCenterMap", "Data centre", "Facility inventory and announced campuses by geography", 72, "Weekly", 12, 85),
    S("dcd", "DataCenterDynamics", "Data centre", "Project announcements, site acquisitions, power-purchase news", 75, "Daily", 15, 85),
    S("cbre_jll", "CBRE / JLL market reports", "Data centre", "Vacancy, preleasing, under-construction MW by market", 85, "Semi-annual", 6, 80),
    S("hyperscaler_pr", "Hyperscaler announcements & earnings", "Data centre", "Capex guidance, campus announcements, power commitments", 80, "Quarterly / event", 12, 90),
    S("semis", "Nvidia/AMD/TSMC/Intel filings & industry reports", "Technology", "Accelerator shipments, advanced packaging capacity → rack MW 6-12 months out", 88, "Quarterly", 9, 80),
    S("permits", "Permits, zoning & planning portals", "Construction", "Planning filings 9-15 months before energisation", 70, "Weekly (scraped)", 12, 85),
    S("constr", "Industrial construction spending & ENR/Dodge", "Construction", "Concurrent confirmation of build activity", 85, "Monthly", 3, 70),
    S("supply", "Lead-time trackers, Wood Mackenzie/transformer surveys", "Supply chain", "Transformer, switchgear, power-IC lead times and shortages", 75, "Monthly", 12, 92),
    S("commod", "LME copper, steel, freight indexes (Drewry/Baltic)", "Supply chain", "Input-cost and logistics stress", 95, "Daily", 3, 75),
    S("news_rss", "Industry RSS, regulators, policy trackers", "News", "Regulatory changes, moratoria, subsidies, export controls", 65, "Continuous", 9, 70),
    S("peers", "Peer order books (electrical equipment OEM filings)", "Lagging", "Confirms the cycle; ground truth for backtesting", 92, "Quarterly", 0, 90),
    S("social", "Unverified web / social chatter", "News", "Rumours; kept only so Validation Agent can reject them", 25, "Continuous", 1, 30),
  ];

  /* ---------- Scenario loadings per signal archetype ---------- */
  const LOAD = {
    G:  { HG: 0.8, BASE: 0.6, RS: 0.0, SD: -0.55 },   // global growth
    H:  { HG: -0.8, BASE: 0.1, RS: 0.4, SD: 1.2 },    // global headwind
    NG: { HG: 0.5, BASE: 0.2, RS: 0.7, SD: -0.6 },    // regional growth
    RH: { HG: -0.4, BASE: 0.0, RS: 0.7, SD: 0.4 },    // regional headwind
    C:  { HG: 0.3, BASE: 0.0, RS: 0.0, SD: 0.0 },     // cost signal (margin, not volume)
  };

  /* ---------- Signals ----------
     id,title,region,layer,horizon,nature,pol,kind,S,C,rel,lead,abb,U,src,corr,challengedBy,load,new,evidence,products */
  const sig = (o) => Object.assign({ new: false, challengedBy: [], status: null }, o);
  const SIGNALS = [
    sig({ id: "N1", title: "Three hyperscaler campus announcements in Nordics (~0.9 GW aggregate)", region: "Nordics", layer: "Core DC", horizon: "leading", nature: "structural", pol: 1, kind: "growth", S: 82, C: 76, rel: 80, lead: 18, abb: 90, U: 30, src: "hyperscaler_pr", corr: 3, challengedBy: ["N6", "N7", "N8"], load: "NG", new: true, evidence: "Hyperscaler A, B and an AI-cloud provider each named a Nordic site in a 6-week window; two quote power in the hundreds of MW.", products: "MV switchgear, protection relays, LV, monitoring" }),
    sig({ id: "N2", title: "Large-load grid connection requests up ~2.4x QoQ (Nordic TSO/DSO queues)", region: "Nordics", layer: "Enabling", horizon: "leading", nature: "structural", pol: 1, kind: "growth", S: 88, C: 72, rel: 90, lead: 24, abb: 92, U: 28, src: "tso_queue", corr: 2, challengedBy: ["N6"], load: "NG", new: true, evidence: "Queue snapshots show data-centre-tagged requests rising sharply; share of requests >50 MW doubled.", products: "Grid-connection substations, MV GIS, protection & control" }),
    sig({ id: "N3", title: "TSO long-term demand outlook revised up (data-centre load share)", region: "Nordics", layer: "Enabling", horizon: "leading", nature: "structural", pol: 1, kind: "growth", S: 70, C: 80, rel: 92, lead: 36, abb: 78, U: 22, src: "entsoe", corr: 2, load: "NG", new: true, evidence: "Revised 10-year outlook lifts 2030 demand; data centres cited as the largest single driver.", products: "Substation & distribution programmes" }),
    sig({ id: "N4", title: "Municipal construction & zoning filings for data-centre sites", region: "Nordics", layer: "Core DC", horizon: "coincident", nature: "cyclical", pol: 1, kind: "growth", S: 64, C: 62, rel: 70, lead: 12, abb: 85, U: 38, src: "permits", corr: 2, challengedBy: ["N8"], load: "NG", new: true, evidence: "Planning filings for large industrial plots tagged 'data centre' up in 4 municipalities.", products: "LV/MV switchboards, power quality" }),
    sig({ id: "N5", title: "GPU / accelerator demand: shipments and advanced-packaging capacity up again", region: "Global", layer: "Upstream", horizon: "leading", nature: "structural", pol: 1, kind: "growth", S: 75, C: 85, rel: 88, lead: 9, abb: 80, U: 30, src: "semis", corr: 3, load: "G", new: true, evidence: "Latest filings show accelerator revenue and packaging-capacity expansion above prior guidance.", products: "All data-centre electrification" }),
    sig({ id: "N6", title: "Nordic grid constraints: capacity-limited areas and queue backlogs", region: "Nordics", layer: "Enabling", horizon: "coincident", nature: "structural", pol: -1, kind: "warning", S: 72, C: 70, rel: 85, lead: 12, abb: 75, U: 30, src: "tso_queue", corr: 2, load: "RH", new: true, evidence: "Several southern regions have no uncommitted capacity; connection dates pushed to 2029+.", products: "Grid-connection infra (timing risk)" }),
    sig({ id: "N7", title: "Large power transformer lead times > 2 years", region: "Global", layer: "Upstream", horizon: "coincident", nature: "structural", pol: -1, kind: "warning", S: 78, C: 82, rel: 75, lead: 12, abb: 88, U: 25, src: "supply", corr: 3, load: "H" , evidence: "Surveys show 120-150 week delivery for large units; projects slip even when MV equipment is ready.", products: "Delivery sequencing of substations" }),
    sig({ id: "N8", title: "Regulatory & environmental-review delays on large sites", region: "Nordics", layer: "Core DC", horizon: "lagging", nature: "cyclical", pol: -1, kind: "warning", S: 55, C: 55, rel: 65, lead: 9, abb: 60, U: 42, src: "news_rss", corr: 1, load: "RH", new: true, evidence: "Appeals and heat-reuse conditions reported on two proposals; no moratorium yet.", products: "Project timing" }),

    sig({ id: "U1", title: "US utility large-load pipelines keep expanding (with speculative-load filters)", region: "USA", layer: "Enabling", horizon: "leading", nature: "structural", pol: 1, kind: "growth", S: 80, C: 75, rel: 85, lead: 24, abb: 90, U: 30, src: "eia", corr: 3, load: "G", evidence: "Utility IRPs raise load forecasts; new tariffs demand financial commitment, filtering paper projects.", products: "MV GIS, protection, substations" }),
    sig({ id: "U2", title: "Hyperscaler aggregate capex guidance raised again", region: "USA", layer: "Core DC", horizon: "leading", nature: "structural", pol: 1, kind: "growth", S: 85, C: 88, rel: 90, lead: 12, abb: 88, U: 22, src: "hyperscaler_pr", corr: 3, load: "G", evidence: "Latest earnings cycle: guidance up for next 4 quarters.", products: "Full portfolio" }),
    sig({ id: "U3", title: "MV switchgear order lead times extending at peers", region: "USA", layer: "Upstream", horizon: "coincident", nature: "cyclical", pol: 1, kind: "growth", S: 66, C: 75, rel: 80, lead: 6, abb: 95, U: 25, src: "supply", corr: 2, load: "G", evidence: "Peers quoting longer delivery windows: demand outrunning capacity (also a capacity-planning flag for ABB).", products: "MV switchgear capacity" }),
    sig({ id: "U4", title: "AI-infrastructure financing stress: neocloud / DC debt spreads widening", region: "USA", layer: "Downstream", horizon: "leading", nature: "cyclical", pol: -1, kind: "reversal", S: 58, C: 55, rel: 72, lead: 9, abb: 70, U: 45, src: "fred", corr: 2, load: "H", evidence: "Credit spreads for leveraged GPU-cloud borrowers up; two projects reported re-scoping.", products: "Order cancellation / push-out risk" }),
    sig({ id: "G1", title: "Frankfurt-region grid saturation + connection-reform uncertainty", region: "Germany", layer: "Enabling", horizon: "coincident", nature: "structural", pol: -1, kind: "warning", S: 60, C: 68, rel: 80, lead: 12, abb: 80, U: 35, src: "entsoe", corr: 2, load: "RH", evidence: "Operators report multi-year waits for new MW in core markets; new rules still being drafted.", products: "Core-market project timing" }),
    sig({ id: "G2", title: "Sovereign / industrial-AI 'gigafactory' bids in Germany", region: "Germany", layer: "Downstream", horizon: "leading", nature: "cyclical", pol: 1, kind: "growth", S: 55, C: 50, rel: 65, lead: 15, abb: 78, U: 50, src: "news_rss", corr: 1, load: "NG", evidence: "Consortia formed; funding not yet committed (false-positive risk).", products: "Industrial + DC LV/MV" }),
    sig({ id: "K1", title: "UK AI Growth Zones designated + connection-queue reform", region: "UK", layer: "Enabling", horizon: "leading", nature: "structural", pol: 1, kind: "growth", S: 62, C: 66, rel: 75, lead: 18, abb: 80, U: 38, src: "news_rss", corr: 2, load: "NG", evidence: "Priority grid access promised to designated zones; delivery timelines still uncertain.", products: "MV, protection, grid connection" }),
    sig({ id: "M1", title: "Gulf sovereign AI campus MoUs (GW scale) + chip export licences", region: "Middle East", layer: "Downstream", horizon: "leading", nature: "structural", pol: 1, kind: "growth", S: 78, C: 60, rel: 68, lead: 15, abb: 82, U: 48, src: "dcd", corr: 2, load: "NG", evidence: "Multiple GW-scale announcements; execution depends on licences and power build-out.", products: "MV/LV, grid connection, automation" }),
    sig({ id: "A1", title: "APAC: Johor/Singapore power constraints steering new builds regionally", region: "APAC", layer: "Core DC", horizon: "coincident", nature: "structural", pol: 1, kind: "growth", S: 70, C: 72, rel: 78, lead: 12, abb: 80, U: 35, src: "dcmap", corr: 2, load: "NG", evidence: "Pipeline shifting towards Malaysia/Indonesia/India; local content and utilities shape awards.", products: "LV/MV, monitoring" }),
    sig({ id: "C1", title: "Copper price spike and falling exchange inventories", region: "Global", layer: "Upstream", horizon: "coincident", nature: "cyclical", pol: -1, kind: "warning", S: 60, C: 80, rel: 90, lead: 3, abb: 85, U: 20, src: "commod", corr: 3, load: "C", evidence: "Price and inventory trend threaten switchgear/busbar margins; also correlates with strong demand.", products: "Margin exposure on MV/LV" }),
    sig({ id: "T1", title: "Rack power density roadmap: 800 V DC / liquid-cooled racks", region: "Global", layer: "Upstream", horizon: "leading", nature: "structural", pol: 1, kind: "growth", S: 72, C: 70, rel: 75, lead: 18, abb: 85, U: 40, src: "semis", corr: 2, load: "G", evidence: "Next-gen platforms push MW per hall up 3-5x; changes LV/DC distribution mix.", products: "Power distribution, monitoring, power quality" }),
    sig({ id: "S2", title: "Nuclear / SMR co-location PPAs for data centres", region: "USA", layer: "Enabling", horizon: "leading", nature: "structural", pol: 1, kind: "growth", S: 58, C: 55, rel: 70, lead: 24, abb: 70, U: 55, src: "dcd", corr: 1, load: "NG", evidence: "Several behind-the-meter agreements; commissioning dates far out.", products: "Generation-side MV/protection" }),
    sig({ id: "L1", title: "Colocation vacancy at record lows; preleasing > 80 %", region: "USA", layer: "Core DC", horizon: "coincident", nature: "cyclical", pol: 1, kind: "growth", S: 68, C: 85, rel: 85, lead: 3, abb: 70, U: 18, src: "cbre_jll", corr: 3, load: "G", evidence: "Broker reports show record-low vacancy in primary markets.", products: "Near-term order flow" }),
    sig({ id: "L2", title: "Peer electrical-equipment order books at record backlog", region: "Global", layer: "Downstream", horizon: "lagging", nature: "cyclical", pol: 1, kind: "growth", S: 74, C: 90, rel: 92, lead: 0, abb: 90, U: 12, src: "peers", corr: 3, load: "G", evidence: "Confirms cycle strength (lagging; useful for backtesting).", products: "Benchmark" }),
    sig({ id: "F1", title: "Rumour: hyperscaler cancelling multi-GW leases", region: "USA", layer: "Core DC", horizon: "leading", nature: "false_positive", pol: -1, kind: "warning", S: 70, C: 25, rel: 25, lead: 1, abb: 40, U: 80, src: "social", corr: 0, load: "H", evidence: "Single unverified social post, no filings, no broker corroboration, denied in subsequent call.", products: "n/a" }),
  ];

  /* ---------- Scoring ---------- */
  const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
  const r1 = (x) => Math.round(x * 10) / 10;

  function validate(s) {
    const src = SOURCES.find((x) => x.id === s.src);
    const checks = {
      reliability: src.rel >= 60,
      corroboration: s.corr >= 2,
      freshness: true,
      consistency: s.nature !== "false_positive",
    };
    let status = "Validated";
    if (!checks.reliability || s.corr === 0) status = "Rejected";
    else if (!checks.corroboration) status = "Provisional";
    const factor = 0.85 + 0.075 * Math.min(s.corr, 3);
    return { status, checks, factor, srcName: src.name };
  }

  function scoreAll(signals, opts = {}) {
    const strict = opts.counterStrictness == null ? 1 : opts.counterStrictness;
    const base = signals.map((s) => {
      const v = validate(s);
      const leadScore = clamp((s.lead / 24) * 100);
      const conf = clamp(s.C * v.factor);
      return Object.assign({}, s, { validation: v, leadScore, confVal: conf });
    });
    // first pass: raw priority
    const raw = (x, conf) => (0.30 * x.S + 0.20 * conf + 0.15 * x.rel + 0.15 * x.leadScore + 0.20 * x.abb) * (1 - 0.5 * x.U / 100);
    base.forEach((x) => (x.rawPriority = r1(raw(x, x.confVal))));
    // counter-evidence discount
    base.forEach((x) => {
      const ch = x.challengedBy.map((id) => base.find((y) => y.id === id)).filter(Boolean);
      const worst = ch.length ? Math.max(...ch.map((c) => c.rawPriority)) : 0;
      const penalty = 0.35 * strict * (worst / 100);
      x.counterPenalty = r1(penalty * 100);
      x.confAdj = clamp(x.confVal * (1 - penalty));
      x.priority = x.validation.status === "Rejected" ? r1(raw(x, x.confAdj) * 0.2) : r1(raw(x, x.confAdj));
      x.tier = x.validation.status === "Rejected" ? "Rejected" : x.priority >= 62 ? "Act" : x.priority >= 50 ? "Watch" : "Monitor";
    });
    return base;
  }

  /* ---------- Scenario posterior ---------- */
  const K = 0.032;
  function posterior(scored, opts = {}) {
    const include = opts.include || (() => true);
    const warnW = opts.warningWeight == null ? 1 : opts.warningWeight;
    const logit = {}, contrib = {};
    SCEN.forEach((k) => { logit[k] = Math.log(PRIOR[k]); contrib[k] = []; });
    scored.forEach((x) => {
      if (x.validation.status === "Rejected" || !include(x)) return;
      const w = (x.priority / 100) * (x.pol < 0 ? warnW : 1);
      SCEN.forEach((k) => {
        const c = K * w * LOAD[x.load][k] * 10; // 10 = scale so ~20 signals move probabilities visibly
        logit[k] += c;
        contrib[k].push({ id: x.id, title: x.title, c });
      });
    });
    const m = Math.max(...SCEN.map((k) => logit[k]));
    const e = SCEN.map((k) => Math.exp(logit[k] - m));
    const z = e.reduce((a, b) => a + b, 0);
    const p = {};
    SCEN.forEach((k, i) => (p[k] = 0.8 * (e[i] / z) + 0.2 * PRIOR[k])); // 20% shrinkage to prior = model-uncertainty floor
    return { p, contrib };
  }

  function entropyConf(p, scored) {
    const H = -SCEN.reduce((a, k) => a + p[k] * Math.log(p[k] + 1e-9), 0) / Math.log(4);
    const act = scored.filter((x) => x.validation.status !== "Rejected");
    const meanC = act.reduce((a, x) => a + x.confAdj, 0) / act.length;
    const score = clamp(meanC * (1 - 0.45 * H));
    return { score: r1(score), label: score >= 60 ? "High" : score >= 42 ? "Medium" : "Low" };
  }

  /* ---------- ABB impact (index: 2026 DC-related Distribution Solutions orders = 100; ILLUSTRATIVE) ---------- */
  const SCEN_INFO = {
    HG: { orders: +38, util: 108, desc: "AI capex keeps compounding, grid and transformer bottlenecks ease faster than expected; order intake outruns capacity.", margin: "+: volume leverage; -: copper & expediting" },
    BASE: { orders: +16, util: 94, desc: "Steady build-out; timing set by interconnection and equipment lead times. Demand real but paced.", margin: "stable" },
    RS: { orders: +7, util: 88, desc: "Total demand holds but moves: constrained core markets (US hubs, Frankfurt, Singapore) lose share to Nordics, Gulf, India/SEA, secondary US.", margin: "mix & logistics cost" },
    SD: { orders: -14, util: 70, desc: "Financing stress / AI-ROI doubts / efficiency shocks cause cancellations and push-outs; inventories and capacity become liabilities.", margin: "-: under-absorption, inventory risk" },
  };
  // % order delta vs 2026 by region and scenario (illustrative)
  const REG_IMPACT = {
    HG: { Nordics: 55, USA: 40, Germany: 30, UK: 35, "Middle East": 60, APAC: 38 },
    BASE: { Nordics: 24, USA: 15, Germany: 8, UK: 14, "Middle East": 25, APAC: 15 },
    RS: { Nordics: 42, USA: -2, Germany: -6, UK: 8, "Middle East": 38, APAC: 18 },
    SD: { Nordics: -6, USA: -18, Germany: -14, UK: -10, "Middle East": -8, APAC: -12 },
  };
  function expectedImpact(p) {
    const ev = SCEN.reduce((a, k) => a + p[k] * SCEN_INFO[k].orders, 0);
    const util = SCEN.reduce((a, k) => a + p[k] * SCEN_INFO[k].util, 0);
    const regions = {};
    REGIONS.forEach((r) => (regions[r] = r1(SCEN.reduce((a, k) => a + p[k] * REG_IMPACT[k][r], 0))));
    return { orderGrowth: r1(ev), utilisation: r1(util), regions };
  }

  /* ---------- Decisions: payoff (margin-contribution index pts) per scenario ---------- */
  const DECISIONS = {
    Manufacturing: [
      { opt: "Increase capacity (full, global)", pay: { HG: 30, BASE: 6, RS: 2, SD: -20 } },
      { opt: "Modular / flexible capacity in EU + Gulf-ready lines (staged)", pay: { HG: 24, BASE: 9, RS: 10, SD: -7 } },
      { opt: "Maintain capacity", pay: { HG: 6, BASE: 7, RS: 4, SD: -2 } },
      { opt: "Reduce capacity", pay: { HG: -16, BASE: -6, RS: -5, SD: 4 } },
    ],
    Procurement: [
      { opt: "Buy now (spot, full cover)", pay: { HG: 20, BASE: 4, RS: 2, SD: -14 } },
      { opt: "Wait", pay: { HG: -18, BASE: 0, RS: -2, SD: 6 } },
      { opt: "Secure strategic inventory (framework agreements, 30-50% copper/steel/transformer cover)", pay: { HG: 22, BASE: 8, RS: 6, SD: -5 } },
      { opt: "Diversify suppliers (dual-source long-lead items)", pay: { HG: 12, BASE: 7, RS: 8, SD: 1 } },
    ],
    "Supply chain": [
      { opt: "Increase safety stock on long-lead parts", pay: { HG: 16, BASE: 6, RS: 5, SD: -8 } },
      { opt: "Source alternatives (second-source transformers/relays components)", pay: { HG: 12, BASE: 8, RS: 9, SD: 1 } },
      { opt: "Monitor bottlenecks only", pay: { HG: -8, BASE: 2, RS: 0, SD: 3 } },
    ],
    Strategy: [
      { opt: "Invest now (capex / partnerships / M&A)", pay: { HG: 28, BASE: 7, RS: 4, SD: -18 } },
      { opt: "Delay investment", pay: { HG: -14, BASE: 0, RS: -3, SD: 5 } },
      { opt: "Prioritise regions (Nordics, Gulf, UK, secondary US) and stage-gate", pay: { HG: 20, BASE: 9, RS: 14, SD: -2 } },
    ],
  };
  const LAMBDA = 0.35;
  function decide(p) {
    const out = {};
    Object.keys(DECISIONS).forEach((dom) => {
      const opts = DECISIONS[dom];
      const best = {};
      SCEN.forEach((k) => (best[k] = Math.max(...opts.map((o) => o.pay[k]))));
      const rows = opts.map((o) => {
        const ev = SCEN.reduce((a, k) => a + p[k] * o.pay[k], 0);
        const regret = Math.max(...SCEN.map((k) => best[k] - o.pay[k]));
        return { opt: o.opt, pay: o.pay, ev: r1(ev), regret, score: r1(ev - LAMBDA * regret) };
      }).sort((a, b) => b.score - a.score);
      rows[0].recommended = true;
      out[dom] = rows;
    });
    return out;
  }

  const TRIPWIRES = [
    { if: "≥ 2 of the 3 Nordic campuses sign firm grid-connection agreements (not just MoUs)", then: "Release phase-2 modular capacity; lock framework orders for MV switchgear" },
    { if: "Large-power-transformer lead time > 150 weeks for 2 consecutive months", then: "Escalate strategic inventory + second-source programme; re-sequence project deliveries" },
    { if: "Hyperscaler capex guidance cut OR DC credit spreads widen another 100 bp", then: "Freeze phase-2 capacity, shift to Slowdown playbook, cap inventory build" },
    { if: "Nordic regulator imposes moratorium / connection-allocation cut on ≥ 1 TSO zone", then: "Shift Nordic weighting to UK/Gulf; keep Nordic as option, not commitment" },
  ];

  /* ---------- Derived views ---------- */
  function regionHeat(scored) {
    const out = {};
    REGIONS.forEach((r) => {
      const xs = scored.filter((x) => x.region === r && x.validation.status !== "Rejected");
      const net = xs.reduce((a, x) => a + x.pol * x.priority, 0);
      const pos = xs.filter((x) => x.pol > 0).reduce((a, x) => a + x.priority, 0);
      const neg = xs.filter((x) => x.pol < 0).reduce((a, x) => a + x.priority, 0);
      out[r] = { net: r1(net), pos: r1(pos), neg: r1(neg), n: xs.length, momentum: r1(clamp(50 + net / 2.2)) };
    });
    return out;
  }

  function scenarioEvidence(scored, post) {
    const out = {};
    SCEN.forEach((k) => {
      const c = post.contrib[k].slice().sort((a, b) => b.c - a.c);
      out[k] = {
        triggers: c.filter((x) => x.c > 0).slice(0, 3),
        support: c.filter((x) => x.c > 0).slice(0, 5),
        contra: c.filter((x) => x.c < 0).slice(-4).reverse(),
      };
    });
    return out;
  }

  /* ---------- Raw "new data" feed that feeds the demo (anonymised, illustrative) ---------- */
  const RAW_FEED = [
    { t: "Hyperscaler A confirms 300 MW Nordic campus; power sourced from regional grid", src: "DCD / company PR", maps: "N1" },
    { t: "Hyperscaler B + AI-cloud provider file for two further Nordic sites (~600 MW combined)", src: "Company PR / planning portal", maps: "N1" },
    { t: "Nordic TSO queue snapshot: data-centre-tagged requests 2.4x QoQ", src: "TSO connection queue", maps: "N2" },
    { t: "TSO ten-year outlook revised: data centres largest demand driver to 2030", src: "TSO / ENTSO-E", maps: "N3" },
    { t: "Four municipalities log large industrial-zone filings tagged 'data centre'", src: "Planning portals (scraped)", maps: "N4" },
    { t: "Accelerator maker lifts guidance; advanced-packaging capacity expands", src: "Semiconductor filings", maps: "N5" },
    { t: "Southern Nordic zones report no uncommitted grid capacity; dates pushed to 2029+", src: "TSO notices", maps: "N6" },
    { t: "Large power transformer delivery quotes 120-150 weeks", src: "Lead-time survey", maps: "N7" },
    { t: "Appeal + heat-reuse conditions on two proposals", src: "News / regulator", maps: "N8" },
    { t: "Social post claims hyperscaler cancelling multi-GW leases", src: "Unverified social", maps: "F1" },
  ];

  /* ---------- Custom data loader ----------
     Merge model: a file can UPDATE existing signals (matched by id), ADD new signals, and REPLACE the news feed.
     It never deletes seed signals, because narrative text and watch-lists reference them by id. */
  let CUSTOM = null;
  const SEED_SIGNALS = JSON.parse(JSON.stringify(SIGNALS));
  const SEED_FEED = JSON.parse(JSON.stringify(RAW_FEED));
  const ENUM = { horizon: ["leading", "coincident", "lagging"], nature: ["structural", "cyclical", "false_positive"], kind: ["growth", "warning", "reversal"], layer: ["Core DC", "Enabling", "Upstream", "Downstream"] };
  const NUM100 = ["S", "C", "rel", "abb", "U"];
  const REQUIRED = ["id", "title", "region", "layer", "horizon", "nature", "kind", "S", "C", "rel", "lead", "abb", "U", "src", "load"];

  function checkSignal(o, isNew, where, errors) {
    const bad = (m) => errors.push(`${where}: ${m}`);
    if (isNew) REQUIRED.forEach((k) => { if (o[k] === undefined || o[k] === null || o[k] === "") bad(`missing required field "${k}"`); });
    Object.keys(ENUM).forEach((k) => { if (o[k] !== undefined && !ENUM[k].includes(o[k])) bad(`"${k}" must be one of ${ENUM[k].join(" | ")} (got "${o[k]}")`); });
    NUM100.forEach((k) => { if (o[k] !== undefined && !(typeof o[k] === "number" && o[k] >= 0 && o[k] <= 100)) bad(`"${k}" must be a number from 0 to 100`); });
    if (o.lead !== undefined && !(typeof o.lead === "number" && o.lead >= 0)) bad(`"lead" must be a number of months (>= 0)`);
    if (o.corr !== undefined && !(Number.isInteger(o.corr) && o.corr >= 0)) bad(`"corr" must be a whole number >= 0`);
    if (o.region !== undefined && !REGIONS.includes(o.region) && o.region !== "Global") bad(`"region" must be one of ${REGIONS.join(", ")}, Global (got "${o.region}")`);
    if (o.load !== undefined && !(o.load in LOAD)) bad(`"load" must be one of ${Object.keys(LOAD).join(", ")} (got "${o.load}")`);
    if (o.pol !== undefined && o.pol !== 1 && o.pol !== -1) bad(`"pol" must be 1 (supports growth) or -1 (warns)`);
    if (o.challengedBy !== undefined && !Array.isArray(o.challengedBy)) bad(`"challengedBy" must be a list of signal ids`);
  }

  function loadCustom(data) {
    const errors = [];
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, errors: ["The file must be a JSON object with \"signals\" and/or \"raw_feed\"."] };
    const list = data.signals === undefined ? [] : data.signals, feed = data.raw_feed;
    if (!Array.isArray(list)) errors.push('"signals" must be a list');
    if (feed !== undefined && !Array.isArray(feed)) errors.push('"raw_feed" must be a list');
    if (errors.length) return { ok: false, errors };
    if (!list.length && !(feed && feed.length)) return { ok: false, errors: ["Nothing to load: provide a non-empty \"signals\" or \"raw_feed\" list."] };
    const ids = new Set();
    list.forEach((o, n) => {
      const where = `signals[${n}]${o && o.id ? " (" + o.id + ")" : ""}`;
      if (!o || typeof o !== "object" || !o.id) return errors.push(`${where}: every signal needs an "id"`);
      if (ids.has(o.id)) errors.push(`${where}: duplicate id in file`);
      ids.add(o.id);
      checkSignal(o, !SIGNALS.some((s) => s.id === o.id), where, errors);
      const kind = o.kind || (SIGNALS.find((s) => s.id === o.id) || {}).kind;
      if (o.pol !== undefined && kind && o.pol !== (kind === "growth" ? 1 : -1)) errors.push(`${where}: "pol" ${o.pol} does not match kind "${kind}" (growth = 1, warning/reversal = -1)`);
    });
    (feed || []).forEach((r, n) => { if (!r || !r.t || !r.src) errors.push(`raw_feed[${n}]: needs "t" (headline text) and "src" (source name)`); });
    if (errors.length) return { ok: false, errors };
    let updated = 0, added = 0;
    list.forEach((o) => {
      const cur = SIGNALS.find((s) => s.id === o.id);
      if (cur) { Object.assign(cur, o); updated++; }
      else { SIGNALS.push(sig(Object.assign({ pol: o.kind === "growth" ? 1 : -1, corr: 1, new: true, evidence: "", products: "" }, o))); added++; }
    });
    if (feed && feed.length) { RAW_FEED.length = 0; feed.forEach((r) => RAW_FEED.push({ t: r.t, src: r.src, maps: r.maps || "" })); }
    CUSTOM = { updated, added, feed: feed ? feed.length : 0 };
    return Object.assign({ ok: true }, CUSTOM);
  }

  function resetCustom() {
    SIGNALS.length = 0; JSON.parse(JSON.stringify(SEED_SIGNALS)).forEach((s) => SIGNALS.push(s));
    RAW_FEED.length = 0; JSON.parse(JSON.stringify(SEED_FEED)).forEach((r) => RAW_FEED.push(r));
    CUSTOM = null;
  }

  function customTemplate() {
    return {
      _help: "Merge file. Signals with an existing id UPDATE that signal (send only the fields to change). New ids are ADDED and need every required field. raw_feed REPLACES the news list. Scores S, C, rel, abb, U are 0-100. pol: 1 supports growth, -1 warns.",
      signals: [
        { id: "N2", S: 60, C: 55, evidence: "Example update: queue growth cooled in the latest snapshot." },
        { id: "X1", title: "Example: new Nordic campus announcement", region: "Nordics", layer: "Core DC", horizon: "leading", nature: "structural", kind: "growth", pol: 1, name: "New Nordic campus announced", S: 70, C: 65, rel: 75, lead: 15, abb: 85, U: 30, src: "hyperscaler_pr", corr: 1, load: "NG", challengedBy: ["N6"], new: true, evidence: "What the source said, in one sentence.", products: "MV switchgear, protection relays" }
      ],
      raw_feed: [{ t: "Example headline shown in the live demo", src: "Source name", maps: "X1" }]
    };
  }


  /* ---------- 8-agent pipeline (deterministic core; LLM augments text extraction & narrative in production) ---------- */
  function runPipeline(opts = {}) {
    const log = [];
    const baselineSignals = SIGNALS.filter((s) => !s.new);
    const t0 = scoreAll(baselineSignals);
    const pBefore = posterior(t0).p;

    log.push({ agent: "Market Intelligence", out: `Ingested ${RAW_FEED.length} new items from 8 sources; entity-resolved to ${RAW_FEED.filter((r) => r.maps !== "F1").length} candidate signals + 1 rumour.` });
    const rawScored = scoreAll(SIGNALS, { counterStrictness: 0 });
    const newGrowth = rawScored.filter((x) => x.new && x.pol > 0);
    const regCount = {}; newGrowth.forEach((x) => { regCount[x.region] = (regCount[x.region] || 0) + 1; });
    const topReg = Object.keys(regCount).sort((a, b) => regCount[b] - regCount[a])[0];
    log.push({ agent: "Weak Signal", out: newGrowth.length ? `Detected a cluster of ${newGrowth.length} co-moving growth signals centred on ${topReg} (z-score burst on queue requests, announcements, permits). ${newGrowth.length} flagged as new.` : "No new growth signals detected in this batch." });
    const scored = scoreAll(SIGNALS);
    const rej = scored.filter((x) => x.validation.status === "Rejected").map((x) => x.id);
    log.push({ agent: "Validation", out: `${scored.filter((x) => x.validation.status === "Validated").length} validated, ${scored.filter((x) => x.validation.status === "Provisional").length} provisional, ${rej.length} rejected (${rej.join(", ")}: single unverified source, no corroboration).` });
    const hits = scored.filter((x) => x.counterPenalty > 0).sort((a, b) => b.counterPenalty - a.counterPenalty);
    const challengers = [...new Set(scored.filter((x) => x.new && x.pol > 0).flatMap((x) => x.challengedBy || []))];
    const cut = scored.filter((x) => x.new && x.pol > 0 && x.counterPenalty > 0).slice(0, 2);
    log.push({ agent: "Counter-Evidence", out: `Found ${challengers.length} contradicting signals${challengers.length ? " (" + challengers.join(", ") + ")" : ""}. ${cut.length ? "Confidence cut: " + cut.map((x) => x.id + " by " + x.counterPenalty + "%").join(", ") + ". " : ""}Signals not discarded: they re-weight timing, not existence.` });
    const post = posterior(scored);
    const ev = scenarioEvidence(scored, post);
    const conf = entropyConf(post.p, scored);
    log.push({ agent: "Scenario Builder", out: `Posterior: ${SCEN.map((k) => SCEN_NAME[k] + " " + Math.round(post.p[k] * 100) + "%").join(" · ")} (confidence ${conf.label}).` });
    const imp = expectedImpact(post.p);
    log.push({ agent: "Impact Assessment", out: `Probability-weighted DC-related order growth ${imp.orderGrowth > 0 ? "+" : ""}${imp.orderGrowth}% (index); Nordics ${imp.regions.Nordics > 0 ? "+" : ""}${imp.regions.Nordics}%; expected utilisation ${imp.utilisation}%.` });
    const dec = decide(post.p);
    log.push({ agent: "Recommendation", out: `Top actions: ${Object.keys(dec).map((d) => d + ": " + dec[d][0].opt.split(" (")[0]).join(" | ")}.` });
    log.push({ agent: "Executive Briefing", out: `Briefing generated: 1 headline, 3 reasons, 3 risks, 4 tripwires, 3 next actions.` });
    const brief = {
      headline: `Nordic AI data-centre demand is accelerating, but grid and transformer bottlenecks will pace it. Prepare options, do not yet commit full capacity.`,
      why: [
        `${scored.filter((x) => x.new && x.pol > 0).length} independent growth indicators moved together (leading-indicator priority scores ${scored.filter((x) => x.new && x.pol > 0 && x.horizon === "leading").map((x) => x.priority).join(", ")}).`,
        `Grid queue requests (earliest hard signal, ~24-month lead) are the strongest evidence; announcements alone are not.`,
        `Counter-evidence is real: grid capacity and transformer lead times shift volume to 2028-29 rather than cancel it.`,
      ],
      risks: ["MoUs convert to firm connection agreements slower than announced", "Transformer shortage delays substation energisation, order timing slips", "Copper price squeezes margin on fixed-price frameworks"],
      next: [
        { who: "Head of Manufacturing (EU)", what: "Prepare modular MV switchgear/relay line expansion (phase 1 only), decision gate in 6 weeks", due: "2 weeks" },
        { who: "Chief Procurement Officer", what: "Open framework talks for copper, steel and transformer components, cover 30-50% of H1 2027 needs", due: "3 weeks" },
        { who: "Regional President Nordics", what: "Convert top 3 campuses to named-account plans; track grid-connection agreements weekly", due: "1 week" },
      ],
    };
    if (CUSTOM) {   // generic briefing: the seed narrative refers to the seed signals
      const top = SCEN.reduce((a, k) => (post.p[k] > post.p[a] ? k : a), SCEN[0]);
      const real = scored.filter((x) => x.nature !== "false_positive");
      const up = real.filter((x) => x.pol > 0).sort((a, b) => b.priority - a.priority);
      const down = real.filter((x) => x.pol < 0).sort((a, b) => b.priority - a.priority);
      brief.headline = `${SCEN_NAME[top]} is the most likely scenario (${Math.round(post.p[top] * 100)}%) on the loaded custom data. Review the evidence before committing capacity.`;
      brief.why = up.slice(0, 3).map((x) => `${x.title} (priority ${x.priority}).`);
      brief.risks = down.slice(0, 3).map((x) => x.title);
      brief.next = [{ who: "Planning owner", what: "Review the strongest signals and warnings in the custom data and confirm the lead scenario", due: "1 week" }];
    }
    return { log, scoredBefore: t0, pBefore, scored, post, evidence: ev, conf, impact: imp, decisions: dec, brief, tripwires: TRIPWIRES };
  }

  /* ================= Plain-English content layer (ILLUSTRATIVE assumptions; replace with ABB finance data) ================= */
  const PLAIN = { Act: "Act now", Watch: "Watch", Monitor: "Background", Rejected: "Rejected (unreliable)" };
  const SHORT = {
    N1: "Three new Nordic campus announcements", N2: "Grid connection requests surging in the Nordics", N3: "Grid operator raised its demand outlook",
    N4: "More building and planning applications", N5: "AI chip demand still rising", N6: "Nordic power grid is full in some areas",
    N7: "Transformers take 2+ years to deliver", N8: "Planning and environmental delays", U1: "US utilities expect much more data-centre load",
    U2: "Big tech raised spending plans again", U3: "Switchgear delivery times getting longer", U4: "Borrowing costs rising for AI data-centre builders",
    G1: "Frankfurt power grid is saturated", G2: "German AI projects announced, funding not yet firm", K1: "UK AI growth zones and grid reform",
    M1: "Gulf states announcing GW-scale AI campuses", A1: "Asian hubs shifting as Singapore runs out of power", C1: "Copper price spike",
    T1: "Racks need far more power (800 V DC)", S2: "Nuclear-powered data-centre deals", L1: "Data-centre space almost fully booked",
    L2: "Competitors' order books at record highs", F1: "Unverified social-media rumour",
  };
  const shortName = (id) => SHORT[id] || (() => { const x = SIGNALS.find((q) => q.id === id); return x ? (x.name || x.title) : id; })();
  const H = (o) => o;
  // Per scenario and horizon. orders/revenue = % change vs 2026 level. margin = percentage points. util = % of capacity used.
  const HORIZONS = {
    HG: {
      m6: H({ orders: 14, revenue: 6, util: 104, risks: ["Factories run out of room: orders can't be delivered fast enough", "Copper and parts prices jump"], catalysts: ["Big-tech spending upgrades", "Nordic grid agreements signed"] }),
      m18: H({ growth: 38, revenue: 28, margin: 1.5, profit: "+1.5 pts: more volume, but rush costs", share: "Gain share if capacity keeps pace; lose it to rivals if not", supply: "Tight: transformers and switchgear slots sold out" }),
      m36: H({ margin: 2.5, orders: 95, revenue: 80, story: "AI power demand compounds; ABB's data-centre business roughly doubles.", drivers: ["Bigger AI chips need more power per rack", "Governments back national AI", "Grids expand fast"], disruption: ["Over-building followed by a sharp correction", "Efficiency breakthroughs"], capex: "High: new lines in Europe, Gulf and US; likely acquisitions", opportunities: ["Pre-packaged power blocks", "Long-term service and monitoring contracts"] }),
    },
    BASE: {
      m6: H({ orders: 7, revenue: 3, util: 93, risks: ["Grid connection dates slip", "Copper squeezes margins on fixed-price deals"], catalysts: ["Quarterly earnings of big tech", "Utility plans published"] }),
      m18: H({ growth: 16, revenue: 12, margin: 0.5, profit: "+0.5 pts: steady volume, stable prices", share: "Hold share", supply: "Tight but manageable with advance planning" }),
      m36: H({ margin: 1, orders: 42, revenue: 36, story: "Steady build-out, paced by how fast grids can connect new sites.", drivers: ["AI and cloud demand keeps growing", "Grid investment programmes", "Older data centres need upgrades"], disruption: ["Permitting delays", "Skilled-labour shortages"], capex: "Moderate: add capacity in steps", opportunities: ["Retrofit and monitoring services", "Grid-connection packages"] }),
    },
    RS: {
      m6: H({ orders: 4, revenue: 2, util: 88, risks: ["Orders arrive in new places, factories are in old ones", "Logistics cost rises"], catalysts: ["Firm Nordic and Gulf grid agreements", "Rules on grid access change"] }),
      m18: H({ growth: 7, revenue: 5, margin: -0.3, profit: "-0.3 pts: new-region set-up and shipping costs", share: "Gain where we are local, lose where we are not", supply: "Uneven: bottlenecks differ by region" }),
      m36: H({ margin: 0.5, orders: 25, revenue: 20, story: "Total demand holds, but moves to regions with spare power.", drivers: ["Power availability decides site choice", "Government incentives", "Local-content rules"], disruption: ["Trade and export-licence changes", "Slow grid build in new hubs"], capex: "Targeted: flexible lines near new hubs", opportunities: ["Nordic and Gulf anchor customers", "Local partnerships"] }),
    },
    SD: {
      m6: H({ orders: -3, revenue: 1, util: 80, risks: ["Customers delay or cancel", "Stock bought for growth sits unsold"], catalysts: ["Cut in big-tech spending", "Credit markets tighten"] }),
      m18: H({ growth: -14, revenue: -8, margin: -2, profit: "-2.0 pts: under-used factories", share: "Hold if we cut costs early", supply: "Easing: lead times shorten, prices soften" }),
      m36: H({ margin: -0.5, orders: 5, revenue: 3, story: "A pause, then slower recovery as AI proves its return.", drivers: ["AI still useful long-term", "Efficiency gains", "Cheaper power"], disruption: ["Lasting loss of confidence in AI spending", "Rivals cut prices"], capex: "Low: pause new capacity", opportunities: ["Buy weaker rivals or assets cheaply", "Focus on service income"] }),
    },
  };
  const SCEN_CARDS = {
    HG: { oneLine: "AI spending keeps surging and power bottlenecks ease faster than expected.", plain: "Customers want more equipment than ABB can build. The risk is being too small, not too big.", assumptions: ["Big tech keeps raising budgets", "Grids and transformers catch up", "No major efficiency shock"], winners: ["US hyperscale hubs", "Middle East", "Nordics"], losers: ["Rivals with limited capacity", "Slow-moving suppliers"], watch: ["U2", "U1", "N5", "L1"] },
    BASE: { oneLine: "Demand keeps growing at a healthy but limited pace.", plain: "Growth is real, but timing depends on how quickly grids and equipment deliveries keep up.", assumptions: ["Spending stays high but flat-ish", "Grid delays continue", "Prices stay stable"], winners: ["Nordics", "UK", "Secondary US markets"], losers: ["Constrained hubs (Frankfurt)"], watch: ["U2", "N3", "N7", "L2"] },
    RS: { oneLine: "Total demand holds, but it moves to countries with spare power.", plain: "ABB's total sales may look fine while the customer map changes, so the wrong factories and teams could be in the wrong places.", assumptions: ["Power availability decides where data centres go", "Core hubs stay capped", "Nordics, Gulf and India grow faster"], winners: ["Nordics", "Middle East", "India and SE Asia"], losers: ["Germany (Frankfurt)", "Crowded US hubs"], watch: ["N2", "N6", "G1", "M1"] },
    SD: { oneLine: "AI spending slows sharply because of money worries or weaker returns.", plain: "Orders get delayed or cancelled. Spare capacity and extra stock become a cost.", assumptions: ["Borrowing gets harder", "Some AI projects miss targets", "Big tech cuts budgets"], winners: ["Service and retrofit business", "Cash-rich buyers of assets"], losers: ["New AI-cloud start-ups", "Suppliers with big inventories"], watch: ["U4", "N7", "C1", "F1"] },
  };
  const REGION_INFO = {
    Nordics: { limit: "Power grid space, transformers, permits", action: "Win anchor customers; add flexible capacity in phases" },
    USA: { limit: "Waiting lines to connect to the grid; financing", action: "Protect capacity and watch credit markets" },
    Germany: { limit: "Frankfurt grid is full; rules unclear", action: "Focus on upgrades and monitoring" },
    UK: { limit: "Slow grid connection delivery", action: "Pursue AI growth-zone projects" },
    "Middle East": { limit: "Chip export licences; execution risk", action: "Bid for large packaged projects" },
    APAC: { limit: "Local power limits; local-content rules", action: "Build local supply and partners" },
  };
  const wsum = (p, f) => SCEN.reduce((a, k) => a + p[k] * f(k), 0);
  function expectedOutlook(p) {
    const q = (x) => r1(x);
    return {
      m6: { orders: q(wsum(p, k => HORIZONS[k].m6.orders)), revenue: q(wsum(p, k => HORIZONS[k].m6.revenue)), util: q(wsum(p, k => HORIZONS[k].m6.util)) },
      m18: { growth: q(wsum(p, k => HORIZONS[k].m18.growth)), util: q(wsum(p, k => SCEN_INFO[k].util)), revenue: q(wsum(p, k => HORIZONS[k].m18.revenue)), margin: q(wsum(p, k => HORIZONS[k].m18.margin)) },
      m36: { margin: q(wsum(p, k => HORIZONS[k].m36.margin)), orders: q(wsum(p, k => HORIZONS[k].m36.orders)), revenue: q(wsum(p, k => HORIZONS[k].m36.revenue)) },
    };
  }
  function explainProbability(post, before) {
    const out = {};
    SCEN.forEach((k) => {
      const c = post.contrib[k].slice().sort((a, b) => b.c - a.c);
      const up = c.filter(x => x.c > 0.02).slice(0, 3).map(x => ({ id: x.id, name: shortName(x.id) }));
      const down = c.filter(x => x.c < -0.02).slice(-3).reverse().map(x => ({ id: x.id, name: shortName(x.id) }));
      const delta = Math.round((post.p[k] - before[k]) * 100);
      out[k] = { up, down, delta, text: `${Math.round(post.p[k] * 100)}% because ${up.length ? up.map(x => x.name).join("; ") : "no strong evidence yet"}.${down.length ? " Held back by: " + down.map(x => x.name).join("; ") + "." : ""}` };
    });
    return out;
  }
  function regionScorecard(p, scored) {
    const heat = regionHeat(scored), imp = expectedImpact(p), avg = imp.orderGrowth;
    return REGIONS.map((r) => {
      const v = imp.regions[r];
      return { region: r, change: v, momentum: heat[r].momentum, verdict: v >= avg + 8 ? "Winner" : v < avg - 6 ? "Lagging" : "Steady", limit: REGION_INFO[r].limit, action: REGION_INFO[r].action };
    }).sort((a, b) => b.change - a.change);
  }
  function takeaways(R) {
    const p = R.post.p, top = SCEN.slice().sort((a, b) => p[b] - p[a])[0];
    const mover = SCEN.slice().sort((a, b) => Math.abs(p[b] - R.pBefore[b]) - Math.abs(p[a] - R.pBefore[a]))[0];
    const md = Math.round((p[mover] - R.pBefore[mover]) * 100);
    const reg = regionScorecard(p, R.scored), best = reg[0], worst = reg[reg.length - 1];
    const risk = R.scored.filter(s => s.pol < 0 && s.tier !== "Rejected").sort((a, b) => b.priority - a.priority)[0];
    const ol = expectedOutlook(p);
    const mfg = R.decisions.Manufacturing[0].opt.split(" (")[0];
    return [
      { tone: "base", head: `Most likely future: ${SCEN_NAME[top]} (${Math.round(p[top] * 100)}%)`, body: SCEN_CARDS[top].oneLine },
      { tone: md >= 0 ? "watch" : "good", head: `Biggest change: ${SCEN_NAME[mover]} ${md >= 0 ? "up" : "down"} ${Math.abs(md)} points`, body: "Caused by the new Nordic data: demand is real, but power grid limits push it to new places." },
      { tone: "good", head: `Brightest region: ${best.region} (${best.change > 0 ? "+" : ""}${best.change}% orders)`, body: `Weakest: ${worst.region} (${worst.change > 0 ? "+" : ""}${worst.change}%).` },
      { tone: "risk", head: `Main risk: ${shortName(risk.id)}`, body: "It delays projects more than it cancels them." },
      { tone: "good", head: `Expected orders: ${ol.m6.orders > 0 ? "+" : ""}${ol.m6.orders}% in 6 months, ${ol.m18.growth > 0 ? "+" : ""}${ol.m18.growth}% in 18 months`, body: `Recommended move: ${/^Modular/.test(mfg) ? "add flexible factory capacity in stages; do not commit to a full expansion yet" : mfg}.` },
    ];
  }

  const api = { loadCustom, resetCustom, customTemplate, isCustom: () => !!CUSTOM, SCEN, SCEN_NAME, PRIOR, REGIONS, SOURCES, SIGNALS, LOAD, SCEN_INFO, REG_IMPACT, DECISIONS, TRIPWIRES, RAW_FEED, scoreAll, posterior, entropyConf, expectedImpact, decide, regionHeat, scenarioEvidence, runPipeline, K, PLAIN, SHORT, shortName, HORIZONS, SCEN_CARDS, REGION_INFO, expectedOutlook, explainProbability, regionScorecard, takeaways };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== "undefined" ? window : globalThis);
