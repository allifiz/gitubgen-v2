import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import XLSX from "xlsx-js-style";
import { inputContext } from "../src/lib/job.js";
import { parseDsm } from "../src/lib/dsm-parser.js";
const root = "https://github.com/GO-Bimbel/api/issues/1";
const md = `**15 Oktober 2026 Pukul 16.00**\n**Maulana**\n## Task 1 | [TEST] FEAT: Example\n* GitHub : ${root}\n* Status : Staging`;
async function ui() {
  const bundled = await build({
    entryPoints: [new URL("../src/sidepanel.js", import.meta.url).pathname],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  });
  const dom = new JSDOM(
      await fs.readFile(
        new URL("../src/sidepanel.html", import.meta.url),
        "utf8",
      ),
      { runScripts: "outside-only", url: "https://extension.test/" },
    ),
    w = dom.window;
  const listeners = [],
    downloads = [],
    saved = {};
  let blob;
  w.structuredClone = structuredClone;
  w.URL.createObjectURL = (b) => {
    blob = b;
    return "blob:test";
  };
  w.URL.revokeObjectURL = () => {};
  w.setTimeout = (f) => {
    f();
    return 0;
  };
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  w.HTMLDialogElement.prototype.close = function (value) {
    this.returnValue = value;
    this.removeAttribute("open");
    this.dispatchEvent(new w.Event("close"));
  };
  w.chrome = {
    storage: {
      session: {
        get: async () => saved,
        set: async (v) => Object.assign(saved, v),
      },
    },
    runtime: {
      onMessage: { addListener: (f) => listeners.push(f) },
      sendMessage: async (m) => {
        if (m.type === "GET_JOB") return null;
        if (m.type === "START_SCAN") {
          queueMicrotask(() => {
            for (const f of listeners)
              f({
                type: "JOB_PROGRESS",
                job: {
                  status: "completed",
                  total: 1,
                  processed: 1,
                  maxDepth: m.maxDepth,
                  inputContext: m.inputContext,
                  errors: [],
                  scans: {
                    [root]: {
                      url: root,
                      events: [
                        {
                          type: "status",
                          status: "In Progress",
                          previousStatus: "Todo",
                          datetime: "2026-10-15T13:00:00+07:00",
                        },
                        {
                          type: "status",
                          status: "Ready to Review",
                          previousStatus: "In Progress",
                          datetime: "2026-10-15T14:00:00+07:00",
                        },
                        {
                          type: "status",
                          status: "Staging",
                          previousStatus: "Ready to Review",
                          datetime: "2026-10-15T16:00:00+07:00",
                        },
                      ],
                    },
                  },
                },
              });
          });
          return { ok: true };
        }
      },
    },
    downloads: {
      download: async (o) => {
        downloads.push(o);
      },
    },
  };
  w.eval(bundled.outputFiles[0].text);
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  await tick();
  const setFile = (id, file) =>
    Object.defineProperty(w.document.querySelector(id), "files", {
      configurable: true,
      value: [file],
    });
  setFile("#dsmFile", { name: "test.md", text: async () => md });
  w.document.querySelector("#githubToken").value = "synthetic";
  return { w, dom, saved, downloads, tick, setFile, getBlob: () => blob };
}
test("sidepanel parse → scan → preview → Excel download memakai hasil interval sama", async () => {
  const u = await ui();
  u.w.document.querySelector("#scan").click();
  await u.tick();
  await u.tick();
  const row = u.w.document.querySelector("#previewTable tbody tr");
  assert.ok(row);
  assert.match(row.textContent, /14:00:00/);
  assert.doesNotMatch(row.cells[5].textContent, /16:00:00/);
  assert.equal(row.cells[6].textContent, "1");
  assert.equal(u.saved.gitubgenCredentials.githubToken, "synthetic");
  assert.equal(
    u.saved.gitubgenCredentials.recorderUrl,
    "https://gitubgen-recorder.vercel.app",
  );
  u.w.document.querySelector("#export").click();
  await u.tick();
  assert.equal(u.downloads.length, 1);
  assert.match(u.downloads[0].filename, /Oktober-2026/);
  assert.ok(u.getBlob().size > 1000);
  u.dom.window.close();
});
test("rekonsiliasi membutuhkan preview row, batal tidak mengunduh, apply menghasilkan salinan", async () => {
  const u = await ui();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Assignee", "Ticket URL", "Date", "Start Time", "End Time", "Hour"],
      ["Maulana", root, "15/10/2026", "old", "old", 9],
    ]),
    "KPI",
  );
  u.setFile("#kpiFile", {
    name: "reference.xlsx",
    arrayBuffer: async () =>
      new u.w.Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }))
        .buffer,
  });
  u.w.document.querySelector("#kpiFile").dispatchEvent(new u.w.Event("change"));
  await u.tick();
  u.w.document.querySelector("#scan").click();
  await u.tick();
  await u.tick();
  u.w.document.querySelector("#importMode").value = "reconcile";
  u.w.document.querySelector("#export").click();
  await u.tick();
  assert.ok(u.w.document.querySelector("#changesDialog").hasAttribute("open"));
  assert.match(
    u.w.document.querySelector("#changesBody").textContent,
    /old → 15\/10\/2026 14:00:00/,
  );
  assert.equal(u.downloads.length, 0);
  u.w.document.querySelector("#changesDialog").close("cancel");
  await u.tick();
  assert.equal(u.downloads.length, 0);
  u.w.document.querySelector("#export").click();
  await u.tick();
  u.w.document.querySelector("#changesDialog").close("apply");
  await u.tick();
  assert.equal(u.downloads.length, 1);
  assert.match(u.downloads[0].filename, /reference-GITUBGEN-V2/);
  u.dom.window.close();
});
