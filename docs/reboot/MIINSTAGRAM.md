# Reboot — MIInstagram (R5, planned; working name)

MIInstagram is a photo social space inside the Mii world. It should feel like Miitomo grew a gallery, not like an
Instagram clone. It is REBOOT, SERVER REQUIRED for other people's posts, and simulated locally until R10.

## Flow

MIIFOTO → CREATE → EDIT → SAVE → POST → SHARE

- The original Miifoto (CLASSIC) stays as it is.
- Miifoto 2 adds the following. Pose and background sets are reused from the original assets where possible; new
  ones are labelled.
  - several Miis in one photo;
  - poses;
  - backgrounds;
  - elements;
  - text;
  - filters.
- **POST** creates a persistent `Post`: image, caption, visibility, outfit tags, tagged profiles, and optionally a room.

## Feed and profile

- The **feed** is paginated. Each post card shows:
  - author (Mii + nickname);
  - time;
  - reactions;
  - comment count.
  - From a card, the user can open the author's profile or their room.
- The **profile** shows:
  - Mii and nickname;
  - bio;
  - photos;
  - current outfit;
  - room link;
  - optional stats.

## Reactions

Reactions are an extensible, server-side table (`ReactionDef`: id, label, icon, order), not a fixed heart. The first
set should come from the Miitomo world. A natural source is the four personality moods, or the original emotion faces
the Mii already has. The set is decided when R5 starts; nothing is invented now.

## Comments

- A comment belongs to a post and has an author profile.
- Comments are rate-limited to one every 5 s sustained (client side) and enforced again on the server.
- They can be deleted by their author or by the post owner, and can be reported.

## Contracts

The contracts are `feed`, `postsBy`, `createPost`, `deletePost`, `reactionTypes`, `react`, `comments`, `comment` and
`deleteComment`, defined in `reboot/api/contracts.ts`.
