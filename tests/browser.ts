import { chromium, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { database, migrate } from "../server/db.js";
import { createApp } from "../server/app.js";
import { token } from "../server/security.js";
import QRCode from "qrcode";

const origin = `http://${process.env.BROWSER_TEST_HOST || "localhost"}:4175`;
const configuredOrigin = "http://localhost:4175";
const db = await database();
await migrate(db);
const setupToken = token();
let passengerCode = "";
const app = createApp(db, {
  origin: configuredOrigin,
  staticDir: "dist",
  setupToken,
  disableRateLimit: true,
  otpProvider: {
    mode: "console",
    async send(_phone, code) {
      passengerCode = code;
      return null;
    },
  },
});
const server = app.listen(4175, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
await mkdir(".data/browser-check", { recursive: true });
const operationsContext = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const admin = await operationsContext.newPage();
admin.on("pageerror", (error) => errors.push(error.message));
async function save(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}
async function nav(page: Page, label: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function generate(kind: string, target: string) {
  await admin.getByRole("button", { name: "Generate QR", exact: true }).click();
  const dialog = admin.getByRole("dialog");
  await dialog
    .getByLabel("Workflow", { exact: true })
    .selectOption({ label: kind });
  await dialog
    .getByLabel(
      kind === "Staff item collection"
        ? "Product (item QR only)"
        : "Compartment (passenger or location QR)",
      { exact: true },
    )
    .selectOption({ label: target });
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    admin.getByRole("heading", { name: "Your QR is ready" }),
  ).toBeVisible();
  const href = await admin
    .getByRole("link", { name: "Open QR workflow" })
    .getAttribute("href");
  await admin.getByRole("button", { name: "Close QR preview" }).click();
  return href!;
}
try {
  await admin.goto(origin + "/setup#" + setupToken);
  await admin
    .getByLabel("Your name", { exact: true })
    .fill("Review Administrator");
  await admin
    .getByLabel("Email address", { exact: true })
    .fill("review-admin@example.test");
  await admin
    .getByLabel("Password (at least 12 characters)", { exact: true })
    .fill("Review-test-password-594!");
  await admin.getByRole("button", { name: "Create administrator" }).click();
  await admin.getByRole("link", { name: "Go to sign in" }).click();
  await admin
    .getByLabel("Email address", { exact: true })
    .fill("review-admin@example.test");
  await admin
    .getByLabel("Password", { exact: true })
    .fill("Review-test-password-594!");
  await admin.getByRole("button", { name: "Sign in securely" }).click();
  await expect(
    admin.getByRole("heading", { name: "Welcome, Review." }),
  ).toBeVisible();
  await admin.screenshot({
    path: ".data/browser-check/empty-dashboard.png",
    fullPage: true,
  });
  await admin.getByRole("button", { name: "Create first service" }).click();
  const service = admin.getByRole("dialog");
  await service
    .getByLabel("Service name", { exact: true })
    .fill("Test Journey Express");
  await service.getByLabel("Train number", { exact: true }).fill("12345");
  await service.getByLabel("Service date", { exact: true }).fill("2026-10-18");
  await service.getByLabel("Origin station", { exact: true }).fill("New Delhi");
  await service
    .getByLabel("Destination station", { exact: true })
    .fill("Mumbai");
  await save(admin);
  await nav(admin, "Services & coaches");
  await nav(admin, "QR centre");
  await admin
    .getByRole("button", { name: "Create passenger QR", exact: true })
    .click();
  await expect(
    admin.getByText("No compartments yet", { exact: true }),
  ).toBeVisible();
  await expect(
    admin.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  await admin
    .getByRole("button", { name: "Add a compartment", exact: true })
    .click();
  await admin
    .getByLabel("Compartment code (for example S1)", { exact: true })
    .fill("S1");
  await save(admin);
  await nav(admin, "Catalogue");
  await admin
    .getByRole("button", { name: "Add category", exact: true })
    .click();
  await admin.getByLabel("Category name", { exact: true }).fill("Beverages");
  await save(admin);
  await admin.getByRole("button", { name: "Add product", exact: true }).click();
  await admin.getByLabel("Product name", { exact: true }).fill("Mineral water");
  await admin
    .getByLabel("Category", { exact: true })
    .selectOption({ label: "Beverages" });
  await admin.getByLabel("Price in rupees", { exact: true }).fill("20");
  await admin
    .getByLabel("Description", { exact: true })
    .fill("Sealed 1 litre drinking water.");
  await save(admin);
  await nav(admin, "Inventory");
  await admin.getByRole("button", { name: "Set opening stock" }).click();
  await admin
    .getByLabel("Product", { exact: true })
    .selectOption({ label: "Mineral water" });
  await admin.getByLabel("Opening quantity", { exact: true }).fill("10");
  await admin
    .getByLabel("Reason", { exact: true })
    .fill("Browser test opening stock");
  await save(admin);
  await nav(admin, "Staff & locations");
  await admin.getByRole("button", { name: "Add staff member" }).click();
  await admin.getByLabel("Display name", { exact: true }).fill("Review Staff");
  await admin
    .getByLabel("Login email", { exact: true })
    .fill("review-staff@example.test");
  await admin
    .getByLabel("Initial password (at least 12 characters)", { exact: true })
    .fill("Review-staff-password-594!");
  await save(admin);
  await nav(admin, "QR centre");
  const passengerUrl = await generate("Passenger ordering", "S1");
  const itemUrl = await generate("Staff item collection", "Mineral water");
  const locationUrl = await generate("Staff compartment location", "S1");
  await admin
    .getByRole("button", { name: "View / download", exact: true })
    .first()
    .click();
  await expect(
    admin.getByRole("link", { name: "Open QR workflow" }),
  ).toHaveAttribute("href", locationUrl);
  await admin.getByRole("button", { name: "Close QR preview" }).click();
  await nav(admin, "Review all views");
  await admin
    .getByLabel("Staff member", { exact: true })
    .selectOption({ label: "Review Staff" });
  await expect(
    admin.getByRole("button", { name: "Scan food QR", exact: true }),
  ).toBeDisabled();
  await admin
    .getByRole("button", { name: "Scan & confirm", exact: true })
    .click();
  await expect(
    admin.getByRole("button", { name: "Scan with camera", exact: true }),
  ).toBeDisabled();
  const passenger = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  passenger.on("pageerror", (error) => errors.push(error.message));
  await passenger.goto(origin + "/user");
  await expect(
    passenger.getByRole("heading", { name: "Passenger sign in", exact: true }),
  ).toBeVisible();
  await expect(
    passenger.getByLabel("Email address", { exact: true }),
  ).toHaveCount(0);
  await passenger
    .getByLabel("Passenger QR link or code", { exact: true })
    .fill(passengerUrl);
  await passenger
    .getByRole("button", {
      name: "Continue to mobile verification",
      exact: true,
    })
    .click();
  await expect(passenger).toHaveURL(
    origin + "/p/" + passengerUrl.split("/").pop(),
  );
  await expect(
    passenger.getByRole("heading", { name: "Let’s get you settled in" }),
  ).toBeVisible();
  await expect(
    passenger.getByRole("button", { name: "Order food", exact: true }),
  ).toHaveCount(0);
  await passenger
    .getByLabel("Mobile number", { exact: true })
    .fill("9876543210");
  await passenger
    .getByRole("button", { name: "Send verification code" })
    .click();
  await expect(passenger.getByRole("status")).toContainText("backend terminal");
  await passenger
    .getByLabel("Verification code", { exact: true })
    .fill(passengerCode === "000000" ? "111111" : "000000");
  await passenger.getByRole("button", { name: "Verify & continue" }).click();
  await expect(passenger.getByRole("alert")).toContainText(
    "Incorrect verification code",
  );
  await passenger
    .getByLabel("Verification code", { exact: true })
    .fill(passengerCode);
  await passenger.screenshot({
    path: ".data/browser-check/passenger-otp-mobile.png",
    fullPage: true,
  });
  await passenger.getByRole("button", { name: "Verify & continue" }).click();
  await expect(
    passenger.getByRole("button", { name: "Order food", exact: true }),
  ).toBeVisible();
  await passenger.reload();
  await expect(
    passenger.getByRole("button", { name: "Order food", exact: true }),
  ).toBeVisible();
  await expect(
    passenger.getByRole("region", { name: "Animated railway landscape" }),
  ).toBeVisible();
  const railwayVideo = passenger.locator(".railway-video");
  await expect(railwayVideo).toHaveJSProperty("videoWidth", 1280);
  await expect(railwayVideo).toHaveJSProperty("paused", false);
  await expect
    .poll(() =>
      railwayVideo.evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(0.1);
  await passenger
    .getByRole("button", { name: "Pause railway animation" })
    .click();
  await expect(railwayVideo).toHaveJSProperty("paused", true);
  await passenger
    .getByRole("button", { name: "Play railway animation" })
    .click();
  await expect(railwayVideo).toHaveJSProperty("paused", false);
  await passenger.emulateMedia({ reducedMotion: "reduce" });
  await expect(railwayVideo).toHaveJSProperty("paused", true);
  await passenger.emulateMedia({ reducedMotion: "no-preference" });
  await expect(railwayVideo).toHaveJSProperty("paused", false);
  await expect
    .poll(() =>
      railwayVideo.evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(2.5);
  await passenger.setViewportSize({ width: 1440, height: 1000 });
  await passenger.screenshot({
    path: ".data/browser-check/passenger-welcome-desktop.png",
    animations: "disabled",
    fullPage: true,
  });
  await passenger.setViewportSize({ width: 390, height: 844 });
  await expect(
    passenger.getByRole("heading", { name: "Stay in your seat" }),
  ).toBeVisible();
  await passenger.screenshot({
    path: ".data/browser-check/passenger-welcome-mobile.png",
    animations: "disabled",
    fullPage: true,
  });
  await passenger
    .getByRole("button", { name: "Order food", exact: true })
    .click();
  await expect(
    passenger.getByRole("heading", { name: "Mineral water", exact: true }),
  ).toBeVisible();
  await passenger
    .getByRole("button", { name: "Add Mineral water", exact: true })
    .click();
  await passenger.getByLabel("Your seat / berth", { exact: true }).fill("24");
  await passenger.screenshot({
    path: ".data/browser-check/passenger-mobile.png",
    fullPage: true,
  });
  expect(
    await passenger.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await passenger.getByRole("button", { name: "Send request" }).click();
  await expect(passenger).toHaveURL(/\/r\//);
  await expect(
    passenger.getByText(
      "Request sent successfully. Follow its current status below.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    passenger.getByRole("heading", { name: "Request received successfully" }),
  ).toBeVisible();
  await expect(
    admin.getByRole("region", { name: "Incoming passenger requests" }),
  ).toContainText("1 passenger request(s) awaiting assignment", {
    timeout: 12000,
  });
  await expect(
    passenger.getByText("Awaiting assignment", { exact: true }),
  ).toBeVisible();
  await nav(admin, "Requests");
  await admin.getByRole("button", { name: "Refresh data" }).click();
  await admin
    .getByRole("button", { name: "Assign staff", exact: true })
    .click();
  await admin
    .getByLabel("Staff member", { exact: true })
    .selectOption({ label: "Review Staff" });
  await save(admin);
  const staff = await admin.context().newPage();
  await staff.setViewportSize({ width: 390, height: 844 });
  staff.on("pageerror", (error) => errors.push(error.message));
  await staff.goto(origin + "/staff/");
  await expect(
    staff.getByRole("heading", { name: "Service staff sign in" }),
  ).toBeVisible();
  await admin.goto(itemUrl);
  await expect(
    admin.getByRole("heading", { name: "Service staff sign in" }),
  ).toBeVisible();
  await admin.goto(origin);
  await expect(
    admin.getByRole("heading", { name: "Welcome, Review." }),
  ).toBeVisible();
  await staff.goto(origin + "/scan/" + itemUrl.split("/").pop());
  await expect(
    staff.getByRole("heading", { name: "Service staff sign in" }),
  ).toBeVisible();
  await staff
    .getByLabel("Email address", { exact: true })
    .fill("review-staff@example.test");
  await staff
    .getByLabel("Password", { exact: true })
    .fill("Review-staff-password-594!");
  await staff.getByRole("button", { name: "Sign in securely" }).click();
  await expect(
    staff
      .getByRole("navigation")
      .getByRole("button", { name: "Inventory", exact: true }),
  ).toHaveCount(0);
  await admin.reload();
  await expect(
    admin.getByRole("heading", { name: "Welcome, Review." }),
  ).toBeVisible();
  await staff
    .getByRole("button", { name: "Validate code", exact: true })
    .click();
  await staff
    .getByRole("button", { name: "Confirm collection", exact: true })
    .click();
  await staff.getByLabel("Quantity you are taking", { exact: true }).fill("1");
  await save(staff);
  await staff.getByLabel("QR link or code", { exact: true }).fill(locationUrl);
  await staff
    .getByRole("button", { name: "Validate code", exact: true })
    .click();
  await staff
    .getByRole("button", { name: "Report this location", exact: true })
    .click();
  await save(staff);
  await staff.getByRole("button", { name: "Scan with camera" }).click();
  await expect(staff.getByRole("alert")).toContainText("Camera unavailable", {
    timeout: 15000,
  });
  const cameraQr = await QRCode.toDataURL(itemUrl, { width: 512, margin: 4 });
  await staff.evaluate("window.__name = (value) => value");
  await staff.evaluate((imageSource) => {
    document.body.dataset.cameraQr = imageSource;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        if (
          typeof constraints.video === "object" &&
          JSON.stringify(constraints.video.facingMode).includes("environment")
        ) {
          document.body.dataset.rearCameraRequested = "true";
        }
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 640;
        const context = canvas.getContext("2d")!;
        const image = new Image();
        image.src = document.body.dataset.cameraQr!;
        await image.decode();
        const draw = () => {
          context.fillStyle = "white";
          context.fillRect(0, 0, 640, 640);
          context.drawImage(image, 64, 64, 512, 512);
        };
        draw();
        const stream = canvas.captureStream(15);
        const timer = setInterval(draw, 65);
        stream
          .getVideoTracks()[0]
          .addEventListener("ended", () => clearInterval(timer));
        return stream;
      },
    });
  }, cameraQr);
  await staff.getByLabel("QR link or code", { exact: true }).fill("");
  await staff.getByRole("button", { name: "Toggle navigation" }).click();
  await nav(staff, "Assigned requests");
  await staff
    .getByRole("button", { name: "Scan food QR", exact: true })
    .click();
  await expect(
    staff.getByLabel("QR link or code", { exact: true }),
  ).toHaveValue(itemUrl.split("/").pop()!, { timeout: 15000 });
  await expect(staff.locator("body")).toHaveAttribute(
    "data-rear-camera-requested",
    "true",
  );
  await expect(
    staff.getByRole("button", { name: "Scan with camera", exact: true }),
  ).toBeVisible();
  await expect(staff.locator(".scanner video")).toHaveJSProperty(
    "srcObject",
    null,
  );
  await staff.evaluate(
    (source) => {
      document.body.dataset.cameraQr = source;
    },
    await QRCode.toDataURL(locationUrl, { width: 512, margin: 4 }),
  );
  await staff.getByRole("button", { name: "Toggle navigation" }).click();
  await nav(staff, "Assigned requests");
  await staff
    .getByRole("button", { name: "Scan compartment QR", exact: true })
    .click();
  await expect(
    staff.getByLabel("QR link or code", { exact: true }),
  ).toHaveValue(locationUrl.split("/").pop()!, { timeout: 15000 });
  await staff.getByRole("button", { name: "Toggle navigation" }).click();
  await nav(staff, "Assigned requests");
  await staff.screenshot({
    path: ".data/browser-check/staff-mobile.png",
    animations: "disabled",
    fullPage: true,
  });
  await staff
    .getByRole("button", { name: "Start service", exact: true })
    .click();
  await staff
    .getByRole("button", { name: "Record delivery", exact: true })
    .click();
  await save(staff);
  await expect(
    staff.getByRole("heading", { name: "You’re all caught up" }),
  ).toBeVisible();
  await passenger.reload();
  await expect(passenger.getByText("Delivered", { exact: true })).toBeVisible();
  await nav(admin, "Overview");
  await admin.getByRole("button", { name: "Refresh data" }).click();
  await expect(
    admin.getByText("Review Staff · S1", { exact: true }),
  ).toBeVisible();
  await admin.screenshot({
    path: ".data/browser-check/dashboard.png",
    fullPage: true,
  });
  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.screenshot({
    path: ".data/browser-check/admin-mobile.png",
    fullPage: true,
  });
  expect(
    await admin.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  assertNoErrors();
  console.log(
    "Browser checks passed: first-run setup, admin configuration, passenger OTP and mobile order, video playback, assignment, staff collection/location/delivery, camera QR decoding, camera-denial fallback, and responsive overflow checks.",
  );
} catch (error) {
  await admin.screenshot({
    path: ".data/browser-check/failure.png",
    fullPage: true,
  });
  console.error(await admin.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await db.close();
}
function assertNoErrors() {
  expect(errors).toEqual([]);
}
