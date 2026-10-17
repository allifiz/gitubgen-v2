import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import XLSX from "xlsx-js-style";
import {
  parseDsm,
  parseSessionFromText,
  parseDateFromText,
} from "../src/lib/dsm-parser.js";
import {
  decideTimes,
  reconcileEvents,
  decisionRows,
  localDate,
  RULE_VERSION,
} from "../src/lib/activity-matcher.js";
import { fetchActivity, normalizeActivity } from "../src/lib/github-graphql.js";
import {
  fetchRecorderHistory,
  transitionToEvent,
} from "../src/lib/recorder-api.js";
import { createWorkbookFromDsm, fillWorkbook } from "../src/lib/workbook.js";
import { jobFingerprint } from "../src/lib/job.js";
const root = "https://github.com/GO-Bimbel/api/issues/1",
  child = "https://github.com/GO-Bimbel/db/issues/2",
  pr = "https://github.com/GO-Bimbel/db/pull/3";
const e = (extra = {}) => ({
  assignee: "maulana",
  date: "2026-10-15",
  ticketUrl: root,
  ticketTitle: "[TEST] FEAT: Example",
  session: "16:00",
  status: "Staging",
  ...extra,
});
const st = (time, previousStatus, status, extra = {}) => ({
  id: `${time}:${status}`,
  type: "status",
  datetime: `2026-10-15T${time}+07:00`,
  previousStatus,
  status,
  source: "graphql",
  projectNumber: 11,
  ...extra,
});
const scan = (events, linkedUrls = []) => ({ url: root, events, linkedUrls });
const decide = (events, entry = e()) =>
  decideTimes(entry, { [root]: scan(events) });
for (const day of [11, 14, 15, 16])
  for (const hour of [11, 16])
    test(`F01 tanggal ${day} bukan sesi ${hour}`, () =>
      assert.equal(
        parseSessionFromText(`${day} Oktober 2026 Pukul ${hour}.00`),
        `${hour}:00`,
      ));
