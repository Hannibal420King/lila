import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const roundController = await readFile(new URL('../../app/controllers/Round.scala', import.meta.url), 'utf8');

test('crawler game routes fall back to live challenges', () => {
  const crawlerStart = roundController.indexOf('if req.client.isCrawler');
  const browserStart = roundController.indexOf('\n    else', crawlerStart);

  assert.notEqual(crawlerStart, -1, 'crawler branch is missing');
  assert.notEqual(browserStart, -1, 'browser branch is missing');

  const crawlerBranch = roundController.slice(crawlerStart, browserStart);
  assert.match(crawlerBranch, /gameIfPresentOrFetch\(gameId\)/);
  assert.match(crawlerBranch, /case Some\(game\)/);
  assert.match(crawlerBranch, /views\.round\.crawler\(game\.pov\(color\)\)/);
  assert.match(
    crawlerBranch,
    /case None => challengeC\.showId\(gameId\.into\(lila\.challenge\.ChallengeId\)\)/,
  );
});
