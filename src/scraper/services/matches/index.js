import { openPageAndNavigate, waitForSelectorSafe } from "../../index.js";

export const getMatchLinks = async (context, leagueSeasonUrl, type) => {
  const page = await openPageAndNavigate(context, `${leagueSeasonUrl}/${type}`);

  const LOAD_MORE_SELECTOR = '[data-testid="wcl-buttonLink"]';
  const MATCH_SELECTOR =
    ".event__match.event__match--static.event__match--twoLine";
  const CLICK_DELAY = 600;
  const MAX_EMPTY_CYCLES = 4;

  let emptyCycles = 0;

  while (true) {
    const countBefore = await page.$$eval(MATCH_SELECTOR, (els) => els.length);

    const loadMoreBtn = await page.$(LOAD_MORE_SELECTOR);
    if (!loadMoreBtn) break;

    try {
      await loadMoreBtn.click();
      await page.waitForTimeout(CLICK_DELAY);
    } catch {
      break;
    }

    const countAfter = await page.$$eval(MATCH_SELECTOR, (els) => els.length);

    if (countAfter === countBefore) {
      emptyCycles++;
      if (emptyCycles >= MAX_EMPTY_CYCLES) break;
    } else {
      emptyCycles = 0;
    }
  }

  await waitForSelectorSafe(page, [MATCH_SELECTOR]);
  await page.waitForTimeout(500);

  const matchDataList = await page.evaluate(() => {
    const extractDate = (el) => {
      const candidates = [
        el.querySelector(".event__time"),
        el.querySelector(".event__stageTime--date"),
        el.querySelector("[class*='event__stageTime']"),
        el.querySelector("[data-testid='wcl-dateContent']"),
        el.querySelector("[class*='wcl-dateContent']"),
      ];
      for (const node of candidates) {
        const raw = node?.innerText?.trim();
        if (!raw) continue;
        const date = raw.split("\n")[0]?.trim();
        if (date) return date;
      }
      return undefined;
    };

    const elements = Array.from(
      document.querySelectorAll(
        ".headerLeague__wrapper, .event__round, .event__match.event__match--static.event__match--twoLine, .event__match",
      ),
    );

    let currentStage = ""; // Sub-level round label (e.g. "SEMI-FINALS", "ROUND 1")
    let currentSection = ""; // Top-level section header (e.g. "World Cup - Qualification")
    const matches = [];

    for (const el of elements) {
      if (el.classList.contains("headerLeague__wrapper")) {
        // Top-level section divider — reset round label and track section name
        currentSection = el.innerText.trim();
        currentStage = "";
      } else if (el.classList.contains("event__round")) {
        currentStage = el.innerText.trim();
      } else if (el.classList.contains("event__match")) {
        // Skip matches that belong to a qualifications section
        if (/qualif/i.test(currentSection)) continue;
        const id = el.id?.replace("g_1_", "")?.replace("g_4_", "");
        const url = el.querySelector("a.eventRowLink")?.href ?? null;
        const midFromUrl = url?.match(/[?&]mid=([^&]+)/)?.[1];
        const matchId = id || midFromUrl;

        const date = extractDate(el);

        const homeName =
          el.querySelector(".event__participant--home")?.innerText.trim() ||
          el
            .querySelector(
              ".event__homeParticipant [data-testid='wcl-scores-simple-text-01']",
            )
            ?.innerText.trim();
        const homeImage =
          el.querySelector(".event__logo--home")?.src ||
          el.querySelector(".event__homeParticipant img")?.src;

        const awayName =
          el.querySelector(".event__participant--away")?.innerText.trim() ||
          el
            .querySelector(
              ".event__awayParticipant [data-testid='wcl-scores-simple-text-01']",
            )
            ?.innerText.trim();
        const awayImage =
          el.querySelector(".event__logo--away")?.src ||
          el.querySelector(".event__awayParticipant img")?.src;

        const homeScoreRaw = el
          .querySelector(".event__score--home")
          ?.innerText.trim();
        const awayScoreRaw = el
          .querySelector(".event__score--away")
          ?.innerText.trim();

        const isNotStarted = homeScoreRaw === "-" || !homeScoreRaw;

        let finalHomeScore = homeScoreRaw;
        let finalAwayScore = awayScoreRaw;

        if (!isNotStarted) {
          // Attempt to calculate regulation time score (sum of periods 1-3)
          let homeRegScore = 0;
          let awayRegScore = 0;
          let hasPeriods = false;

          for (let p = 1; p <= 3; p++) {
            const hPart = el
              .querySelector(`.event__part--home.event__part--${p}`)
              ?.innerText.trim();
            const aPart = el
              .querySelector(`.event__part--away.event__part--${p}`)
              ?.innerText.trim();
            if (hPart && aPart) {
              homeRegScore += parseInt(hPart, 10);
              awayRegScore += parseInt(aPart, 10);
              hasPeriods = true;
            }
          }

          if (hasPeriods) {
            finalHomeScore = homeRegScore.toString();
            finalAwayScore = awayRegScore.toString();
          }
        }

        const result = isNotStarted
          ? {}
          : {
              home: finalHomeScore,
              away: finalAwayScore,
              regulationTime: undefined,
              penalties: undefined,
            };

        matches.push({
          matchId,
          url,
          stage: currentStage,
          date,
          status: isNotStarted ? "NOT STARTED" : "FINISHED",
          home: { name: homeName, image: homeImage },
          away: { name: awayName, image: awayImage },
          result,
          information: [],
          statistics: [],
        });
      }
    }

    return matches;
  });

  await page.close();

  const validMatches = matchDataList.filter(
    (match) => match.home?.name && match.away?.name && match.date,
  );
  if (validMatches.length < matchDataList.length) {
    console.warn(
      `⚠️  ${type}: ${matchDataList.length - validMatches.length} matches missing team names or date`,
    );
  }
  console.info(
    `✅ Found ${validMatches.length} valid matches for ${type} (${matchDataList.length} raw)`,
  );
  return validMatches;
};

