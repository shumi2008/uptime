const fs = require("fs");

async function main() {
  const response = await fetch(
    "https://www.fotmob.com/teams/10185/fixtures/maccabi-haifa",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(20000),
    }
  );
  const html = await response.text();
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  const data = JSON.parse(match[1]);
  const team = data?.props?.pageProps?.fallback?.["team-10185"];
  fs.writeFileSync(
    require("path").join(__dirname, "team-full.json"),
    JSON.stringify(team, null, 2)
  );
  console.log("keys", Object.keys(team || {}));
  const fixtures = team?.fixtures?.allFixtures?.fixtures;
  console.log("fixtures", fixtures?.length);
  if (fixtures?.length) {
    console.log(
      fixtures
        .filter((f) => !f.status?.finished)
        .slice(0, 5)
        .map((f) => ({
          home: f.home?.name || f.home,
          away: f.away?.name || f.away,
          utc: f.status?.utcTime,
          tournament: f.tournament?.name,
        }))
    );
  }
}

main().catch(console.error);