test("F02 prose tidak mengganti tanggal/PIC/sesi; URL catatan bukan tiket", () => {
  const md = `**14 Oktober 2026 Pukul 11.00**\n**Allief**\n## Task 1 | Test\n* GitHub : ${root}\n* Status : In Progress\n* catatan: diskusi Maulana deadline 16/10/2026 ada 15 item ${pr}\n## Task 2 | Next\n* GitHub : ${child}`;
  const rows = parseDsm(md);
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every(
      (r) =>
        r.assignee === "allief" &&
        r.date === "2026-10-14" &&
        r.session === "11:00",
    ),
  );
  assert.equal(rows[1].line, 8);
  assert.equal(parseDateFromText("31/02/2026"), null);
});
test("F03/F04 HMAC: RTR menutup kerja, Todo/review/Staging tidak menambah Hour", () => {
  const d = decide([
    st("13:44:52", "Todo", "In Progress", { actor: "allifgobimbel" }),
    st("13:45:15", "In Progress", "Todo"),
    st("13:49:09", "Todo", "In Progress"),
    st("14:05:35", "In Progress", "Ready to Review"),
    st("14:29:34", "Ready to Review", "Done Review"),
    st("14:48:29", "Done Review", "Staging"),
  ]);
  assert.equal(d.end, "2026-10-15T14:05:35+07:00");
  assert.equal(d.intervals.length, 2);
  assert.equal(d.seconds, 1009);
  assert.ok(d.flags.includes("SHORT_STATUS_CYCLE"));
});
test("F04 #3956: tiga sesi menghasilkan 3637 detik", () => {
  const d = decide([
    st("09:14:17", "Staging", "In Progress"),
    st("09:30:15", "In Progress", "Ready to Review"),
    st("13:55:21", "Ready to Review", "In Progress"),
    st("14:03:30", "In Progress", "Ready to Review"),
    st("14:21:26", "Staging", "In Progress"),
    st("14:57:56", "In Progress", "Ready to Review"),
  ]);
  assert.equal(d.seconds, 3637);
  assert.equal(d.intervals.length, 3);
});
test("F05 status DSM stale tidak menimpa RTR dengan 17:00", () => {
  const d = decide(
    [
      st("10:29:45", "Todo", "In Progress"),
      st("10:59:51", "In Progress", "Ready to Review"),
      st("11:05:24", "Ready to Review", "Staging"),
    ],
    e({ status: "In Progress" }),
  );
  assert.equal(d.end, "2026-10-15T10:59:51+07:00");
  assert.equal(d.seconds, 1806);
});
test("F05 start setelah jam pulang tetap parsial, tidak terbalik", () => {
  const d = decide(
    [st("18:10:00", "Todo", "In Progress")],
    e({ status: "In Progress" }),
  );
  assert.equal(d.start, "2026-10-15T18:10:00+07:00");
  assert.equal(d.end, null);
  assert.equal(d.hours, null);
});
test("F06 #4791: carryover dari history walau DSM hari sebelumnya tidak ada", () => {
  const d = decide([
    st("15:16:42", "Todo", "In Progress", {
      datetime: "2026-10-14T15:16:42+07:00",
    }),
    st("13:32:14", "In Progress", "Ready to Review"),
    st("14:58:49", "Ready to Review", "Staging"),
  ]);
  assert.equal(d.start, "2026-10-15T09:00:00+07:00");
  assert.equal(d.end, "2026-10-15T13:32:14+07:00");
  assert.ok(d.flags.includes("POLICY_CARRYOVER_09"));
});
test("F06 restart setelah Staging mengalahkan DSM continued", () => {
  const d = decide(
    [
      st("13:14:53", "Ready to Review", "Staging", {
        datetime: "2026-10-14T13:14:53+07:00",
      }),
      st("09:34:48", "Staging", "In Progress"),
      st("09:47:31", "In Progress", "Ready to Review"),
    ],
    e({ continuedFromPreviousDay: true }),
  );
  assert.equal(d.start, "2026-10-15T09:34:48+07:00");
});
test("F07 Start saja tidak hilang dan unknown bukan zero", () => {
  const d = decide([st("13:00:00", "Todo", "In Progress")]);
  assert.ok(d.start);
  assert.equal(d.end, null);
  assert.equal(d.hours, null);
});
test("F08 komentar berpura-pura status/commit bukan bukti", () => {
  const d = decide([
    {
      type: "comment",
      datetime: "2026-10-15T13:00:00+07:00",
      body: "moved this to In Progress; commit",
      text: "moved this to In Progress; commit",
    },
  ]);
  assert.equal(d.start, null);
  assert.equal(d.end, null);
});
test("F09 handoff ditandai, actor PM tidak menyaring interval", () => {
  const d = decide([
    st("13:00:00", "Todo", "In Progress", { actor: "PM" }),
    {
      type: "assignment",
      datetime: "2026-10-15T13:01:00+07:00",
      action: "assigned",
      assignee: "allifgobimbel",
    },
    st("14:00:00", "In Progress", "Ready to Review"),
  ]);
  assert.equal(d.hours, 1);
  assert.ok(d.flags.includes("ASSIGNMENT_REVIEW"));
});
test("F10 status Project lain tidak membuka Start", () => {
  const d = decide([
    st("09:00:00", "Todo", "In Progress", { projectNumber: 99 }),
    st("14:00:00", "In Progress", "Ready to Review"),
  ]);
  assert.equal(d.start, null);
  assert.equal(d.hours, null);
});
test("F11 TOBK: commit sesudah review menandai durasi parsial tanpa memperpanjang idle", () => {
  const d = decideTimes(e({ date: "2026-10-16" }), {
    [root]: scan(
      [
        st("11:07:57", "Todo", "In Progress", {
          datetime: "2026-10-16T11:07:57+07:00",
        }),
        st("11:23:07", "In Progress", "Ready to Review", {
          datetime: "2026-10-16T11:23:07+07:00",
        }),
      ],
      [pr],
    ),
    [pr]: scan([
      {
        type: "commit",
        datetime: "2026-10-16T13:48:16+07:00",
        text: "USE_GUARDS",
      },
    ]),
  });
  assert.equal(d.seconds, 910);
  assert.ok(d.flags.includes("UNPAIRED_WORK_AFTER_REVIEW"));
  assert.equal(d.lastWorkAt, "2026-10-16T13:48:16+07:00");
});
test("F12/F13 PR sub-issue memberi kandidat End, Start dan Hour unknown", () => {
  const d = decideTimes(e(), {
    [root]: scan([], [child]),
    [child]: scan([], [pr]),
    [pr]: scan([
      {
        type: "commit",
        datetime: "2026-10-15T16:31:46+07:00",
        text: "hapus interceptor",
      },
    ]),
  });
  assert.equal(d.end, "2026-10-15T16:31:46+07:00");
  assert.equal(d.start, null);
  assert.equal(d.hours, null);
  assert.ok(d.relationshipPaths.some((p) => p.length === 3));
});
test("F12 hubungan typed; mention bukan closing PR; Target Date dari Project 11", () => {
  const d = normalizeActivity(
    {
      data: {
        repository: {
          issue: {
            url: root,
            subIssues: { nodes: [{ url: child }] },
            closedByPullRequestsReferences: { nodes: [{ url: pr }] },
            projectItems: {
              nodes: [
                {
                  project: { number: 99 },
                  fieldValues: {
                    nodes: [
                      { field: { name: "Target Date" }, date: "2026-01-01" },
                    ],
                  },
                },
                {
                  project: { number: 11 },
                  fieldValues: {
                    nodes: [
                      { field: { name: "Target Date" }, date: "2026-10-20" },
                    ],
                  },
                },
              ],
            },
            timelineItems: {
              nodes: [
                {
                  __typename: "CrossReferencedEvent",
                  createdAt: "2026-10-15T01:00:00Z",
                  source: { url: "https://github.com/a/b/pull/999" },
                },
              ],
            },
          },
        },
      },
    },
    root,
  );
  assert.deepEqual(d.linkedUrls, [child, pr]);
  assert.equal(d.targetDate, "2026-10-20");
});
test("F14 pagination connection dan partial project data tetap dipakai", async () => {
  let calls = 0;
  const d = await fetchActivity(root, "synthetic", async (_url, init) => {
    calls++;
    const q = JSON.parse(init.body).query;
    return {
      ok: true,
      json: async () =>
        q.includes("query Page")
          ? {
              data: {
                node: {
                  comments: {
                    nodes: [
                      {
                        id: "end",
                        createdAt: "2026-10-15T07:00:00Z",
                        bodyText: "/end",
                      },
                    ],
                    pageInfo: { hasNextPage: false, endCursor: "b" },
                  },
                },
              },
            }
          : q.includes("query ProjectActivity")
            ? {
                errors: [{ message: "date denied" }],
                data: {
                  repository: {
                    issue: {
                      url: root,
                      timelineItems: {
                        nodes: [
                          st("14:00:00", "In Progress", "Ready to Review", {
                            createdAt: "2026-10-15T07:00:00Z",
                          }),
                        ],
                      },
                    },
                  },
                },
              }
            : {
                data: {
                  repository: {
                    issue: {
                      id: "I_1",
                      url: root,
                      comments: {
                        nodes: [
                          {
                            id: "start",
                            createdAt: "2026-10-15T06:00:00Z",
                            bodyText: "/start",
                          },
                        ],
                        pageInfo: { hasNextPage: true, endCursor: "a" },
                      },
                    },
                  },
                },
              },
    };
  });
  assert.equal(calls, 3);
  assert.ok(d.events.some((e) => e.body === "/end"));
  assert.ok(d.events.some((e) => e.type === "status"));
  assert.equal(d.coverage.complete, false);
});
test("F14 request cap menghasilkan coverage partial", async () => {
  const d = await fetchActivity(
    root,
    "synthetic",
    async () => ({
      ok: true,
      json: async () => ({
        data: {
          repository: {
            issue: {
              id: "I",
              url: root,
              comments: {
                nodes: [],
                pageInfo: { hasNextPage: true, endCursor: "a" },
              },
            },
          },
        },
      }),
    }),
    { maxRequests: 1 },
  );
  assert.equal(d.coverage.complete, false);
  assert.ok(d.warnings.some((w) => w.includes("REQUEST_BUDGET")));
});
test("F16 reconcile native/Recorder menyimpan timestamp asli; transisi cepat berbeda tidak digabung", () => {
  const native = st("13:00:02", "Todo", "In Progress"),
    rec = {
      ...native,
      id: "rec",
      datetime: "2026-10-15T13:00:00+07:00",
      source: "recorder",
      recorderSource: "poll",
    };
  const events = reconcileEvents([
    rec,
    native,
    st("13:00:03", "In Progress", "Todo"),
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].datetime, native.datetime);
  assert.equal(events[0].observations.length, 2);
});
test("F16 baseline menurunkan confidence", () => {
  const d = decide([
    transitionToEvent({
      issueUrl: root,
      newStatus: "In Progress",
      previousStatus: null,
      occurredAt: "2026-10-15T13:00:00+07:00",
      source: "baseline",
    }),
    st("14:00:00", "In Progress", "Ready to Review"),
  ]);
  assert.notEqual(d.confidence, "HIGH");
  assert.ok(d.flags.includes("BASELINE_STATE"));
});
test("F21 tanggal unik memakai WIB, bukan slice UTC", () => {
  const result = createWorkbookFromDsm([e()], {
    [root]: scan([
      st("01:00:00", "Todo", "In Progress", {
        datetime: "2026-10-14T18:00:00Z",
      }),
      st("10:00:00", "In Progress", "Ready to Review"),
    ]),
  });
  assert.equal(result.workbook.Sheets["Rekap Tiket Unik"].G2.v, "15/10/2026");
  assert.equal(localDate("2026-10-14T18:00:00Z"), "2026-10-15");
});
test("F22 Recorder client chunks 451 URL tanpa silent truncation", async () => {
  let sizes = [];
  const urls = Array.from({ length: 451 }, (_, i) => root + i);
  await fetchRecorderHistory(
    { url: "https://rec.vercel.app", secret: "synthetic" },
    urls,
    {},
    async (_u, init) => {
      sizes.push(JSON.parse(init.body).issueUrls.length);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          history: [],
          coverage: { truncated: false },
        }),
      };
    },
  );
  assert.deepEqual(sizes, [200, 200, 51]);
});
const headers = [
  "Assignee",
  "Type",
  "Ticket Title",
  "Ticket URL",
  "Type",
  "Status",
  "Priority",
  "Date",
  "Target Date",
  "Week",
  "Start Time",
  "End Time",
  "Hour",
];
const wb = (rows, h = headers) => {
  const w = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([h, ...rows]), "KPI");
  return w;
};
const row = (start = "", end = "", hour = "") => [
  "Maulana",
  "TEST",
  "Title",
  root,
  "FEAT",
  "Staging",
  "",
  "15/10/2026",
  "",
  "",
  start,
  end,
  hour,
];
const pair = {
  [root]: scan([
    st("13:00:00", "Todo", "In Progress"),
    st("14:00:00", "In Progress", "Ready to Review"),
  ]),
};
test("F24 setengah terisi dilengkapi; nilai lama dilindungi default", () => {
  const before = wb([row("", "15/10/2026 14:00:00")]),
    result = fillWorkbook(before, [e()], pair);
  assert.equal(result.workbook.Sheets.KPI.K2.v, "15/10/2026 13:00:00");
  assert.equal(result.workbook.Sheets.KPI.M2.v, 1);
  assert.equal(before.Sheets.KPI.K2?.v || "", "");
  const full = fillWorkbook(wb([row("manual", "old", 9)]), [e()], pair);
  assert.equal(full.workbook.Sheets.KPI.K2.v, "manual");
  assert.equal(full.workbook.Sheets.KPI.M2.v, 9);
});
test("F24 rekonsiliasi preview, row selection dan Manual lock", () => {
  const book = wb([row("old", "old", 9)]),
    preview = fillWorkbook(book, [e()], pair, { mode: "reconcile" });
  assert.ok(preview.changes.some((c) => c.before === "old"));
  const unselected = fillWorkbook(book, [e()], pair, {
    mode: "reconcile",
    allowedRowIds: [],
  });
  assert.equal(unselected.workbook.Sheets.KPI.K2.v, "old");
  const locked = fillWorkbook(
    wb([[...row("old", "old", 9), "YES"]], [...headers, "Manual"]),
    [e()],
    pair,
    { mode: "reconcile" },
  );
  assert.equal(locked.workbook.Sheets.KPI.K2.v, "old");
  assert.equal(locked.changes.length, 0);
});
test("F25 roundtrip menjaga formula hyperlink comment style merge & coordinates", () => {
  const book = wb([row("", "15/10/2026 14:00:00")]);
  const s = book.Sheets.KPI;
  s.M2 = { t: "n", f: "1+1", v: 2 };
  s.D2.l = { Target: root };
  s.D2.c = [{ a: "Reviewer", t: "keep" }];
  s.D2.s = { font: { bold: true } };
  s["!merges"] = [{ s: { r: 3, c: 0 }, e: { r: 3, c: 2 } }];
  const result = fillWorkbook(book, [e()], pair, { mode: "reconcile" }),
    round = XLSX.read(
      XLSX.write(result.workbook, {
        type: "buffer",
        bookType: "xlsx",
        cellStyles: true,
      }),
      { type: "buffer", cellStyles: true },
    );
  assert.equal(round.Sheets.KPI.M2.f, "1+1");
  assert.equal(round.Sheets.KPI.D2.l.Target, root);
  assert.equal(round.Sheets.KPI.D2.c[0].t, "keep");
  assert.ok(result.workbook.Sheets.KPI.D2.s.font.bold);
  assert.equal(round.Sheets.KPI["!merges"].length, 1);
});
test("F25 Target Date ditambahkan di ujung, formula tidak bergeser", () => {
  const h = headers.filter((v) => v !== "Target Date"),
    r = row();
  r.splice(8, 1);
  const b = wb([r], h);
  b.Sheets.KPI.L2 = { t: "n", f: "1+1", v: 2 };
  const out = fillWorkbook(b, [e()], pair).workbook.Sheets.KPI;
  assert.equal(out.L2.f, "1+1");
  assert.equal(out.M1.v, "Target Date");
});
test("F26 Diagnostic row stabil, mencakup unmatched dan skipped", () => {
  const r = row("old", "old", 5),
    r2 = row();
  r2[7] = "14/10/2026";
  const out = fillWorkbook(wb([r, r2]), [e()], pair).workbook;
  assert.equal(out.Sheets.KPI.H2.v, "15/10/2026");
  const rows = XLSX.utils.sheet_to_json(out.Sheets.Diagnostic, { header: 1 });
  assert.equal(rows.length, 3);
  assert.equal(rows[1][0], 2);
  assert.equal(rows[2][0], 3);
  assert.equal(rows[2][10], "UNMATCHED_DSM_ROW");
  assert.equal(rows[1][18], RULE_VERSION);
});
test("F27 overlap dilaporkan tanpa pembagian waktu; presisi detik dipertahankan", () => {
  const rows = decisionRows([e(), e({ ticketUrl: child })], {
    ...pair,
    [child]: scan(pair[root].events),
  });
  assert.equal(rows[0].decision.hours, 1);
  assert.ok(
    rows.every((r) => r.decision.flags.includes("OVERLAPPING_TICKETS")),
  );
  const d = decide([
    st("13:00:00", "Todo", "In Progress"),
    st("13:00:05", "In Progress", "Ready to Review"),
  ]);
  assert.equal(d.seconds, 5);
  assert.ok(d.hours > 0);
  assert.ok(d.flags.includes("SUB_DISPLAY_PRECISION"));
});

