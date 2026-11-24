'use strict';
// Sorts games from sources into clickable sections on the Downloads page (Big titles, Co-op, Horror...).
// Sources don't say what a game is, so this reads the title (and any tags/genres a source did give),
// plus a built-in list of well-known games. It is a best guess, never a promise. Pure and testable.

const SECTIONS = [
  { id: 'big', label: 'Big titles', blurb: 'Blockbusters and huge games' },
  { id: 'coop', label: 'Co-op & multiplayer', blurb: 'Play with friends' },
  { id: 'new', label: 'New', blurb: 'Added recently' },
  { id: 'openworld', label: 'Open world', blurb: 'Huge worlds to explore' },
  { id: 'shooter', label: 'Shooters', blurb: 'Guns and action' },
  { id: 'rpg', label: 'RPG', blurb: 'Story and characters' },
  { id: 'horror', label: 'Horror', blurb: 'Scary games' },
  { id: 'racing', label: 'Racing & sports', blurb: 'Cars, football and more' },
  { id: 'survival', label: 'Survival & building', blurb: 'Craft, build, survive' },
  { id: 'indie', label: 'Small & indie', blurb: 'Under 3 GB' },
];

// Words in a title or tag that mark a category.
const WORDS = {
  coop: /\b(co-?op|coop|multi-?player|online|lan|split[- ]?screen|party|2[- ]?player|4[- ]?player|pvp)\b/i,
  horror: /\b(horror|resident evil|silent hill|outlast|amnesia|alien isolation|dead space|phasmophobia|five nights|little nightmares|layers of fear|the evil within|dying light|until dawn|fatal frame|visage|alan wake|the forest|sons of the forest)\b/i,
  racing: /\b(racing|rally|forza|need for speed|gran turismo|dirt|grid|assetto|f1|fifa|ea fc|efootball|pes|nba|madden|nhl|wwe|ufc|pga|tony hawk|skate|trackmania|burnout|the crew|wrc|motogp|ride)\b/i,
  shooter: /\b(shooter|fps|call of duty|battlefield|doom|far cry|counter-?strike|halo|apex|overwatch|valorant|titanfall|borderlands|bioshock|crysis|metro|wolfenstein|rainbow six|ghost recon|payday|left 4 dead|back 4 blood|helldivers|destiny|warframe|cod)\b/i,
  rpg: /\b(rpg|witcher|baldur|dragon age|final fantasy|persona|elden ring|skyrim|oblivion|fallout|cyberpunk|mass effect|divinity|pillars|diablo|path of exile|dark souls|sekiro|monster hunter|kingdom come|starfield|fable|yakuza|like a dragon|xenoblade|nier|tales of|dragon'?s dogma|hogwarts legacy|disco elysium)\b/i,
  openworld: /\b(open[- ]world|grand theft auto|gta|red dead|witcher|skyrim|elden ring|fallout|assassin'?s creed|cyberpunk|horizon|far cry|watch dogs|just cause|saints row|spider-?man|ghost of tsushima|hogwarts legacy|starfield|days gone|mafia|the crew|forza horizon|death stranding|no man'?s sky|fuel|breath of the wild)\b/i,
  survival: /\b(survival|craft|minecraft|terraria|valheim|rust|ark|subnautica|raft|green hell|the forest|don'?t starve|7 days to die|project zomboid|satisfactory|factorio|rimworld|stardew|palworld|enshrouded|v rising|grounded|no man'?s sky|sons of the forest|astroneer)\b/i,
};

// Well-known co-op games that don't say so in their name.
const KNOWN_COOP = /\b(it takes two|a way out|left 4 dead|deep rock galactic|helldivers|lethal company|phasmophobia|don'?t starve together|terraria|stardew|valheim|risk of rain|overcooked|portal 2|borderlands|remnant|back 4 blood|vermintide|payday|world war z|monster hunter|diablo|path of exile|grounded|raft|sea of thieves|gang beasts|human fall flat|unravel|cuphead|castle crashers|escape simulator|content warning|peak|repo|schedule i|baldur'?s gate 3|divinity|sons of the forest|the forest|green hell|ark|rust|7 days to die|project zomboid|satisfactory|palworld|enshrouded|v rising|astroneer|the isle|vrising|warframe|destiny|payday|killing floor|ready or not|gtfo|barotrauma|space engineers|keep talking|moving out|spelunky|army of two|resident evil 5|resident evil 6|gears|halo|call of duty|battlefield|fortnite|minecraft)\b/i;

// Famous big-budget games. Anything 40 GB or more also counts as big.
const KNOWN_BIG = /\b(grand theft auto|gta|red dead|cyberpunk|witcher|elden ring|call of duty|assassin'?s creed|ea fc|fifa|battlefield|resident evil|god of war|spider-?man|hogwarts legacy|baldur'?s gate|starfield|fallout|skyrim|doom|far cry|forza|halo|horizon|last of us|mortal kombat|tekken|street fighter|final fantasy|dark souls|sekiro|monster hunter|death stranding|silent hill|alan wake|control|hitman|watch dogs|rainbow six|ghost of tsushima|ratchet|uncharted|gears|dying light|dead space|star wars|jedi|batman|arkham|mass effect|diablo|the division|metal gear|persona|like a dragon|yakuza|ghostwire|returnal|black myth|wukong|dragon age|crysis|bioshock|borderlands|nba 2k|madden|f1 \d\d|need for speed|the sims|civilization|total war|cod)\b/i;

function sizeToMB(text) {
  const m = /([\d.,]+)\s*(KB|MB|GB|TB)/i.exec(String(text || ''));
  if (!m) return null;
  return parseFloat(m[1].replace(',', '.')) * { KB: 1 / 1024, MB: 1, GB: 1024, TB: 1048576 }[m[2].toUpperCase()];
}

// Words that mean "this download is not a game": keep them out of sections like Co-op.
const NOISE = /\b(update|patch|dlc|soundtrack|ost|crack|fix|trainer|tool|redist)\b/i;

function categorize(item, now = Date.now()) {
  const title = String((item && item.title) || '');
  const extra = Array.isArray(item && item.tags) ? item.tags.join(' ') : '';
  const text = `${title} ${extra}`;
  const mb = sizeToMB(item && item.size);
  const out = [];
  const has = (k) => WORDS[k].test(text);

  if (KNOWN_BIG.test(title) || (mb !== null && mb >= 40 * 1024)) out.push('big');
  if (WORDS.coop.test(text) || KNOWN_COOP.test(text)) out.push('coop');
  const t = Date.parse(item && item.date);
  if (!Number.isNaN(t) && now - t >= 0 && now - t < 45 * 86400000) out.push('new');
  for (const k of ['openworld', 'shooter', 'rpg', 'horror', 'racing', 'survival']) if (has(k)) out.push(k);
  if (mb !== null && mb < 3 * 1024 && !out.includes('big')) out.push('indie');
  return NOISE.test(title) && !/\b(game of the year|goty)\b/i.test(title) ? out.filter((x) => x === 'new' || x === 'indie') : out;
}

module.exports = { SECTIONS, categorize, sizeToMB };
