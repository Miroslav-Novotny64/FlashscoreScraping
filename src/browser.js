import { chromium } from "playwright";

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-software-rasterizer",
];

const MAX_LAUNCH_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const MAX_SCRAPES_BEFORE_RESTART = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class BrowserManager {
  #browser = null;
  #launching = null;
  #scrapeCount = 0;
  #busy = false;

  isBusy() {
    return this.#busy;
  }

  isReady() {
    return this.#browser?.isConnected() ?? false;
  }

  async #launch(retries = MAX_LAUNCH_RETRIES) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.info(`Launching Chromium (attempt ${attempt}/${retries})...`);
        const browser = await chromium.launch({
          headless: true,
          args: LAUNCH_ARGS,
        });

        browser.on("disconnected", () => {
          console.warn("Chromium disconnected, will relaunch on next request");
          this.#browser = null;
        });

        console.info("Chromium launched successfully");
        return browser;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Chromium launch failed (attempt ${attempt}): ${message}`);
        if (attempt === retries) throw error;
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }

    throw new Error("Chromium launch failed after all retries");
  }

  async #getBrowser() {
    if (this.#browser?.isConnected()) {
      return this.#browser;
    }

    if (this.#launching) {
      return this.#launching;
    }

    this.#browser = null;
    this.#launching = this.#launch()
      .then((browser) => {
        this.#browser = browser;
        this.#launching = null;
        return browser;
      })
      .catch((error) => {
        this.#launching = null;
        throw error;
      });

    return this.#launching;
  }

  async warmup() {
    await this.#getBrowser();
  }

  async createContext() {
    const browser = await this.#getBrowser();
    return browser.newContext();
  }

  acquireScrapeSlot() {
    if (this.#busy) return false;
    this.#busy = true;
    return true;
  }

  releaseScrapeSlot() {
    this.#busy = false;
  }

  async maybeRestartBrowser() {
    this.#scrapeCount++;
    if (this.#scrapeCount < MAX_SCRAPES_BEFORE_RESTART) return;

    console.info(
      `Restarting Chromium after ${MAX_SCRAPES_BEFORE_RESTART} scrapes`,
    );
    this.#scrapeCount = 0;
    await this.close();
  }

  async close() {
    if (this.#browser) {
      try {
        await this.#browser.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Error closing Chromium: ${message}`);
      }
    }
    this.#browser = null;
    this.#launching = null;
  }
}

export const browserManager = new BrowserManager();
