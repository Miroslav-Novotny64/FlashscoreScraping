import { createServer } from "http";
import { chromium } from "playwright";
import { BASE_URL } from "./constants/index.js";
import { getMatchLinks } from "./scraper/services/matches/index.js";

const PORT = process.env.PORT || 8080;

const server = createServer(async (req, res) => {
  // Setup CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (req.method === "GET" && url.pathname === "/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ status: "ok" }));
  }
  
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/api/scrape")) {
    const sport = url.searchParams.get("sport");
    const country = url.searchParams.get("country");
    const league = url.searchParams.get("league");
    
    if (!sport || !country || !league) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Missing required query parameters: sport, country, league" }));
    }
    
    let browser;
    let context;
    try {
      // Launch headless browser using playwright
      browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
      context = await browser.newContext();
      
      const seasonUrl = `${BASE_URL}/${sport}/${country}/${league}`.toLowerCase();
      console.info(`Scraping ${seasonUrl}...`);
      
      const matchLinksResults = await getMatchLinks(context, seasonUrl, "results");
      const matchLinksFixtures = await getMatchLinks(context, seasonUrl, "fixtures");
      
      const matchLinks = [...matchLinksFixtures, ...matchLinksResults];

      if (matchLinks.length === 0) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: "No matches found. Please verify that the league name provided is correct" }));
      }

      // Convert array into a dictionary mapping matchId to matchData
      const matchData = {};
      matchLinks.forEach((matchLink) => {
        matchData[matchLink.matchId] = matchLink;
      });

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(matchData));
    } catch (error) {
      console.error("Scraping error:", error);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Scraping failed", details: error.message }));
    } finally {
      if (context) await context.close();
      if (browser) await browser.close();
    }
  } else {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Not Found" }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.info(`Server listening on port ${PORT}`);
});
