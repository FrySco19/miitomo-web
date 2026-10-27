/**
 * REBOOT R3 — PublicRoomTemplate: what a kind of public room is (layout, capacity, interactables, activity, default
 * permissions). Data, not code: a new room type = a new row. R3 ships ONE complete template (vertical slice).
 *
 * layout: null = the owner's own room as it is (original room base + the owner's wall / floor). Templates with their
 * own decoration come later; recovered original assets stay local, new ones are kept apart (CLASSIC-VS-REBOOT.md).
 */
import type { RoomPermissions } from '../api/contracts';

export interface PublicRoomTemplate {
  id: string;
  title: string;
  layout: { wall: string; floor: string; variant: number } | null;
  /** Miis including the owner (2..8). */
  capacity: number;
  /** Which original interactables visitors may use: 'all' | 'none' | list of names. */
  interactables: 'all' | 'none' | string[];
  /** Activity of the room: 'social' = R2b life (chat, watch, wander, objects). Minigame activities arrive with R6/R7. */
  activity: 'social';
  permissions: RoomPermissions;
  /** Simulated visitors only (local provider): average stay and arrival gaps, seconds. */
  visits: { stay: [number, number]; gap: [number, number] };
}

export const PUBLIC_TEMPLATES: readonly PublicRoomTemplate[] = [
  {
    id: 'lounge', title: 'Salotto aperto', layout: null, capacity: 8, interactables: 'all', activity: 'social',
    permissions: { whoCanEnter: 'friends', whoCanInteract: 'everyone', activitiesOpen: true },
    visits: { stay: [70, 170], gap: [8, 22] },
  },
];
export const templateById = (id: string | null | undefined) => PUBLIC_TEMPLATES.find((t) => t.id === id) ?? PUBLIC_TEMPLATES[0];

/** R6: a room still called by its template's default title is shown with the template's translated name (`tpl.<id>`). */
export function roomTitle(info: { title: string; templateId?: string | null }, i18n: { has(k: string): boolean; t(k: string): string }) {
  const tpl = templateById(info.templateId);
  return info.title === tpl.title && i18n.has(`tpl.${tpl.id}`) ? i18n.t(`tpl.${tpl.id}`) : info.title;
}
