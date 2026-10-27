// REBOOT R6.0b unit tests — the Reboot economy (Wallet: rules, daily caps, once keys, spend, ledger, persistence, a new
// day) and the Reboot shop inventory (catalogue, starters, buy, equip, refusals). Run from client/web:
//   npx tsx ../../tests/unit/economy.test.mts
import { Wallet, EARN, WALLET_KEY } from '../../client/web/src/reboot/economy/Wallet';
import { Inventory, INVENTORY_KEY } from '../../client/web/src/reboot/shop/Inventory';
import { SHOP_ITEMS, SHOP_KINDS, itemById } from '../../client/web/src/reboot/shop/catalog';
import { STRINGS } from '../../client/web/src/reboot/i18n/strings';
import { kv } from './r5-fakehost.mts';

let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
let now = new Date(2026, 9, 27, 10, 0, 0);
const clock = { now: () => now };

// ---------------- wallet
const store = kv();
const w = new Wallet(store, clock);
const ev: string[] = []; w.subscribe((e) => ev.push(`${e.type}:${e.entry.amount}`));
ok('start: 0 coins, empty history', w.balance === 0 && w.ledger.length === 0);
ok('welcome pays once', w.earn('welcome', { once: 'welcome' }).ok && !w.earn('welcome', { once: 'welcome' }).ok && w.balance === EARN.welcome.amount);
const caps: boolean[] = []; for (let i = 0; i < 5; i++) caps.push(w.earn('post.photo').ok);
ok('daily cap: 3 photos pay, the 4th and 5th are CAPPED', caps.join() === 'true,true,true,false,false' && w.usedToday('post.photo') === 3, caps);
const r1 = w.earn('visit.friend', { once: 'visit:f1:day1' }), r2 = w.earn('visit.friend', { once: 'visit:f1:day1' });
ok('once key: the same friend\'s visit pays once a day (ALREADY), no change on refusal', r1.ok && !r2.ok && (r2 as any).code === 'ALREADY' && w.usedToday('visit.friend') === 1);
const bal = w.balance;
ok('ledger: newest first, with the rule as reason; events for each payment', w.ledger[0].reason === 'earn.visit.friend' && w.ledger.length === 5 && ev.length === 5 && ev.every((x) => x.startsWith('earned:')));
ok('spend: refuses more than the balance (INSUFFICIENT), nothing changes', (w.spend(bal + 1, 'spend.shop') as any).code === 'INSUFFICIENT' && w.balance === bal);
ok('spend: refuses zero, negative, fractional (INVALID)', ['0', '-5', '2.5'].every((n) => (w.spend(Number(n), 'spend.shop') as any).code === 'INVALID'));
ok('spend: takes the coins and writes the history', w.spend(20, 'spend.shop', { item: '@item.cover.mint' }).ok && w.balance === bal - 20 && w.ledger[0].amount === -20 && ev.at(-1) === 'spent:-20');
ok('persisted: a new wallet reads balance, history, caps and once keys', (() => { const w2 = new Wallet(store, clock); return w2.balance === w.balance && w2.ledger.length === w.ledger.length && !w2.earn('post.photo').ok && !w2.earn('welcome', { once: 'welcome' }).ok; })());
now = new Date(2026, 9, 28, 9, 0, 0);
ok('a new day: daily caps reset; once keys do not', w.earn('post.photo').ok && w.usedToday('post.photo') === 1 && !w.earn('welcome', { once: 'welcome' }).ok);
ok('daily bonus: once a day', w.earn('daily').ok && !w.earn('daily').ok);
ok('unknown rule: INVALID', (w.earn('nope' as any) as any).code === 'INVALID');
store.m.set(WALLET_KEY, '{"v":1,"balance":"lots"}');
ok('corrupt or tampered record: starts clean (no invented coins)', new Wallet(store, clock).balance === 0);
store.m.set(WALLET_KEY, '{"v":1,"balance":-40,"ledger":[],"once":[],"day":"","today":{}}');
ok('negative balance in storage: clamped to 0', new Wallet(store, clock).balance === 0);
const full = { getItem: () => null, setItem: () => { throw Object.assign(new Error('q'), { name: 'QuotaExceededError' }); } };
const wf = new Wallet(full, clock); wf.earn('welcome');
ok('storage full: works this session, error kept', wf.balance === EARN.welcome.amount && wf.lastError === 'QuotaExceededError');
ok('rules: every rule has a positive amount and texts in every language', Object.entries(EARN).every(([k, r]) => r.amount > 0 && STRINGS.en['rule.' + k] && STRINGS.it['rule.' + k] && STRINGS.en['earn.' + k] && STRINGS.it['earn.' + k]));

// ---------------- shop
ok('catalogue: unique ids, one free starter per kind, priced items > 0, names in every language',
  new Set(SHOP_ITEMS.map((x) => x.id)).size === SHOP_ITEMS.length && SHOP_KINDS.every((k) => SHOP_ITEMS.filter((x) => x.kind === k && x.starter && x.price === 0).length === 1)
  && SHOP_ITEMS.filter((x) => !x.starter).every((x) => x.price > 0) && SHOP_ITEMS.every((x) => STRINGS.en[x.nameKey] && STRINGS.it[x.nameKey]));
const s2 = kv(); now = new Date(2026, 9, 27, 10, 0, 0);
const wallet = new Wallet(s2, clock); wallet.earn('welcome', { once: 'welcome' });    // 50 coins
const inv = new Inventory(s2, wallet);
ok('starters: owned and in use from the start', SHOP_KINDS.every((k) => inv.owns(inv.equipped(k)) && itemById(inv.equipped(k))!.starter));
ok('equip something not owned: NOT_OWNED', (inv.equip('cover.mint') as any).code === 'NOT_OWNED' && inv.equipped('cover') === 'cover.orange');
ok('buy too dear: INSUFFICIENT, no coins taken, not owned', (inv.buy('cover.night') as any).code === 'INSUFFICIENT' && wallet.balance === 50 && !inv.owns('cover.night'));
let told = 0; inv.subscribe(() => told++);
ok('buy: coins spent, owned, history names the item (i18n reference)', inv.buy('cover.mint').ok && wallet.balance === 10 && inv.owns('cover.mint') && wallet.ledger[0].vars?.item === '@item.cover.mint' && told === 1);
ok('buy twice: OWNED, no coins taken', (inv.buy('cover.mint') as any).code === 'OWNED' && wallet.balance === 10);
ok('equip: in use, announced; equip again = no change', inv.equip('cover.mint').ok && inv.equipped('cover') === 'cover.mint' && told === 2 && inv.equip('cover.mint').ok && told === 2);
ok('unknown item: UNKNOWN', (inv.buy('cover.gold-plated') as any).code === 'UNKNOWN');
ok('persisted: owned and in use survive a reload', (() => { const i2 = new Inventory(s2, new Wallet(s2, clock)); return i2.owns('cover.mint') && i2.equipped('cover') === 'cover.mint'; })());
s2.m.set(INVENTORY_KEY, JSON.stringify({ v: 1, owned: ['cover.night', 'nope'], equipped: { cover: 'cover.grape', card: 'frame.gold', frame: 'nope' } }));
const i3 = new Inventory(s2, wallet);
ok('stored record checked: unknown ids dropped, nothing in use that is not owned or of another kind', !i3.owns('nope') && i3.equipped('cover') === 'cover.orange' && i3.equipped('card') === 'card.plain' && i3.equipped('frame') === 'frame.none');
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
