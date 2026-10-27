# QUESTIONS.md — questions & answers ("knowledge") (research, 2026-10-25)

## Where the questions came from — REVERSED
Questions were **server data** (Sakasho REST): `/v2/knowledge/players/@me/{questions,available_questions,available_bonus_questions,current_bonus_questions}`, `/v1/knowledge/players/@me/{knowns,unknowns,unknowns_random,liked_knowns,pending_questions,counts,owners}`, sub-Mii variants `/v1/sub_mii_knowledges/*`, the "Centro risposte" channel `/v1/channel/*`. JSON keys used by the client (strings of libcocos2dcpp.so): `knowledge_id, question_id, question, questions, question_parameter, category, answer_id, answer_setting, answerer_player_id, questioner_player_id, answer_updated_at, answered_knowledges, answered_knowledge_counts, knowledge_body, knowledge_comment, knowledge_heart, theme_id, theme_content`.

## What survived in the user's files — VERIFIED
| Data | File |
|---|---|
| Question lead-ins ("Allora,", "Dunque,", "Ehi,", "Dimmi,", "Sentiamo," … 24 lines) | System/KnowledgeHead/KH_EUit.msbt (APK + CDN) |
| Room lines around questions: noQuestion, questionNoAnswer, questionSameAnswer, todayQuestion1, bonusQuestion1, myCreateQuestion | Scene/RoomSceneTalkWords.msbt |
| Question UI layouts (knowledge v2-0/1/2, profile) and their labels | CDN layout + message zips |
| **Question texts** | **not found** in the APK, the CDN manifest (2,854 files) or public sources searched so far. They were delivered by `api.miitomo.com` only. |

## Consequence
The original question database is **missing**. M9 keeps "Chiedi qualcosa!" on the original `noQuestion` line. A future offline Q&A can use the original flow and lines with a **separate, clearly labelled replacement pack** (never mixed with original text, `source: "placeholder"` in the save) or questions supplied by the user; any preserved question list found later (community archives, Kaerutomo) would be imported as original.

## M13 update (2026-10-26)
- The message project `Arch.msbp` defines the question-list attribute set `kl_`: QuestionID, MessageType, start/end date + weekday, period type, IsOnce, AppearRate, IsPrivate, Genre1/2, ClearAnswer, Region, Age0–3, Male/Female, Difficulty, todayquestion, blockdays. So question lists were MSBT files in Nintendo's pipeline.
- None of the 607 files of the user's full Italian message zip (nor the APK) has that entry size: the lists were delivered by the server only. **Still missing.**
- KnowledgeHead `KH_EUit.msbt` decoded with `kh_`: each lead-in has UseForQuestion / UseForReportFriend / UseForReportMyself / ToLowerCase flags and a probability (e.g. "Dimmi, " questions only; "Lo sapevi? " reports only). Ready to be used when questions exist.
