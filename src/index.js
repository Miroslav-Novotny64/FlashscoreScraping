import { createServer } from "http";
import { BASE_URL } from "./constants/index.js";
import { browserManager } from "./browser.js";
import { getMatchLinks } from "./scraper/services/matches/index.js";

const PORT = process.env.PORT || 8080;

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    const ready = browserManager.isReady();
    res.statusCode = ready ? 200 : 503;
    res.setHeader("Content-Type", "application/json");
    return res.end(
      JSON.stringify({
        status: ready ? "ok" : "degraded",
        browser: ready ? "connected" : "not connected",
      }),
    );
  }

  if (
    req.method === "GET" &&
    (url.pathname === "/" || url.pathname === "/api/scrape")
  ) {
    const sport = url.searchParams.get("sport");
    const country = url.searchParams.get("country");
    const league = url.searchParams.get("league");

    if (!sport || !country || !league) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          error: "Missing required query parameters: sport, country, league",
        }),
      );
    }

    if (!browserManager.acquireScrapeSlot()) {
      res.statusCode = 429;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Retry-After", "30");
      return res.end(
        JSON.stringify({
          error: "Scraper is busy, try again later",
        }),
      );
    }

    let context;
    try {
      context = await browserManager.createContext();

      const seasonUrl =
        `${BASE_URL}/${sport}/${country}/${league}`.toLowerCase();
      console.info(`Scraping ${seasonUrl}...`);

      const matchLinksResults = await getMatchLinks(
        context,
        seasonUrl,
        "results",
      );
      const matchLinksFixtures = await getMatchLinks(
        context,
        seasonUrl,
        "fixtures",
      );

      const matchLinks = [...matchLinksFixtures, ...matchLinksResults];

      if (matchLinks.length === 0) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        return res.end(
          JSON.stringify({
            error:
              "No matches found. Please verify that the league name provided is correct",
          }),
        );
      }

      const matchData = {};
      for (const matchLink of matchLinks) {
        const key = matchLink.matchId ?? matchLink.url;
        if (!key) continue;
        matchData[key] = matchLink;
      }

      const payloadCount = Object.keys(matchData).length;
      console.info(`✅ Returning ${payloadCount} matches to API client`);

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      return res.end(JSON.stringify(matchData));
    } catch (error) {
      console.error("Scraping error:", error);
      const message = error instanceof Error ? error.message : String(error);
      if (/browser|closed|context|launch/i.test(message)) {
        await browserManager.close();
      }
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({ error: "Scraping failed", details: message }),
      );
    } finally {
      if (context) {
        try {
          await context.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Error closing browser context: ${message}`);
        }
      }
      browserManager.releaseScrapeSlot();
      try {
        await browserManager.maybeRestartBrowser();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Error during browser restart check: ${message}`);
      }
    }
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: "Not Found" }));
});

const shutdown = async (signal) => {
  console.info(`Received ${signal}, shutting down...`);
  server.close();
  await browserManager.close();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.listen(PORT, "0.0.0.0", async () => {
  console.info(`Server listening on port ${PORT}`);
  try {
    await browserManager.warmup();
    console.info("Chromium warmup complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Chromium warmup failed, will retry on first scrape: ${message}`,
    );
  }
});
