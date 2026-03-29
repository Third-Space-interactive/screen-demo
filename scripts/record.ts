import { chromium, type Page, type BrowserContext } from "playwright";
import * as fs from "fs";
import * as path from "path";
import type { BrowsePlan, BrowsePlanAction, Moment, MomentsFile } from "../src/types";

function clampToViewport(
  x: number,
  y: number,
  vw: number,
  vh: number
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(vw, x)),
    y: Math.max(0, Math.min(vh, y)),
  };
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: tsx scripts/record.ts <slug>");
    process.exit(1);
  }

  const dataDir = path.resolve(__dirname, "..", "data", slug);
  const planPath = path.join(dataDir, "browse-plan.json");

  if (!fs.existsSync(planPath)) {
    console.error(`Browse plan not found: ${planPath}`);
    process.exit(1);
  }

  const plan: BrowsePlan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
  const videoDir = dataDir;

  // Launch browser with video recording
  // C2 fix: capture recordingStart immediately after context creation,
  // before newPage(), to minimize offset with video start
  const browser = await chromium.launch({ headless: false });
  const context: BrowserContext = await browser.newContext({
    viewport: plan.viewport,
    recordVideo: {
      dir: videoDir,
      size: plan.viewport,
    },
  });
  const recordingStart = Date.now(); // C2: set clock right after context (video starts here)

  const page: Page = await context.newPage();
  const moments: Moment[] = [];
  let momentId = 0;

  console.log(`Recording started for "${slug}" at ${plan.url}`);

  for (const action of plan.actions) {
    momentId++;

    const moment: Moment = {
      id: momentId,
      type: action.type,
      // C1 fix: timestamp will be set to the PRE-action time (when cursor should arrive)
      timestamp: 0,
      description: action.description,
    };

    switch (action.type) {
      case "navigate": {
        const targetUrl = action.url ?? plan.url;
        moment.url = targetUrl;
        moment.timestamp = Date.now() - recordingStart; // before navigation starts
        await page.goto(targetUrl, { waitUntil: "networkidle" });
        break;
      }

      case "wait": {
        moment.timestamp = Date.now() - recordingStart;
        const ms = action.ms ?? 1000;
        await page.waitForTimeout(ms);
        break;
      }

      case "hover": {
        if (!action.selector) break;
        const el = page.locator(action.selector).first();
        await el.scrollIntoViewIfNeeded(); // I1: ensure element is in viewport
        const box = await el.boundingBox();
        if (box) {
          // I1 fix: clamp coordinates to viewport bounds
          const clamped = clampToViewport(
            box.x + box.width / 2,
            box.y + box.height / 2,
            plan.viewport.width,
            plan.viewport.height
          );
          moment.cursor = {
            x: Math.round(clamped.x),
            y: Math.round(clamped.y),
          };
          moment.target = {
            x: Math.round(Math.max(0, box.x)),
            y: Math.round(Math.max(0, box.y)),
            width: Math.round(box.width),
            height: Math.round(box.height),
          };
        }
        // C1 fix: timestamp is BEFORE the action (when cursor should be at target)
        moment.timestamp = Date.now() - recordingStart;
        await el.hover();
        await page.waitForTimeout(500);
        break;
      }

      case "click": {
        if (!action.selector) break;
        const el = page.locator(action.selector).first();
        await el.scrollIntoViewIfNeeded(); // I1: ensure element is in viewport
        const box = await el.boundingBox();
        if (box) {
          const clamped = clampToViewport(
            box.x + box.width / 2,
            box.y + box.height / 2,
            plan.viewport.width,
            plan.viewport.height
          );
          moment.cursor = {
            x: Math.round(clamped.x),
            y: Math.round(clamped.y),
          };
          moment.target = {
            x: Math.round(Math.max(0, box.x)),
            y: Math.round(Math.max(0, box.y)),
            width: Math.round(box.width),
            height: Math.round(box.height),
          };
        }
        // C1 fix: timestamp is BEFORE the click (cursor arrives, then click happens)
        moment.timestamp = Date.now() - recordingStart;
        await el.click();
        await page.waitForTimeout(800);
        break;
      }

      case "scroll": {
        const deltaY = action.deltaY ?? 400;
        const scrollBefore = await page.evaluate(() => window.scrollY);
        moment.cursor = {
          x: Math.round(plan.viewport.width / 2),
          y: Math.round(plan.viewport.height / 2),
        };
        moment.timestamp = Date.now() - recordingStart; // before scroll
        await page.mouse.wheel(0, deltaY);
        await page.waitForTimeout(600);
        const scrollAfter = await page.evaluate(() => window.scrollY);
        moment.scrollDelta = {
          x: 0,
          y: Math.round(scrollAfter - scrollBefore),
        };
        break;
      }

      case "script": {
        if (!action.js) break;
        moment.timestamp = Date.now() - recordingStart; // before script runs
        await page.evaluate(action.js);
        await page.waitForTimeout(800);
        break;
      }
    }

    // C1 fix: DO NOT overwrite timestamp. It stays as the pre-action value.
    moments.push(moment);
    console.log(`  [${moment.timestamp}ms] ${action.type}: ${action.description}`);
  }

  // Close context to finalize video
  const videoPath = await page.video()?.path();
  await context.close();
  await browser.close();

  // Rename the video file to recording.mp4
  if (videoPath && fs.existsSync(videoPath)) {
    const destPath = path.join(dataDir, "recording.mp4");
    fs.renameSync(videoPath, destPath);
    console.log(`\nRecording saved: ${destPath}`);
  }

  // Write moments.json
  const momentsFile: MomentsFile = {
    metadata: {
      url: plan.url,
      viewportWidth: plan.viewport.width,
      viewportHeight: plan.viewport.height,
      totalDurationMs: Date.now() - recordingStart,
      recordingStart: new Date(recordingStart).toISOString(),
    },
    moments,
  };

  const momentsPath = path.join(dataDir, "moments.json");
  fs.writeFileSync(momentsPath, JSON.stringify(momentsFile, null, 2));
  console.log(`Moments saved: ${momentsPath} (${moments.length} actions)`);
}

main().catch((err) => {
  console.error("Recording failed:", err);
  process.exit(1);
});