async function background(initial, fetcher, history = {}) {
  let saved = { gitubgenJob: initial },
    checkpoints = [];
  const chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener() {} },
      sendMessage: async () => {},
    },
    sidePanel: { setPanelBehavior: async () => {} },
    storage: {
      local: {
        get: async () => structuredClone(saved),
        set: async (v) => {
          saved = { ...saved, ...structuredClone(v) };
          checkpoints.push(structuredClone(v.gitubgenJob));
        },
        remove: async () => {},
      },
      session: { get: async () => ({}) },
    },
  };
  const source = await fs.readFile(
    new URL("../src/background.js", import.meta.url),
    "utf8",
  );
  const api = new Function(
    "chrome",
    "fetchActivity",
    "fetchRecorderHistory",
    "reconcileEvents",
    "RULE_VERSION",
    "jobFingerprint",
    source.replace(/^import .*;\n/gm, "").replace(/^export /gm, "") +
      "\nreturn {startScan};",
  )(
    chrome,
    fetcher,
    async () => history,
    reconcileEvents,
    RULE_VERSION,
    jobFingerprint,
  );
  return { api, get: () => saved.gitubgenJob, checkpoints };
}
test("F15 Recorder dipakai walau GraphQL gagal", async () => {
  const b = await background(
    null,
    async () => {
      throw new Error("403");
    },
    { [root]: [st("13:00:00", "Todo", "In Progress", { source: "recorder" })] },
  );
  await b.api.startScan(
    [{ url: root, dates: ["2026-10-15"] }],
    3,
    "synthetic",
    { url: "https://rec.vercel.app", secret: "synthetic" },
    "context",
  );
  assert.equal(b.get().scans[root].events.length, 1);
  assert.equal(b.get().errors.length, 1);
  assert.equal(b.checkpoints[0].processed, 0);
  assert.equal(b.checkpoints[1].inFlight.length, 1);
});
test("F23 checkpoint lama ditolak untuk input baru; graph sampai PR tidak berhenti pada End", async () => {
  const old = {
    status: "paused",
    fingerprint: "old",
    queue: [],
    scans: { old: {} },
    processed: 1,
    total: 1,
  };
  const b = await background(old, async (u) =>
    u === root
      ? scan([st("14:00:00", "In Progress", "Ready to Review")], [child])
      : u === child
        ? scan([], [pr])
        : scan([{ type: "commit", datetime: "2026-10-15T16:00:00+07:00" }]),
  );
  await b.api.startScan(
    [{ url: root, dates: ["2026-10-15"] }],
    3,
    "synthetic",
    null,
    "new",
  );
  assert.deepEqual(Object.keys(b.get().scans), [root, child, pr]);
  assert.equal(b.get().status, "completed");
  assert.equal(b.get().inputContext, "new");
});

