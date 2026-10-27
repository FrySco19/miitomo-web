# API.md — historical Miitomo API inventory (research, 2026-10-25)

Sources: `reference-metadata/miitomo-2.4.0.rest-paths.txt` (125 path fragments from libsakasho/libcocos2dcpp strings), `miitomo-2.4.0.sakasho-api.txt` (251 Sakasho C calls), NETWORK.md. No traffic captures exist (the service ended in 2018), so **request/response bodies are unknown unless stated**. Nintendo services are never contacted.

Transport (NETWORK.md): HTTPS to `https://api.miitomo.com` (env 2007), Sakasho SDK (DeNA) — bodies LZ4 + per-byte obfuscation (`cookRequest` / `cookResponse`, community description unverified), request signature `generateRequestSignature`, session cookie `player_session_id`, identity via NPF / Nintendo Account (BaaS). Mii data encrypted server-side (`/v1/mii_data_encryption/{encrypt,decrypt}`).

| Group | Sakasho calls (examples) | Paths | Status |
|---|---|---|---|
| System / session | SystemInitialize, InternalCreatePlayer, InternalOpenSession, SystemGetServerVersion, SystemRetryAuth, SystemSwitchPlayer, SystemWithdraw | /v1/session, /v1/player, /v1/players, /v2/players, /v1/version | paths REVERSED; flow DEDUCED (create → open session → masters) |
| Masters / schedules / assets | MasterGetMasters(ByLabel), MasterGetDistributionSchedules(ByLabel), AssetGetAssetManifestUrls | /v1/masters, /v1/schedules, /v1/assets/manifest_urls | paths REVERSED; masters content (shop, events, questions?) **missing** |
| Player data / profile | PlayerDataSave/Load/Get/Delete, PlayerProfileGetProfile(AllFields), PlayerProfileSaveIntroduction, PlayerLastUpdateGetPlayerLastUpdates | /v1/players/@me, /profiles, /introductions, /last_updates, /read_and_save_player_data | paths REVERSED; blob format unknown |
| Mii | MiiEncrypt/Decrypt(WithJson), MiiGetMiisByPlayerId/ByPosition, MiiLock/Unlock/LockRandomly, MiiShareMii | /v1/miis, /v2/miis, /v1/miis/lock_someone, /v1/players/@me/shared_miis, /v1/mii_data_encryption/* | paths REVERSED |
| Knowledge (Q&A) | KnowledgeGetQuestions, KnowledgeGetAvailable(Bonus)Questions, KnowledgeCreateKnowledge, KnowledgeUpdateKnowledgeAnswer, KnowledgePendQuestion, KnowledgeGet{Known,Unknown}Knowledges…, comments, likes, share period | /v1/knowledge/players/@me/*, /v2/knowledge/players/@me/* | paths + JSON key names REVERSED (QUESTIONS.md); question texts **missing** |
| Sub-Mii knowledge | SubMiiKnowledge* (28 calls) | /v1/sub_mii_knowledges/* | paths REVERSED |
| Channel (Centro risposte / stile) | ChannelGetChannels/Themes/PopularAnswers, ChannelSubmitAnswer, comments, likes, ranking | /v1/channel/* | paths REVERSED |
| Friends | FriendGetFriends, FriendSendFriendRequest(ByFriendCode), Accept/Refuse/Delete, GenerateFriendCode, FriendSuggestion*, StarAccount* | /v1/players/@me/friends, /friend_requests/*, /v1/friend_code, /v2/players/@me/friend_suggestions[/pickup], /star_accounts | paths REVERSED |
| Messages | MessageSendMessage(AndSavePlayerData), MessageGet(Received)Messages, Read/Hide | /v1/players/@me/messages, /received_messages, /messages_and_player_data | paths REVERSED |
| Economy | InventoryGetInventories/Records, InventoryReceiveVirtualCurrencyFromInventory, PaymentGetProducts/Wallet/Purchase(AndSave)/RecoverPurchased, LoginBonus*, Poster* (purchase frames) | /v1/inventories, /v2/payment/, /v2/virtual_currency/purchase_limit_status, /v2/login_bonuses, /v2/players/@me/login_bonuses | paths REVERSED; prices / products **missing** (masters) |
| Progression | AchievementProgressAchievement, FashionabilityTakeFashionabilityAction, AffectionTakeAction, Members* (My Nintendo missions) | /v2/achievements, /v2/fashionabilities, /v1/affections, /v1/mission_rewards, /v2/players/@me/missions/progress | paths REVERSED |
| Album / poster / images | Album*, Poster*, ImageUploadImage | (not all recovered) | partial |
| Timeline / tags / SNS | TimelineGetTimeline(Player), EmotionalTagAddEmotionalTagsFromText, Sns* | /v1/timeline, /v1/timeline_player, /v1/emotional_tags, /v1/sns/* | paths REVERSED |
| Moderation | Inspection* (profanity, 11 report types) | /v1/inspections/violation_report/* | paths REVERSED |
| Analytics / log | AnalyticsSendEvent, LogSendLog | — | not needed |

## Architecture decision (central / P2P / hybrid)
**Decided by the user (2026-10-26): central — our own server, later.** Friends are local for now (`LocalProvider`,
SOCIAL.md); a `ServerProvider` will talk to our own backend. Nintendo servers / authentication are never used; P2P is
not the target architecture. Evidence agrees: every social object is a server resource with server ids (friend codes,
requests, messages, rankings, moderation, Mii locking for visits). Our API will be designed from the reversed resource
list above (accounts, friends, visits, answers, comments, hearts, greetings, outfits, rooms, notifications), not copied
from Sakasho's wire format.

## Next research steps
1. Verify the body obfuscation by emulating `cookRequest`/`cookResponse` (Unicorn) on known input.
2. Trace JSON parsing per call in libcocos2dcpp (`sakashoHelper::*` result handlers) to rebuild response schemas.
3. Masters: find what the client reads from `/v1/masters` (shop items, prices, events, question lists?).