export const getMatchData = async (context, { id: matchId, url }) => {
  const page = await openPageAndNavigate(context, url);

  await waitForSelectorSafe(page, [
    ".duelParticipant__startTime",
    "div[data-testid='wcl-summaryMatchInformation'] > div'",
  ]);

  const matchData = await extractMatchData(page);
  const information = await extractMatchInformation(page);

  const statsLink = buildStatsUrl(url);
  await page.goto(statsLink, { waitUntil: "domcontentloaded" });

  await waitForSelectorSafe(page, [
    "div[data-testid='wcl-statistics']",
    "div[data-testid='wcl-statistics-value']",
  ]);

  const statistics = await extractMatchStatistics(page);

  await page.close();
  return { matchId, ...matchData, information, statistics };
};

const buildStatsUrl = (matchUrl) => {
  if (!matchUrl) return null;

  const url = new URL(matchUrl);
  const base = url.origin + url.pathname.replace(/\/$/, "");
  const mid = url.searchParams.get("mid");

  return `${base}/summary/stats/0/?mid=${mid}`;
};

const extractMatchData = async (page) => {
  await waitForSelectorSafe(page, [
    "span[data-testid='wcl-scores-overline-03']",
    ".duelParticipant__startTime",
    ".fixedHeaderDuel__detailStatus",
    ".tournamentHeader__country > a",
    ".detailScore__wrapper span:not(.detailScore__divider)",
    ".duelParticipant__home .participant__image",
    ".duelParticipant__away .participant__image",
    ".duelParticipant__home .participant__participantName.participant__overflow",
    ".duelParticipant__away .participant__participantName.participant__overflow",
  ]);

  return await page.evaluate(() => {
    return {
      stage: Array.from(
        document.querySelectorAll("span[data-testid='wcl-scores-overline-03']"),
      )?.[2]
        ?.innerText.trim()
        ?.split(" - ")
        .pop()
        .trim(),
      date: document
        .querySelector(".duelParticipant__startTime")
        ?.innerText.trim(),
      status:
        document
          .querySelector(".fixedHeaderDuel__detailStatus")
          ?.innerText.trim() ?? "NOT STARTED",
      home: {
        name: document
          .querySelector(
            ".duelParticipant__home .participant__participantName.participant__overflow",
          )
          ?.innerText.trim(),
        image: document.querySelector(
          ".duelParticipant__home .participant__image",
        )?.src,
      },
      away: {
        name: document
          .querySelector(
            ".duelParticipant__away .participant__participantName.participant__overflow",
          )
          ?.innerText.trim(),
        image: document.querySelector(
          ".duelParticipant__away .participant__image",
        )?.src,
      },
      result: {
        home: Array.from(
          document.querySelectorAll(
            ".detailScore__wrapper span:not(.detailScore__divider)",
          ),
        )?.[0]?.innerText.trim(),
        away: Array.from(
          document.querySelectorAll(
            ".detailScore__wrapper span:not(.detailScore__divider)",
          ),
        )?.[1]?.innerText.trim(),
        regulationTime: document
          .querySelector(".detailScore__fullTime")
          ?.innerText.trim()
          .replace(/[\n()]/g, ""),
        penalties: Array.from(
          document.querySelectorAll('[data-testid="wcl-scores-overline-02"]'),
        )
          .find(
            (element) => element.innerText.trim().toLowerCase() === "penalties",
          )
          ?.nextElementSibling?.innerText?.trim()
          .replace(/\s+/g, ""),
      },
    };
  });
};

const extractMatchInformation = async (page) => {
  return await page.evaluate(async () => {
    const elements = Array.from(
      document.querySelectorAll(
        "div[data-testid='wcl-summaryMatchInformation'] > div",
      ),
    );
    return elements.reduce((acc, element, index) => {
      if (index % 2 === 0) {
        acc.push({
          category: element?.textContent
            .trim()
            .replace(/\s+/g, " ")
            .replace(/(^[:\s]+|[:\s]+$|:)/g, ""),
          value: elements[index + 1]?.innerText
            .trim()
            .replace(/\s+/g, " ")
            .replace(/(^[:\s]+|[:\s]+$|:)/g, ""),
        });
      }
      return acc;
    }, []);
  });
};

const extractMatchStatistics = async (page) => {
  return await page.evaluate(async () => {
    return Array.from(
      document.querySelectorAll("div[data-testid='wcl-statistics']"),
    ).map((element) => ({
      category: element
        .querySelector("div[data-testid='wcl-statistics-category']")
        ?.innerText.trim(),
      homeValue: Array.from(
        element.querySelectorAll(
          "div[data-testid='wcl-statistics-value'] > strong",
        ),
      )?.[0]?.innerText.trim(),
      awayValue: Array.from(
        element.querySelectorAll(
          "div[data-testid='wcl-statistics-value'] > strong",
        ),
      )?.[1]?.innerText.trim(),
    }));
  });
};