test("F23 in-flight checkpoint requeue tanpa kehilangan item atau memakai input lain", async () => {
  const first = await background(null, async () => scan([]));
  const inputs = [{ url: root, dates: ["2026-10-15"] }];
  await first.api.startScan(inputs, 3, "synthetic", null, "same");
  const checkpoint = structuredClone(first.get());
  checkpoint.status = "paused";
  checkpoint.scans = {};
  checkpoint.processed = 0;
  checkpoint.queue = [];
  checkpoint.inFlight = [
    { url: root, dates: ["2026-10-15"], targets: {}, depth: 0 },
  ];
  const calls = [];
  const resumed = await background(checkpoint, async (url) => {
    calls.push(url);
    return scan([]);
  });
  await resumed.api.startScan(inputs, 3, "synthetic", null, "same");
  assert.deepEqual(calls, [root]);
  assert.equal(resumed.get().processed, 1);
  assert.equal(resumed.get().status, "completed");
});

test("F16 transisi berbeda di antara dua timestamp membatalkan korelasi proximity", () => {
  const rec = st("13:00:00", "Todo", "In Progress", {
      source: "recorder",
      id: "rec",
      recorderSource: "poll",
    }),
    pause = st("13:00:01", "In Progress", "Todo"),
    native = st("13:00:02", "Todo", "In Progress");
  assert.equal(reconcileEvents([rec, pause, native]).length, 3);
});
