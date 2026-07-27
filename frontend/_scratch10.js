const { chromium } = require("playwright-core");
const STORE_CODE = "23114D50";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("http://localhost:3000/");
  await page.waitForURL("**/setup", { timeout: 10000 });
  const allInputs = page.locator("form input");
  await allInputs.nth(0).fill("http://localhost:8010");
  await allInputs.nth(1).fill(STORE_CODE);
  await allInputs.nth(2).fill("TST" + Date.now().toString().slice(-6));
  await page.click('button[type="submit"]');
  await page.waitForURL("**/login", { timeout: 10000 });
  for (const d of ["1", "1", "1", "1"]) await page.click(`button:has-text("${d}")`);
  await page.waitForURL("**/floor", { timeout: 10000 });

  await page.click("button:has-text('T3')");
  await page.waitForURL("**/orders/**", { timeout: 10000 });

  await page.click('button:has-text("+ เพิ่มรายการ")');
  await page.waitForTimeout(400);
  await page.screenshot({ path: "_s10_menu_modal.png" });

  await page.fill('input[placeholder="ค้นหาเมนู..."]', "ชา");
  await page.waitForTimeout(300);
  const visibleAfterSearch = await page.locator(".grid button div:first-child").allTextContents();
  console.log("Visible items after searching 'ชา':", visibleAfterSearch);
  await page.screenshot({ path: "_s10_search.png" });

  await page.click("text=ชาเย็น");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "_s10_stacked_modal.png" });
  console.log("Item modal + menu modal both visible:", await page.locator(".fixed").count());

  await page.click('button:has-text("เพิ่มลงบิล")');
  await page.waitForTimeout(500);

  // menu modal should still be open (didn't auto-close) so staff can add more items
  console.log("Menu modal still open after adding item:", await page.locator("text=เลือกเมนู").isVisible());

  await page.click('button:has-text("ปิด")');
  await page.waitForTimeout(200);
  console.log("Menu modal closed:", !(await page.locator("text=เลือกเมนู").isVisible()));

  console.log("Console errors:", errors);
  await browser.close();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
